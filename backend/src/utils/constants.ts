import { env } from "../env";

export const PRODUCT_REPORT_THRESHOLD = env.PRODUCT_REPORT_THRESHOLD;
export const USER_REPORT_THRESHOLD = env.USER_REPORT_THRESHOLD;

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
  role: true,
  createdAt: true,
  updatedAt: true,
  wallet: { select: { balance: true } },
} as const;

// bigint isn't JSON-serializable, so every self-facing user DTO goes
// through this to flatten wallet.balance into a plain string field
// (docs/architecture.md §7.6 — GET /api/users/me now also exposes balance).
export function serializeSelfUser<T extends { wallet: { balance: bigint } | null }>(
  user: T
): Omit<T, "wallet"> & { balance: string } {
  const { wallet, ...rest } = user;
  return { ...rest, balance: (wallet?.balance ?? 0n).toString() };
}
