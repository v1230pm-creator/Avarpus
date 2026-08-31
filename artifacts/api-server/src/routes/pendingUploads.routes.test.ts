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
});