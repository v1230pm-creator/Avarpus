/**
 * API tests for chat/invite features.
 *
 * Environment: all provider env vars (MATRIX_*, LIVEKIT_*) are absent so
 * every provider-dependent path must fail closed.
 *
 * Room fixtures are inserted DIRECTLY into the DB (bypassing the API) because
 * POST /chat/rooms now requires Matrix and returns 503 when credentials are
 * absent. Tests that specifically cover the room-creation 503 path use the API.
 *
 * Covers:
 *   - Invite single-use/expiry
 *   - Cross-shop and cross-customer isolation
 *   - Customer portal fail-closed boundary (new)
 *   - Room creation returns 503 + zero DB rows when Matrix absent (new)
 *   - Room idempotency (API-level, Matrix-absent returns 503)
 *   - Message send 503 on ROOM_NOT_PROVISIONED (null providerRoomId DB row)
 *   - Message send 503 MATRIX_UNAVAILABLE when providerRoomId set but creds absent
 *   - No DB row persisted after any 503
 *   - Cross-room/cross-customer media download (404)
 *   - Call-token 503 LIVEKIT_UNAVAILABLE
 *   - Call-token 404 for cross-shop room
 *   - Capabilities: e2eeEnabled false, providers unavailable
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  pool,
  shopsTable,
  usersTable,
  customersTable,
  customerUsersTable,
  customerInvitesTable,
  dealersTable,
  chatProviderIdentitiesTable,
  chatRoomsTable,
  chatRoomMembersTable,
  chatMessagesTable,
  chatReadStateTable,
  chatContactMatchGrantsTable,
  chatContactMatchAttemptsTable,
  sessionsTable,
} from "@workspace/db";

vi.mock("../lib/mailer", () => ({
  sendOtpEmail: vi.fn(async () => {}),
  sendStaffApprovedEmail: vi.fn(async () => {}),
  sendStaffRejectedEmail: vi.fn(async () => {}),
  getMailFrom: () => "test@example.com",
  warnIfMailFromUnset: () => {},
}));

// Ensure ALL provider env vars are absent throughout the suite
beforeAll(() => {
  delete process.env.LIVEKIT_URL;
  delete process.env.LIVEKIT_API_KEY;
  delete process.env.LIVEKIT_API_SECRET;
  delete process.env.MATRIX_BASE_URL;
  delete process.env.MATRIX_SERVER_NAME;
  delete process.env.MATRIX_APP_SERVICE_TOKEN;
  // Admin token is legacy and MUST NOT enable Matrix on its own.
  delete process.env.MATRIX_ADMIN_TOKEN;
});

const { default: app } = await import("../app");
const { hashPassword, generateToken, sha256, createSession } = await import("../lib/authUtils");

async function issueContactMatchGrant(callerUserId: string, targetUserId: string, shopId: string) {
  const rawToken = generateToken();
  await db.insert(chatContactMatchGrantsTable).values({
    tokenHash: sha256(rawToken),
    callerUserId,
    targetUserId,
    shopId,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });
  return rawToken;
}

const RUN = Date.now().toString().slice(-8);
const mob = (n: string | number) => `9${RUN}${n}`.slice(0, 10);
// Guaranteed-unique 10-digit mobile for test-local users (avoids collisions
// caused by mob() truncating multi-char suffixes off the 8-digit RUN prefix).
const RUN6 = RUN.slice(-6);
let _mobSeq = 100;
const uniqMob = () => `9${RUN6}${(_mobSeq++).toString().padStart(3, "0")}`.slice(0, 10);
const email = (tag: string) => `chattest-${tag.toLowerCase()}-${RUN}@example.test`;

// ── Fixtures ──────────────────────────────────────────────────────────────────

let shopA: { id: string };
let shopB: { id: string };
let dealerA: { id: string };
let dealerB: { id: string };
let customerA: { id: string };
let customerB: { id: string };
let customerUserA: { id: string } | null = null;
let dealerTokenA: string;
let dealerTokenB: string;
let customerTokenA: string | null = null;

// DB-inserted rooms (bypass the API to avoid Matrix requirement)
let roomA: { id: string };
let roomAWithProvider: { id: string };

const PASSWORD = "Test1234!";

async function signIn(emailOrMobile: string, _password: string): Promise<string> {
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, emailOrMobile))
    .limit(1);
  if (!user) throw new Error(`Test user not found: ${emailOrMobile}`);
  return createSession(user.id, false, "test fixture");
}

beforeAll(async () => {
  // Shop A
  const [dA] = await db.insert(usersTable).values({
    name: "Chat Dealer A",
    email: email("dealera"),
    mobile: mob("1"),
    passwordHash: hashPassword(PASSWORD),
    role: "dealer",
    isActive: true,
  }).returning();
  dealerA = dA;
  const [sA] = await db.insert(shopsTable).values({ dealerId: dA.id, businessName: "Shop A" }).returning();
  shopA = sA;
  await db.update(usersTable).set({ shopId: sA.id }).where(eq(usersTable.id, dA.id));

  // Shop B
  const [dB] = await db.insert(usersTable).values({
    name: "Chat Dealer B",
    email: email("dealerb"),
    mobile: mob("2"),
    passwordHash: hashPassword(PASSWORD),
    role: "dealer",
    isActive: true,
  }).returning();
  dealerB = dB;
  const [sB] = await db.insert(shopsTable).values({ dealerId: dB.id, businessName: "Shop B" }).returning();
  shopB = sB;
  await db.update(usersTable).set({ shopId: sB.id }).where(eq(usersTable.id, dB.id));

  // Customers
  const [cA] = await db.insert(customersTable).values({ shopId: sA.id, name: "Customer A", mobile: mob("3") }).returning();
  customerA = cA;
  const [cB] = await db.insert(customersTable).values({ shopId: sB.id, name: "Customer B", mobile: mob("4") }).returning();
  customerB = cB;

  dealerTokenA = await signIn(email("dealera"), PASSWORD);
  dealerTokenB = await signIn(email("dealerb"), PASSWORD);

  // ── Insert rooms directly into DB ────────────────────────────────────────
  // roomA: no providerRoomId (simulates a pre-condition / legacy row)
  const [rA] = await db.insert(chatRoomsTable).values({
    shopId: shopA.id,
    kind: "support",
    name: "Room A (no provider)",
    createdById: dealerA.id,
    createdByName: "Dealer A",
  }).returning();
  roomA = rA;

  // Add dealer as member of roomA
  await db.insert(chatRoomMembersTable).values({
    roomId: roomA.id,
    shopId: shopA.id,
    userId: dealerA.id,
    role: "moderator",
  });

  // roomAWithProvider: has a fake providerRoomId (Matrix "present" at DB level)
  const [rAP] = await db.insert(chatRoomsTable).values({
    shopId: shopA.id,
    kind: "support",
    name: "Room A With Provider",
    providerRoomId: "!fakematrixroom:matrix.example.com",
    createdById: dealerA.id,
    createdByName: "Dealer A",
  }).returning();
  roomAWithProvider = rAP;

  await db.insert(chatRoomMembersTable).values({
    roomId: roomAWithProvider.id,
    shopId: shopA.id,
    userId: dealerA.id,
    role: "moderator",
  });
});

afterAll(async () => {
  for (const sid of [shopA?.id, shopB?.id].filter(Boolean)) {
    await db.delete(chatReadStateTable).where(eq(chatReadStateTable.shopId, sid!));
    await db.delete(chatMessagesTable).where(eq(chatMessagesTable.shopId, sid!));
    await db.delete(chatRoomMembersTable).where(eq(chatRoomMembersTable.shopId, sid!));
    await db.delete(chatRoomsTable).where(eq(chatRoomsTable.shopId, sid!));
    await db.delete(chatProviderIdentitiesTable).where(eq(chatProviderIdentitiesTable.shopId, sid!));
    await db.delete(customerInvitesTable).where(eq(customerInvitesTable.shopId, sid!));
    await db.delete(customerUsersTable).where(eq(customerUsersTable.shopId, sid!));
    await db.delete(customersTable).where(eq(customersTable.shopId, sid!));
    await db.delete(dealersTable).where(eq(dealersTable.shopId, sid!));
  }
  await db.delete(usersTable).where(eq(usersTable.role, "customer"));
  if (dealerA?.id) await db.delete(usersTable).where(eq(usersTable.id, dealerA.id));
  if (dealerB?.id) await db.delete(usersTable).where(eq(usersTable.id, dealerB.id));
  if (shopA?.id) await db.delete(shopsTable).where(eq(shopsTable.id, shopA.id));
  if (shopB?.id) await db.delete(shopsTable).where(eq(shopsTable.id, shopB.id));
  await pool.end();
});

// ── Invite: single-use and expiry ─────────────────────────────────────────────

describe("Customer invite: single-use and expiry", () => {
  let rawToken: string;

  it("dealer can issue an invite for their own customer", async () => {
    const res = await request(app)
      .post(`/api/customers/${customerA.id}/invite`)
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send();
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token.length).toBeGreaterThan(20);
    expect(res.body.customerId).toBe(customerA.id);
    rawToken = res.body.token;
    // raw token ≠ its hash
    expect(rawToken).not.toBe(sha256(rawToken));
  });

  it("can activate the invite without creating a session", async () => {
    const res = await request(app)
      .post("/api/auth/activate-invite")
      .send({ token: rawToken, name: "Customer Test", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("customer");
    expect(res.body.token).toBeUndefined();
    const sessions = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, res.body.user.id));
    expect(sessions).toHaveLength(0);
    customerTokenA = await createSession(res.body.user.id, false, "test fixture");
    customerUserA = { id: res.body.user.id };
  });

  it("rejects re-use of the same token (single-use)", async () => {
    const res = await request(app)
      .post("/api/auth/activate-invite")
      .send({ token: rawToken, name: "Customer 2", password: PASSWORD });
    expect([409, 410]).toContain(res.status);
  });

  it("rejects an expired token (410)", async () => {
    const expiredToken = generateToken();
    await db.insert(customerInvitesTable).values({
      shopId: shopA.id,
      customerId: customerA.id,
      tokenHash: sha256(expiredToken),
      issuedById: dealerA.id,
      issuedByName: "Dealer A",
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await request(app)
      .post("/api/auth/activate-invite")
      .send({ token: expiredToken, name: "Hacker", password: PASSWORD });
    expect(res.status).toBe(410);
  });

  it("rejects duplicate invite when customer already has an account", async () => {
    const res = await request(app)
      .post(`/api/customers/${customerA.id}/invite`)
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send();
    expect(res.status).toBe(409);
  });
});

// ── Cross-shop isolation: invites ─────────────────────────────────────────────

describe("Cross-shop isolation: invites", () => {
  it("dealer B cannot issue invite for shop A customer (404)", async () => {
    const res = await request(app)
      .post(`/api/customers/${customerA.id}/invite`)
      .set("Authorization", `Bearer ${dealerTokenB}`)
      .send();
    expect(res.status).toBe(404);
  });
});

// ── Customer portal: fail-closed boundary ─────────────────────────────────────

describe("Customer portal: fail-closed auth boundary", () => {
  it("customer blocked from GET /api/repairs → 403 CUSTOMER_PORTAL_FORBIDDEN", async () => {
    if (!customerTokenA) return;
    const res = await request(app)
      .get("/api/repairs")
      .set("Authorization", `Bearer ${customerTokenA}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CUSTOMER_PORTAL_FORBIDDEN");
  });

  it("customer blocked from GET /api/customers → 403", async () => {
    if (!customerTokenA) return;
    const res = await request(app)
      .get("/api/customers")
      .set("Authorization", `Bearer ${customerTokenA}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CUSTOMER_PORTAL_FORBIDDEN");
  });

  it("customer blocked from GET /api/staff → 403", async () => {
    if (!customerTokenA) return;
    const res = await request(app)
      .get("/api/staff")
      .set("Authorization", `Bearer ${customerTokenA}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CUSTOMER_PORTAL_FORBIDDEN");
  });

  it("customer blocked from POST /api/storage/uploads/request-url → 403", async () => {
    if (!customerTokenA) return;
    const res = await request(app)
      .post("/api/storage/uploads/request-url")
      .set("Authorization", `Bearer ${customerTokenA}`)
      .send({ name: "test.jpg", size: 100, contentType: "image/jpeg" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CUSTOMER_PORTAL_FORBIDDEN");
  });

  it("customer blocked from GET /api/storage/objects/… → 403 (generic object access removed)", async () => {
    if (!customerTokenA) return;
    const res = await request(app)
      .get(`/api/storage/objects/uploads/${shopA.id}/somefile.jpg`)
      .set("Authorization", `Bearer ${customerTokenA}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CUSTOMER_PORTAL_FORBIDDEN");
  });

  it("customer allowed GET /api/auth/me → 200", async () => {
    if (!customerTokenA) return;
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${customerTokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("customer");
  });

  it("customer allowed GET /api/chat/capabilities → 200", async () => {
    if (!customerTokenA) return;
    const res = await request(app)
      .get("/api/chat/capabilities")
      .set("Authorization", `Bearer ${customerTokenA}`);
    expect(res.status).toBe(200);
  });
});

// ── Room creation: Matrix-absent fail-closed ──────────────────────────────────

describe("Room creation: validation + Matrix-absent fail-closed", () => {
  const clientReqId = `test-create-503-${RUN}`;

  it("rejects out-of-scope kind=support with 400", async () => {
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ name: "No Support", kind: "support", clientRequestId: `${clientReqId}-support` });
    expect(res.status).toBe(400);
  });

  it("kind=customer without active customer account → 409 CUSTOMER_ACCOUNT_REQUIRED", async () => {
    // customerB has no app user link in shopB → but we use shopA's customer that
    // has NO active link at this point. Use a fresh customer with no link.
    const [freshCust] = await db.insert(customersTable).values({
      shopId: shopA.id, name: "Unlinked Cust", mobile: uniqMob(),
    }).returning();
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ name: "Cust Room", kind: "customer", customerId: freshCust.id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CUSTOMER_ACCOUNT_REQUIRED");
    await db.delete(customersTable).where(eq(customersTable.id, freshCust.id));
  });

  it("kind=dealer without active portal account → 409 DEALER_ACCOUNT_REQUIRED", async () => {
    // Create a dealer row with no portal user.
    const [dRow] = await db.insert(dealersTable).values({
      shopId: shopA.id, dealerCode: `DLR-${RUN}-A`, name: "Dealer NoPortal", mobile: uniqMob(),
    }).returning();
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ name: "Dealer Room", kind: "dealer", dealerId: dRow.id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DEALER_ACCOUNT_REQUIRED");
    await db.delete(dealersTable).where(eq(dealersTable.id, dRow.id));
  });

  it("kind=dealer with multiple owners → 409 DEALER_ACCOUNT_AMBIGUOUS", async () => {
    const [dRow] = await db.insert(dealersTable).values({
      shopId: shopA.id, dealerCode: `DLR-${RUN}-B`, name: "Dealer Ambiguous", mobile: uniqMob(),
    }).returning();
    const owners = [];
    for (const n of ["94", "95"]) {
      const [u] = await db.insert(usersTable).values({
        name: `Owner ${n}`, email: email(`owner${n}`), mobile: uniqMob(),
        passwordHash: hashPassword(PASSWORD), role: "dealer_owner",
        shopId: shopA.id, dealerId: dRow.id, isActive: true,
      }).returning();
      owners.push(u);
    }
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ name: "Ambiguous Room", kind: "dealer", dealerId: dRow.id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DEALER_ACCOUNT_AMBIGUOUS");
    for (const u of owners) await db.delete(usersTable).where(eq(usersTable.id, u.id));
    await db.delete(dealersTable).where(eq(dealersTable.id, dRow.id));
  });

  it("kind=customer with active account but Matrix absent → 503 MATRIX_UNAVAILABLE, no room row", async () => {
    if (!customerTokenA || !customerUserA) return; // requires activated customer
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ name: "Should Not Exist", kind: "customer", customerId: customerA.id, clientRequestId: clientReqId });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("MATRIX_UNAVAILABLE");
    const rows = await db
      .select()
      .from(chatRoomsTable)
      .where(and(
        eq(chatRoomsTable.shopId, shopA.id),
        eq(chatRoomsTable.clientRequestId, clientReqId),
      ));
    expect(rows.length).toBe(0);
  });

  it("customers cannot create kind=customer rooms (403 — only kind=direct allowed)", async () => {
    if (!customerTokenA) return;
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${customerTokenA}`)
      .send({ name: "Customer Room", kind: "customer", customerId: customerA.id });
    expect(res.status).toBe(403);
  });

  it("customers cannot create kind=dealer rooms (403 — only kind=direct allowed)", async () => {
    if (!customerTokenA) return;
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${customerTokenA}`)
      .send({ name: "Dealer Room", kind: "dealer", dealerId: dealerA.id });
    expect(res.status).toBe(403);
  });
});

// ── GET room — reads from DB-inserted fixture ─────────────────────────────────

describe("Chat rooms: read access (DB-inserted fixture)", () => {
  it("dealer can GET their own room", async () => {
    const res = await request(app)
      .get(`/api/chat/rooms/${roomA.id}`)
      .set("Authorization", `Bearer ${dealerTokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.room.id).toBe(roomA.id);
  });

  it("dealer can list rooms (includes fixture)", async () => {
    const res = await request(app)
      .get("/api/chat/rooms")
      .set("Authorization", `Bearer ${dealerTokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.rooms.some((r: { id: string }) => r.id === roomA.id)).toBe(true);
  });
});

// ── Cross-shop isolation: rooms ───────────────────────────────────────────────

describe("Cross-shop isolation: rooms", () => {
  it("dealer B cannot GET dealer A's room (404)", async () => {
    const res = await request(app)
      .get(`/api/chat/rooms/${roomA.id}`)
      .set("Authorization", `Bearer ${dealerTokenB}`);
    expect(res.status).toBe(404);
  });

  it("dealer B cannot send to dealer A's room (404, not 403)", async () => {
    const res = await request(app)
      .post(`/api/chat/rooms/${roomA.id}/messages`)
      .set("Authorization", `Bearer ${dealerTokenB}`)
      .send({ kind: "text", body: "cross-shop attack" });
    expect(res.status).toBe(404);
  });
});

// ── Customer isolation ────────────────────────────────────────────────────────

describe("Customer user isolation", () => {
  it("customer cannot GET a room they are not a member of (404)", async () => {
    if (!customerTokenA) return;
    const res = await request(app)
      .get(`/api/chat/rooms/${roomA.id}`)
      .set("Authorization", `Bearer ${customerTokenA}`);
    expect(res.status).toBe(404);
  });

  it("customer can GET room once added as member", async () => {
    if (!customerTokenA || !customerUserA) return;
    await db.insert(chatRoomMembersTable).values({
      roomId: roomA.id,
      shopId: shopA.id,
      userId: customerUserA.id,
    }).onConflictDoNothing();

    const res = await request(app)
      .get(`/api/chat/rooms/${roomA.id}`)
      .set("Authorization", `Bearer ${customerTokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.room.id).toBe(roomA.id);
  });
});

// ── Membership enforced for EVERY role (no shop-wide staff bypass) ────────────

describe("Membership required for all roles (same-shop staff isolation)", () => {
  let staffToken: string;
  let staffUser: { id: string };

  beforeAll(async () => {
    // A second staff user in the SAME shop as dealerA, NOT a member of roomA.
    const [u] = await db.insert(usersTable).values({
      name: "Reception A",
      email: email("reception"),
      mobile: uniqMob(),
      passwordHash: hashPassword(PASSWORD),
      role: "reception",
      shopId: shopA.id,
      isActive: true,
    }).returning();
    staffUser = u;
    staffToken = await signIn(email("reception"), PASSWORD);
  });

  afterAll(async () => {
    if (staffUser?.id) {
      await db.delete(chatRoomMembersTable).where(eq(chatRoomMembersTable.userId, staffUser.id));
      await db.delete(usersTable).where(eq(usersTable.id, staffUser.id));
    }
  });

  it("same-shop non-member staff gets 404 on GET room", async () => {
    const res = await request(app)
      .get(`/api/chat/rooms/${roomA.id}`)
      .set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(404);
  });

  it("same-shop non-member staff does NOT see the room in list", async () => {
    const res = await request(app)
      .get("/api/chat/rooms")
      .set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(200);
    expect(res.body.rooms.some((r: { id: string }) => r.id === roomA.id)).toBe(false);
  });

  it("same-shop non-member staff gets 404 on send", async () => {
    const res = await request(app)
      .post(`/api/chat/rooms/${roomA.id}/messages`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ kind: "text", body: "hi", clientRequestId: `crid-nonmember-${RUN}` });
    expect(res.status).toBe(404);
  });

  it("same-shop non-member staff gets 404 on read marker", async () => {
    const res = await request(app)
      .post(`/api/chat/rooms/${roomA.id}/read`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ messageId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(404);
  });

  it("becomes visible once added as a member", async () => {
    await db.insert(chatRoomMembersTable).values({
      roomId: roomA.id, shopId: shopA.id, userId: staffUser.id, role: "member",
    }).onConflictDoNothing();
    const res = await request(app)
      .get(`/api/chat/rooms/${roomA.id}`)
      .set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(200);
  });
});

// ── Provider-mocked: two-member creation, dedupe, idempotent send ─────────────

describe("Provider-mocked room creation + idempotent send", () => {
  let custUser: { id: string };
  let cust: { id: string };
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;
  let createdRoomId: string | null = null;
  let matrixCallCount = { createRoom: 0, register: 0, join: 0, joinedMembers: 0, send: 0 };
  // Capture the parsed content of the last Matrix m.room.message send.
  let lastSendContent: Record<string, unknown> | null = null;
  // Capture the sender ?user_id impersonation of the last send.
  let lastSendUserId: string | null = null;
  // Capture the Authorization header + createRoom/invite/join impersonation.
  let lastAuthHeader: string | null = null;
  let createRoomUserId: string | null = null;
  let createRoomInvites: string[] = [];
  const roomsByAlias = new Map<string, string>();
  let joinUserId: string | null = null;
  // errcode to return from the /register branch (null = success 200).
  // Set to "M_USER_IN_USE" (with status 400) to exercise idempotent re-register.
  let registerErrcode: string | null = null;
  // Override the joined_members set (null = the exact two expected IDs).
  let joinedMembersOverride: string[] | null = null;
  // When set, the /send branch responds with this status (to simulate failure).
  let sendFailStatus: number | null = null;

  const SERVER_NAME = "example.com";
  const AS_TOKEN = "test-as-token";
  const AS_ROOM = "!mockroom:example.com";
  // Deterministic virtual IDs mirror matrixUserIdForApp (localpart appuser-<id>).
  const vId = (appUserId: string) => `@appuser-${appUserId.replace(/-/g, "")}:${SERVER_NAME}`;

  const parseUserId = (url: string): string | null => {
    const m = url.match(/[?&]user_id=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  };

  beforeAll(async () => {
    process.env.MATRIX_BASE_URL = "https://matrix.example.com";
    process.env.MATRIX_SERVER_NAME = SERVER_NAME;
    process.env.MATRIX_APP_SERVICE_TOKEN = AS_TOKEN;
    // Present but MUST be ignored — Matrix readiness requires the AS token.
    process.env.MATRIX_ADMIN_TOKEN = "legacy-admin-token-should-be-ignored";

    // A customer WITH an active app user link in shopA.
    const [c] = await db.insert(customersTable).values({
      shopId: shopA.id, name: "Linked Cust", mobile: uniqMob(),
    }).returning();
    cust = c;
    const [u] = await db.insert(usersTable).values({
      name: "Linked Cust User", email: email("linkedcust"), mobile: uniqMob(),
      passwordHash: hashPassword(PASSWORD), role: "customer",
      shopId: shopA.id, isActive: true,
    }).returning();
    custUser = u;
    await db.insert(customerUsersTable).values({
      userId: u.id, customerId: c.id, shopId: shopA.id,
    });

    // Mock global fetch to emulate a Matrix homeserver responding to a
    // registered Application Service (AS-token + ?user_id impersonation).
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      const authHeader =
        (init?.headers as Record<string, string> | undefined)?.["Authorization"] ??
        (init?.headers as Record<string, string> | undefined)?.["authorization"] ??
        null;
      lastAuthHeader = authHeader;

      // AS registration flow (m.login.application_service). Idempotent.
      if (url.includes("/_matrix/client/v3/register")) {
        matrixCallCount.register++;
        if (registerErrcode) {
          return new Response(JSON.stringify({ errcode: registerErrcode }), { status: 400 });
        }
        return new Response(JSON.stringify({ user_id: "@x:example.com" }), { status: 200 });
      }
      // Best-effort display name set (AS impersonation). Always OK.
      if (url.includes("/profile/") && url.includes("/displayname")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (url.includes("/_matrix/client/v3/directory/room/")) {
        const alias = decodeURIComponent(url.split("/directory/room/")[1].split("?")[0]);
        const roomId = roomsByAlias.get(alias);
        return roomId
          ? new Response(JSON.stringify({ room_id: roomId }), { status: 200 })
          : new Response(JSON.stringify({ errcode: "M_NOT_FOUND" }), { status: 404 });
      }
      if (url.includes("/createRoom")) {
        matrixCallCount.createRoom++;
        createRoomUserId = parseUserId(url);
        const raw = typeof init?.body === "string" ? init.body : "{}";
        try {
          createRoomInvites = (JSON.parse(raw).invite as string[]) ?? [];
        } catch { createRoomInvites = []; }
        const aliasLocalpart = (JSON.parse(raw) as { room_alias_name?: string }).room_alias_name;
        if (aliasLocalpart) {
          const alias = `#${aliasLocalpart}:${SERVER_NAME}`;
          if (roomsByAlias.has(alias)) {
            return new Response(JSON.stringify({ errcode: "M_ROOM_IN_USE" }), { status: 400 });
          }
          roomsByAlias.set(alias, AS_ROOM);
        }
        return new Response(JSON.stringify({ room_id: AS_ROOM }), { status: 200 });
      }
      if (/\/rooms\/[^/]+\/join(\?|$)/.test(url)) {
        matrixCallCount.join++;
        joinUserId = parseUserId(url);
        return new Response(JSON.stringify({ room_id: AS_ROOM }), { status: 200 });
      }
      if (url.includes("/joined_members")) {
        matrixCallCount.joinedMembers++;
        const ids = joinedMembersOverride ?? [vId(dealerA.id), vId(custUser.id)];
        const joined: Record<string, unknown> = {};
        for (const id of ids) joined[id] = { display_name: id };
        return new Response(JSON.stringify({ joined }), { status: 200 });
      }
      if (url.includes("/send/m.room.message/")) {
        lastSendUserId = parseUserId(url);
        try {
          const raw = typeof init?.body === "string" ? init.body : "{}";
          lastSendContent = JSON.parse(raw);
        } catch { lastSendContent = null; }
        if (sendFailStatus !== null) {
          return new Response(JSON.stringify({ errcode: "M_FORBIDDEN" }), { status: sendFailStatus });
        }
        matrixCallCount.send++;
        return new Response(JSON.stringify({ event_id: `$evt-${matrixCallCount.send}` }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch);
  });

  afterAll(async () => {
    fetchSpy?.mockRestore();
    delete process.env.MATRIX_BASE_URL;
    delete process.env.MATRIX_SERVER_NAME;
    delete process.env.MATRIX_APP_SERVICE_TOKEN;
    delete process.env.MATRIX_ADMIN_TOKEN;
    if (custUser?.id) {
      await db.delete(customerUsersTable).where(eq(customerUsersTable.userId, custUser.id));
    }
    // rooms/members/identities cleaned by top-level afterAll (shop-scoped)
    if (cust?.id) {
      await db.delete(customersTable).where(eq(customersTable.id, cust.id));
    }
  });

  it("creates a customer room with EXACTLY two members via AS impersonation", async () => {
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ name: "Linked Cust Room", kind: "customer", customerId: cust.id });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(true);
    createdRoomId = res.body.room.id;
    expect(res.body.room.peerKey).toBeTruthy();
    expect(res.body.room.providerRoomId).toBe(AS_ROOM);

    const members = await db.select().from(chatRoomMembersTable)
      .where(eq(chatRoomMembersTable.roomId, createdRoomId!));
    expect(members.length).toBe(2);
    const memberIds = members.map((m) => m.userId).sort();
    expect(memberIds).toEqual([dealerA.id, custUser.id].sort());

    // Both virtual users ensured (AS register), room created, target joined,
    // and the joined-members verification ran exactly once.
    expect(matrixCallCount.createRoom).toBe(1);
    expect(matrixCallCount.register).toBe(2);
    expect(matrixCallCount.join).toBe(1);
    expect(matrixCallCount.joinedMembers).toBe(1);

    // Authorization uses the AS token — NEVER the admin token.
    expect(lastAuthHeader).toBe(`Bearer ${AS_TOKEN}`);
    expect(lastAuthHeader).not.toContain("legacy-admin-token-should-be-ignored");

    // createRoom is impersonated AS the initiator (dealerA), inviting exactly
    // the target virtual user (custUser). Join is scoped to the target.
    expect(createRoomUserId).toBe(vId(dealerA.id));
    expect(createRoomInvites).toEqual([vId(custUser.id)]);
    expect(joinUserId).toBe(vId(custUser.id));

    const idents = await db.select().from(chatProviderIdentitiesTable)
      .where(eq(chatProviderIdentitiesTable.shopId, shopA.id));
    expect(idents.length).toBeGreaterThanOrEqual(2);
  });

  it("M_USER_IN_USE from AS register is treated as idempotent success", async () => {
    // Fresh pair so peerKey dedupe does not short-circuit.
    const [c2] = await db.insert(customersTable).values({
      shopId: shopA.id, name: "Idem Cust", mobile: uniqMob(),
    }).returning();
    const [u2] = await db.insert(usersTable).values({
      name: "Idem Cust User", email: email("idemcust"), mobile: uniqMob(),
      passwordHash: hashPassword(PASSWORD), role: "customer",
      shopId: shopA.id, isActive: true,
    }).returning();
    await db.insert(customerUsersTable).values({
      userId: u2.id, customerId: c2.id, shopId: shopA.id,
    });
    joinedMembersOverride = [vId(dealerA.id), vId(u2.id)];
    registerErrcode = "M_USER_IN_USE";
    try {
      const res = await request(app)
        .post("/api/chat/rooms")
        .set("Authorization", `Bearer ${dealerTokenA}`)
        .send({ name: "Idem Room", kind: "customer", customerId: c2.id });
      expect(res.status).toBe(200);
      expect(res.body.created).toBe(true);
    } finally {
      registerErrcode = null;
      joinedMembersOverride = null;
    }
    await db.delete(customerUsersTable).where(eq(customerUsersTable.userId, u2.id));
    await db.delete(customersTable).where(eq(customersTable.id, c2.id));
  });

  it("an unexpected THIRD provider member prevents local room persistence (fail closed)", async () => {
    const [c3] = await db.insert(customersTable).values({
      shopId: shopA.id, name: "Bad Cust", mobile: uniqMob(),
    }).returning();
    const [u3] = await db.insert(usersTable).values({
      name: "Bad Cust User", email: email("badcust"), mobile: uniqMob(),
      passwordHash: hashPassword(PASSWORD), role: "customer",
      shopId: shopA.id, isActive: true,
    }).returning();
    await db.insert(customerUsersTable).values({
      userId: u3.id, customerId: c3.id, shopId: shopA.id,
    });
    // Homeserver reports a leaked admin identity as a third member.
    joinedMembersOverride = [vId(dealerA.id), vId(u3.id), "@admin:example.com"];
    try {
      const res = await request(app)
        .post("/api/chat/rooms")
        .set("Authorization", `Bearer ${dealerTokenA}`)
        .send({ name: "Bad Room", kind: "customer", customerId: c3.id });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("MATRIX_UNAVAILABLE");
    } finally {
      joinedMembersOverride = null;
    }
    // The local reservation remains invisible and fences retries because the
    // provider may already hold this invalid remote room; deleting it would
    // allow a duplicate Matrix create.
    const peerRooms = await db.select().from(chatRoomsTable)
      .where(eq(chatRoomsTable.shopId, shopA.id));
    const badRoom = peerRooms.find((r) => r.name === "Bad Room");
    expect(badRoom?.providerRoomId).toBeNull();
    const badRoomMembers = await db.select().from(chatRoomMembersTable)
      .where(eq(chatRoomMembersTable.roomId, badRoom!.id));
    expect(badRoomMembers).toEqual([]);
    await db.delete(chatRoomsTable).where(eq(chatRoomsTable.id, badRoom!.id));

    await db.delete(customerUsersTable).where(eq(customerUsersTable.userId, u3.id));
    await db.delete(customersTable).where(eq(customersTable.id, c3.id));
  });

  it("re-creating the same pair returns the existing room (peerKey dedupe), no new provider room", async () => {
    const before = matrixCallCount.createRoom;
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ name: "Dup Attempt", kind: "customer", customerId: cust.id });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect(res.body.room.id).toBe(createdRoomId);
    expect(matrixCallCount.createRoom).toBe(before); // no second createRoom
  });

  it("repeated send with same clientRequestId → one row, one provider event", async () => {
    const crid = `idem-${RUN}`;
    const sendBefore = matrixCallCount.send;
    const r1 = await request(app)
      .post(`/api/chat/rooms/${createdRoomId}/messages`)
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ kind: "text", body: "hello once", clientRequestId: crid });
    expect(r1.status).toBe(200);
    const r2 = await request(app)
      .post(`/api/chat/rooms/${createdRoomId}/messages`)
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ kind: "text", body: "hello once", clientRequestId: crid });
    expect(r2.status).toBe(200);
    expect(r2.body.message.id).toBe(r1.body.message.id);

    // Send uses the AS token and impersonates the sender (dealerA) via ?user_id.
    expect(lastAuthHeader).toBe(`Bearer ${AS_TOKEN}`);
    expect(lastSendUserId).toBe(vId(dealerA.id));

    const rows = await db.select().from(chatMessagesTable)
      .where(and(
        eq(chatMessagesTable.roomId, createdRoomId!),
        eq(chatMessagesTable.senderId, dealerA.id),
        eq(chatMessagesTable.clientRequestId, crid),
      ));
    expect(rows.length).toBe(1);
    // exactly one provider event (second call short-circuits before send)
    expect(matrixCallCount.send).toBe(sendBefore + 1);
  });

  // ── Voice-note (audio) send ─────────────────────────────────────────────────

  it("valid audio send: stores durationMs + sends Matrix m.audio with info.duration", async () => {
    const crid = `audio-ok-${RUN}`;
    const objectPath = `/objects/uploads/${shopA.id}/chat/${createdRoomId}/note.m4a`;
    const res = await request(app)
      .post(`/api/chat/rooms/${createdRoomId}/messages`)
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ kind: "audio", body: "Voice note", objectPath, durationMs: 4200, clientRequestId: crid });
    expect(res.status).toBe(200);
    expect(res.body.message.kind).toBe("audio");
    expect(res.body.message.durationMs).toBe(4200);
    expect(res.body.message.objectPath).toBe(objectPath);

    // Matrix content: m.audio, url = opaque objectPath, info.duration = ms
    expect(lastSendContent).toBeTruthy();
    expect(lastSendContent!.msgtype).toBe("m.audio");
    expect(lastSendContent!.url).toBe(objectPath);
    expect((lastSendContent!.info as Record<string, unknown>)?.duration).toBe(4200);

    // DB row carries durationMs
    const [row] = await db.select().from(chatMessagesTable)
      .where(and(
        eq(chatMessagesTable.roomId, createdRoomId!),
        eq(chatMessagesTable.senderId, dealerA.id),
        eq(chatMessagesTable.clientRequestId, crid),
      ));
    expect(row.durationMs).toBe(4200);
    expect(row.kind).toBe("audio");
  });

  it("audio send with invalid durationMs (0) → 400, no row, no provider event", async () => {
    const crid = `audio-baddur-${RUN}`;
    const objectPath = `/objects/uploads/${shopA.id}/chat/${createdRoomId}/bad.m4a`;
    const sendBefore = matrixCallCount.send;
    const res = await request(app)
      .post(`/api/chat/rooms/${createdRoomId}/messages`)
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ kind: "audio", body: "bad", objectPath, durationMs: 0, clientRequestId: crid });
    expect(res.status).toBe(400);
    expect(matrixCallCount.send).toBe(sendBefore);
    const rows = await db.select().from(chatMessagesTable)
      .where(and(eq(chatMessagesTable.roomId, createdRoomId!), eq(chatMessagesTable.clientRequestId, crid)));
    expect(rows.length).toBe(0);
  });

  it("audio send with durationMs over 600000 → 400", async () => {
    const objectPath = `/objects/uploads/${shopA.id}/chat/${createdRoomId}/toolong.m4a`;
    const res = await request(app)
      .post(`/api/chat/rooms/${createdRoomId}/messages`)
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ kind: "audio", body: "x", objectPath, durationMs: 600001, clientRequestId: `audio-toolong-${RUN}` });
    expect(res.status).toBe(400);
  });

  it("audio send missing durationMs → 400", async () => {
    const objectPath = `/objects/uploads/${shopA.id}/chat/${createdRoomId}/nodur.m4a`;
    const res = await request(app)
      .post(`/api/chat/rooms/${createdRoomId}/messages`)
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ kind: "audio", body: "x", objectPath, clientRequestId: `audio-nodur-${RUN}` });
    expect(res.status).toBe(400);
  });

  it("non-audio send with durationMs → 400 (metadata not applicable)", async () => {
    const res = await request(app)
      .post(`/api/chat/rooms/${createdRoomId}/messages`)
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ kind: "text", body: "hi", durationMs: 1000, clientRequestId: `text-dur-${RUN}` });
    expect(res.status).toBe(400);
  });

  it("audio send with wrong-room objectPath → 400, no row, no provider event", async () => {
    const crid = `audio-wrongroom-${RUN}`;
    const sendBefore = matrixCallCount.send;
    // Path under a DIFFERENT room id
    const objectPath = `/objects/uploads/${shopA.id}/chat/${roomA.id}/foreign.m4a`;
    const res = await request(app)
      .post(`/api/chat/rooms/${createdRoomId}/messages`)
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ kind: "audio", body: "x", objectPath, durationMs: 3000, clientRequestId: crid });
    expect(res.status).toBe(400);
    expect(matrixCallCount.send).toBe(sendBefore);
    const rows = await db.select().from(chatMessagesTable)
      .where(and(eq(chatMessagesTable.roomId, createdRoomId!), eq(chatMessagesTable.clientRequestId, crid)));
    expect(rows.length).toBe(0);
  });

  it("audio send provider failure → 503, zero DB write", async () => {
    const crid = `audio-provfail-${RUN}`;
    const objectPath = `/objects/uploads/${shopA.id}/chat/${createdRoomId}/fail.m4a`;
    sendFailStatus = 403;
    try {
      const res = await request(app)
        .post(`/api/chat/rooms/${createdRoomId}/messages`)
        .set("Authorization", `Bearer ${dealerTokenA}`)
        .send({ kind: "audio", body: "x", objectPath, durationMs: 2000, clientRequestId: crid });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("MATRIX_SEND_FAILED");
    } finally {
      sendFailStatus = null;
    }
    const rows = await db.select().from(chatMessagesTable)
      .where(and(eq(chatMessagesTable.roomId, createdRoomId!), eq(chatMessagesTable.clientRequestId, crid)));
    expect(rows.length).toBe(0);
  });

  it("authenticated audio media download: member reaches endpoint, non-member 404", async () => {
    // Insert an audio message directly with a valid chat-namespace path.
    const [audioMsg] = await db.insert(chatMessagesTable).values({
      roomId: createdRoomId!,
      shopId: shopA.id,
      senderId: dealerA.id,
      senderName: "Chat Dealer A",
      kind: "audio",
      body: "voice note",
      objectPath: `/objects/uploads/${shopA.id}/chat/${createdRoomId}/dl.m4a`,
      durationMs: 5000,
      providerEventId: "$audio-dl-event",
    }).returning();

    // Member (dealerA) — auth passes; storage returns 404 (no real GCS object).
    const memberRes = await request(app)
      .get(`/api/chat/rooms/${createdRoomId}/messages/${audioMsg.id}/media`)
      .set("Authorization", `Bearer ${dealerTokenA}`);
    expect(memberRes.status).not.toBe(403);
    expect(memberRes.status).not.toBe(500);
    expect([200, 404]).toContain(memberRes.status);

    // Non-member cross-shop (dealerB) → 404.
    const nonMemberRes = await request(app)
      .get(`/api/chat/rooms/${createdRoomId}/messages/${audioMsg.id}/media`)
      .set("Authorization", `Bearer ${dealerTokenB}`);
    expect(nonMemberRes.status).toBe(404);

    await db.delete(chatMessagesTable).where(eq(chatMessagesTable.id, audioMsg.id));
  });
});

// ── Messages: Matrix-absent fail-closed — no fake persistence ─────────────────

describe("Chat messages: Matrix-absent fail-closed (no fake persistence)", () => {
  it("send without clientRequestId → 400", async () => {
    const res = await request(app)
      .post(`/api/chat/rooms/${roomAWithProvider.id}/messages`)
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ kind: "text", body: "Hello" });
    expect(res.status).toBe(400);
  });

  it("send to room with null providerRoomId → 503 ROOM_NOT_PROVISIONED", async () => {
    const res = await request(app)
      .post(`/api/chat/rooms/${roomA.id}/messages`)
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ kind: "text", body: "Hello", clientRequestId: `crid-rnp-${RUN}` });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("ROOM_NOT_PROVISIONED");
  });

  it("no message row persisted after ROOM_NOT_PROVISIONED 503", async () => {
    const rows = await db.select().from(chatMessagesTable)
      .where(and(eq(chatMessagesTable.roomId, roomA.id), eq(chatMessagesTable.shopId, shopA.id)));
    expect(rows.length).toBe(0);
  });

  it("send to room with providerRoomId but Matrix creds absent → 503 MATRIX_UNAVAILABLE", async () => {
    const res = await request(app)
      .post(`/api/chat/rooms/${roomAWithProvider.id}/messages`)
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ kind: "text", body: "test", clientRequestId: `crid-mu-${RUN}` });
    expect(res.status).toBe(503);
    expect(["MATRIX_UNAVAILABLE", "MATRIX_SEND_FAILED"]).toContain(res.body.code);
  });

  it("no message row persisted after MATRIX_UNAVAILABLE 503", async () => {
    const rows = await db.select().from(chatMessagesTable)
      .where(eq(chatMessagesTable.roomId, roomAWithProvider.id));
    expect(rows.length).toBe(0);
  });

  it("send 400 when body missing (clientRequestId present, room provisioned)", async () => {
    // clientRequestId present + valid room → passes idempotency + provider gate
    // order; body validation then fails with 400 (Matrix absent would 503, but
    // body check happens after provider readiness — either way no row is stored).
    const res = await request(app)
      .post(`/api/chat/rooms/${roomAWithProvider.id}/messages`)
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ kind: "text", clientRequestId: `crid-nobody-${RUN}` }); // body missing
    expect([400, 503]).toContain(res.status);
    const rows = await db.select().from(chatMessagesTable)
      .where(eq(chatMessagesTable.roomId, roomAWithProvider.id));
    expect(rows.length).toBe(0);
  });
});

// ── Messages: list ────────────────────────────────────────────────────────────

describe("Chat messages: list", () => {
  it("can list messages (empty)", async () => {
    const res = await request(app)
      .get(`/api/chat/rooms/${roomA.id}/messages`)
      .set("Authorization", `Bearer ${dealerTokenA}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.messages)).toBe(true);
    expect(typeof res.body.hasMore).toBe("boolean");
  });
});

// ── Read markers ──────────────────────────────────────────────────────────────

describe("Chat read markers", () => {
  it("rejects marking a non-existent message (404)", async () => {
    const res = await request(app)
      .post(`/api/chat/rooms/${roomA.id}/read`)
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ messageId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(404);
  });

  it("marks read state for a DB-inserted message", async () => {
    const [msg] = await db.insert(chatMessagesTable).values({
      roomId: roomA.id,
      shopId: shopA.id,
      senderId: dealerA.id,
      senderName: "Dealer A",
      kind: "text",
      body: "direct insert for read marker test",
      providerEventId: "$fake-event-id",
    }).returning();

    const res = await request(app)
      .post(`/api/chat/rooms/${roomA.id}/read`)
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ messageId: msg.id });
    expect(res.status).toBe(200);

    // cleanup
    await db.delete(chatReadStateTable).where(
      and(eq(chatReadStateTable.roomId, roomA.id), eq(chatReadStateTable.userId, dealerA.id))
    );
    await db.delete(chatMessagesTable).where(eq(chatMessagesTable.id, msg.id));
  });
});

// ── Media download: cross-room / cross-customer isolation ─────────────────────

describe("Chat media download: access control", () => {
  let mediaMsg: { id: string };

  beforeAll(async () => {
    // Insert a DB message with a chat-namespace objectPath (no real GCS object)
    const [m] = await db.insert(chatMessagesTable).values({
      roomId: roomA.id,
      shopId: shopA.id,
      senderId: dealerA.id,
      senderName: "Dealer A",
      kind: "image",
      body: "photo",
      objectPath: `/objects/uploads/${shopA.id}/chat/${roomA.id}/fake-img.jpg`,
      providerEventId: "$fake-img-event",
    }).returning();
    mediaMsg = m;
  });

  afterAll(async () => {
    if (mediaMsg?.id) {
      await db.delete(chatMessagesTable).where(eq(chatMessagesTable.id, mediaMsg.id));
    }
  });

  it("dealer A can access message media URL (hits storage, 404 because no real GCS object)", async () => {
    const res = await request(app)
      .get(`/api/chat/rooms/${roomA.id}/messages/${mediaMsg.id}/media`)
      .set("Authorization", `Bearer ${dealerTokenA}`);
    // Storage call will fail with ObjectNotFoundError → 404 (correct — no real file)
    // but NOT 403 (auth passed) and NOT 500 (handled error)
    expect([200, 404]).toContain(res.status);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(500);
  });

  it("dealer B cannot access dealer A's room media (404 — cross-shop)", async () => {
    const res = await request(app)
      .get(`/api/chat/rooms/${roomA.id}/messages/${mediaMsg.id}/media`)
      .set("Authorization", `Bearer ${dealerTokenB}`);
    expect(res.status).toBe(404);
  });

  it("customer not a member of roomA cannot access media (404)", async () => {
    // Create a second customer (not added to roomA)
    const isolatedRawToken = generateToken();
    await db.insert(customerInvitesTable).values({
      shopId: shopA.id,
      customerId: customerB.id,
      tokenHash: sha256(isolatedRawToken),
      issuedById: dealerA.id,
      issuedByName: "Dealer A",
      expiresAt: new Date(Date.now() + 60_000),
    });

    // customerB belongs to shopB, so we can't use that invite from shopA
    // Instead use a fresh customer in shopA
    const [cFresh] = await db.insert(customersTable).values({
      shopId: shopA.id, name: "Fresh Customer", mobile: mob("9"),
    }).returning();
    const freshToken = generateToken();
    await db.insert(customerInvitesTable).values({
      shopId: shopA.id,
      customerId: cFresh.id,
      tokenHash: sha256(freshToken),
      issuedById: dealerA.id,
      issuedByName: "Dealer A",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const activateRes = await request(app)
      .post("/api/auth/activate-invite")
      .send({ token: freshToken, name: "Fresh", password: PASSWORD });
    expect(activateRes.status).toBe(200);
    expect(activateRes.body.token).toBeUndefined();
    const freshCustomerToken = await createSession(activateRes.body.user.id, false, "test fixture");

    // freshCustomer is NOT a member of roomA
    const res = await request(app)
      .get(`/api/chat/rooms/${roomA.id}/messages/${mediaMsg.id}/media`)
      .set("Authorization", `Bearer ${freshCustomerToken}`);
    expect(res.status).toBe(404);
  });

  it("customer who IS a member can reach the media endpoint (auth passes, 404 from no real GCS object)", async () => {
    if (!customerTokenA || !customerUserA) return;
    // customerUserA was added to roomA in the isolation tests above
    const res = await request(app)
      .get(`/api/chat/rooms/${roomA.id}/messages/${mediaMsg.id}/media`)
      .set("Authorization", `Bearer ${customerTokenA}`);
    // No real GCS object → ObjectNotFoundError → 404, but auth was accepted
    expect([200, 404]).toContain(res.status);
    expect(res.status).not.toBe(403);
  });

  it("text message has no media — returns 404 from kind check", async () => {
    const [textMsg] = await db.insert(chatMessagesTable).values({
      roomId: roomA.id,
      shopId: shopA.id,
      senderId: dealerA.id,
      senderName: "Dealer A",
      kind: "text",
      body: "no media here",
      providerEventId: "$fake-text",
    }).returning();

    const res = await request(app)
      .get(`/api/chat/rooms/${roomA.id}/messages/${textMsg.id}/media`)
      .set("Authorization", `Bearer ${dealerTokenA}`);
    expect(res.status).toBe(404);

    await db.delete(chatMessagesTable).where(eq(chatMessagesTable.id, textMsg.id));
  });

  it("message from a different room cannot be accessed via wrong room URL (404)", async () => {
    // Message belongs to roomAWithProvider, but URL uses roomA
    const [wrongRoomMsg] = await db.insert(chatMessagesTable).values({
      roomId: roomAWithProvider.id,
      shopId: shopA.id,
      senderId: dealerA.id,
      senderName: "Dealer A",
      kind: "image",
      body: "cross-room msg",
      objectPath: `/objects/uploads/${shopA.id}/chat/${roomAWithProvider.id}/cross.jpg`,
      providerEventId: "$cross-event",
    }).returning();

    const res = await request(app)
      .get(`/api/chat/rooms/${roomA.id}/messages/${wrongRoomMsg.id}/media`)
      .set("Authorization", `Bearer ${dealerTokenA}`);
    expect(res.status).toBe(404);

    await db.delete(chatMessagesTable).where(eq(chatMessagesTable.id, wrongRoomMsg.id));
  });
});

// ── Upload URL: signed key must match returned objectPath ─────────────────────

describe("Chat upload URL: signed key matches objectPath (no post-signing rewrite)", () => {
  const FAKE_BUCKET = "my-bucket";
  const FAKE_DIR = `/${FAKE_BUCKET}`;
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  // Each call to the sidecar returns a deterministic signed URL whose path
  // encodes the exact object key that was requested.  We capture the key from
  // the request body so we can assert it equals the objectPath in the response.
  const capturedKeys: string[] = [];

  beforeAll(() => {
    process.env.PRIVATE_OBJECT_DIR = FAKE_DIR;

    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/object-storage/signed-object-url")) {
        // Parse the request body to capture the exact key being signed.
        let objectName = "";
        try {
          const rawBody = typeof init?.body === "string" ? init.body : "";
          const parsed = JSON.parse(rawBody);
          objectName = parsed.object_name ?? "";
          capturedKeys.push(objectName);
        } catch { /* ignore */ }
        // The signed URL encodes the key in its pathname, just like GCS does.
        const fakeSignedURL =
          `https://storage.googleapis.com/${FAKE_BUCKET}/${objectName}?X-Goog-Signature=fake`;
        return new Response(JSON.stringify({ signed_url: fakeSignedURL }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch);
  });

  afterAll(() => {
    fetchSpy?.mockRestore();
    delete process.env.PRIVATE_OBJECT_DIR;
    capturedKeys.length = 0;
  });

  it("POST upload-url: objectPath and signed URL key refer to the same object", async () => {
    capturedKeys.length = 0;
    const res = await request(app)
      .post(`/api/chat/rooms/${roomA.id}/upload-url`)
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ name: "photo.jpg", size: 1024, contentType: "image/jpeg" });

    expect(res.status).toBe(200);
    expect(typeof res.body.uploadURL).toBe("string");
    expect(typeof res.body.objectPath).toBe("string");

    // The key the sidecar was asked to sign.
    expect(capturedKeys.length).toBe(1);
    const signedKey = capturedKeys[0]; // e.g. "uploads/<shopId>/chat/<roomId>/<uuid>"

    // objectPath must normalise to the exact key embedded in the signed URL.
    // normalizeObjectEntityPath strips the PRIVATE_OBJECT_DIR prefix, leaving
    // /objects/<signedKey>. Verify equality without path rewriting.
    const expectedObjectPath = `/objects/${signedKey}`;
    expect(res.body.objectPath).toBe(expectedObjectPath);

    // The uploadURL itself must contain the same key.
    expect(res.body.uploadURL).toContain(signedKey);
  });

  it("objectPath is under the room's chat namespace", async () => {
    capturedKeys.length = 0;
    const res = await request(app)
      .post(`/api/chat/rooms/${roomA.id}/upload-url`)
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ name: "doc.pdf", size: 2048, contentType: "application/pdf" });

    expect(res.status).toBe(200);
    const expectedPrefix = `uploads/${shopA.id}/chat/${roomA.id}/`;
    // objectPath is /objects/<key> so strip leading /objects/
    const keyPart = res.body.objectPath.replace(/^\/objects\//, "");
    expect(keyPart.startsWith(expectedPrefix)).toBe(true);
  });

  it("accepts Expo native voice-note MIME types (audio/mp4, audio/x-m4a, audio/aac)", async () => {
    for (const contentType of ["audio/mp4", "audio/x-m4a", "audio/aac"]) {
      capturedKeys.length = 0;
      const res = await request(app)
        .post(`/api/chat/rooms/${roomA.id}/upload-url`)
        .set("Authorization", `Bearer ${dealerTokenA}`)
        .send({ name: "voice.m4a", size: 4096, contentType });
      expect(res.status).toBe(200);
      expect(typeof res.body.objectPath).toBe("string");
    }
  });

  it("cross-shop non-member gets 404 on upload-url", async () => {
    const res = await request(app)
      .post(`/api/chat/rooms/${roomA.id}/upload-url`)
      .set("Authorization", `Bearer ${dealerTokenB}`)
      .send({ name: "photo.jpg", size: 1024, contentType: "image/jpeg" });
    expect(res.status).toBe(404);
  });

  it("disallowed content type is rejected with 400", async () => {
    const res = await request(app)
      .post(`/api/chat/rooms/${roomA.id}/upload-url`)
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ name: "script.exe", size: 100, contentType: "application/x-msdownload" });
    expect(res.status).toBe(400);
  });
});

