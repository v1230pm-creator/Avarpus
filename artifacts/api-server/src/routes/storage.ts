import { Readable } from "stream";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull, or } from "drizzle-orm";
import { db, repairsTable, repairPhotosTable, usersTable, statusUpdatesTable, type DbUser } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import { isDealerPortalRole } from "../lib/dealerPortal";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";
import { isPersonalContact } from "../lib/statusAccess";
import { registerPendingUpload } from "../lib/pendingUploads";

// Object storage (App Storage) routes. Objects hold customer device photos,
// documents and signatures, so both upload and serving are auth-protected AND
// shop-scoped: every object lives under uploads/<shopId>/... and a caller can
// only request upload URLs for, and read objects from, their own shop's
// namespace. This prevents cross-shop disclosure even with a known path.

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

function shopIdOr403(req: Request, res: Response): string | null {
  const me = (req as Request & { user: DbUser }).user;
  if (!me.shopId) {
    res.status(403).json({ error: "Your account is not linked to a shop." });
    return null;
  }
  return me.shopId;
}

router.post(
  "/storage/uploads/request-url",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const { name, size, contentType } = req.body ?? {};
    if (
      typeof name !== "string" || !name ||
      typeof contentType !== "string" || !contentType ||
      typeof size !== "number" || size <= 0
    ) {
      res.status(400).json({ error: "Missing or invalid required fields" });
      return;
    }
    const uploadURL = await objectStorageService.getObjectEntityUploadURL(shopId);
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
  }),
);

router.post(
  "/storage/profiles/upload-url",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { name, size, contentType } = req.body ?? {};
    if (
      typeof name !== "string" || !name ||
      typeof size !== "number" || !Number.isFinite(size) || size <= 0 || size > 10 * 1024 * 1024 ||
      typeof contentType !== "string" || !["image/jpeg", "image/png", "image/webp"].includes(contentType)
    ) {
      res.status(400).json({ error: "Profile photo must be a JPEG, PNG, or WebP image no larger than 10 MB" });
      return;
    }
    const me = (req as Request & { user: DbUser }).user;
    const { uploadURL, objectPath } = await objectStorageService
      .getObjectEntityUploadURLWithPrefix(`profiles/${me.id}`);
    await registerPendingUpload({
      objectPath,
      ownerUserId: me.id,
      purpose: "profile",
    });
    res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
  }),
);

router.get(
  "/storage/objects/*path",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : String(raw ?? "");
    const me = (req as Request & { user: DbUser }).user;
    const objectPath = `/objects/${wildcardPath}`;
    const isProfilePath = wildcardPath.startsWith("uploads/profiles/");
    const isStatusPath = wildcardPath.startsWith("uploads/status/");
    if (isProfilePath) {
      // Profile objects are public-to-authenticated-users only while the exact
      // object remains attached to an active account.
      const [profileHit] = await db.select({ id: usersTable.id }).from(usersTable)
        .where(and(eq(usersTable.profilePhoto, objectPath), eq(usersTable.isActive, true))).limit(1);
      if (!profileHit) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
    } else if (isStatusPath) {
      const [status] = await db
        .select({ id: statusUpdatesTable.id, authorId: statusUpdatesTable.authorId, audience: statusUpdatesTable.audience, expiresAt: statusUpdatesTable.expiresAt })
        .from(statusUpdatesTable)
        .innerJoin(usersTable, eq(usersTable.id, statusUpdatesTable.authorId))
        .where(and(
          eq(statusUpdatesTable.objectPath, objectPath),
          isNull(statusUpdatesTable.deletedAt),
          eq(usersTable.isActive, true),
        ))
        .limit(1);
      if (
        !status ||
        status.expiresAt <= new Date() ||
        (
          status.authorId !== me.id &&
          (status.audience !== "contacts" || !(await isPersonalContact(me.id, status.authorId)))
        )
      ) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
    } else {
      const shopId = shopIdOr403(req, res);
      if (!shopId) return;
    // Shop isolation: only serve objects from the caller's own namespace.
      if (!wildcardPath.startsWith(`uploads/${shopId}/`)) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
    // Dealer-portal accounts: shop scoping is NOT enough — the object must be
    // attached (photo or signature) to a repair belonging to THEIR dealer.
      if (isDealerPortalRole(me.role)) {
      const dealerId = me.dealerId;
      if (!dealerId) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      const [photoHit] = await db
        .select({ id: repairPhotosTable.id })
        .from(repairPhotosTable)
        .innerJoin(repairsTable, eq(repairPhotosTable.repairId, repairsTable.id))
        .where(and(
          eq(repairPhotosTable.objectPath, objectPath),
          eq(repairPhotosTable.shopId, shopId),
          eq(repairsTable.dealerId, dealerId),
        ))
        .limit(1);
      let allowed = !!photoHit;
      if (!allowed) {
        const [sigHit] = await db
          .select({ id: repairsTable.id })
          .from(repairsTable)
          .where(and(
            eq(repairsTable.shopId, shopId),
            eq(repairsTable.dealerId, dealerId),
            or(
              eq(repairsTable.receivingSignaturePath, objectPath),
              eq(repairsTable.deliverySignaturePath, objectPath),
            ),
          ))
          .limit(1);
        allowed = !!sigHit;
      }
      if (!allowed) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      }
    }
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(
        `/objects/${wildcardPath}`,
      );
      const response = await objectStorageService.downloadObject(objectFile);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (response.body) {
        Readable.fromWeb(
          response.body as unknown as import("stream/web").ReadableStream<Uint8Array>,
        ).pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      throw error;
    }
  }),
);

export default router;
