import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  chatMessagesTable,
  chatRoomsTable,
  db,
  pendingUploadsTable,
  usersTable,
} from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import {
  ABANDONED_UPLOAD_GRACE_MS,
  claimPendingUpload,
  cleanupAbandonedChatAndProfileUploads,
  completePendingUpload,
  refreshPendingUploadClaim,
  registerPendingUpload,
  releasePendingUpload,
  UPLOAD_PROCESSING_LEASE_MS,
} from "./pendingUploads";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: string[] = [];
let userId = "";
let roomId = "";

function oldMetadata() {
  return [{
    timeCreated: new Date(Date.now() - ABANDONED_UPLOAD_GRACE_MS - 60_000).toISOString(),
  }];
}

function listedFile(objectPath: string, deleteFile = vi.fn()) {
  return {
    objectPath,
    file: {
      getMetadata: async () => oldMetadata(),
      delete: deleteFile,
    },
  };
}

describe.sequential("Chat/Profile abandoned upload cleanup", () => {
  beforeAll(async () => {
    const [user] = await db.insert(usersTable).values({
      name: "Pending Upload User",
      email: `pending-upload-${suffix}@example.test`,
      mobile: `79${suffix.replace(/\D/g, "").slice(-8).padStart(8, "4")}`,
      role: "customer",
      isActive: true,
      passwordHash: null,
    }).returning();
    userId = user.id;
    userIds.push(user.id);
    const [room] = await db.insert(chatRoomsTable).values({
      scope: "global_direct",
      kind: "direct",
      name: "Pending upload test",
      createdById: user.id,
      createdByName: user.name,
    }).returning();
    roomId = room.id;
  });

  afterAll(async () => {
    await db.delete(pendingUploadsTable).where(eq(pendingUploadsTable.ownerUserId, userId));
    await db.delete(chatRoomsTable).where(eq(chatRoomsTable.id, roomId));
    if (userIds.length) {
      await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    }
  });

  it("deletes old registered, never-attached Chat/Profile-staging objects while ignoring unrelated namespaces", async () => {
    const profilePath = `/objects/uploads/profiles/${userId}/${randomUUID()}`;
    const chatPath = `/objects/uploads/global/chat/${roomId}/${randomUUID()}`;
    const statusPath = `/objects/uploads/status/${userId}/${randomUUID()}`;
    const profileDelete = vi.fn();
    const chatDelete = vi.fn();
    const statusDelete = vi.fn();
    await registerPendingUpload({ objectPath: profilePath, ownerUserId: userId, purpose: "profile" });
    await registerPendingUpload({ objectPath: chatPath, ownerUserId: userId, purpose: "chat" });
    const list = vi.spyOn(ObjectStorageService.prototype, "listObjectEntityFiles")
      .mockResolvedValue([
        listedFile(profilePath, profileDelete),
        listedFile(chatPath, chatDelete),
        listedFile(statusPath, statusDelete),
      ] as never);
    try {
      const result = await cleanupAbandonedChatAndProfileUploads();
      expect(result).toMatchObject({
        listed: 3,
        considered: 2,
        deleted: 2,
        ignored: 1,
        protected: 0,
        unregistered: 0,
        failed: 0,
      });
      expect(profileDelete).toHaveBeenCalledOnce();
      expect(chatDelete).toHaveBeenCalledOnce();
      expect(statusDelete).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalledWith("uploads/");
      expect(list).toHaveBeenCalledWith("uploads/profiles/");
      expect(list).toHaveBeenCalledWith("uploads/global/chat/");
      const rows = await db.select().from(pendingUploadsTable).where(
        inArray(pendingUploadsTable.objectPath, [profilePath, chatPath]),
      );
      expect(rows).toHaveLength(0);
    } finally {
      list.mockRestore();
    }
  });

  it("never deletes a final profile photo, even when old and unreferenced by this database", async () => {
    // A final object belongs to whichever user row points at it — possibly in
    // another environment's database sharing the same bucket. No reference
    // check may decide its fate.
    const finalPath = `/objects/uploads/profiles/${randomUUID()}/final/${randomUUID()}`;
    const finalDelete = vi.fn();
    const list = vi.spyOn(ObjectStorageService.prototype, "listObjectEntityFiles")
      .mockResolvedValue([listedFile(finalPath, finalDelete)] as never);
    try {
      const result = await cleanupAbandonedChatAndProfileUploads();
      expect(result).toMatchObject({
        listed: 1,
        considered: 0,
        protected: 1,
        deleted: 0,
        failed: 0,
      });
      expect(finalDelete).not.toHaveBeenCalled();
    } finally {
      list.mockRestore();
    }
  });

  it("leaves old objects this database never registered untouched", async () => {
    // Uploads issued by another environment (or before the registry existed)
    // have no pending_uploads row here; "no reference here" proves nothing.
    const profilePath = `/objects/uploads/profiles/${randomUUID()}/${randomUUID()}`;
    const chatPath = `/objects/uploads/global/chat/${randomUUID()}/${randomUUID()}`;
    const profileDelete = vi.fn();
    const chatDelete = vi.fn();
    const list = vi.spyOn(ObjectStorageService.prototype, "listObjectEntityFiles")
      .mockResolvedValue([
        listedFile(profilePath, profileDelete),
        listedFile(chatPath, chatDelete),
      ] as never);
    try {
      const result = await cleanupAbandonedChatAndProfileUploads();
      expect(result).toMatchObject({
        listed: 2,
        considered: 2,
        unregistered: 2,
        deleted: 0,
        failed: 0,
      });
      expect(profileDelete).not.toHaveBeenCalled();
      expect(chatDelete).not.toHaveBeenCalled();
    } finally {
      list.mockRestore();
    }
  });

  it("retains active Profile photos and successfully attached Chat media", async () => {
    const profilePath = `/objects/uploads/profiles/${userId}/final/${randomUUID()}`;
    const chatPath = `/objects/uploads/global/chat/${roomId}/${randomUUID()}`;
    const profileDelete = vi.fn();
    const chatDelete = vi.fn();
    await db.update(usersTable).set({ profilePhoto: profilePath }).where(eq(usersTable.id, userId));
    const [message] = await db.insert(chatMessagesTable).values({
      roomId,
      senderId: userId,
      senderName: "Pending Upload User",
      kind: "image",
      body: "attached.jpg",
      objectPath: chatPath,
      clientRequestId: `pending-upload-${suffix}`,
    }).returning();
    await registerPendingUpload({ objectPath: chatPath, ownerUserId: userId, purpose: "chat" });
    const list = vi.spyOn(ObjectStorageService.prototype, "listObjectEntityFiles")
      .mockResolvedValue([
        listedFile(profilePath, profileDelete),
        listedFile(chatPath, chatDelete),
      ] as never);
    try {
      const result = await cleanupAbandonedChatAndProfileUploads();
      expect(result).toMatchObject({ protected: 1, retained: 1, deleted: 0, failed: 0 });
      expect(profileDelete).not.toHaveBeenCalled();
      expect(chatDelete).not.toHaveBeenCalled();
      const claims = await db.select().from(pendingUploadsTable).where(
        inArray(pendingUploadsTable.objectPath, [profilePath, chatPath]),
      );
      expect(claims).toHaveLength(0);
    } finally {
      list.mockRestore();
      await db.delete(chatMessagesTable).where(eq(chatMessagesTable.id, message.id));
      await db.update(usersTable).set({ profilePhoto: null }).where(eq(usersTable.id, userId));
    }
  });

  it("keeps an old upload while an attach lease is active", async () => {
    const objectPath = `/objects/uploads/global/chat/${roomId}/${randomUUID()}`;
    const deleteFile = vi.fn();
    await registerPendingUpload({ objectPath, ownerUserId: userId, purpose: "chat" });
    const claim = await claimPendingUpload({
      objectPath,
      ownerUserId: userId,
      purpose: "chat",
    });
    expect(claim).not.toBeNull();
    const list = vi.spyOn(ObjectStorageService.prototype, "listObjectEntityFiles")
      .mockResolvedValue([listedFile(objectPath, deleteFile)] as never);
    try {
      const result = await cleanupAbandonedChatAndProfileUploads();
      expect(result).toMatchObject({ retained: 1, deleted: 0, failed: 0 });
      expect(deleteFile).not.toHaveBeenCalled();
    } finally {
      list.mockRestore();
      await completePendingUpload({
        objectPath,
        ownerUserId: userId,
        purpose: "chat",
        token: claim!.token,
      });
    }
  });

  it("rejects a claim owned by another account", async () => {
    const [other] = await db.insert(usersTable).values({
      name: "Other Upload User",
      email: `pending-upload-other-${suffix}@example.test`,
      mobile: `78${suffix.replace(/\D/g, "").slice(-8).padStart(8, "5")}`,
      role: "customer",
      isActive: true,
      passwordHash: null,
    }).returning();
    userIds.push(other.id);
    const objectPath = `/objects/uploads/global/chat/${roomId}/${randomUUID()}`;
    await registerPendingUpload({ objectPath, ownerUserId: other.id, purpose: "chat" });
    expect(await claimPendingUpload({
      objectPath,
      ownerUserId: userId,
      purpose: "chat",
    })).toBeNull();
    await db.delete(pendingUploadsTable).where(eq(pendingUploadsTable.objectPath, objectPath));
  });

  it("uses exclusive fenced claims so an old request cannot clear a replacement lease", async () => {
    const objectPath = `/objects/uploads/global/chat/${roomId}/${randomUUID()}`;
    await registerPendingUpload({ objectPath, ownerUserId: userId, purpose: "chat" });
    const start = new Date("2026-08-31T00:00:00.000Z");
    const first = await claimPendingUpload({
      objectPath,
      ownerUserId: userId,
      purpose: "chat",
      now: start,
    });
    expect(first).not.toBeNull();
    expect(await claimPendingUpload({
      objectPath,
      ownerUserId: userId,
      purpose: "chat",
      now: new Date(start.getTime() + 1_000),
    })).toBeNull();

    const replacement = await claimPendingUpload({
      objectPath,
      ownerUserId: userId,
      purpose: "chat",
      now: new Date(start.getTime() + UPLOAD_PROCESSING_LEASE_MS + 1),
    });
    expect(replacement).not.toBeNull();
    expect(replacement!.token).not.toBe(first!.token);

    await releasePendingUpload({
      objectPath,
      ownerUserId: userId,
      purpose: "chat",
      token: first!.token,
    });
    expect(await refreshPendingUploadClaim({
      objectPath,
      ownerUserId: userId,
      purpose: "chat",
      token: first!.token,
      now: new Date(start.getTime() + UPLOAD_PROCESSING_LEASE_MS + 2),
    })).toBe(false);
    expect(await refreshPendingUploadClaim({
      objectPath,
      ownerUserId: userId,
      purpose: "chat",
      token: replacement!.token,
      now: new Date(start.getTime() + UPLOAD_PROCESSING_LEASE_MS + 2),
    })).toBe(true);
    await completePendingUpload({
      objectPath,
      ownerUserId: userId,
      purpose: "chat",
      token: replacement!.token,
    });
  });

  it("leaves a failed deletion available for the next cleanup retry", async () => {
    const objectPath = `/objects/uploads/profiles/${userId}/${randomUUID()}`;
    const deleteFile = vi.fn()
      .mockRejectedValueOnce(new Error("temporary storage failure"))
      .mockResolvedValueOnce([]);
    await registerPendingUpload({ objectPath, ownerUserId: userId, purpose: "profile" });
    const list = vi.spyOn(ObjectStorageService.prototype, "listObjectEntityFiles")
      .mockResolvedValue([listedFile(objectPath, deleteFile)] as never);
    try {
      const first = await cleanupAbandonedChatAndProfileUploads();
      const second = await cleanupAbandonedChatAndProfileUploads();
      expect(first).toMatchObject({ deleted: 0, failed: 1 });
      expect(second).toMatchObject({ deleted: 1, failed: 0 });
      expect(deleteFile).toHaveBeenCalledTimes(2);
    } finally {
      list.mockRestore();
    }
  });
});