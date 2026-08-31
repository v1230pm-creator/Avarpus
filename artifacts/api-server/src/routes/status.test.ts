import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app";
import {
  chatBlocksTable,
  chatRoomMembersTable,
  chatRoomsTable,
  db,
  statusUpdatesTable,
  statusViewersTable,
  usersTable,
} from "@workspace/db";
import { createSession } from "../lib/authUtils";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { cleanupAbandonedStatusUploads, STATUS_UPLOAD_GRACE_MS } from "./status";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const digits = suffix.replace(/\D/g, "").slice(-8).padStart(8, "7");
const userIds: string[] = [];
let authorId = "";
let contactId = "";
let outsiderId = "";
let authorToken = "";
let contactToken = "";
let outsiderToken = "";
let roomId = "";

async function createUser(tag: string, prefix: string) {
  const [user] = await db.insert(usersTable).values({
    name: `Status ${tag}`,
    email: `status-${tag}-${suffix}@example.test`,
    mobile: `${prefix}${digits}`,
    role: "customer",
    isActive: true,
    passwordHash: null,
  }).returning();
  userIds.push(user.id);
  return user;
}

describe.sequential("personal Status updates", () => {
  beforeAll(async () => {
    const author = await createUser("author", "81");
    const contact = await createUser("contact", "82");
    const outsider = await createUser("outsider", "83");
    authorId = author.id;
    contactId = contact.id;
    outsiderId = outsider.id;
    authorToken = await createSession(author.id, true, "status-test-author");
    contactToken = await createSession(contact.id, true, "status-test-contact");
    outsiderToken = await createSession(outsider.id, true, "status-test-outsider");

    const [room] = await db.insert(chatRoomsTable).values({
      scope: "global_direct",
      kind: "direct",
      name: "Personal contact",
      peerKey: [author.id, contact.id].sort().join(":"),
      createdById: author.id,
      createdByName: author.name,
    }).returning();
    roomId = room.id;
    await db.insert(chatRoomMembersTable).values([
      { roomId: room.id, userId: author.id, role: "member" },
      { roomId: room.id, userId: contact.id, role: "member" },
    ]);
  });

  afterAll(async () => {
    if (userIds.length) {
      await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    }
  });

  it("publishes a real text status with a server-owned 24-hour expiry", async () => {
    const before = Date.now();
    const response = await request(app)
      .post("/api/statuses")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({ kind: "text", body: "A real update", audience: "contacts" });
    expect(response.status).toBe(201);
    expect(response.body.status).toMatchObject({
      authorId,
      kind: "text",
      body: "A real update",
      viewed: false,
      viewerCount: 0,
    });
    const ttl = new Date(response.body.status.expiresAt).getTime() - before;
    expect(ttl).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 2_000);
  });

  it("rejects foreign paths and stored media metadata mismatches", async () => {
    const fileLookup = vi.spyOn(ObjectStorageService.prototype, "getObjectEntityFile");
    const foreign = await request(app)
      .post("/api/statuses")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        kind: "image",
        objectPath: `/objects/uploads/status/${contactId}/foreign`,
        mimeType: "image/jpeg",
        sizeBytes: 12,
      });
    expect(foreign.status).toBe(400);
    expect(fileLookup).not.toHaveBeenCalled();

    fileLookup.mockResolvedValue({
      getMetadata: async () => [{ contentType: "image/png", size: "13" }],
    } as never);
    const mismatch = await request(app)
      .post("/api/statuses")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        kind: "image",
        objectPath: `/objects/uploads/status/${authorId}/uploaded`,
        mimeType: "image/jpeg",
        sizeBytes: 12,
      });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.message).toMatch(/failed validation/i);
    fileLookup.mockRestore();
  });

  it("publishes uploaded image bytes only after real object metadata validation", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const upload = await request(app)
      .post("/api/statuses/upload-url")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({ name: "status.jpg", size: bytes.byteLength, contentType: "image/jpeg" });
    expect(upload.status).toBe(200);
    const put = await fetch(upload.body.uploadURL, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: bytes,
    });
    expect(put.ok).toBe(true);
    try {
      const published = await request(app)
        .post("/api/statuses")
        .set("Authorization", `Bearer ${authorToken}`)
        .send({
          kind: "image",
          objectPath: upload.body.objectPath,
          mimeType: "image/jpeg",
          sizeBytes: bytes.byteLength,
          audience: "contacts",
        });
      expect(published.status).toBe(201);
      expect(published.body.status).toMatchObject({
        kind: "image",
        mediaUrl: `/api/storage${upload.body.objectPath}`,
      });
      const visibleMedia = await request(app)
        .get(published.body.status.mediaUrl)
        .set("Authorization", `Bearer ${contactToken}`);
      expect(visibleMedia.status).toBe(200);
      await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, authorId));
      const deactivatedMedia = await request(app)
        .get(published.body.status.mediaUrl)
        .set("Authorization", `Bearer ${contactToken}`);
      expect(deactivatedMedia.status).toBe(404);
      await db.update(usersTable).set({ isActive: true }).where(eq(usersTable.id, authorId));
      const removed = await request(app)
        .delete(`/api/statuses/${published.body.status.id}`)
        .set("Authorization", `Bearer ${authorToken}`);
      expect(removed.status).toBe(204);
      await expect(
        new ObjectStorageService().getObjectEntityFile(upload.body.objectPath),
      ).rejects.toBeInstanceOf(ObjectNotFoundError);
    } finally {
      try {
        const objectFile = await new ObjectStorageService().getObjectEntityFile(upload.body.objectPath);
        await objectFile.delete({ ignoreNotFound: true });
      } catch {}
    }
  });

  it("deletes old unclaimed uploads but retains media attached to a live status", async () => {
    const attachedPath = `/objects/uploads/status/${authorId}/attached`;
    const abandonedPath = `/objects/uploads/status/${authorId}/abandoned`;
    const freshPath = `/objects/uploads/status/${authorId}/fresh`;
    const attachedDelete = vi.fn();
    const abandonedDelete = vi.fn();
    const freshDelete = vi.fn();
    const listFiles = vi.spyOn(ObjectStorageService.prototype, "listObjectEntityFiles")
      .mockResolvedValue([
        {
          objectPath: attachedPath,
          file: {
            getMetadata: async () => [{
              timeCreated: new Date(Date.now() - STATUS_UPLOAD_GRACE_MS - 1_000).toISOString(),
            }],
            delete: attachedDelete,
          },
        },
        {
          objectPath: abandonedPath,
          file: {
            getMetadata: async () => [{
              timeCreated: new Date(Date.now() - STATUS_UPLOAD_GRACE_MS - 1_000).toISOString(),
            }],
            delete: abandonedDelete,
          },
        },
        {
          objectPath: freshPath,
          file: {
            getMetadata: async () => [{
              timeCreated: new Date(Date.now() - STATUS_UPLOAD_GRACE_MS + 60_000).toISOString(),
            }],
            delete: freshDelete,
          },
        },
      ] as never);
    const [liveStatus] = await db.insert(statusUpdatesTable).values({
      authorId,
      kind: "image",
      objectPath: attachedPath,
      mimeType: "image/jpeg",
      sizeBytes: 1,
      audience: "contacts",
      expiresAt: new Date(Date.now() + 60_000),
    }).returning();
    try {
      const result = await cleanupAbandonedStatusUploads();
      expect(result).toMatchObject({
        listed: 3,
        retained: 1,
        deleted: 1,
        tooNew: 1,
        failed: 0,
      });
      expect(attachedDelete).not.toHaveBeenCalled();
      expect(abandonedDelete).toHaveBeenCalledOnce();
      expect(freshDelete).not.toHaveBeenCalled();
    } finally {
      listFiles.mockRestore();
      await db.delete(statusUpdatesTable).where(eq(statusUpdatesTable.id, liveStatus.id));
    }
  });

  it("leaves a failed orphan delete for the next cleanup run to retry", async () => {
    const objectPath = `/objects/uploads/status/${authorId}/retryable`;
    const deleteFile = vi.fn()
      .mockRejectedValueOnce(new Error("temporary storage outage"))
      .mockResolvedValueOnce([]);
    const listFiles = vi.spyOn(ObjectStorageService.prototype, "listObjectEntityFiles")
      .mockResolvedValue([{
        objectPath,
        file: {
          getMetadata: async () => [{
            timeCreated: new Date(Date.now() - STATUS_UPLOAD_GRACE_MS - 1_000).toISOString(),
          }],
          delete: deleteFile,
        },
      }] as never);
    try {
      const first = await cleanupAbandonedStatusUploads();
      expect(first).toMatchObject({ listed: 1, deleted: 0, failed: 1 });
      const second = await cleanupAbandonedStatusUploads();
      expect(second).toMatchObject({ listed: 1, deleted: 1, failed: 0 });
      expect(deleteFile).toHaveBeenCalledTimes(2);
    } finally {
      listFiles.mockRestore();
    }
  });

  it("does not delete an old upload while it is being published", async () => {
    const objectPath = `/objects/uploads/status/${authorId}/publish-race`;
    let releaseValidation!: () => void;
    let reportValidationStarted!: () => void;
    const validationGate = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    const validationStarted = new Promise<void>((resolve) => {
      reportValidationStarted = resolve;
    });
    const fileLookup = vi.spyOn(ObjectStorageService.prototype, "getObjectEntityFile")
      .mockResolvedValue({
        getMetadata: async () => {
          reportValidationStarted();
          await validationGate;
          return [{ contentType: "image/jpeg", size: "1" }];
        },
      } as never);
    const cleanupDelete = vi.fn();
    const listFiles = vi.spyOn(ObjectStorageService.prototype, "listObjectEntityFiles")
      .mockResolvedValue([{
        objectPath,
        file: {
          getMetadata: async () => [{
            timeCreated: new Date(Date.now() - STATUS_UPLOAD_GRACE_MS - 1_000).toISOString(),
          }],
          delete: cleanupDelete,
        },
      }] as never);
    let publishedId: string | undefined;
    try {
      const publishPromise = request(app)
        .post("/api/statuses")
        .set("Authorization", `Bearer ${authorToken}`)
        .send({
          kind: "image",
          objectPath,
          mimeType: "image/jpeg",
          sizeBytes: 1,
          audience: "contacts",
        })
        .then((response) => response);
      await validationStarted;
      const cleanupPromise = cleanupAbandonedStatusUploads();
      await new Promise((resolve) => setTimeout(resolve, 25));
      releaseValidation();

      const [published, cleanup] = await Promise.all([publishPromise, cleanupPromise]);
      publishedId = published.body.status?.id;
      expect(published.status).toBe(201);
      expect(cleanup).toMatchObject({ listed: 1, retained: 1, deleted: 0, failed: 0 });
      expect(cleanupDelete).not.toHaveBeenCalled();
    } finally {
      releaseValidation();
      listFiles.mockRestore();
      fileLookup.mockRestore();
      if (publishedId) {
        await db.delete(statusUpdatesTable).where(eq(statusUpdatesTable.id, publishedId));
      }
    }
  });

  it("shows the update to personal direct contacts but not unrelated accounts", async () => {
    const contactFeed = await request(app)
      .get("/api/statuses")
      .set("Authorization", `Bearer ${contactToken}`);
    expect(contactFeed.status).toBe(200);
    expect(contactFeed.body.groups.some((group: { userId: string }) => group.userId === authorId)).toBe(true);

    const outsiderFeed = await request(app)
      .get("/api/statuses")
      .set("Authorization", `Bearer ${outsiderToken}`);
    expect(outsiderFeed.status).toBe(200);
    expect(outsiderFeed.body.groups.some((group: { userId: string }) => group.userId === authorId)).toBe(false);
  });

  it("deduplicates repeated views and exposes viewers only to the owner", async () => {
    const [status] = await db.select().from(statusUpdatesTable)
      .where(eq(statusUpdatesTable.authorId, authorId))
      .limit(1);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const viewed = await request(app)
        .post(`/api/statuses/${status.id}/view`)
        .set("Authorization", `Bearer ${contactToken}`);
      expect(viewed.status).toBe(200);
    }
    const rows = await db.select().from(statusViewersTable).where(and(
      eq(statusViewersTable.statusId, status.id),
      eq(statusViewersTable.viewerUserId, contactId),
    ));
    expect(rows).toHaveLength(1);

    const ownerViewers = await request(app)
      .get(`/api/statuses/${status.id}/viewers`)
      .set("Authorization", `Bearer ${authorToken}`);
    expect(ownerViewers.status).toBe(200);
    expect(ownerViewers.body.viewers).toHaveLength(1);
    expect(ownerViewers.body.viewers[0].userId).toBe(contactId);

    const contactItem = await request(app)
      .get(`/api/statuses/${status.id}`)
      .set("Authorization", `Bearer ${contactToken}`);
    expect(contactItem.status).toBe(200);
    expect(contactItem.body.status.viewerCount).toBe(0);
    const ownerItem = await request(app)
      .get(`/api/statuses/${status.id}`)
      .set("Authorization", `Bearer ${authorToken}`);
    expect(ownerItem.body.status.viewerCount).toBe(1);

    const denied = await request(app)
      .get(`/api/statuses/${status.id}/viewers`)
      .set("Authorization", `Bearer ${contactToken}`);
    expect(denied.status).toBe(404);
  });

  it("removes blocked contacts from feeds and item access in both directions", async () => {
    const [status] = await db.select().from(statusUpdatesTable)
      .where(eq(statusUpdatesTable.authorId, authorId))
      .limit(1);
    await db.insert(chatBlocksTable).values({
      blockerUserId: contactId,
      blockedUserId: authorId,
    });
    const feed = await request(app)
      .get("/api/statuses")
      .set("Authorization", `Bearer ${contactToken}`);
    expect(feed.body.groups.some((group: { userId: string }) => group.userId === authorId)).toBe(false);
    const item = await request(app)
      .get(`/api/statuses/${status.id}`)
      .set("Authorization", `Bearer ${contactToken}`);
    expect(item.status).toBe(404);
    await db.delete(chatBlocksTable).where(and(
      eq(chatBlocksTable.blockerUserId, contactId),
      eq(chatBlocksTable.blockedUserId, authorId),
    ));
  });

  it("never returns an expired status and hard-cleans it from persistence", async () => {
    const [expired] = await db.insert(statusUpdatesTable).values({
      authorId,
      kind: "text",
      body: "Expired",
      audience: "contacts",
      expiresAt: new Date(Date.now() - 1_000),
    }).returning();
    const response = await request(app)
      .get(`/api/statuses/${expired.id}`)
      .set("Authorization", `Bearer ${contactToken}`);
    expect(response.status).toBe(404);
    await request(app).get("/api/statuses").set("Authorization", `Bearer ${authorToken}`);
    const [remaining] = await db.select({ id: statusUpdatesTable.id })
      .from(statusUpdatesTable)
      .where(eq(statusUpdatesTable.id, expired.id));
    expect(remaining).toBeUndefined();
  });

  it("keeps shared media when only one of its Status rows has expired", async () => {
    const objectPath = `/objects/uploads/status/${authorId}/shared`;
    const fileLookup = vi.spyOn(ObjectStorageService.prototype, "getObjectEntityFile");
    const [active, expired] = await db.insert(statusUpdatesTable).values([
      {
        authorId,
        kind: "image",
        objectPath,
        mimeType: "image/jpeg",
        sizeBytes: 1,
        audience: "contacts",
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        authorId,
        kind: "image",
        objectPath,
        mimeType: "image/jpeg",
        sizeBytes: 1,
        audience: "contacts",
        expiresAt: new Date(Date.now() - 1_000),
      },
    ]).returning();
    try {
      const feed = await request(app)
        .get("/api/statuses")
        .set("Authorization", `Bearer ${authorToken}`);
      expect(feed.status).toBe(200);
      const remaining = await db.select({ id: statusUpdatesTable.id })
        .from(statusUpdatesTable)
        .where(inArray(statusUpdatesTable.id, [active.id, expired.id]));
      expect(remaining.map((row) => row.id)).toEqual([active.id]);
      expect(fileLookup).not.toHaveBeenCalled();
    } finally {
      fileLookup.mockRestore();
      await db.delete(statusUpdatesTable).where(eq(statusUpdatesTable.id, active.id));
    }
  });

  it("lets only the owner delete a status", async () => {
    const [status] = await db.insert(statusUpdatesTable).values({
      authorId,
      kind: "text",
      body: "Delete me",
      audience: "contacts",
      expiresAt: new Date(Date.now() + 60_000),
    }).returning();
    const denied = await request(app)
      .delete(`/api/statuses/${status.id}`)
      .set("Authorization", `Bearer ${contactToken}`);
    expect(denied.status).toBe(404);
    const deleted = await request(app)
      .delete(`/api/statuses/${status.id}`)
      .set("Authorization", `Bearer ${authorToken}`);
    expect(deleted.status).toBe(204);
  });
});