import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  FRONTEND_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
  SESSION_COOKIE_NAME: z.string().min(1).default("tsp.sid"),
  SESSION_MAX_AGE_MS: z.coerce.number().int().positive().default(7 * 24 * 60 * 60 * 1000),
  CSRF_SECRET: z.string().min(16, "CSRF_SECRET must be at least 16 characters"),
  COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  PRODUCT_REPORT_THRESHOLD: z.coerce.number().int().positive().default(5),
  USER_REPORT_THRESHOLD: z.coerce.number().int().positive().default(5),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;

// Trim trailing slashes too — a stray "http://localhost:5173/" in
// FRONTEND_ORIGIN would silently fail to match the browser's Origin header
// (which never has one), causing CORS/cookie failures that look identical
// to a real cross-site misconfiguration.
export const FRONTEND_ORIGINS = env.FRONTEND_ORIGIN.split(",").map((s) => s.trim().replace(/\/+$/, ""));

// Browsers refuse to store a `Secure` cookie over a plain-HTTP connection —
// they don't reject the request, they just silently drop the Set-Cookie
// header. If COOKIE_SECURE=true ends up set in a local/dev .env (an easy
// copy-paste mistake, since production guidance says to set it), every
// request after login would look "logged out" with no visible error, which
// is exactly the failure mode this app hit once already. Outside
// production there is no scenario where Secure helps and several where it
// silently breaks auth, so the env var is only honored when NODE_ENV is
// actually "production" — see session.ts / middleware/csrf.ts.
export const COOKIE_SECURE_EFFECTIVE = env.NODE_ENV === "production" && env.COOKIE_SECURE;

if (env.NODE_ENV === "production" && !env.COOKIE_SECURE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[env] NODE_ENV=production but COOKIE_SECURE is not \"true\" — session/CSRF cookies will be sent without the Secure flag."
  );
}
