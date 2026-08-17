import { createHash } from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db, appUpdatesTable, usersTable, type DbUser } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole } from "../middlewares/requireRole";
import { asyncHandler } from "../lib/asyncHandler";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";

// ── OTA app update system ───────────────────────────────────────────────────
// Strictly additive and isolated from business data: this module only reads
// and writes the app_updates table and APK objects under
// uploads/app-updates/. It never modifies or deletes any user/business data,
// and the client never auto-installs — the user always initiates download and
// install manually.

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

const APK_PREFIX = "/objects/uploads/app-updates/";
const UPDATE_TYPES = new Set(["optional", "recommended", "critical"]);
const ADMIN = requireRole(["super_admin"]);

function userOf(req: Request): DbUser {
  return (req as Request & { user: DbUser }).user;
}

function publicUpdate(u: typeof appUpdatesTable.$inferSelect) {
  return {
    id: u.id,
    version: u.version,
    buildNumber: u.buildNumber,
    releaseDate: u.releaseDate,
    apkSize: u.apkSize,
    checksum: u.checksum,
    updateType: u.updateType,
    minAndroidVersion: u.minAndroidVersion,
    releaseNotes: u.releaseNotes ?? null,
    screenshots: u.screenshots ?? null,
    demoVideoUrl: u.demoVideoUrl,
    publishedAt: u.publishedAt ? u.publishedAt.toISOString() : null,
    apkUrl: u.apkPath ? `/app-updates/${u.id}/apk` : null,
  };
}

// Compute size + SHA-256 by streaming the uploaded APK from object storage.
async function computeApkMeta(
  apkPath: string,
): Promise<{ size: number; checksum: string }> {
  const file = await objectStorage.getObjectEntityFile(apkPath);
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size ?? 0);
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    file
      .createReadStream()
      .on("data", (chunk: Buffer) => hash.update(chunk))
      .on("end", () => resolve())
      .on("error", reject);
  });
  return { size, checksum: hash.digest("hex") };
}

// ── User-facing ─────────────────────────────────────────────────────────────

// Latest published release (by build number). Any authenticated shop user.
router.get(
  "/app-updates/latest",
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const [latest] = await db
      .select()
      .from(appUpdatesTable)
      .where(eq(appUpdatesTable.status, "published"))
      .orderBy(desc(appUpdatesTable.buildNumber))
      .limit(1);
    if (!latest) {
      res.json({ update: null });
      return;
    }
    res.json({ update: publicUpdate(latest) });
  }),
);

// Published changelog history (newest first) for "View Full Changelog".
router.get(
  "/app-updates/changelog",
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const rows = await db
      .select()
      .from(appUpdatesTable)
      .where(eq(appUpdatesTable.status, "published"))
      .orderBy(desc(appUpdatesTable.buildNumber))
      .limit(50);
    res.json({ updates: rows.map(publicUpdate) });
  }),
);

