// Route-level security regression tests for the SIM and device-key flows.
// These use the real development database and never call an SMS provider.
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, like } from "drizzle-orm";
import {
  db,
  deviceAuthChallengesTable,
  loginEventsTable,
  phoneVerificationChallengesTable,
  pool,
  sessionsTable,
  smsVerificationEventsTable,
  userDevicesTable,
  usersTable,
} from "@workspace/db";
import {
  bridgeSigningPayload,
} from "../lib/phoneVerification";

const BRIDGE_SECRET = "sim-security-test-shared-secret";
process.env.SMS_BRIDGE_SHARED_SECRET = BRIDGE_SECRET;

const { default: app } = await import("../app");
const { createSession } = await import("../lib/authUtils");

const RUN = Date.now().toString().slice(-7);
let sequence = 0;
const testMobiles: string[] = [];
const testUserIds: string[] = [];

function nextMobile(): string {
  const mobile = `9${RUN}${String(sequence++).padStart(2, "0")}`;
  testMobiles.push(mobile);
  return mobile;
}

function nextGatewayId(): string {
  return `sim-security-${RUN}-${sequence++}`;
}

function smsFor(challenge: string, senderNumber: string, gatewayMessageId = nextGatewayId()) {
  const payload = {
    senderNumber,
    message: `AVARPUS VERIFY ${challenge}`,
    receivedAt: new Date().toISOString(),
    gatewayMessageId,
  };
  return {
    ...payload,
    signature: crypto
      .createHmac("sha256", BRIDGE_SECRET)
      .update(bridgeSigningPayload(payload), "utf8")
      .digest("hex"),
  };
}

async function startVerification(mobile: string, deviceId?: string) {
  const response = await request(app)
    .post("/api/auth/phone-verification/start")
    .send({ mobile, ...(deviceId ? { deviceId } : {}) });
  expect(response.status).toBe(200);
  return response.body as {
    verificationId: string;
    challenge: string;
    statusToken: string;
    registered: boolean;
  };
}

let userId: string;
let userMobile: string;

async function createActiveUser() {
  const mobile = nextMobile();
  const [user] = await db
    .insert(usersTable)
    .values({
      name: "SIM Security Test User",
      email: `sim-security-${RUN}-${sequence}@example.test`,
      mobile,
      role: "dealer",
      isActive: true,
    })
    .returning({ id: usersTable.id });
  testUserIds.push(user.id);
  return { id: user.id, mobile };
}

beforeAll(async () => {
  const user = await createActiveUser();
  userId = user.id;
  userMobile = user.mobile;
});

afterAll(async () => {
  try {
    if (testMobiles.length > 0) {
      await db
        .delete(phoneVerificationChallengesTable)
        .where(like(phoneVerificationChallengesTable.phoneNumber, `+91${RUN}%`));
    }
    await db
      .delete(smsVerificationEventsTable)
      .where(like(smsVerificationEventsTable.gatewayMessageId, `sim-security-${RUN}-%`));
    for (const id of testUserIds) {
      await db.delete(deviceAuthChallengesTable).where(eq(deviceAuthChallengesTable.userId, id));
      await db.delete(userDevicesTable).where(eq(userDevicesTable.userId, id));
      await db.delete(sessionsTable).where(eq(sessionsTable.userId, id));
      await db.delete(loginEventsTable).where(eq(loginEventsTable.userId, id));
      await db.delete(usersTable).where(eq(usersTable.id, id));
    }
  } finally {
    await pool.end();
  }
});

