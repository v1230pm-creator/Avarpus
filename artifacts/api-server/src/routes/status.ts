import { Router, type IRouter, type Request } from "express";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  statusUpdatesTable,
  statusViewersTable,
  usersTable,
  type DbUser,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { isPersonalContact, statusVisibilityCondition } from "../lib/statusAccess";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const STATUS_TTL_MS = 24 * 60 * 60 * 1000;
const STATUS_MAX_TEXT = 7_000;
const STATUS_IMAGE_MAX = 15 * 1024 * 1024;
const STATUS_VIDEO_MAX = 64 * 1024 * 1024;
const STATUS_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const STATUS_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type AuthedRequest = Request & { user: DbUser };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Invalid status";
}

function statusKindValid(kind: unknown): kind is "text" | "image" | "video" {
  return kind === "text" || kind === "image" || kind === "video";
}

function mediaTypeValid(kind: "image" | "video", contentType: string): boolean {
  return kind === "image"
    ? STATUS_IMAGE_TYPES.has(contentType)
    : STATUS_VIDEO_TYPES.has(contentType);
}

function mediaMaxSize(kind: "image" | "video"): number {
  return kind === "image" ? STATUS_IMAGE_MAX : STATUS_VIDEO_MAX;
}

function mediaUrl(objectPath: string | null): string | null {
  return objectPath ? `/api/storage${objectPath}` : null;
}

function formatStatus(
  status: typeof statusUpdatesTable.$inferSelect,
  author: { id: string; name: string; profilePhoto: string | null },
  viewed: boolean,
  viewerCount: number,
) {
  return {
    id: status.id,
    authorId: author.id,
    authorName: author.name,
    authorPhoto: author.profilePhoto,
    kind: status.kind,
    body: status.body,
    objectPath: status.objectPath,
    mediaUrl: mediaUrl(status.objectPath),
    mimeType: status.mimeType,
    sizeBytes: status.sizeBytes,
    createdAt: status.createdAt,
    expiresAt: status.expiresAt,
    viewed,
    viewerCount,
  };
}

async function cleanupInactiveStatuses(onlyIds?: string[]): Promise<void> {
  const inactive = or(
    lte(statusUpdatesTable.expiresAt, new Date()),
    isNotNull(statusUpdatesTable.deletedAt),
  );
  const rows = await db
    .select({
      id: statusUpdatesTable.id,
      objectPath: statusUpdatesTable.objectPath,
    })
    .from(statusUpdatesTable)
    .where(onlyIds?.length
      ? and(inactive, inArray(statusUpdatesTable.id, onlyIds))
      : inactive);
  const cleanedIds: string[] = [];
  for (const row of rows) {
    if (!row.objectPath) {
      cleanedIds.push(row.id);
      continue;
    }
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(row.objectPath);
      await objectFile.delete({ ignoreNotFound: true });
      cleanedIds.push(row.id);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        cleanedIds.push(row.id);
      } else {
        // Keep the tombstone/expired row so the next feed read retries storage
        // cleanup without ever making the status visible again.
        console.warn("Status media cleanup will be retried", {
          statusId: row.id,
          error: errorMessage(error),
        });
      }
    }
  }
  if (cleanedIds.length) {
    await db.delete(statusUpdatesTable).where(inArray(statusUpdatesTable.id, cleanedIds));
  }
}

async function statusById(id: string) {
  const [row] = await db
    .select({ status: statusUpdatesTable, author: {
      id: usersTable.id,
      name: usersTable.name,
      profilePhoto: usersTable.profilePhoto,
    } })
    .from(statusUpdatesTable)
    .innerJoin(usersTable, eq(usersTable.id, statusUpdatesTable.authorId))
    .where(and(
      eq(statusUpdatesTable.id, id),
      isNull(statusUpdatesTable.deletedAt),
      gt(statusUpdatesTable.expiresAt, new Date()),
      eq(usersTable.isActive, true),
    ))
    .limit(1);
  return row ?? null;
}

async function viewerInfo(statusId: string, viewerId: string, includeCount = false) {
  const [view] = await db
    .select({ viewedAt: statusViewersTable.viewedAt })
    .from(statusViewersTable)
    .where(and(
      eq(statusViewersTable.statusId, statusId),
      eq(statusViewersTable.viewerUserId, viewerId),
    ))
    .limit(1);
  if (!includeCount) return { viewed: !!view, viewerCount: 0 };
  const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(statusViewersTable)
      .where(eq(statusViewersTable.statusId, statusId));
  return { viewed: !!view, viewerCount: Number(count ?? 0) };
}

