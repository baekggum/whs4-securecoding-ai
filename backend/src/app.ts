import path from "path";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import { FRONTEND_ORIGINS } from "./env";
import { prisma } from "./prisma";
import { sessionMiddleware } from "./session";
import { attachCurrentUser } from "./middleware/auth";
import { csrfProtection } from "./middleware/csrf";
import { globalLimiter } from "./middleware/rateLimiters";
import { apiRouter } from "./routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();

  // Required for Secure cookies / correct req.ip behind a reverse proxy in
  // production (e.g. nginx, a PaaS load balancer).
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'", ...FRONTEND_ORIGINS],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: "same-site" },
    })
  );

  // Health endpoints are registered before the session middleware and rate
  // limiter (deploy-handoff.md B-1): container/LB probes must not consume
  // globalLimiter quota (which could 429 a busy uptime monitor behind one
  // proxy IP) or trigger a pointless session-store lookup per probe.

  // Liveness: process is up. Response shape unchanged.
  app.get("/health", (_req, res) => res.json({ ok: true }));

  // Readiness: DB is reachable too (deploy-handoff.md B-2). Errors are
  // handled here rather than leaking to errorHandler, so a probe failure is
  // a plain 503 instead of a logged "unhandled" 500.
  app.get("/health/ready", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ready" });
    } catch (err) {
      console.error("[health/ready] DB check failed:", err);
      res.status(503).json({ status: "unavailable" });
    }
  });

  app.use(
    cors({
      origin: FRONTEND_ORIGINS,
      credentials: true,
    })
  );

  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use(cookieParser());
  app.use(sessionMiddleware);
  app.use(attachCurrentUser);
  app.use(globalLimiter);

  // Re-encoded product images only (see src/upload/imageProcessor.ts) —
  // served inline so <img> tags can render them directly.
  app.use(
    "/uploads",
    express.static(path.join(__dirname, "..", "uploads"), {
      maxAge: "7d",
      setHeaders: (res) => {
        res.setHeader("X-Content-Type-Options", "nosniff");
      },
    })
  );

  app.use("/api", csrfProtection, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