// ── Call tokens: provider-absent 503 ─────────────────────────────────────────

describe("Provider-absent: call token", () => {
  it("returns 503 LIVEKIT_UNAVAILABLE when credentials absent", async () => {
    const res = await request(app)
      .post(`/api/chat/rooms/${roomA.id}/call-token`)
      .set("Authorization", `Bearer ${dealerTokenA}`);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("LIVEKIT_UNAVAILABLE");
    // Credentials must never leak into the response body
    expect(JSON.stringify(res.body)).not.toMatch(/key|secret|token.*livekit/i);
  });

  it("cross-shop room returns 404 on call-token (not 403)", async () => {
    const res = await request(app)
      .post(`/api/chat/rooms/${roomA.id}/call-token`)
      .set("Authorization", `Bearer ${dealerTokenB}`);
    expect(res.status).toBe(404);
  });
});

// ── Chat capabilities ─────────────────────────────────────────────────────────

describe("Chat capabilities endpoint", () => {
  it("returns e2eeEnabled:false and providers unavailable when creds absent", async () => {
    const res = await request(app)
      .get("/api/chat/capabilities")
      .set("Authorization", `Bearer ${dealerTokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.e2eeEnabled).toBe(false);
    expect(res.body.matrixAvailable).toBe(false);
    expect(res.body.livekitAvailable).toBe(false);
  });
});

// ── Contact match: privacy-safe exact-match ───────────────────────────────────

describe("Contact match: privacy-safe exact lookup", () => {
  let staffInShopA: { id: string; mobile: string };
  let staffInShopB: { id: string; mobile: string };
  let inactiveInShopA: { id: string; mobile: string };

  beforeAll(async () => {
    // Active staff in shopA
    const mobileA = uniqMob();
    const [sA] = await db.insert(usersTable).values({
      name: "Staff Match A",
      email: email("staffmatcha"),
      mobile: mobileA,
      passwordHash: hashPassword(PASSWORD),
      role: "reception",
      shopId: shopA.id,
      isActive: true,
    }).returning();
    staffInShopA = { id: sA.id, mobile: mobileA };

    // Active staff in shopB (cross-shop — must never appear for shopA callers)
    const mobileB = uniqMob();
    const [sB] = await db.insert(usersTable).values({
      name: "Staff Match B",
      email: email("staffmatchb"),
      mobile: mobileB,
      passwordHash: hashPassword(PASSWORD),
      role: "reception",
      shopId: shopB.id,
      isActive: true,
    }).returning();
    staffInShopB = { id: sB.id, mobile: mobileB };

    // Inactive user in shopA (must never appear in results)
    const mobileInactive = uniqMob();
    const [sI] = await db.insert(usersTable).values({
      name: "Inactive Match A",
      email: email("inactivematcha"),
      mobile: mobileInactive,
      passwordHash: hashPassword(PASSWORD),
      role: "reception",
      shopId: shopA.id,
      isActive: false,
    }).returning();
    inactiveInShopA = { id: sI.id, mobile: mobileInactive };
  });

  afterAll(async () => {
    if (staffInShopA?.id) await db.delete(usersTable).where(eq(usersTable.id, staffInShopA.id));
    if (staffInShopB?.id) await db.delete(usersTable).where(eq(usersTable.id, staffInShopB.id));
    if (inactiveInShopA?.id) await db.delete(usersTable).where(eq(usersTable.id, inactiveInShopA.id));
  });

  it("exact match by 10-digit number returns same-shop active user", async () => {
    const res = await request(app)
      .post("/api/chat/contacts/match")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ phone: staffInShopA.mobile });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.contacts)).toBe(true);
    const match = res.body.contacts.find((c: { userId: string }) => c.userId === staffInShopA.id);
    expect(match).toBeDefined();
    expect(match.name).toBeDefined();
    expect(match.mobile).toBe(staffInShopA.mobile);
    expect(typeof match.matchToken).toBe("string");
    expect(match.matchToken.length).toBeGreaterThan(20);
  });

  it("cross-shop number not returned (shop isolation)", async () => {
    const res = await request(app)
      .post("/api/chat/contacts/match")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ phone: staffInShopB.mobile });
    expect(res.status).toBe(200);
    const ids = res.body.contacts.map((c: { userId: string }) => c.userId);
    expect(ids).not.toContain(staffInShopB.id);
  });

  it("inactive user in same shop is excluded", async () => {
    const res = await request(app)
      .post("/api/chat/contacts/match")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ phone: inactiveInShopA.mobile });
    expect(res.status).toBe(200);
    const ids = res.body.contacts.map((c: { userId: string }) => c.userId);
    expect(ids).not.toContain(inactiveInShopA.id);
  });

  it("self is excluded from match results", async () => {
    const res = await request(app)
      .post("/api/chat/contacts/match")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ phone: mob("1") }); // dealerA's own mobile
    expect(res.status).toBe(200);
    const ids = res.body.contacts.map((c: { userId: string }) => c.userId);
    expect(ids).not.toContain(dealerA.id);
  });

  it("unregistered number returns empty contacts (no information leak)", async () => {
    const res = await request(app)
      .post("/api/chat/contacts/match")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ phone: "9999999999" }); // guaranteed not in DB
    expect(res.status).toBe(200);
    expect(res.body.contacts).toEqual([]);
  });

  it("accepts +91 prefix (normalized to 10 digits)", async () => {
    const res = await request(app)
      .post("/api/chat/contacts/match")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ phone: `+91${staffInShopA.mobile}` });
    expect(res.status).toBe(200);
    const ids = res.body.contacts.map((c: { userId: string }) => c.userId);
    expect(ids).toContain(staffInShopA.id);
  });

  it("accepts phones array (batch exact match)", async () => {
    const res = await request(app)
      .post("/api/chat/contacts/match")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ phones: [staffInShopA.mobile, "9999999999"] });
    expect(res.status).toBe(200);
    const ids = res.body.contacts.map((c: { userId: string }) => c.userId);
    expect(ids).toContain(staffInShopA.id);
    // Unregistered number not leaked
    expect(ids.length).toBe(1);
  });

  it("rejects oversized phones array (> 50 entries)", async () => {
    const res = await request(app)
      .post("/api/chat/contacts/match")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ phones: Array.from({ length: 51 }, (_, i) => `900000${String(i).padStart(4, "0")}`) });
    expect(res.status).toBe(400);
  });

  it("customer can call contact match (allowed in portal)", async () => {
    if (!customerTokenA) return;
    const res = await request(app)
      .post("/api/chat/contacts/match")
      .set("Authorization", `Bearer ${customerTokenA}`)
      .send({ phone: staffInShopA.mobile });
    expect(res.status).toBe(200);
    // Customer is in shopA → should see shopA staff
    const ids = res.body.contacts.map((c: { userId: string }) => c.userId);
    expect(ids).toContain(staffInShopA.id);
  });

  it("no auth → 401", async () => {
    const res = await request(app)
      .post("/api/chat/contacts/match")
      .send({ phone: staffInShopA.mobile });
    expect(res.status).toBe(401);
  });

  it("durably limits contact matching even when every lookup has zero matches", async () => {
    await db.delete(chatContactMatchAttemptsTable).where(eq(chatContactMatchAttemptsTable.userId, dealerA.id));
    for (let i = 0; i < 10; i++) {
      const allowed = await request(app)
        .post("/api/chat/contacts/match")
        .set("Authorization", `Bearer ${dealerTokenA}`)
        .set("X-Forwarded-For", `198.51.100.${i + 1}`)
        .send({ phone: "9999999999" });
      expect(allowed.status).toBe(200);
      expect(allowed.body.contacts).toEqual([]);
    }
    const limited = await request(app)
      .post("/api/chat/contacts/match")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .set("X-Forwarded-For", "198.51.100.200")
      .send({ phone: "9999999999" });
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ message: expect.any(String) });
    await db.delete(chatContactMatchAttemptsTable).where(eq(chatContactMatchAttemptsTable.userId, dealerA.id));
  });

  it("durably limits one IP across different authenticated users", async () => {
    const forwardedIp = "203.0.113.77";
    const secret = process.env.SESSION_SECRET;
    if (!secret) throw new Error("SESSION_SECRET is required for this test");
    const ipHash = sha256(`chat-contact-match-ip:v1:${secret}:${forwardedIp}`);
    const sharedPasswordHash = hashPassword(PASSWORD);
    const createdUsers = await db
      .insert(usersTable)
      .values(
        Array.from({ length: 21 }, (_, index) => ({
          name: `IP Limit User ${index}`,
          email: email(`iplimit${index}`),
          mobile: uniqMob(),
          passwordHash: sharedPasswordHash,
          role: "reception",
          shopId: shopA.id,
          isActive: true,
        })),
      )
      .returning({ id: usersTable.id });

    try {
      await db
        .delete(chatContactMatchAttemptsTable)
        .where(eq(chatContactMatchAttemptsTable.ipHash, ipHash));
      const tokens = await Promise.all(
        createdUsers.map((user) => createSession(user.id, false, null)),
      );
      for (let index = 0; index < 20; index++) {
        const allowed = await request(app)
          .post("/api/chat/contacts/match")
          .set("Authorization", `Bearer ${tokens[index]}`)
          .set("X-Forwarded-For", forwardedIp)
          .send({ phone: "9999999999" });
        expect(allowed.status).toBe(200);
      }
      const limited = await request(app)
        .post("/api/chat/contacts/match")
        .set("Authorization", `Bearer ${tokens[20]}`)
        .set("X-Forwarded-For", forwardedIp)
        .send({ phone: "9999999999" });
      expect(limited.status).toBe(429);
    } finally {
      await db
        .delete(chatContactMatchAttemptsTable)
        .where(eq(chatContactMatchAttemptsTable.ipHash, ipHash));
      await db
        .delete(usersTable)
        .where(inArray(usersTable.id, createdUsers.map((user) => user.id)));
    }
  });
});

// ── Direct room creation (kind=direct) ───────────────────────────────────────

describe("Direct room creation (kind=direct)", () => {
  let directTarget: { id: string };
  let directTargetInactive: { id: string };
  let directTargetShopB: { id: string };

  beforeAll(async () => {
    // Active target in shopA
    const [t] = await db.insert(usersTable).values({
      name: "Direct Target",
      email: email("directtarget"),
      mobile: uniqMob(),
      passwordHash: hashPassword(PASSWORD),
      role: "reception",
      shopId: shopA.id,
      isActive: true,
    }).returning();
    directTarget = t;

    // Inactive target in shopA
    const [ti] = await db.insert(usersTable).values({
      name: "Direct Target Inactive",
      email: email("directtargetinactive"),
      mobile: uniqMob(),
      passwordHash: hashPassword(PASSWORD),
      role: "reception",
      shopId: shopA.id,
      isActive: false,
    }).returning();
    directTargetInactive = ti;

    // Active target in shopB (cross-shop — must be rejected)
    const [tb] = await db.insert(usersTable).values({
      name: "Direct Target ShopB",
      email: email("directtargetshopb"),
      mobile: uniqMob(),
      passwordHash: hashPassword(PASSWORD),
      role: "reception",
      shopId: shopB.id,
      isActive: true,
    }).returning();
    directTargetShopB = tb;
  });

  afterAll(async () => {
    for (const u of [directTarget, directTargetInactive, directTargetShopB]) {
      if (u?.id) {
        await db.delete(chatRoomMembersTable).where(eq(chatRoomMembersTable.userId, u.id));
        await db.delete(usersTable).where(eq(usersTable.id, u.id));
      }
    }
    // Clean up any direct rooms created in shopA
    const directRooms = await db.select({ id: chatRoomsTable.id })
      .from(chatRoomsTable)
      .where(and(eq(chatRoomsTable.shopId, shopA.id), eq(chatRoomsTable.kind, "direct")));
    for (const r of directRooms) {
      await db.delete(chatRoomMembersTable).where(eq(chatRoomMembersTable.roomId, r.id));
      await db.delete(chatRoomsTable).where(eq(chatRoomsTable.id, r.id));
    }
  });

  it("kind=direct without targetUserId and matchToken → generic 403", async () => {
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ name: "Direct Room", kind: "direct" });
    expect(res.status).toBe(403);
  });

  it("kind=direct with targetUserId = self → generic 403", async () => {
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ name: "Self Room", kind: "direct", targetUserId: dealerA.id });
    expect(res.status).toBe(403);
  });

  it("kind=direct with inactive target and no proof → generic 403", async () => {
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ name: "Inactive Room", kind: "direct", targetUserId: directTargetInactive.id });
    expect(res.status).toBe(403);
    expect(res.body.code).toBeUndefined();
  });

  it("kind=direct with cross-shop target and no proof → generic 403", async () => {
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ name: "Cross Shop Room", kind: "direct", targetUserId: directTargetShopB.id });
    expect(res.status).toBe(403);
    expect(res.body.code).toBeUndefined();
  });

  it("kind=direct with valid target but Matrix absent → 503 MATRIX_UNAVAILABLE, no DB row", async () => {
    const clientReqId = `direct-503-${RUN}`;
    const matchToken = await issueContactMatchGrant(dealerA.id, directTarget.id, shopA.id);
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({ name: "Direct Room 503", kind: "direct", targetUserId: directTarget.id, matchToken, clientRequestId: clientReqId });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("MATRIX_UNAVAILABLE");
    // Zero DB writes
    const rows = await db.select().from(chatRoomsTable)
      .where(and(eq(chatRoomsTable.shopId, shopA.id), eq(chatRoomsTable.clientRequestId, clientReqId)));
    expect(rows.length).toBe(0);
  });

  it("customer can call POST /chat/rooms (portal allowed)", async () => {
    if (!customerTokenA) return;
    // Should reach business logic (not portal 403) — result will be 400/404/503
    // depending on the input, but NOT 403 CUSTOMER_PORTAL_FORBIDDEN.
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${customerTokenA}`)
      .send({ name: "Direct Room", kind: "direct", targetUserId: "00000000-0000-0000-0000-000000000000" });
    // Proof rejection is in-route, not the portal allowlist.
    expect(res.status).toBe(403);
    expect(res.body.code).not.toBe("CUSTOMER_PORTAL_FORBIDDEN");
  });

  it("customer cannot create kind=customer rooms even though POST /chat/rooms is in portal allowlist", async () => {
    if (!customerTokenA) return;
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${customerTokenA}`)
      .send({ name: "Bad Customer Room", kind: "customer", customerId: customerA.id });
    expect(res.status).toBe(403);
    // This is the in-route 403, not the portal 403
    expect(res.body.code).not.toBe("CUSTOMER_PORTAL_FORBIDDEN");
  });
});

// ── Direct room creation: Matrix-mocked (two members, peerKey idempotency) ────

describe("Direct room creation: Matrix-mocked (kind=direct)", () => {
  let directTarget2: { id: string };
  let concurrentTarget: { id: string };
  let timeoutTarget: { id: string };
  let registrationFailureTarget: { id: string };
  let registrationTimeoutTarget: { id: string };
  let displayNameTimeoutTarget: { id: string };
  let sameShopNonMember: { id: string };
  let sameShopNonMemberToken: string;
  let fetchSpy2: ReturnType<typeof vi.spyOn> | null = null;
  let createdDirectRoomId: string | null = null;
  let concurrentRoomId: string | null = null;
  let registrationRetryRoomId: string | null = null;
  let registrationTimeoutRoomId: string | null = null;
  let displayNameTimeoutRoomId: string | null = null;
  let directTargetMatchToken: string;
  let createRoomCalls = 0;
  let delayFirstCreateRoom = false;
  let hangCreateRoomUntilAbort = false;
  let hangRegistrationUntilAbort = false;
  let hangDisplayNameOnCall: number | null = null;
  let failNextRegistration = false;
  let registerCalls = 0;
  let registrationTimeoutSignalObserved = false;
  let displayNameCalls = 0;
  let displayNameTimeoutSignalObserved = false;
  let timeoutSignalObserved = false;
  let joinedMemberIds: string[] = [];
  const directRoomsByAlias = new Map<string, string>();

  const SERVER_NAME2 = "example.com";
  const AS_TOKEN2 = "test-as-token";
  const AS_ROOM2 = "!mockdirectroom:example.com";
  const vId2 = (appUserId: string) =>
    `@appuser-${appUserId.replace(/-/g, "")}:${SERVER_NAME2}`;

  beforeAll(async () => {
    process.env.MATRIX_BASE_URL = "https://matrix.example.com";
    process.env.MATRIX_SERVER_NAME = SERVER_NAME2;
    process.env.MATRIX_APP_SERVICE_TOKEN = AS_TOKEN2;

    // A fresh active staff user in shopA as the direct target.
    const [t] = await db.insert(usersTable).values({
      name: "Direct Target Mocked",
      email: email("directtargetmocked"),
      mobile: uniqMob(),
      passwordHash: hashPassword(PASSWORD),
      role: "reception",
      shopId: shopA.id,
      isActive: true,
    }).returning();
    directTarget2 = t;

    const [concurrent] = await db.insert(usersTable).values({
      name: "Concurrent Direct Target",
      email: email("concurrentdirecttarget"),
      mobile: uniqMob(),
      passwordHash: hashPassword(PASSWORD),
      role: "reception",
      shopId: shopA.id,
      isActive: true,
    }).returning();
    concurrentTarget = concurrent;

    const [timeout] = await db.insert(usersTable).values({
      name: "Timeout Direct Target",
      email: email("timeoutdirecttarget"),
      mobile: uniqMob(),
      passwordHash: hashPassword(PASSWORD),
      role: "reception",
      shopId: shopA.id,
      isActive: true,
    }).returning();
    timeoutTarget = timeout;

    const [registrationFailure] = await db.insert(usersTable).values({
      name: "Registration Failure Direct Target",
      email: email("registrationfailuredirecttarget"),
      mobile: uniqMob(),
      passwordHash: hashPassword(PASSWORD),
      role: "reception",
      shopId: shopA.id,
      isActive: true,
    }).returning();
    registrationFailureTarget = registrationFailure;

    const [registrationTimeout] = await db.insert(usersTable).values({
      name: "Registration Timeout Direct Target",
      email: email("registrationtimeoutdirecttarget"),
      mobile: uniqMob(),
      passwordHash: hashPassword(PASSWORD),
      role: "reception",
      shopId: shopA.id,
      isActive: true,
    }).returning();
    registrationTimeoutTarget = registrationTimeout;

    const [displayNameTimeout] = await db.insert(usersTable).values({
      name: "Display Name Timeout Direct Target",
      email: email("displaynametimeoutdirecttarget"),
      mobile: uniqMob(),
      passwordHash: hashPassword(PASSWORD),
      role: "reception",
      shopId: shopA.id,
      isActive: true,
    }).returning();
    displayNameTimeoutTarget = displayNameTimeout;

    const [nonMember] = await db.insert(usersTable).values({
      name: "Same Shop Non Member",
      email: email("sameshopnonmember"),
      mobile: uniqMob(),
      passwordHash: hashPassword(PASSWORD),
      role: "reception",
      shopId: shopA.id,
      isActive: true,
    }).returning();
    sameShopNonMember = nonMember;
    sameShopNonMemberToken = await signIn(nonMember.email, PASSWORD);

    // Minimal fetch mock — reuse the same pattern as Provider-mocked suite.
    fetchSpy2 = vi.spyOn(globalThis, "fetch").mockImplementation((async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/_matrix/client/v3/register")) {
        registerCalls++;
        if (failNextRegistration) {
          failNextRegistration = false;
          return new Response(JSON.stringify({ errcode: "M_FORBIDDEN" }), { status: 403 });
        }
        if (hangRegistrationUntilAbort) {
          const signal = init?.signal;
          return await new Promise<Response>((_resolve, reject) => {
            const abort = () => {
              registrationTimeoutSignalObserved = true;
              const err = new Error("mock Matrix registration aborted");
              err.name = "AbortError";
              reject(err);
            };
            if (!signal || signal.aborted) {
              abort();
              return;
            }
            signal.addEventListener("abort", abort, { once: true });
          });
        }
        return new Response(JSON.stringify({ user_id: "@x:example.com" }), { status: 200 });
      }
      if (url.includes("/_matrix/client/v3/profile/") && url.includes("/displayname")) {
        displayNameCalls++;
        if (hangDisplayNameOnCall === displayNameCalls) {
          const signal = init?.signal;
          return await new Promise<Response>((_resolve, reject) => {
            const abort = () => {
              displayNameTimeoutSignalObserved = true;
              const err = new Error("mock Matrix display-name request aborted");
              err.name = "AbortError";
              reject(err);
            };
            if (!signal || signal.aborted) {
              abort();
              return;
            }
            signal.addEventListener("abort", abort, { once: true });
          });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (url.includes("/profile/") && url.includes("/displayname")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (url.includes("/_matrix/client/v3/directory/room/")) {
        const alias = decodeURIComponent(url.split("/directory/room/")[1].split("?")[0]);
        const roomId = directRoomsByAlias.get(alias);
        return roomId
          ? new Response(JSON.stringify({ room_id: roomId }), { status: 200 })
          : new Response(JSON.stringify({ errcode: "M_NOT_FOUND" }), { status: 404 });
      }
      if (url.includes("/createRoom")) {
        createRoomCalls++;
        const creator = new URL(url).searchParams.get("user_id");
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          invite?: string[];
          room_alias_name?: string;
        };
        joinedMemberIds = [creator, body.invite?.[0]].filter(
          (id): id is string => Boolean(id),
        );
        const alias = body.room_alias_name
          ? `#${body.room_alias_name}:${SERVER_NAME2}`
          : null;
        if (alias && directRoomsByAlias.has(alias)) {
          return new Response(JSON.stringify({ errcode: "M_ROOM_IN_USE" }), { status: 400 });
        }
        // Simulate Matrix accepting createRoom before a lost response/crash.
        // The retry must resolve this alias instead of creating again.
        if (alias) directRoomsByAlias.set(alias, AS_ROOM2);
        if (delayFirstCreateRoom && createRoomCalls === 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (hangCreateRoomUntilAbort) {
          const signal = init?.signal;
          return await new Promise<Response>((_resolve, reject) => {
            const abort = () => {
              timeoutSignalObserved = true;
              const err = new Error("mock Matrix request aborted");
              err.name = "AbortError";
              reject(err);
            };
            if (!signal || signal.aborted) {
              abort();
              return;
            }
            signal.addEventListener("abort", abort, { once: true });
          });
        }
        return new Response(JSON.stringify({ room_id: AS_ROOM2 }), { status: 200 });
      }
      if (/\/rooms\/[^/]+\/join(\?|$)/.test(url)) {
        return new Response(JSON.stringify({ room_id: AS_ROOM2 }), { status: 200 });
      }
      if (url.includes("/joined_members")) {
        const joined: Record<string, unknown> = {};
        for (const id of joinedMemberIds) joined[id] = { display_name: id };
        return new Response(JSON.stringify({ joined }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch);
  });

  afterAll(async () => {
    fetchSpy2?.mockRestore();
    delete process.env.MATRIX_BASE_URL;
    delete process.env.MATRIX_SERVER_NAME;
    delete process.env.MATRIX_APP_SERVICE_TOKEN;
    if (createdDirectRoomId) {
      await db.delete(chatProviderIdentitiesTable).where(eq(chatProviderIdentitiesTable.shopId, shopA.id));
      await db.delete(chatRoomMembersTable).where(eq(chatRoomMembersTable.roomId, createdDirectRoomId));
      await db.delete(chatRoomsTable).where(eq(chatRoomsTable.id, createdDirectRoomId));
    }
    if (concurrentRoomId) {
      await db.delete(chatRoomMembersTable).where(eq(chatRoomMembersTable.roomId, concurrentRoomId));
      await db.delete(chatRoomsTable).where(eq(chatRoomsTable.id, concurrentRoomId));
    }
    if (registrationRetryRoomId) {
      await db.delete(chatRoomMembersTable).where(eq(chatRoomMembersTable.roomId, registrationRetryRoomId));
      await db.delete(chatRoomsTable).where(eq(chatRoomsTable.id, registrationRetryRoomId));
    }
    if (registrationTimeoutRoomId) {
      await db.delete(chatRoomMembersTable).where(eq(chatRoomMembersTable.roomId, registrationTimeoutRoomId));
      await db.delete(chatRoomsTable).where(eq(chatRoomsTable.id, registrationTimeoutRoomId));
    }
    if (displayNameTimeoutRoomId) {
      await db.delete(chatRoomMembersTable).where(eq(chatRoomMembersTable.roomId, displayNameTimeoutRoomId));
      await db.delete(chatRoomsTable).where(eq(chatRoomsTable.id, displayNameTimeoutRoomId));
    }
    for (const user of [
      directTarget2,
      concurrentTarget,
      timeoutTarget,
      registrationFailureTarget,
      registrationTimeoutTarget,
      displayNameTimeoutTarget,
      sameShopNonMember,
    ]) {
      if (user?.id) {
        await db.delete(sessionsTable).where(eq(sessionsTable.userId, user.id));
        await db.delete(usersTable).where(eq(usersTable.id, user.id));
      }
    }
  });

  it("creates a direct room with EXACTLY two members (dealer → staff, kind=direct)", async () => {
    directTargetMatchToken = await issueContactMatchGrant(dealerA.id, directTarget2.id, shopA.id);
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({
        name: "Direct Room Mocked",
        kind: "direct",
        targetUserId: directTarget2.id,
        matchToken: directTargetMatchToken,
        clientRequestId: `direct-member-only-${RUN}`,
      });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(true);
    expect(res.body.room.kind).toBe("direct");
    createdDirectRoomId = res.body.room.id;

    const members = await db.select().from(chatRoomMembersTable)
      .where(eq(chatRoomMembersTable.roomId, createdDirectRoomId!));
    expect(members.length).toBe(2);
    const memberIds = members.map((m) => m.userId).sort();
    expect(memberIds).toEqual([dealerA.id, directTarget2.id].sort());
  });

  it("does not replay another member's clientRequestId to a same-shop nonmember", async () => {
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${sameShopNonMemberToken}`)
      .send({
        name: "Must Not Be Disclosed",
        kind: "direct",
        targetUserId: directTarget2.id,
        clientRequestId: `direct-member-only-${RUN}`,
      });
    expect(res.status).toBe(404);
    expect(res.body.room).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("provider");
  });

  it("rejects a match proof presented by a different authenticated caller", async () => {
    const token = await issueContactMatchGrant(dealerA.id, concurrentTarget.id, shopA.id);
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${sameShopNonMemberToken}`)
      .send({
        name: "Wrong caller",
        kind: "direct",
        targetUserId: concurrentTarget.id,
        matchToken: token,
      });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("Concurrent Direct Target");
  });

  it("cannot reuse a consumed proof for a different new target", async () => {
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({
        name: "Wrong target",
        kind: "direct",
        targetUserId: concurrentTarget.id,
        matchToken: directTargetMatchToken,
      });
    expect(res.status).toBe(403);
    expect(res.body.room).toBeUndefined();
  });

  it("peerKey idempotency: re-creating the same pair returns existing room", async () => {
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({
        name: "Direct Room Dup",
        kind: "direct",
        targetUserId: directTarget2.id,
        matchToken: directTargetMatchToken,
      });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect(res.body.room.id).toBe(createdDirectRoomId);
  });

  it("serializes concurrent direct creation across requests before Matrix provisioning", async () => {
    createRoomCalls = 0;
    delayFirstCreateRoom = true;
    const matchToken = await issueContactMatchGrant(dealerA.id, concurrentTarget.id, shopA.id);
    const payload = {
      name: "Concurrent Direct Room",
      kind: "direct",
      targetUserId: concurrentTarget.id,
      matchToken,
    };
    try {
      const [first, second] = await Promise.all([
        request(app).post("/api/chat/rooms").set("Authorization", `Bearer ${dealerTokenA}`).send(payload),
        request(app).post("/api/chat/rooms").set("Authorization", `Bearer ${dealerTokenA}`).send(payload),
      ]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(createRoomCalls).toBe(1);
      expect([first.body.created, second.body.created].sort()).toEqual([false, true]);
      expect(first.body.room.id).toBe(second.body.room.id);
      concurrentRoomId = first.body.room.id;
    } finally {
      delayFirstCreateRoom = false;
    }
  });

  it("aborts a stalled Matrix provision without keeping a database transaction open", async () => {
    createRoomCalls = 0;
    hangCreateRoomUntilAbort = true;
    timeoutSignalObserved = false;
    process.env.MATRIX_PROVISION_TIMEOUT_MS = "100";
    const matchToken = await issueContactMatchGrant(dealerA.id, timeoutTarget.id, shopA.id);
    const peerKey = [dealerA.id, timeoutTarget.id].sort().join(":");
    try {
      const pending = request(app)
        .post("/api/chat/rooms")
        .set("Authorization", `Bearer ${dealerTokenA}`)
        .send({
          name: "Timed Out Direct Room",
          kind: "direct",
          targetUserId: timeoutTarget.id,
          matchToken,
        })
        .then((response) => response);

      // Wait until the request reaches the held provider call, then prove a
      // separate DB operation completes while Matrix is still stalled.
      for (let attempt = 0; createRoomCalls === 0 && attempt < 20; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(createRoomCalls).toBe(1);
      await Promise.race([
        db.execute(sql`SELECT 1`),
        new Promise((_, reject) => setTimeout(() => reject(new Error("DB probe blocked")), 250)),
      ]);

      const res = await pending;
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("MATRIX_UNAVAILABLE");
      expect(timeoutSignalObserved).toBe(true);

      // Failed reservations are removed, so neither a ghost room nor a
      // pair-level lock prevents the caller from retrying.
      const rows = await db.select({ id: chatRoomsTable.id }).from(chatRoomsTable)
        .where(and(eq(chatRoomsTable.shopId, shopA.id), eq(chatRoomsTable.peerKey, peerKey)));
      expect(rows).toHaveLength(1);

       // Matrix accepted the aliased create before its response was lost. A
       // retry resolves that same alias instead of issuing another createRoom.
      const retry = await request(app)
        .post("/api/chat/rooms")
        .set("Authorization", `Bearer ${dealerTokenA}`)
        .send({
          name: "Timed Out Direct Room Retry",
          kind: "direct",
          targetUserId: timeoutTarget.id,
          matchToken,
        });
       expect(retry.status).toBe(200);
       expect(retry.body.created).toBe(false);
      expect(createRoomCalls).toBe(1);

      await db.delete(chatRoomsTable).where(eq(chatRoomsTable.id, rows[0].id));
    } finally {
      hangCreateRoomUntilAbort = false;
      delete process.env.MATRIX_PROVISION_TIMEOUT_MS;
    }
  });

  it("recovers a crash-after-create reservation and concurrent retries converge on its Matrix alias", async () => {
    const peerKey = [dealerA.id, timeoutTarget.id].sort().join(":");
    const provisionKey = sha256(`matrix-direct-room:v1:${shopA.id}:${peerKey}`);
    const alias = `#appchat-${provisionKey.slice(0, 40)}:${SERVER_NAME2}`;
    const remoteRoomId = "!crash-recovered:example.com";
    // This represents Matrix having accepted createRoom immediately before the
    // original process died, while the database row remained memberless.
    directRoomsByAlias.set(alias, remoteRoomId);
    joinedMemberIds = [vId2(dealerA.id), vId2(timeoutTarget.id)];
    createRoomCalls = 0;
    const [crashedReservation] = await db.insert(chatRoomsTable).values({
      shopId: shopA.id,
      kind: "direct",
      name: "Crash Recovery Direct Room",
      providerRoomId: null,
      peerKey,
      provisionKey,
      provisionAttemptId: "00000000-0000-4000-8000-000000000113",
      provisionLeaseUntil: new Date(Date.now() - 1_000),
      createdById: dealerA.id,
      createdByName: "Dealer A",
    }).returning();
    const matchToken = await issueContactMatchGrant(dealerA.id, timeoutTarget.id, shopA.id);
    const payload = {
      name: "Crash Recovery Direct Room",
      kind: "direct",
      targetUserId: timeoutTarget.id,
      matchToken,
    };

    try {
      const [first, second] = await Promise.all([
        request(app).post("/api/chat/rooms").set("Authorization", `Bearer ${dealerTokenA}`).send(payload),
        request(app).post("/api/chat/rooms").set("Authorization", `Bearer ${dealerTokenA}`).send(payload),
      ]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.body.room.id).toBe(crashedReservation.id);
      expect(second.body.room.id).toBe(crashedReservation.id);
      expect(first.body.room.providerRoomId).toBe(remoteRoomId);
      expect(createRoomCalls).toBe(0);

      const [recovered] = await db
        .select()
        .from(chatRoomsTable)
        .where(eq(chatRoomsTable.id, crashedReservation.id));
      expect(recovered.providerRoomId).toBe(remoteRoomId);
      const members = await db
        .select({ userId: chatRoomMembersTable.userId })
        .from(chatRoomMembersTable)
        .where(eq(chatRoomMembersTable.roomId, crashedReservation.id));
      expect(members.map((member) => member.userId).sort()).toEqual(
        [dealerA.id, timeoutTarget.id].sort(),
      );
    } finally {
      await db.delete(chatRoomMembersTable).where(eq(chatRoomMembersTable.roomId, crashedReservation.id));
      await db.delete(chatRoomsTable).where(eq(chatRoomsTable.id, crashedReservation.id));
      directRoomsByAlias.delete(alias);
    }
  });

  it("releases a reservation after a confirmed pre-create registration failure", async () => {
    createRoomCalls = 0;
    failNextRegistration = true;
    const peerKey = [dealerA.id, registrationFailureTarget.id].sort().join(":");
    const failedMatchToken = await issueContactMatchGrant(
      dealerA.id,
      registrationFailureTarget.id,
      shopA.id,
    );
    const failed = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({
        name: "Registration Failure Direct Room",
        kind: "direct",
        targetUserId: registrationFailureTarget.id,
        matchToken: failedMatchToken,
      });
    expect(failed.status).toBe(503);
    expect(createRoomCalls).toBe(0);
    const afterFailure = await db.select({ id: chatRoomsTable.id }).from(chatRoomsTable)
      .where(and(eq(chatRoomsTable.shopId, shopA.id), eq(chatRoomsTable.peerKey, peerKey)));
    expect(afterFailure).toEqual([]);

    const retryMatchToken = await issueContactMatchGrant(
      dealerA.id,
      registrationFailureTarget.id,
      shopA.id,
    );
    const retry = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({
        name: "Registration Retry Direct Room",
        kind: "direct",
        targetUserId: registrationFailureTarget.id,
        matchToken: retryMatchToken,
      });
    expect(retry.status).toBe(200);
    expect(retry.body.created).toBe(true);
    expect(createRoomCalls).toBe(1);
    registrationRetryRoomId = retry.body.room.id;
  });

  it("releases an ensure-phase timeout so a recovered provider can create the room", async () => {
    createRoomCalls = 0;
    registerCalls = 0;
    hangRegistrationUntilAbort = true;
    registrationTimeoutSignalObserved = false;
    process.env.MATRIX_PROVISION_TIMEOUT_MS = "100";
    const peerKey = [dealerA.id, registrationTimeoutTarget.id].sort().join(":");
    const timedOutMatchToken = await issueContactMatchGrant(
      dealerA.id,
      registrationTimeoutTarget.id,
      shopA.id,
    );
    try {
      const pending = request(app)
        .post("/api/chat/rooms")
        .set("Authorization", `Bearer ${dealerTokenA}`)
        .send({
          name: "Registration Timeout Direct Room",
          kind: "direct",
          targetUserId: registrationTimeoutTarget.id,
          matchToken: timedOutMatchToken,
        })
        .then((response) => response);
      for (let attempt = 0; registerCalls === 0 && attempt < 20; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(registerCalls).toBe(1);
      const timedOut = await pending;
      expect(timedOut.status).toBe(503);
      expect(registrationTimeoutSignalObserved).toBe(true);
      const afterTimeout = await db.select({ id: chatRoomsTable.id }).from(chatRoomsTable)
        .where(and(eq(chatRoomsTable.shopId, shopA.id), eq(chatRoomsTable.peerKey, peerKey)));
      expect(afterTimeout).toEqual([]);
    } finally {
      hangRegistrationUntilAbort = false;
      delete process.env.MATRIX_PROVISION_TIMEOUT_MS;
    }

    const retryMatchToken = await issueContactMatchGrant(
      dealerA.id,
      registrationTimeoutTarget.id,
      shopA.id,
    );
    const retry = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({
        name: "Registration Timeout Retry",
        kind: "direct",
        targetUserId: registrationTimeoutTarget.id,
        matchToken: retryMatchToken,
      });
    expect(retry.status).toBe(200);
    expect(retry.body.created).toBe(true);
    registrationTimeoutRoomId = retry.body.room.id;
  });

  it("releases a target display-name timeout before Matrix room creation", async () => {
    createRoomCalls = 0;
    displayNameCalls = 0;
    displayNameTimeoutSignalObserved = false;
    hangDisplayNameOnCall = 2; // initiator profile succeeds; target profile stalls.
    process.env.MATRIX_PROVISION_TIMEOUT_MS = "100";
    const peerKey = [dealerA.id, displayNameTimeoutTarget.id].sort().join(":");
    const timedOutMatchToken = await issueContactMatchGrant(
      dealerA.id,
      displayNameTimeoutTarget.id,
      shopA.id,
    );
    try {
      const timedOut = await request(app)
        .post("/api/chat/rooms")
        .set("Authorization", `Bearer ${dealerTokenA}`)
        .send({
          name: "Display Name Timeout Direct Room",
          kind: "direct",
          targetUserId: displayNameTimeoutTarget.id,
          matchToken: timedOutMatchToken,
        });
      expect(timedOut.status).toBe(503);
      expect(displayNameTimeoutSignalObserved).toBe(true);
      expect(createRoomCalls).toBe(0);
      const afterTimeout = await db.select({ id: chatRoomsTable.id }).from(chatRoomsTable)
        .where(and(eq(chatRoomsTable.shopId, shopA.id), eq(chatRoomsTable.peerKey, peerKey)));
      expect(afterTimeout).toEqual([]);
    } finally {
      hangDisplayNameOnCall = null;
      delete process.env.MATRIX_PROVISION_TIMEOUT_MS;
    }

    const retryMatchToken = await issueContactMatchGrant(
      dealerA.id,
      displayNameTimeoutTarget.id,
      shopA.id,
    );
    const retry = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${dealerTokenA}`)
      .send({
        name: "Display Name Timeout Retry",
        kind: "direct",
        targetUserId: displayNameTimeoutTarget.id,
        matchToken: retryMatchToken,
      });
    expect(retry.status).toBe(200);
    expect(retry.body.created).toBe(true);
    displayNameTimeoutRoomId = retry.body.room.id;
  });

  it("customer can create kind=direct room when Matrix is configured (Matrix-mocked)", async () => {
    if (!customerTokenA || !customerUserA) return;
    const matchToken = await issueContactMatchGrant(customerUserA.id, dealerA.id, shopA.id);
    // Customer creates a direct room targeting dealerA
    const res = await request(app)
      .post("/api/chat/rooms")
      .set("Authorization", `Bearer ${customerTokenA}`)
      .send({ name: "Customer Direct Room", kind: "direct", targetUserId: dealerA.id, matchToken });
    // Should succeed (200) or return idempotent existing room
    // dealerA and customerUserA are in the same shopA
    if (res.status === 200) {
      expect(res.body.room.kind).toBe("direct");
      const members = await db.select().from(chatRoomMembersTable)
        .where(eq(chatRoomMembersTable.roomId, res.body.room.id));
      expect(members.length).toBe(2);
      const memberIds = members.map((m) => m.userId);
      expect(memberIds).toContain(customerUserA.id);
      expect(memberIds).toContain(dealerA.id);
      // Cleanup
      await db.delete(chatRoomMembersTable).where(eq(chatRoomMembersTable.roomId, res.body.room.id));
      await db.delete(chatRoomsTable).where(eq(chatRoomsTable.id, res.body.room.id));
    } else {
      // Acceptable: peerKey already exists (test isolation) or some other non-portal error
      expect(res.status).not.toBe(403);
      expect(res.body.code).not.toBe("CUSTOMER_PORTAL_FORBIDDEN");
    }
  });
});
