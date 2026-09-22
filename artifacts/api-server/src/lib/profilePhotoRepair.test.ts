import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "./objectStorage";
import {
  canonicalProfilePathFromLegacy,
  clearMissingProfilePhotoReferences,
  repairLeftNoLegacyReferences,
  repairLegacyProfilePhotoPaths,
} from "./profilePhotoRepair";

const PRIVATE_DIR = "/test-bucket/.private";

function legacyPath(userId: string, objectId: string) {
  return `${PRIVATE_DIR.split("/.private")[0]}/${encodeURIComponent(
    `.private/uploads/profiles/${userId}/final/${objectId}`,
  )}`;
}

describe("canonicalProfilePathFromLegacy", () => {
  const userId = randomUUID();
  const objectId = randomUUID();

  it("decodes a percent-encoded bucket path into the /objects entity path", () => {
    expect(canonicalProfilePathFromLegacy(legacyPath(userId, objectId), PRIVATE_DIR)).toBe(
      `/objects/uploads/profiles/${userId}/final/${objectId}`,
    );
  });

  it("leaves canonical paths and foreign paths alone", () => {
    expect(
      canonicalProfilePathFromLegacy(`/objects/uploads/profiles/${userId}/${objectId}`, PRIVATE_DIR),
    ).toBeNull();
    expect(canonicalProfilePathFromLegacy("/other-bucket/.private%2Fuploads%2Fx", PRIVATE_DIR)).toBeNull();
    expect(
      canonicalProfilePathFromLegacy(
        `/test-bucket/.private%2Fuploads%2Fglobal%2Fchat%2F${userId}%2F${objectId}`,
        PRIVATE_DIR,
      ),
    ).toBeNull();
    expect(canonicalProfilePathFromLegacy("/test-bucket/%E0%A4%A", PRIVATE_DIR)).toBeNull();
  });
});

describe("ObjectStorageService.normalizeObjectEntityPath", () => {
  const previous = process.env.PRIVATE_OBJECT_DIR;
  beforeAll(() => {
    process.env.PRIVATE_OBJECT_DIR = PRIVATE_DIR;
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.PRIVATE_OBJECT_DIR;
    else process.env.PRIVATE_OBJECT_DIR = previous;
  });

  it("recognises percent-encoded storage URLs as private-dir objects", () => {
    const service = new ObjectStorageService();
    const encoded = `https://storage.googleapis.com/test-bucket/${encodeURIComponent(
      ".private/uploads/profiles/u/final/o",
    )}`;
    expect(service.normalizeObjectEntityPath(encoded)).toBe("/objects/uploads/profiles/u/final/o");
    expect(
      service.normalizeObjectEntityPath("https://storage.googleapis.com/test-bucket/.private/uploads/profiles/u/o"),
    ).toBe("/objects/uploads/profiles/u/o");
  });
});

