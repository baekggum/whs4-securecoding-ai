import path from "path";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import { FRONTEND_ORIGINS } from "./env";
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

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
