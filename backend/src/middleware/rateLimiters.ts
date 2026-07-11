import rateLimit from "express-rate-limit";
import type { Request } from "express";

// Strict limiter for auth endpoints — defends against credential
// brute-forcing and mass account creation (docs/architecture.md §6).
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "시도가 너무 많습니다. 잠시 후 다시 시도해주세요." },
});

// Reports feed directly into auto-block/dormant transitions, so an abusive
// reporter could otherwise weaponize rate to silence other users/products.
export const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.currentUser?.id ?? req.ip ?? "anonymous",
  message: { error: "신고가 너무 많습니다. 잠시 후 다시 시도해주세요." },
});

// Gentle default limiter applied to the whole API.
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
});