router.post(
  "/statuses/upload-url",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const { name, size, contentType } = req.body ?? {};
    const normalizedType = typeof contentType === "string"
      ? contentType.trim().toLowerCase()
      : "";
    if (
      typeof name !== "string" || !name.trim() ||
      typeof size !== "number" || !Number.isFinite(size) || size <= 0 ||
      (!STATUS_IMAGE_TYPES.has(normalizedType) && !STATUS_VIDEO_TYPES.has(normalizedType))
    ) {
      res.status(400).json({
        message: "Status media must be a JPEG, PNG, WebP, GIF, MP4, or QuickTime video.",
      });
      return;
    }
    const kind = STATUS_IMAGE_TYPES.has(normalizedType) ? "image" : "video";
    if (size > mediaMaxSize(kind)) {
      res.status(400).json({
        message: `Status ${kind} exceeds the ${kind === "image" ? "15 MB" : "64 MB"} limit.`,
      });
      return;
    }
    const { uploadURL, objectPath } =
      await objectStorageService.getObjectEntityUploadURLWithPrefix(`status/${me.id}`);
    res.json({ uploadURL, objectPath, maxSize: mediaMaxSize(kind), kind });
  }),
);

router.get(
  "/statuses",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    await cleanupInactiveStatuses();
    const rows = await db
      .select({
        status: statusUpdatesTable,
        author: {
          id: usersTable.id,
          name: usersTable.name,
          profilePhoto: usersTable.profilePhoto,
        },
      })
      .from(statusUpdatesTable)
      .innerJoin(usersTable, eq(usersTable.id, statusUpdatesTable.authorId))
      .where(and(
        isNull(statusUpdatesTable.deletedAt),
        gt(statusUpdatesTable.expiresAt, new Date()),
        eq(usersTable.isActive, true),
        statusVisibilityCondition(
          statusUpdatesTable.authorId,
          statusUpdatesTable.audience,
          me.id,
        ),
      ))
      .orderBy(desc(statusUpdatesTable.createdAt));

    const ids = rows.map((row) => row.status.id);
    const viewerRows = ids.length === 0
      ? []
      : await db
        .select({
          statusId: statusViewersTable.statusId,
          viewerUserId: statusViewersTable.viewerUserId,
        })
        .from(statusViewersTable)
        .where(inArray(statusViewersTable.statusId, ids));
    const viewedIds = new Set(
      viewerRows
        .filter((row) => row.viewerUserId === me.id)
        .map((row) => row.statusId),
    );
    const viewerCounts = new Map<string, number>();
    for (const row of viewerRows) {
      viewerCounts.set(row.statusId, (viewerCounts.get(row.statusId) ?? 0) + 1);
    }

    const byAuthor = new Map<string, {
      userId: string;
      name: string;
      profilePhoto: string | null;
      items: ReturnType<typeof formatStatus>[];
    }>();
    for (const row of rows) {
      const item = formatStatus(
        row.status,
        row.author,
        viewedIds.has(row.status.id),
      row.author.id === me.id ? viewerCounts.get(row.status.id) ?? 0 : 0,
      );
      const group = byAuthor.get(row.author.id) ?? {
        userId: row.author.id,
        name: row.author.name,
        profilePhoto: row.author.profilePhoto,
        items: [],
      };
      group.items.push(item);
      byAuthor.set(row.author.id, group);
    }

    const groups = Array.from(byAuthor.values()).map((group) => ({
      ...group,
      hasUnviewed: group.items.some((item) => !item.viewed),
      latestAt: group.items[0]?.createdAt ?? new Date(),
    }));
    groups.sort((a, b) => {
      if (a.userId === me.id) return -1;
      if (b.userId === me.id) return 1;
      return new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime();
    });
    res.json({ groups });
  }),
);

