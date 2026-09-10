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
import {
  requiresFreshApkForIdentityChange,
  reusedApkError,
} from "../lib/appUpdatePolicy";

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
const ADMIN = requireRole("super_admin");

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
// Also validates that the object is a real APK (ZIP container): the first two
// bytes must be the "PK" magic and the file must be plausibly sized, so a
// renamed text/image file can never be published as an update.
class NotAnApkError extends Error {}
const MIN_APK_SIZE = 1024 * 1024; // 1 MB — real app APKs are far larger

async function computeApkMeta(
  apkPath: string,
): Promise<{ size: number; checksum: string }> {
  const file = await objectStorage.getObjectEntityFile(apkPath);
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size ?? 0);
  if (size < MIN_APK_SIZE) {
    throw new NotAnApkError("File is too small to be a valid APK");
  }
  const hash = createHash("sha256");
  let firstBytes: Buffer | null = null;
  await new Promise<void>((resolve, reject) => {
    file
      .createReadStream()
      .on("data", (chunk: Buffer) => {
        if (!firstBytes) firstBytes = chunk;
        hash.update(chunk);
      })
      .on("end", () => resolve())
      .on("error", reject);
  });
  const head = firstBytes as Buffer | null;
  if (!head || head.length < 2 || head[0] !== 0x50 || head[1] !== 0x4b) {
    throw new NotAnApkError("File is not a valid APK (bad file signature)");
  }
  return { size, checksum: hash.digest("hex") };
}