describe.sequential("repairLegacyProfilePhotoPaths", () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userIds: string[] = [];
  const previous = process.env.PRIVATE_OBJECT_DIR;
  let liveUserId = "";
  let goneUserId = "";
  let canonicalUserId = "";
  let flakyUserId = "";
  const liveObjectId = randomUUID();
  const goneObjectId = randomUUID();
  const flakyObjectId = randomUUID();

  beforeAll(async () => {
    process.env.PRIVATE_OBJECT_DIR = PRIVATE_DIR;
    let i = 0;
    for (const label of ["live", "gone", "canonical", "flaky"] as const) {
      i += 1;
      const [user] = await db.insert(usersTable).values({
        name: `Photo Repair ${label}`,
        email: `photo-repair-${label}-${suffix}@example.test`,
        mobile: `78${i}${suffix.replace(/\D/g, "").slice(-7).padStart(7, "5")}`,
        role: "customer",
        isActive: true,
        passwordHash: null,
      }).returning();
      userIds.push(user.id);
      if (label === "live") liveUserId = user.id;
      if (label === "gone") goneUserId = user.id;
      if (label === "canonical") canonicalUserId = user.id;
      if (label === "flaky") flakyUserId = user.id;
    }
    await db.update(usersTable)
      .set({ profilePhoto: legacyPath(flakyUserId, flakyObjectId) })
      .where(eq(usersTable.id, flakyUserId));
    await db.update(usersTable)
      .set({ profilePhoto: legacyPath(liveUserId, liveObjectId) })
      .where(eq(usersTable.id, liveUserId));
    await db.update(usersTable)
      .set({ profilePhoto: legacyPath(goneUserId, goneObjectId) })
      .where(eq(usersTable.id, goneUserId));
    await db.update(usersTable)
      .set({ profilePhoto: `/objects/uploads/profiles/${canonicalUserId}/final/${randomUUID()}` })
      .where(eq(usersTable.id, canonicalUserId));
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (previous === undefined) delete process.env.PRIVATE_OBJECT_DIR;
    else process.env.PRIVATE_OBJECT_DIR = previous;
    if (userIds.length > 0) {
      await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    }
  });

  it("rewrites existing objects, clears true not-found, and preserves rows on transient storage errors", async () => {
    const liveCanonical = `/objects/uploads/profiles/${liveUserId}/final/${liveObjectId}`;
    const flakyCanonical = `/objects/uploads/profiles/${flakyUserId}/final/${flakyObjectId}`;
    const flakyLegacy = legacyPath(flakyUserId, flakyObjectId);
    const seen: string[] = [];
    vi.spyOn(ObjectStorageService.prototype, "getObjectEntityFile").mockImplementation(
      async (path: string) => {
        seen.push(path);
        if (path === liveCanonical) return {} as never;
        if (path === flakyCanonical) throw new Error("sidecar unreachable");
        throw new ObjectNotFoundError();
      },
    );

    const result = await repairLegacyProfilePhotoPaths();
    expect(result.repaired).toBeGreaterThanOrEqual(1);
    expect(result.cleared).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(repairLeftNoLegacyReferences(result)).toBe(false);
    expect(seen).toContain(liveCanonical);
    expect(seen).toContain(flakyCanonical);

    const rows = await db
      .select({ id: usersTable.id, profilePhoto: usersTable.profilePhoto })
      .from(usersTable)
      .where(inArray(usersTable.id, userIds));
    const byId = new Map(rows.map((row) => [row.id, row.profilePhoto]));
    expect(byId.get(liveUserId)).toBe(liveCanonical);
    expect(byId.get(goneUserId)).toBeNull();
    expect(byId.get(canonicalUserId)).toMatch(/^\/objects\/uploads\/profiles\//);
    // A transient error must never clear a photo: the legacy value survives.
    expect(byId.get(flakyUserId)).toBe(flakyLegacy);

    // Once storage answers, the retried row is repaired and nothing is left.
    vi.restoreAllMocks();
    vi.spyOn(ObjectStorageService.prototype, "getObjectEntityFile").mockResolvedValue({} as never);
    const again = await repairLegacyProfilePhotoPaths();
    const remaining = await db
      .select({ id: usersTable.id, profilePhoto: usersTable.profilePhoto })
      .from(usersTable)
      .where(inArray(usersTable.id, userIds));
    expect(remaining.find((row) => row.id === flakyUserId)?.profilePhoto).toBe(flakyCanonical);
    expect(remaining.every((row) => row.profilePhoto === null || row.profilePhoto.startsWith("/objects/"))).toBe(true);
    expect(again.failed).toBe(0);
  });
});

describe.sequential("clearMissingProfilePhotoReferences", () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userIds: string[] = [];
  let presentUserId = "";
  let missingUserId = "";
  let erroringUserId = "";
  let presentPath = "";
  let missingPath = "";
  let erroringPath = "";

  beforeAll(async () => {
    let i = 0;
    for (const label of ["present", "missing", "erroring"] as const) {
      i += 1;
      const [user] = await db.insert(usersTable).values({
        name: `Photo Missing ${label}`,
        email: `photo-missing-${label}-${suffix}@example.test`,
        mobile: `77${i}${suffix.replace(/\D/g, "").slice(-7).padStart(7, "6")}`,
        role: "customer",
        isActive: true,
        passwordHash: null,
      }).returning();
      userIds.push(user.id);
      const path = `/objects/uploads/profiles/${user.id}/final/${randomUUID()}`;
      await db.update(usersTable).set({ profilePhoto: path }).where(eq(usersTable.id, user.id));
      if (label === "present") { presentUserId = user.id; presentPath = path; }
      if (label === "missing") { missingUserId = user.id; missingPath = path; }
      if (label === "erroring") { erroringUserId = user.id; erroringPath = path; }
    }
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (userIds.length > 0) {
      await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    }
  });

  it("clears only references whose object is definitively gone and never deletes anything", async () => {
    const deleted = vi.fn();
    vi.spyOn(ObjectStorageService.prototype, "getObjectEntityFile").mockImplementation(
      async (path: string) => {
        if (path === presentPath) return { delete: deleted } as never;
        if (path === erroringPath) throw new Error("sidecar unreachable");
        if (path === missingPath) throw new ObjectNotFoundError();
        return {} as never;
      },
    );

    const result = await clearMissingProfilePhotoReferences();
    expect(result.cleared).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(deleted).not.toHaveBeenCalled();

    const rows = await db
      .select({ id: usersTable.id, profilePhoto: usersTable.profilePhoto })
      .from(usersTable)
      .where(inArray(usersTable.id, userIds));
    const byId = new Map(rows.map((row) => [row.id, row.profilePhoto]));
    expect(byId.get(presentUserId)).toBe(presentPath);
    expect(byId.get(missingUserId)).toBeNull();
    // A transient storage error must never clear a photo.
    expect(byId.get(erroringUserId)).toBe(erroringPath);
  });
});
