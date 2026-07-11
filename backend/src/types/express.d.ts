import type { User } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      // Populated by requireAuth after verifying the session and loading
      // the current user's status from the database.
      currentUser?: User;
    }
  }
}

export {};
