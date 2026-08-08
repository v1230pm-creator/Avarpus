import { Readable } from "stream";
import { Router, type IRouter, type Request, type Response } from "express";
import type { DbUser } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { asyncHandler } from "../lib/asyncHandler";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";

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

router.get(
  "/storage/objects/*path",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const shopId = shopIdOr403(req, res);
    if (!shopId) return;
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : String(raw ?? "");
    // Shop isolation: only serve objects from the caller's own namespace.
    if (!wildcardPath.startsWith(`uploads/${shopId}/`)) {
      res.status(404).json({ error: "Object not found" });
      return;
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
