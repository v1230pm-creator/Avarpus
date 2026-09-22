import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  chatRoomMembersTable,
  chatRoomsTable,
  db,
  pendingUploadsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession } from "../lib/authUtils";
import { ObjectStorageService } from "../lib/objectStorage";
import * as pendingUploads from "../lib/pendingUploads";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: string[] = [];
let userId = "";
let token = "";
let roomId = "";

describe.sequential("pending upload route lifecycle", () => {
  beforeAll(async () => {
    const [user] = await db.insert(usersTable).values({
      name: "Upload Route User",
      email: `upload-route-${suffix}@example.test`,
      mobile: `77${suffix.replace(/\D/g, "").slice(-8).padStart(8, "6")}`,
      role: "customer",
      isActive: true,
      passwordHash: null,
    }).returning();
    userId = user.id;
    userIds.push(user.id);
    token = await createSession(user.id, true, "pending-upload-route-test");
    const [room] = await db.insert(chatRoomsTable).values({
      scope: "global_direct",
      kind: "direct",
      name: "Upload route test",
      createdById: user.id,
      createdByName: user.name,
    }).returning();
    roomId = room.id;
    await db.insert(chatRoomMembersTable).values({
      roomId,
      userId,
      role: "member",
    });
  });

  afterAll(async () => {
    await db.delete(pendingUploadsTable).where(eq(pendingUploadsTable.ownerUserId, userId));
    await db.delete(chatRoomsTable).where(eq(chatRoomsTable.id, roomId));
    if (userIds.length) {
      await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    }
  });

  it("registers ownership when issuing a Chat upload URL", async () => {
    const objectPath = `/objects/uploads/global/chat/${roomId}/${randomUUID()}`;
    const signed = vi.spyOn(ObjectStorageService.prototype, "getObjectEntityUploadURLWithPrefix")
      .mockResolvedValue({ uploadURL: "https://storage.example.test/chat", objectPath });
    try {
      const response = await request(app)
        .post(`/api/chat/rooms/${roomId}/upload-url`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "photo.jpg", size: 10, contentType: "image/jpeg" });
      expect(response.status).toBe(200);
      expect(response.body.objectPath).toBe(objectPath);
      const [claim] = await db.select().from(pendingUploadsTable)
        .where(eq(pendingUploadsTable.objectPath, objectPath));
      expect(claim).toMatchObject({ ownerUserId: userId, purpose: "chat" });
    } finally {
      signed.mockRestore();
      await db.delete(pendingUploadsTable).where(eq(pendingUploadsTable.objectPath, objectPath));
    }
  });

  it("registers Profile staging ownership and removes it after a verified save", async () => {
    const stagingPath = `/objects/uploads/profiles/${userId}/${randomUUID()}`;
    const finalPath = `/objects/uploads/profiles/${userId}/final/${randomUUID()}`;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const signed = vi.spyOn(ObjectStorageService.prototype, "getObjectEntityUploadURLWithPrefix")
      .mockResolvedValue({ uploadURL: "https://storage.example.test/profile", objectPath: stagingPath });
    const getFile = vi.spyOn(ObjectStorageService.prototype, "getObjectEntityFile")
      .mockResolvedValue({
        getMetadata: async () => [{ size: String(png.length), contentType: "image/png" }],
        download: async () => [png],
        delete: vi.fn(async () => []),
      } as never);
    const saveFinal = vi.spyOn(ObjectStorageService.prototype, "saveObjectEntityWithPrefix")
      .mockResolvedValue(finalPath);
    try {
      const upload = await request(app)
        .post("/api/storage/profiles/upload-url")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "avatar.png", size: png.length, contentType: "image/png" });
      expect(upload.status).toBe(200);
      const [registered] = await db.select().from(pendingUploadsTable)
        .where(eq(pendingUploadsTable.objectPath, stagingPath));
      expect(registered).toMatchObject({ ownerUserId: userId, purpose: "profile" });

      const update = await request(app)
        .patch("/api/auth/me")
        .set("Authorization", `Bearer ${token}`)
        .send({ profilePhoto: stagingPath });
      expect(update.status).toBe(200);
      expect(update.body.user.profilePhoto).toBe(finalPath);
      const pending = await db.select().from(pendingUploadsTable)
        .where(eq(pendingUploadsTable.objectPath, stagingPath));
      expect(pending).toHaveLength(0);
    } finally {
      signed.mockRestore();
      getFile.mockRestore();
      saveFinal.mockRestore();
      await db.update(usersTable).set({ profilePhoto: null }).where(eq(usersTable.id, userId));
      await db.delete(pendingUploadsTable).where(eq(pendingUploadsTable.objectPath, stagingPath));
    }
  });
  async function attachViaRoute(opts: { previousFinal: string | null; sweeps: "on" | "off" }) {
    const stagingPath = `/objects/uploads/profiles/${userId}/${randomUUID()}`;
    const finalPath = `/objects/uploads/profiles/${userId}/final/${randomUUID()}`;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const deletes: string[] = [];
    await db.update(usersTable).set({ profilePhoto: opts.previousFinal }).where(eq(usersTable.id, userId));
    const previousSweeps = process.env.OBJECT_STORAGE_SWEEPS;
    process.env.OBJECT_STORAGE_SWEEPS = opts.sweeps;
    const signed = vi.spyOn(ObjectStorageService.prototype, "getObjectEntityUploadURLWithPrefix")
      .mockResolvedValue({ uploadURL: "https://storage.example.test/profile", objectPath: stagingPath });
    const getFile = vi.spyOn(ObjectStorageService.prototype, "getObjectEntityFile")
      .mockImplementation(async (path: string) => ({
        getMetadata: async () => [{ size: String(png.length), contentType: "image/png" }],
        download: async () => [png],
        delete: vi.fn(async () => { deletes.push(path); return []; }),
      }) as never);
    const saveFinal = vi.spyOn(ObjectStorageService.prototype, "saveObjectEntityWithPrefix")
      .mockResolvedValue(finalPath);
    try {
      const upload = await request(app)
        .post("/api/storage/profiles/upload-url")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "avatar.png", size: png.length, contentType: "image/png" });
      expect(upload.status).toBe(200);
      const update = await request(app)
        .patch("/api/auth/me")
        .set("Authorization", `Bearer ${token}`)
        .send({ profilePhoto: stagingPath });
      return { update, stagingPath, finalPath, deletes };
    } finally {
      signed.mockRestore();
      getFile.mockRestore();
      saveFinal.mockRestore();
      if (previousSweeps === undefined) delete process.env.OBJECT_STORAGE_SWEEPS;
      else process.env.OBJECT_STORAGE_SWEEPS = previousSweeps;
      await db.update(usersTable).set({ profilePhoto: null }).where(eq(usersTable.id, userId));
      await db.delete(pendingUploadsTable).where(eq(pendingUploadsTable.objectPath, stagingPath));
    }
  }

  it("deletes the displaced final photo on replacement only where this database owns the bucket", async () => {
    const owned = `/objects/uploads/profiles/${userId}/final/${randomUUID()}`;
    const withSweeps = await attachViaRoute({ previousFinal: owned, sweeps: "on" });
    expect(withSweeps.update.status).toBe(200);
    expect(withSweeps.update.body.user.profilePhoto).toBe(withSweeps.finalPath);
    expect(withSweeps.deletes).toContain(owned);
    expect(withSweeps.deletes).not.toContain(withSweeps.finalPath);

    const shared = `/objects/uploads/profiles/${userId}/final/${randomUUID()}`;
    const withoutSweeps = await attachViaRoute({ previousFinal: shared, sweeps: "off" });
    expect(withoutSweeps.update.status).toBe(200);
    expect(withoutSweeps.update.body.user.profilePhoto).toBe(withoutSweeps.finalPath);
    // Another environment's database may still show this photo: keep it.
    expect(withoutSweeps.deletes).not.toContain(shared);
    expect(withoutSweeps.deletes).not.toContain(withoutSweeps.finalPath);
  });

  it("removes a final photo it copied but could not attach (claim expired)", async () => {
    const renew = vi.spyOn(pendingUploads, "refreshPendingUploadClaim").mockResolvedValue(false);
    try {
      const result = await attachViaRoute({ previousFinal: null, sweeps: "off" });
      expect(result.update.status).toBe(409);
      expect(result.update.body.code).toBe("PROFILE_PHOTO_CLAIM_EXPIRED");
      // Created seconds ago in this request and referenced by nothing: gone
      // regardless of the sweep policy.
      expect(result.deletes).toContain(result.finalPath);
      const [row] = await db.select({ profilePhoto: usersTable.profilePhoto }).from(usersTable)
        .where(eq(usersTable.id, userId));
      expect(row.profilePhoto).toBeNull();
    } finally {
      renew.mockRestore();
    }
  });
});
