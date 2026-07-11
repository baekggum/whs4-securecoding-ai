import type { NextFunction, Request, Response } from "express";
import { prisma } from "../prisma";
import { asyncHandler } from "../lib/asyncHandler";

// Loads the current user (if any) from the session on every request, and
// enforces that dormant accounts lose access immediately — this is why the
// project uses server-side sessions instead of JWT (see docs/architecture.md §5).
export const attachCurrentUser = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const userId = req.session.userId;
  if (!userId) {
    return next();
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user || user.status !== "active") {
    // Session refers to a deleted or dormant user: destroy it so the
    // stale cookie stops being sent as if it were valid.
    req.session.destroy(() => undefined);
    return next();
  }

  req.currentUser = user;
  next();
});

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.currentUser) {
    res.status(401).json({ error: "로그인이 필요합니다." });
    return;
  }
  next();
}