async function streamPublishedApk(
  req: Request,
  res: Response,
  row: typeof appUpdatesTable.$inferSelect,
): Promise<void> {
  if (!row.apkPath) {
    res.status(404).json({ error: "APK file not found" });
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
    const match = /^bytes=(\d+)-(\d*)$/.exec(range.trim());
    if (!match) {
      res.status(416).setHeader("Content-Range", `bytes */${total}`).end();
      return;
    }
    start = Number.parseInt(match[1], 10);
    if (match[2]) end = Math.min(Number.parseInt(match[2], 10), total - 1);
    if (start >= total || start > end) {
      res.status(416).setHeader("Content-Range", `bytes */${total}`).end();
      return;
    }
    isPartial = true;
  }

  if (start === 0) {
    db.update(appUpdatesTable)
      .set({ downloadCount: sql`${appUpdatesTable.downloadCount} + 1` })
      .where(eq(appUpdatesTable.id, row.id))
      .catch(() => {});
  }

  res.status(isPartial ? 206 : 200);
  res.setHeader("Content-Type", "application/vnd.android.package-archive");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="avarpus-${row.version}.apk"`,
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
}

// ── User-facing ─────────────────────────────────────────────────────────────

// Public website download. Only the latest explicitly published APK is exposed;
// draft and archived release objects remain inaccessible.
router.get(
  "/app-updates/public/latest/apk",
  asyncHandler(async (req: Request, res: Response) => {
    const [latest] = await db
      .select()
      .from(appUpdatesTable)
      .where(
        and(
          eq(appUpdatesTable.status, "published"),
          isNotNull(appUpdatesTable.apkPath),
        ),
      )
      .orderBy(desc(appUpdatesTable.buildNumber))
      .limit(1);

    if (!latest) {
      res.status(404).json({ error: "No public Android release is available" });
      return;
    }

    await streamPublishedApk(req, res, latest);
  }),
);

// Latest published release (by build number). Any authenticated shop user.
router.get(
  "/app-updates/latest",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const [latest] = await db
      .select()
      .from(appUpdatesTable)
      .where(eq(appUpdatesTable.status, "published"))
      .orderBy(desc(appUpdatesTable.buildNumber))
      .limit(1);
    const rawBuild = req.query["buildNumber"];
    const clientBuild =
      typeof rawBuild === "string" && /^\d+$/.test(rawBuild)
        ? Number.parseInt(rawBuild, 10)
        : null;
    if (!latest) {
      res.json({ update: null, updateAvailable: false });
      return;
    }
    if (clientBuild !== null) {
      // Fire-and-forget update-check counter; never block the response.
      db.update(appUpdatesTable)
        .set({ checkCount: sql`${appUpdatesTable.checkCount} + 1` })
        .where(eq(appUpdatesTable.id, latest.id))
        .catch(() => {});
    }
    res.json({
      update: publicUpdate(latest),
      updateAvailable:
        clientBuild !== null ? latest.buildNumber > clientBuild : undefined,
    });
  }),
);

// Serve a screenshot/image object referenced by a release. APKs share the
// same storage namespace, so the object must appear in some release's
// screenshots array — arbitrary namespace objects (including draft APKs) are
// never streamable here. Non-super_admin callers can only fetch screenshots
// of published releases.
router.get(
  "/app-updates/assets/:objectId",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const objectId = String(req.params.objectId);
    if (!/^[0-9a-fA-F-]{36}$/.test(objectId)) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    const objectPath = `${APK_PREFIX}${objectId}`;
    const isSuperAdmin = userOf(req).role === "super_admin";
    const [referencing] = await db
      .select({ id: appUpdatesTable.id })
      .from(appUpdatesTable)
      .where(and(
        sql`${appUpdatesTable.screenshots} @> ${JSON.stringify([objectPath])}::jsonb`,
        ...(isSuperAdmin ? [] : [eq(appUpdatesTable.status, "published")]),
      ))
      .limit(1);
    if (!referencing) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    let file;
    try {
      file = await objectStorage.getObjectEntityFile(objectPath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      throw error;
    }
    const [metadata] = await file.getMetadata();
    res.setHeader(
      "Content-Type",
      typeof metadata.contentType === "string"
        ? metadata.contentType
        : "application/octet-stream",
    );
    res.setHeader("Content-Length", String(metadata.size ?? 0));
    res.setHeader("Cache-Control", "private, max-age=3600");
    const stream = file.createReadStream();
    stream.on("error", () => {
      if (!res.headersSent) res.status(500);
      res.end();
    });
    stream.pipe(res);
  }),
);

// Aggregate stats for the admin dashboard.
router.get(
  "/app-updates/stats",
  requireAuth,
  ADMIN,
  asyncHandler(async (_req: Request, res: Response) => {
    const [totals] = await db
      .select({
        totalReleases: sql<number>`count(*)::int`,
        publishedCount: sql<number>`count(*) filter (where ${appUpdatesTable.status} = 'published')::int`,
        draftCount: sql<number>`count(*) filter (where ${appUpdatesTable.status} = 'draft')::int`,
        totalDownloads: sql<number>`coalesce(sum(${appUpdatesTable.downloadCount}), 0)::int`,
        totalUpdateChecks: sql<number>`coalesce(sum(${appUpdatesTable.checkCount}), 0)::int`,
      })
      .from(appUpdatesTable);
    const [current] = await db
      .select()
      .from(appUpdatesTable)
      .where(eq(appUpdatesTable.status, "published"))
      .orderBy(desc(appUpdatesTable.buildNumber))
      .limit(1);
    res.json({
      stats: {
        totalReleases: totals?.totalReleases ?? 0,
        publishedCount: totals?.publishedCount ?? 0,
        draftCount: totals?.draftCount ?? 0,
        totalDownloads: totals?.totalDownloads ?? 0,
        totalUpdateChecks: totals?.totalUpdateChecks ?? 0,
        currentVersion: current?.version ?? null,
        currentBuildNumber: current?.buildNumber ?? null,
        currentPublishedAt: current?.publishedAt
          ? current.publishedAt.toISOString()
          : null,
        currentDownloadCount: current?.downloadCount ?? null,
      },
    });
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
    await streamPublishedApk(req, res, row);
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
        checkCount: r.update.checkCount,
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
      } catch (error) {
        res.status(400).json({
          error:
            error instanceof NotAnApkError
              ? error.message
              : "Uploaded APK not found in storage",
        });
        return;
      }
    }
    const createResult = await db.transaction(async (tx) => {
      if (apkMeta) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`app_updates_apk:${apkMeta.checksum}`}))`,
        );
        const [existingApk] = await tx
          .select({
            version: appUpdatesTable.version,
            buildNumber: appUpdatesTable.buildNumber,
          })
          .from(appUpdatesTable)
          .where(eq(appUpdatesTable.checksum, apkMeta.checksum))
          .orderBy(desc(appUpdatesTable.createdAt))
          .limit(1);
        if (existingApk) {
          return {
            ok: false as const,
            status: 409,
            message: reusedApkError(existingApk),
          };
        }
      }
      const [created] = await tx
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
      return { ok: true as const, created };
    });
    if (!createResult.ok) {
      res.status(createResult.status).json({ error: createResult.message });
      return;
    }
    res.status(201).json({
      update: {
        ...publicUpdate(createResult.created),
        status: createResult.created.status,
      },
    });
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
    const touchesImmutable =
      body.apkPath !== undefined ||
      body.version !== undefined ||
      body.buildNumber !== undefined;
    let replacementMeta: { size: number; checksum: string } | null = null;
    if (
      typeof body.apkPath === "string" &&
      body.apkPath !== row.apkPath
    ) {
      try {
        replacementMeta = await computeApkMeta(body.apkPath);
      } catch (error) {
        res.status(400).json({
          error:
            error instanceof NotAnApkError
              ? error.message
              : "Uploaded APK not found in storage",
        });
        return;
      }
    }
    const updateResult = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(appUpdatesTable)
        .where(eq(appUpdatesTable.id, row.id))
        .for("update")
        .limit(1);
      if (!current) {
        return {
          ok: false as const,
          status: 404,
          message: "Update not found",
        };
      }
      if (requiresFreshApkForIdentityChange(current, body)) {
        return {
          ok: false as const,
          status: 409,
          message:
            "Upload a fresh APK before changing the version or build number. Editing release labels cannot change the installed app.",
        };
      }
      if (touchesImmutable && current.status === "published") {
        return {
          ok: false as const,
          status: 409,
          message:
            "Unpublish the release before changing its APK, version or build number",
        };
      }
      if (
        typeof body.apkPath === "string" &&
        body.apkPath !== current.apkPath &&
        !replacementMeta
      ) {
        return {
          ok: false as const,
          status: 409,
          message: "Release changed concurrently; reload it and try again",
        };
      }
      if (replacementMeta) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`app_updates_apk:${replacementMeta.checksum}`}))`,
        );
        const [existingApk] = await tx
          .select({
            version: appUpdatesTable.version,
            buildNumber: appUpdatesTable.buildNumber,
          })
          .from(appUpdatesTable)
          .where(
            and(
              eq(appUpdatesTable.checksum, replacementMeta.checksum),
              ne(appUpdatesTable.id, current.id),
            ),
          )
          .orderBy(desc(appUpdatesTable.createdAt))
          .limit(1);
        if (existingApk) {
          return {
            ok: false as const,
            status: 409,
            message: reusedApkError(existingApk),
          };
        }
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
      if (body.apkPath === null) {
        patch.apkPath = null;
        patch.apkSize = null;
        patch.checksum = null;
      } else if (replacementMeta) {
        patch.apkPath = body.apkPath;
        patch.apkSize = replacementMeta.size;
        patch.checksum = replacementMeta.checksum;
      }
      const [updated] = await tx
        .update(appUpdatesTable)
        .set(patch)
        .where(eq(appUpdatesTable.id, current.id))
        .returning();
      return { ok: true as const, updated };
    });
    if (!updateResult.ok) {
      res
        .status(updateResult.status)
        .json({ error: updateResult.message });
      return;
    }
    res.json({
      update: {
        ...publicUpdate(updateResult.updated),
        status: updateResult.updated.status,
      },
    });
  }),
);

// Publish: requires a complete release (APK + checksum). Only one release is
// live at a time — publishing atomically archives the previously published
// release. Publishing a lower build number than the currently live release
// (a rollback) requires the explicit allowLowerBuild flag.
router.post(
  "/app-updates/:id/publish",
  requireAuth,
  ADMIN,
  asyncHandler(async (req: Request, res: Response) => {
    const allowLowerBuild =
      (req.body as { allowLowerBuild?: unknown } | undefined)
        ?.allowLowerBuild === true;
    const result = await db.transaction(async (tx) => {
      // Serialize all publishes with a transaction-scoped advisory lock —
      // row locks alone cannot serialize two publishes when no row is
      // currently published (both would lock an empty set and go live).
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('app_updates_publish'))`,
      );
      const [row] = await tx
        .select()
        .from(appUpdatesTable)
        .where(eq(appUpdatesTable.id, String(req.params.id)))
        .for("update")
        .limit(1);
      if (!row) {
        return {
          ok: false as const,
          status: 404,
          message: "Update not found",
        };
      }
      if (!row.apkPath || !row.checksum || !row.apkSize) {
        return {
          ok: false as const,
          status: 400,
          message: "Upload an APK before publishing",
        };
      }
      const [existingApk] = await tx
        .select({
          version: appUpdatesTable.version,
          buildNumber: appUpdatesTable.buildNumber,
        })
        .from(appUpdatesTable)
        .where(
          and(
            eq(appUpdatesTable.checksum, row.checksum),
            ne(appUpdatesTable.id, row.id),
            ne(appUpdatesTable.status, "draft"),
          ),
        )
        .orderBy(desc(appUpdatesTable.createdAt))
        .limit(1);
      if (existingApk) {
        return {
          ok: false as const,
          status: 409,
          message: reusedApkError(existingApk),
        };
      }
      const published = await tx
        .select()
        .from(appUpdatesTable)
        .where(eq(appUpdatesTable.status, "published"))
        .for("update");
      const currentLive = published
        .filter((p) => p.id !== row.id)
        .sort((a, b) => b.buildNumber - a.buildNumber)[0];
      if (
        currentLive &&
        row.buildNumber <= currentLive.buildNumber &&
        !allowLowerBuild
      ) {
        return {
          ok: false as const,
          status: 409,
          message: `Build number ${row.buildNumber} is not higher than the currently published build ${currentLive.buildNumber}. Confirm the rollback to proceed.`,
        };
      }
      // Archive every other currently published release.
      for (const p of published) {
        if (p.id === row.id) continue;
        await tx
          .update(appUpdatesTable)
          .set({ status: "archived", updatedAt: new Date() })
          .where(eq(appUpdatesTable.id, p.id));
      }
      // Atomic guard: only publish a row that still has a complete APK at
      // write time (a concurrent PATCH cannot have cleared it).
      const [updated] = await tx
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
        return {
          ok: false as const,
          status: 409,
          message: "Release changed concurrently; upload an APK and try again",
        };
      }
      return { ok: true as const, updated };
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.message });
      return;
    }
    res.json({
      update: { ...publicUpdate(result.updated), status: result.updated.status },
    });
  }),
);

router.post(
  "/app-updates/:id/unpublish",
  requireAuth,
  ADMIN,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('app_updates_publish'))`,
      );
      const [row] = await tx
        .select()
        .from(appUpdatesTable)
        .where(eq(appUpdatesTable.id, String(req.params.id)))
        .for("update")
        .limit(1);
      if (!row) {
        return {
          ok: false as const,
          status: 404,
          message: "Update not found",
        };
      }
      if (row.status !== "published") {
        return {
          ok: false as const,
          status: 409,
          message: "Only the currently published release can be unpublished",
        };
      }
      const [updated] = await tx
        .update(appUpdatesTable)
        .set({ status: "unpublished", updatedAt: new Date() })
        .where(
          and(
            eq(appUpdatesTable.id, row.id),
            eq(appUpdatesTable.status, "published"),
          ),
        )
        .returning();
      if (!updated) {
        return {
          ok: false as const,
          status: 409,
          message: "Release status changed concurrently; reload and try again",
        };
      }
      return { ok: true as const, updated };
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.message });
      return;
    }
    res.json({
      update: {
        ...publicUpdate(result.updated),
        status: result.updated.status,
      },
    });
  }),
);

export default router;