router.post(
  "/statuses",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const { kind, body, objectPath, mimeType, sizeBytes, audience } = req.body ?? {};
    if (!statusKindValid(kind)) {
      res.status(400).json({ message: "Status kind must be text, image, or video." });
      return;
    }
    const visibility = audience === undefined ? "contacts" : audience;
    if (visibility !== "contacts" && visibility !== "nobody") {
      res.status(400).json({ message: "Unsupported status audience." });
      return;
    }
    let normalizedBody: string | null = null;
    if (kind === "text") {
      if (typeof body !== "string" || !body.trim()) {
        res.status(400).json({ message: "Text status cannot be empty." });
        return;
      }
      normalizedBody = body.trim().slice(0, STATUS_MAX_TEXT);
    } else {
      if (
        typeof objectPath !== "string" ||
        !objectPath.startsWith(`/objects/uploads/status/${me.id}/`) ||
        typeof mimeType !== "string" ||
        typeof sizeBytes !== "number" ||
        !Number.isInteger(sizeBytes) ||
        sizeBytes <= 0 ||
        !mediaTypeValid(kind, mimeType.trim().toLowerCase()) ||
        sizeBytes > mediaMaxSize(kind)
      ) {
        res.status(400).json({ message: "Status media metadata is invalid." });
        return;
      }
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
        const [metadata] = await objectFile.getMetadata();
        const storedType = String(metadata.contentType ?? "").toLowerCase();
        const storedSize = Number(metadata.size ?? 0);
        if (
          storedType !== mimeType.trim().toLowerCase() ||
          storedSize <= 0 ||
          storedSize !== sizeBytes ||
          storedSize > mediaMaxSize(kind)
        ) {
          res.status(400).json({ message: "Uploaded status media failed validation." });
          return;
        }
      } catch {
        res.status(400).json({ message: "Uploaded status media was not found." });
        return;
      }
    }

    const now = new Date();
    const [created] = await db.insert(statusUpdatesTable).values({
      authorId: me.id,
      kind,
      body: normalizedBody,
      objectPath: kind === "text" ? null : objectPath.trim(),
      mimeType: kind === "text" ? null : mimeType.trim().toLowerCase(),
      sizeBytes: kind === "text" ? null : sizeBytes,
      audience: visibility,
      createdAt: now,
      expiresAt: new Date(now.getTime() + STATUS_TTL_MS),
    }).returning();
    const info = await viewerInfo(created.id, me.id, true);
    res.status(201).json({
      status: formatStatus(created, {
        id: me.id,
        name: me.name,
        profilePhoto: me.profilePhoto,
      }, info.viewed, info.viewerCount),
    });
  }),
);

router.get(
  "/statuses/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const id = String(req.params.id ?? "");
    if (!UUID_RE.test(id)) {
      res.status(404).json({ message: "Status not found" });
      return;
    }
    const row = await statusById(id);
    const visible = !!row && (
      row.author.id === me.id ||
      (row.status.audience === "contacts" && await isPersonalContact(me.id, row.author.id))
    );
    if (!row || !visible) {
      res.status(404).json({ message: "Status not found" });
      return;
    }
    const info = await viewerInfo(id, me.id, row.author.id === me.id);
    res.json({ status: formatStatus(row.status, row.author, info.viewed, info.viewerCount) });
  }),
);

router.post(
  "/statuses/:id/view",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const id = String(req.params.id ?? "");
    if (!UUID_RE.test(id)) {
      res.status(404).json({ message: "Status not found" });
      return;
    }
    const row = await statusById(id);
    const visible = !!row && (
      row.author.id === me.id ||
      (row.status.audience === "contacts" && await isPersonalContact(me.id, row.author.id))
    );
    if (!row || !visible) {
      res.status(404).json({ message: "Status not found" });
      return;
    }
    const viewedAt = new Date();
    if (row.author.id !== me.id) {
      await db.insert(statusViewersTable).values({
        statusId: id,
        viewerUserId: me.id,
        viewedAt,
      }).onConflictDoUpdate({
        target: [statusViewersTable.statusId, statusViewersTable.viewerUserId],
        set: { viewedAt },
      });
    }
    res.json({ viewedAt });
  }),
);

router.get(
  "/statuses/:id/viewers",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const id = String(req.params.id ?? "");
    if (!UUID_RE.test(id)) {
      res.status(404).json({ message: "Status not found" });
      return;
    }
    const row = await statusById(id);
    if (!row || row.author.id !== me.id) {
      res.status(404).json({ message: "Status not found" });
      return;
    }
    const viewers = await db
      .select({
        userId: statusViewersTable.viewerUserId,
        name: usersTable.name,
        profilePhoto: usersTable.profilePhoto,
        viewedAt: statusViewersTable.viewedAt,
      })
      .from(statusViewersTable)
      .innerJoin(usersTable, eq(usersTable.id, statusViewersTable.viewerUserId))
      .where(eq(statusViewersTable.statusId, id))
      .orderBy(desc(statusViewersTable.viewedAt));
    res.json({ viewers });
  }),
);

router.delete(
  "/statuses/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const id = String(req.params.id ?? "");
    if (!UUID_RE.test(id)) {
      res.status(404).json({ message: "Status not found" });
      return;
    }
    const [deleted] = await db.update(statusUpdatesTable)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(statusUpdatesTable.id, id),
        eq(statusUpdatesTable.authorId, me.id),
        isNull(statusUpdatesTable.deletedAt),
      ))
      .returning({ id: statusUpdatesTable.id });
    if (!deleted) {
      res.status(404).json({ message: "Status not found" });
      return;
    }
    await cleanupInactiveStatuses([id]);
    res.status(204).send();
  }),
);

export default router;