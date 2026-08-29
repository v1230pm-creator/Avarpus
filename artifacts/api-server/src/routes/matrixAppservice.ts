import crypto from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  MATRIX_APPSERVICE_NAMESPACE_PREFIX,
  MATRIX_DIRECT_ROOM_ALIAS_PREFIX,
  matrixConfigurationStatus,
} from "../lib/chatProviders";

const router: IRouter = Router();

function matrixError(res: Response, status: number, errcode: string, error: string) {
  return res.status(status).json({ errcode, error });
}

function suppliedHomeserverToken(req: Request): string {
  const authorization = req.header("authorization") ?? "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7);
  return typeof req.query.access_token === "string" ? req.query.access_token : "";
}

function sameSecret(supplied: string, expected: string): boolean {
  const suppliedDigest = crypto.createHash("sha256").update(supplied).digest();
  const expectedDigest = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(suppliedDigest, expectedDigest);
}

function requireHomeserver(req: Request, res: Response): boolean {
  const expected = process.env.MATRIX_HOMESERVER_TOKEN?.trim();
  if (!expected) {
    matrixError(res, 503, "M_UNAVAILABLE", "Application Service is not configured");
    return false;
  }
  if (!sameSecret(suppliedHomeserverToken(req), expected)) {
    matrixError(res, 401, "M_UNAUTHORIZED", "Invalid homeserver token");
    return false;
  }
  return true;
}

function escapedServerName(): string | null {
  const serverName = process.env.MATRIX_SERVER_NAME?.trim();
  return serverName ? serverName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : null;
}

function ownsUserId(userId: string): boolean {
  const serverName = escapedServerName();
  return !!serverName &&
    new RegExp(`^@${MATRIX_APPSERVICE_NAMESPACE_PREFIX}[a-f0-9]{32}:${serverName}$`).test(userId);
}

function ownsRoomAlias(roomAlias: string): boolean {
  const serverName = escapedServerName();
  return !!serverName &&
    new RegExp(`^#${MATRIX_DIRECT_ROOM_ALIAS_PREFIX}[a-f0-9]{40}:${serverName}$`).test(roomAlias);
}

router.get("/health", (req, res) => {
  if (!requireHomeserver(req, res)) return;
  res.json(matrixConfigurationStatus());
});

router.put("/_matrix/app/v1/transactions/:txnId", (req, res) => {
  if (!requireHomeserver(req, res)) return;
  if (!req.params.txnId || !req.body || !Array.isArray(req.body.events)) {
    matrixError(res, 400, "M_BAD_JSON", "Transaction body must contain an events array");
    return;
  }
  // Avarpus currently sends through the Client-Server API and stores its local
  // message only after Matrix accepts it. Incoming AS events require no further
  // mutation, so acknowledging a replay is naturally idempotent.
  res.json({});
});

router.get("/_matrix/app/v1/users/:userId", (req, res) => {
  if (!requireHomeserver(req, res)) return;
  if (!ownsUserId(req.params.userId)) {
    matrixError(res, 404, "M_NOT_FOUND", "User is outside the Application Service namespace");
    return;
  }
  res.json({});
});

router.get("/_matrix/app/v1/rooms/:roomAlias", (req, res) => {
  if (!requireHomeserver(req, res)) return;
  if (!ownsRoomAlias(req.params.roomAlias)) {
    matrixError(res, 404, "M_NOT_FOUND", "Room alias is outside the Application Service namespace");
    return;
  }
  res.json({});
});

export default router;