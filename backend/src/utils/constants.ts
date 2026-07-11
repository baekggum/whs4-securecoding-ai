import { env } from "../env";

export const PRODUCT_REPORT_THRESHOLD = env.PRODUCT_REPORT_THRESHOLD;
export const USER_REPORT_THRESHOLD = env.USER_REPORT_THRESHOLD;

export const GLOBAL_ROOM_MARKER = "__global__";

// Publicly safe user fields — never spread the full Prisma User record
// (which includes passwordHash) into an API response.
export const PUBLIC_USER_SELECT = {
  id: true,
  username: true,
  bio: true,
  status: true,
  createdAt: true,
} as const;

export const SELF_USER_SELECT = {
  id: true,
  username: true,
  bio: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;