describe("SIM verification bridge security", () => {
  it("rejects a bridge payload with an invalid HMAC", async () => {
    const user = await createActiveUser();
    const verification = await startVerification(user.mobile);
    const payload = smsFor(verification.challenge, `+91${user.mobile}`);
    payload.signature = "0".repeat(64);

    const response = await request(app).post("/api/auth/sms-verification").send(payload);

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid bridge signature");
  });

  it("rejects a correctly signed bridge payload outside the clock-skew window", async () => {
    const user = await createActiveUser();
    const verification = await startVerification(user.mobile);
    const payload = smsFor(verification.challenge, `+91${user.mobile}`);
    payload.receivedAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    payload.signature = crypto
      .createHmac("sha256", BRIDGE_SECRET)
      .update(bridgeSigningPayload(payload), "utf8")
      .digest("hex");

    const response = await request(app).post("/api/auth/sms-verification").send(payload);

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Stale bridge message");
  });

  it("rejects a valid challenge sent by a different mobile number", async () => {
    const user = await createActiveUser();
    const sender = nextMobile();
    const verification = await startVerification(user.mobile);

    const response = await request(app)
      .post("/api/auth/sms-verification")
      .send(smsFor(verification.challenge, `+91${sender}`));

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      verified: false,
      errorCode: "SENDER_MISMATCH",
    });
  });

  it("expires a SIM challenge and rejects it even with a fresh signed message", async () => {
    const user = await createActiveUser();
    const verification = await startVerification(user.mobile);
    await db
      .update(phoneVerificationChallengesTable)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(phoneVerificationChallengesTable.id, verification.verificationId));

    const response = await request(app)
      .post("/api/auth/sms-verification")
      .send(smsFor(verification.challenge, `+91${user.mobile}`));

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      verified: false,
      errorCode: "EXPIRED",
    });
  });

  it("rejects a reused SIM challenge", async () => {
    const user = await createActiveUser();
    const verification = await startVerification(user.mobile);
    const first = await request(app)
      .post("/api/auth/sms-verification")
      .send(smsFor(verification.challenge, `+91${user.mobile}`));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ verified: true, verificationId: verification.verificationId });

    const second = await request(app)
      .post("/api/auth/sms-verification")
      .send(smsFor(verification.challenge, `+91${user.mobile}`));

    expect(second.status).toBe(400);
    expect(second.body).toMatchObject({
      verified: false,
      errorCode: "CHALLENGE_INVALID_OR_USED",
    });
  });

  it("rejects a duplicate gateway message ID", async () => {
    const user = await createActiveUser();
    const firstVerification = await startVerification(user.mobile);
    const firstPayload = smsFor(firstVerification.challenge, `+91${user.mobile}`);
    const first = await request(app).post("/api/auth/sms-verification").send(firstPayload);
    expect(first.status).toBe(200);

    const secondVerification = await startVerification(user.mobile);
    const duplicateIdPayload = smsFor(
      secondVerification.challenge,
      `+91${user.mobile}`,
      firstPayload.gatewayMessageId,
    );
    const second = await request(app)
      .post("/api/auth/sms-verification")
      .send(duplicateIdPayload);

    expect(second.status).toBe(400);
    expect(second.body).toMatchObject({
      verified: false,
      errorCode: "MESSAGE_ALREADY_PROCESSED",
    });

    const [stillPending] = await db
      .select({ status: phoneVerificationChallengesTable.status })
      .from(phoneVerificationChallengesTable)
      .where(eq(phoneVerificationChallengesTable.id, secondVerification.verificationId));
    expect(stillPending.status).toBe("pending");
  });
});

describe("SIM verification account binding", () => {
  it("does not create an account or session for an unknown mobile", async () => {
    const unknownMobile = nextMobile();
    const verification = await startVerification(unknownMobile);
    expect(verification.registered).toBe(false);

    const bridge = await request(app)
      .post("/api/auth/sms-verification")
      .send(smsFor(verification.challenge, `+91${unknownMobile}`));
    expect(bridge.status).toBe(400);
    expect(bridge.body).toMatchObject({
      verified: false,
      errorCode: "MOBILE_NOT_REGISTERED",
    });

    const status = await request(app)
      .post("/api/auth/phone-verification/status")
      .send({
        verificationId: verification.verificationId,
        statusToken: verification.statusToken,
      });
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      state: "failed",
      errorCode: "MOBILE_NOT_REGISTERED",
    });
    expect(status.body.session).toBeUndefined();

    const users = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.mobile, unknownMobile));
    expect(users).toHaveLength(0);
  });
});

