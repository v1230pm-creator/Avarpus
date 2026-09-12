import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { resendWebhookHandler } from "./routes/resendWebhook";
import matrixAppserviceRouter from "./routes/matrixAppservice";

const app: Express = express();

// Behind Replit's proxy — trust the first hop so req.ip reflects the real
// client address (used for auth rate limiting).
app.set("trust proxy", 1);
// API responses are dynamic and often authenticated. React Query owns client
// caching; HTTP validators can make React Native surface a bare 304 as a failed
// fetch with no response body.
app.disable("etag");

// Baseline security headers. This is a JSON API, so the defaults (nosniff,
// HSTS, no framing, strict referrer, restrictive CSP) apply to every response.
// Stored files (photos, signatures) are fetched cross-origin by the web apps
// and the mobile app, so resources must stay embeddable from other origins.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) ?? [],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
// Resend signs the exact request bytes. This route must be mounted before the
// global JSON parser so signature verification never sees re-serialized JSON.
app.post("/api/webhooks/resend", express.raw({ type: "application/json", limit: "256kb" }), resendWebhookHandler);
// Matrix may deliver batched transactions. Keep this parser isolated so the
// callback has an explicit bound without widening the rest of the API.
app.use(
  "/api/matrix/appservice",
  express.json({ limit: "1mb" }),
  matrixAppserviceRouter,
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Global error handler — catches errors forwarded via next(err) from async handlers.
// Always returns a generic message to the caller; full error details go to server logs only.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled route error");
  if (!res.headersSent) {
    res.status(500).json({ message: "An unexpected error occurred. Please try again." });
  }
});

export default app;
