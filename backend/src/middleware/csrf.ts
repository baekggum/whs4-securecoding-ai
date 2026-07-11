import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../env";
import { HttpError } from "../lib/HttpError";

// Double-submit cookie CSRF protection (see docs/architecture.md §6 and
// docs/research.md §5). The token cookie is HMAC-signed so an attacker who
// manages to set an arbitrary cookie on this origin still cannot forge a
// value that passes verification without knowing CSRF_SECRET.
export const CSRF_COOKIE_NAME = "tsp.csrf";
const CSRF_HEADER_NAME = "x-csrf-token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function sign(value: string): string {
  return crypto.createHmac("sha256", env.CSRF_SECRET).update(value).digest("hex");
}

export function issueCsrfCookie(res: Response): string {
  const token = crypto.randomBytes(32).toString("hex");
  const cookieValue = `${token}.${sign(token)}`;
  res.cookie(CSRF_COOKIE_NAME, cookieValue, {
    httpOnly: false, // frontend JS must read this to echo it back in a header
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: env.SESSION_MAX_AGE_MS,
  });
  return token;
}

function tokenFromCookiePair(cookieValue: unknown): string | null {
  if (typeof cookieValue !== "string") return null;
  const dotIndex = cookieValue.indexOf(".");
  if (dotIndex === -1) return null;
  const token = cookieValue.slice(0, dotIndex);
  const signature = cookieValue.slice(dotIndex + 1);
  if (!token || !signature) return null;

  const expected = sign(token);
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (signatureBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(signatureBuf, expectedBuf)) return null;
  return token;
}

export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const cookieToken = tokenFromCookiePair(req.cookies?.[CSRF_COOKIE_NAME]);
  const headerToken = req.get(CSRF_HEADER_NAME);

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    next(new HttpError(403, "유효하지 않은 요청입니다. 페이지를 새로고침한 후 다시 시도해주세요."));
    return;
  }

  next();
}