describe("device-key authorization security", () => {
  it("requires recent SIM verification before registering a device key", async () => {
    const sessionToken = await createSession(userId);
    const deviceId = `sim-security-device-${RUN}-registration`;
    const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

    const response = await request(app)
      .post("/api/auth/devices/register")
      .set("Authorization", `Bearer ${sessionToken}`)
      .send({ deviceId, publicKey: publicKeyPem, algorithm: "RSA-SHA256" });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: "SIM_VERIFICATION_REQUIRED" });
  });

  it("rejects invalid, expired, and reused device-auth challenges", async () => {
    const sessionToken = await createSession(userId);
    const deviceId = `sim-security-device-${RUN}-auth`;
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

    const verification = await startVerification(userMobile, deviceId);
    const bridge = await request(app)
      .post("/api/auth/sms-verification")
      .send(smsFor(verification.challenge, `+91${userMobile}`));
    expect(bridge.status).toBe(200);

    const status = await request(app)
      .post("/api/auth/phone-verification/status")
      .send({
        verificationId: verification.verificationId,
        statusToken: verification.statusToken,
      });
    expect(status.status).toBe(200);
    expect(status.body.state).toBe("verified");

    const registration = await request(app)
      .post("/api/auth/devices/register")
      .set("Authorization", `Bearer ${sessionToken}`)
      .send({ deviceId, publicKey: publicKeyPem, algorithm: "RSA-SHA256" });
    expect(registration.status).toBe(200);

    const challenge = await request(app)
      .post("/api/auth/device/challenge")
      .send({ mobile: userMobile, deviceId });
    expect(challenge.status).toBe(200);
    const challengeBody = challenge.body as { challengeId: string; challenge: string };

    const invalid = await request(app)
      .post("/api/auth/device/authenticate")
      .send({
        challengeId: challengeBody.challengeId,
        challenge: challengeBody.challenge,
        deviceId,
        signature: Buffer.from("not the device signature").toString("base64"),
      });
    expect(invalid.status).toBe(401);

    const signer = crypto.createSign("SHA256");
    signer.update(challengeBody.challenge, "utf8");
    signer.end();
    const validSignature = signer.sign(privateKey).toString("base64");
    const authenticated = await request(app)
      .post("/api/auth/device/authenticate")
      .send({
        challengeId: challengeBody.challengeId,
        challenge: challengeBody.challenge,
        deviceId,
        signature: validSignature,
      });
    expect(authenticated.status).toBe(200);
    expect(typeof authenticated.body.token).toBe("string");

    const reused = await request(app)
      .post("/api/auth/device/authenticate")
      .send({
        challengeId: challengeBody.challengeId,
        challenge: challengeBody.challenge,
        deviceId,
        signature: validSignature,
      });
    expect(reused.status).toBe(401);

    const expiredChallenge = await request(app)
      .post("/api/auth/device/challenge")
      .send({ mobile: userMobile, deviceId });
    expect(expiredChallenge.status).toBe(200);
    const expiredBody = expiredChallenge.body as { challengeId: string; challenge: string };
    await db
      .update(deviceAuthChallengesTable)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(deviceAuthChallengesTable.id, expiredBody.challengeId));

    const expiredSigner = crypto.createSign("SHA256");
    expiredSigner.update(expiredBody.challenge, "utf8");
    expiredSigner.end();
    const expired = await request(app)
      .post("/api/auth/device/authenticate")
      .send({
        challengeId: expiredBody.challengeId,
        challenge: expiredBody.challenge,
        deviceId,
        signature: expiredSigner.sign(privateKey).toString("base64"),
      });
    expect(expired.status).toBe(401);
  });
});