import type { NextFunction, Request, Response } from "express";

// Chains after requireAuth, which already re-fetches the full user row
// (including role) from the DB on every request (middleware/auth.ts) — so
// this needs no extra query of its own, and a role change takes effect on
// the very next request just like the existing dormant-account check
// (docs/architecture.md §9.2). Never trust a client-supplied role; this
// only ever reads what the server itself just loaded.
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.currentUser || req.currentUser.role !== "admin") {
    res.status(403).json({ error: "관리자 권한이 필요합니다." });
    return;
  }
  next();
}
