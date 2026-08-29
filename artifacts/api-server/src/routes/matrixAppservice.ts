import crypto from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  MATRIX_APPSERVICE_NAMESPACE_PREFIX,
  MATRIX_DIRECT_ROOM_ALIAS_PREFIX,
  matrixConfigurationStatus,
  matrixOutboundAuthStatus,
} from "../lib/chatProviders";

const router: IRouter = Router();

router.use((_req, res, next) => {
  res.setHeader("X-Avarpus-Matrix-Appservice", "2");
  next();
});

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

type MatrixTransactionBody = {
  events?: unknown;
};

/**
 * Validate the event envelope before acknowledging it. Avarpus currently
 * originates messages through the Client-Server API, so there is no inbound
 * event-to-local-message mutation to perform here. We still parse and validate
 * every transaction rather than exposing a health-only 200 endpoint; an invalid
 * transaction is rejected and Matrix will retry it.
 */
function validateTransaction(body: unknown): { eventCount: number } | null {
  if (!body || typeof body !== "object") return null;
  const events = (body as MatrixTransactionBody).events;
  if (!Array.isArray(events)) return null;
  for (const event of events) {
    if (!event || typeof event !== "object") return null;
    const record = event as Record<string, unknown>;
    if (typeof record.type !== "string" || typeof record.sender !== "string") {
      return null;
    }
  }
  return { eventCount: events.length };
}

function handleTransaction(req: Request, res: Response): void {
  if (!requireHomeserver(req, res)) return;
  const transaction = validateTransaction(req.body);
  if (!transaction) {
    matrixError(res, 400, "M_BAD_JSON", "Transaction body must contain valid Matrix events");
    return;
  }
  // The empty Matrix response is the protocol acknowledgement. Because this
  // handler has no side effects, retries/replays are safe and idempotent.
  // eventCount is intentionally not returned: Synapse expects an empty object.
  void transaction.eventCount;
  res.json({});
}

router.get("/health", (req, res) => {
  if (!requireHomeserver(req, res)) return;
  res.json(matrixConfigurationStatus());
});

router.get("/health/outbound", async (req, res) => {
  if (!requireHomeserver(req, res)) return;
  res.json({
    ...matrixConfigurationStatus(),
    ...(await matrixOutboundAuthStatus()),
  });
});

// ESS installations that post directly to the configured callback base are
// supported in addition to the standard Matrix transaction path below.
router.post("/", handleTransaction);
router.put("/_matrix/app/v1/transactions/:txnId", handleTransaction);

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