// APK download with HTTP Range support (pause/resume). Only published
// releases are downloadable. Counts a download when the transfer starts at 0.
router.get(
  "/app-updates/:id/apk",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const [row] = await db
      .select()
      .from(appUpdatesTable)
      .where(eq(appUpdatesTable.id, String(req.params.id)))
      .limit(1);
    if (!row || row.status !== "published" || !row.apkPath) {
      res.status(404).json({ error: "Update not found" });
      return;
    }
    let file;
    try {
      file = await objectStorage.getObjectEntityFile(row.apkPath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "APK file not found" });
        return;
      }
      throw error;
    }
    const [metadata] = await file.getMetadata();
    const total = Number(metadata.size ?? 0);

    let start = 0;
    let end = total - 1;
    let isPartial = false;
    const range = req.headers.range;
    if (typeof range === "string") {
      const m = /^bytes=(\d+)-(\d*)$/.exec(range.trim());
      if (!m) {
        res.status(416).setHeader("Content-Range", `bytes */${total}`).end();
        return;
      }
      start = Number.parseInt(m[1], 10);
      if (m[2]) end = Math.min(Number.parseInt(m[2], 10), total - 1);
      if (start >= total || start > end) {
        res.status(416).setHeader("Content-Range", `bytes */${total}`).end();
        return;
      }
      isPartial = true;
    }

    if (start === 0) {
      // Fire-and-forget counter; never block or fail the download for it.
      db.update(appUpdatesTable)
        .set({ downloadCount: sql`${appUpdatesTable.downloadCount} + 1` })
        .where(eq(appUpdatesTable.id, row.id))
        .catch(() => {});
    }

    res.status(isPartial ? 206 : 200);
    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", String(end - start + 1));
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="vmc-erp-${row.version}.apk"`,
    );
    if (isPartial) {
      res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    }
    const stream = file.createReadStream({ start, end });
    stream.on("error", () => {
      if (!res.headersSent) res.status(500);
      res.end();
    });
    stream.pipe(res);
  }),
);

// ── Admin (super_admin only) ────────────────────────────────────────────────

// Presigned upload URL for a new APK (namespaced under uploads/app-updates/,
// which the shop-scoped object route can never serve).
router.post(
  "/app-updates/upload-url",
  requireAuth,
  ADMIN,
  asyncHandler(async (_req: Request, res: Response) => {
    const uploadURL = await objectStorage.getObjectEntityUploadURL("app-updates");
    const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath });
  }),
);

// Full release list for the admin Update Manager / history.
router.get(
  "/app-updates",
  requireAuth,
  ADMIN,
  asyncHandler(async (_req: Request, res: Response) => {
    const rows = await db
      .select({
        update: appUpdatesTable,
        publishedByName: usersTable.name,
      })
      .from(appUpdatesTable)
      .leftJoin(usersTable, eq(appUpdatesTable.publishedBy, usersTable.id))
      .orderBy(desc(appUpdatesTable.buildNumber), desc(appUpdatesTable.createdAt));
    res.json({
      updates: rows.map((r) => ({
        ...publicUpdate(r.update),
        status: r.update.status,
        downloadCount: r.update.downloadCount,
        publishedByName: r.publishedByName ?? null,
        createdAt: r.update.createdAt.toISOString(),
        apkPath: r.update.apkPath,
      })),
    });
  }),
);

type UpdateBody = {
  version?: unknown;
  buildNumber?: unknown;
  releaseDate?: unknown;
  apkPath?: unknown;
  updateType?: unknown;
  minAndroidVersion?: unknown;
  releaseNotes?: unknown;
  screenshots?: unknown;
  demoVideoUrl?: unknown;
};

function validateBody(body: UpdateBody, partial: boolean): string | null {
  if (!partial || body.version !== undefined) {
    if (typeof body.version !== "string" || !/^\d+\.\d+\.\d+$/.test(body.version)) {
      return "version must be in X.Y.Z format";
    }
  }
  if (!partial || body.buildNumber !== undefined) {
    if (
      typeof body.buildNumber !== "number" ||
      !Number.isInteger(body.buildNumber) ||
      body.buildNumber <= 0
    ) {
      return "buildNumber must be a positive integer";
    }
  }
  if (body.releaseDate !== undefined && body.releaseDate !== null) {
    if (
      typeof body.releaseDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.releaseDate)
    ) {
      return "releaseDate must be YYYY-MM-DD";
    }
  }
  if (body.updateType !== undefined) {
    if (typeof body.updateType !== "string" || !UPDATE_TYPES.has(body.updateType)) {
      return "updateType must be optional, recommended or critical";
    }
  }
  if (body.apkPath !== undefined && body.apkPath !== null) {
    // Exact canonical form: prefix + single UUID segment, nothing else.
    if (
      typeof body.apkPath !== "string" ||
      !new RegExp(
        `^${APK_PREFIX}[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`,
      ).test(body.apkPath)
    ) {
      return "apkPath must be an uploaded app-updates object";
    }
  }
  if (body.releaseNotes !== undefined && body.releaseNotes !== null) {
    if (!Array.isArray(body.releaseNotes)) return "releaseNotes must be an array";
  }
  if (body.screenshots !== undefined && body.screenshots !== null) {
    if (
      !Array.isArray(body.screenshots) ||
      body.screenshots.some((s) => typeof s !== "string")
    ) {
      return "screenshots must be an array of strings";
    }
  }
  if (body.demoVideoUrl !== undefined && body.demoVideoUrl !== null) {
    if (typeof body.demoVideoUrl !== "string") return "demoVideoUrl must be a string";
  }
  if (body.minAndroidVersion !== undefined && body.minAndroidVersion !== null) {
    if (typeof body.minAndroidVersion !== "string") {
      return "minAndroidVersion must be a string";
    }
  }
  return null;
}

// Create a draft release. If an APK is attached, size + SHA-256 are computed
// server-side from the uploaded object (never trusted from the client).
router.post(
  "/app-updates",
  requireAuth,
  ADMIN,
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as UpdateBody;
    const err = validateBody(body, false);
    if (err) {
      res.status(400).json({ error: err });
      return;
    }
    let apkMeta: { size: number; checksum: string } | null = null;
    if (typeof body.apkPath === "string") {
      try {
        apkMeta = await computeApkMeta(body.apkPath);
      } catch {
        res.status(400).json({ error: "Uploaded APK not found in storage" });
        return;
      }
    }
    const [created] = await db
      .insert(appUpdatesTable)
      .values({
        version: body.version as string,
        buildNumber: body.buildNumber as number,
        releaseDate: (body.releaseDate as string | undefined) ?? null,
        apkPath: (body.apkPath as string | undefined) ?? null,
        apkSize: apkMeta?.size ?? null,
        checksum: apkMeta?.checksum ?? null,
        updateType: (body.updateType as string | undefined) ?? "optional",
        minAndroidVersion: (body.minAndroidVersion as string | undefined) ?? null,
        releaseNotes: body.releaseNotes ?? null,
        screenshots: body.screenshots ?? null,
        demoVideoUrl: (body.demoVideoUrl as string | undefined) ?? null,
        status: "draft",
        createdBy: userOf(req).id,
      })
      .returning();
    res.status(201).json({ update: { ...publicUpdate(created), status: created.status } });
  }),
);

// Edit a release. APK replacement is only allowed while not published.
router.patch(
  "/app-updates/:id",
  requireAuth,
  ADMIN,
  asyncHandler(async (req: Request, res: Response) => {
    const [row] = await db
      .select()
      .from(appUpdatesTable)
      .where(eq(appUpdatesTable.id, String(req.params.id)))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Update not found" });
      return;
    }
    const body = (req.body ?? {}) as UpdateBody;
    const err = validateBody(body, true);
    if (err) {
      res.status(400).json({ error: err });
      return;
    }
    // Release identity (version/build) and the APK itself are immutable while
    // published — unpublish first. Enforced again atomically in the UPDATE's
    // WHERE clause below so a concurrent publish cannot slip changes through.
    const touchesImmutable =
      body.apkPath !== undefined ||
      body.version !== undefined ||
      body.buildNumber !== undefined;
    if (touchesImmutable && row.status === "published") {
      res.status(409).json({ error: "Unpublish the release before changing its APK, version or build number" });
      return;
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.version !== undefined) patch.version = body.version;
    if (body.buildNumber !== undefined) patch.buildNumber = body.buildNumber;
    if (body.releaseDate !== undefined) patch.releaseDate = body.releaseDate;
    if (body.updateType !== undefined) patch.updateType = body.updateType;
    if (body.minAndroidVersion !== undefined) patch.minAndroidVersion = body.minAndroidVersion;
    if (body.releaseNotes !== undefined) patch.releaseNotes = body.releaseNotes;
    if (body.screenshots !== undefined) patch.screenshots = body.screenshots;
    if (body.demoVideoUrl !== undefined) patch.demoVideoUrl = body.demoVideoUrl;
    if (body.apkPath !== undefined) {
      if (body.apkPath === null) {
        patch.apkPath = null;
        patch.apkSize = null;
        patch.checksum = null;
      } else {
        try {
          const meta = await computeApkMeta(body.apkPath as string);
          patch.apkPath = body.apkPath;
          patch.apkSize = meta.size;
          patch.checksum = meta.checksum;
        } catch {
          res.status(400).json({ error: "Uploaded APK not found in storage" });
          return;
        }
      }
    }
    const [updated] = await db
      .update(appUpdatesTable)
      .set(patch)
      .where(
        touchesImmutable
          ? and(eq(appUpdatesTable.id, row.id), ne(appUpdatesTable.status, "published"))
          : eq(appUpdatesTable.id, row.id),
      )
      .returning();
    if (!updated) {
      // Lost the race with a concurrent publish — nothing was changed.
      res.status(409).json({ error: "Release was published concurrently; unpublish it first" });
      return;
    }
    res.json({ update: { ...publicUpdate(updated), status: updated.status } });
  }),
);

// Publish: requires a complete release (APK + checksum). Idempotent-safe.
router.post(
  "/app-updates/:id/publish",
  requireAuth,
  ADMIN,
  asyncHandler(async (req: Request, res: Response) => {
    const [row] = await db
      .select()
      .from(appUpdatesTable)
      .where(eq(appUpdatesTable.id, String(req.params.id)))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Update not found" });
      return;
    }
    if (!row.apkPath || !row.checksum || !row.apkSize) {
      res.status(400).json({ error: "Upload an APK before publishing" });
      return;
    }
    // Atomic guard: only publish a row that still has a complete APK at write
    // time (a concurrent PATCH cannot have cleared it).
    const [updated] = await db
      .update(appUpdatesTable)
      .set({
        status: "published",
        publishedBy: userOf(req).id,
        publishedAt: row.publishedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(appUpdatesTable.id, row.id),
        isNotNull(appUpdatesTable.apkPath),
        isNotNull(appUpdatesTable.checksum),
      ))
      .returning();
    if (!updated) {
      res.status(409).json({ error: "Release changed concurrently; upload an APK and try again" });
      return;
    }
    res.json({ update: { ...publicUpdate(updated), status: updated.status } });
  }),
);

router.post(
  "/app-updates/:id/unpublish",
  requireAuth,
  ADMIN,
  asyncHandler(async (req: Request, res: Response) => {
    const [row] = await db
      .select()
      .from(appUpdatesTable)
      .where(eq(appUpdatesTable.id, String(req.params.id)))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Update not found" });
      return;
    }
    const [updated] = await db
      .update(appUpdatesTable)
      .set({ status: "unpublished", updatedAt: new Date() })
      .where(eq(appUpdatesTable.id, row.id))
      .returning();
    res.json({ update: { ...publicUpdate(updated), status: updated.status } });
  }),
);

export default router;
