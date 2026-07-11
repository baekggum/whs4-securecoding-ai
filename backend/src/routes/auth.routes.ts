import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { loginSchema, signupSchema } from "../validators/auth.schema";
import * as authService from "../services/auth.service";
import { requireAuth } from "../middleware/auth";
import { authLimiter } from "../middleware/rateLimiters";
import { env } from "../env";
import { CSRF_COOKIE_NAME } from "../middleware/csrf";
import { serializeSelfUser } from "../utils/constants";

export const authRouter = Router();

function regenerateSession(req: import("express").Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

authRouter.post(
  "/signup",
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = signupSchema.parse(req.body);
    const user = await authService.signup(input);

    // Regenerate the session id before storing userId to prevent session
    // fixation (an attacker priming a known session id pre-login).
    await regenerateSession(req);
    req.session.userId = user.id;

    res.status(201).json({ user: serializeSelfUser(user) });
  })
);

authRouter.post(
  "/login",
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await authService.login(input);

    await regenerateSession(req);
    req.session.userId = user.id;

    res.json({ user: serializeSelfUser(user) });
  })
);

authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        res.status(500).json({ error: "로그아웃 처리 중 오류가 발생했습니다." });
        return;
      }
      res.clearCookie(env.SESSION_COOKIE_NAME, { path: "/" });
      // Force the next login to obtain a fresh CSRF token rather than
      // reusing one issued to the just-ended session's browser tab.
      res.clearCookie(CSRF_COOKIE_NAME, { path: "/" });
      res.status(204).send();
    });
  })
);
