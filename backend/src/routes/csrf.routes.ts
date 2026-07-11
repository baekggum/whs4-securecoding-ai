import { Router } from "express";
import { issueCsrfCookie } from "../middleware/csrf";

export const csrfRouter = Router();

// Public — the frontend calls this on load (and after login) to obtain a
// fresh CSRF token, which it must echo back via the X-CSRF-Token header on
// every mutating request.
csrfRouter.get("/csrf-token", (_req, res) => {
  const csrfToken = issueCsrfCookie(res);
  res.json({ csrfToken });
});
