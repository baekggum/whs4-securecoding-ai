import type { User } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      // Populated by attachCurrentUser (middleware/auth.ts) after loading
      // the session user's current status/role from the database on every
      // request. Handlers behind requireAuth should read it through
      // requireCurrentUser(req) instead of a non-null assertion.
      currentUser?: User;
    }
  }
}

export {};
