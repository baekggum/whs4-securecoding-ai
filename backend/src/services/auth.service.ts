import { prisma } from "../prisma";
import { hashPassword, verifyPassword } from "../lib/password";
import { HttpError } from "../lib/HttpError";
import type { SignupInput, LoginInput } from "../validators/auth.schema";
import { SELF_USER_SELECT } from "../utils/constants";
import { env } from "../env";

export async function signup(input: SignupInput) {
  const existing = await prisma.user.findUnique({ where: { username: input.username } });
  if (existing) {
    throw new HttpError(409, "이미 사용 중인 아이디입니다.");
  }

  const passwordHash = await hashPassword(input.password);

  // User row + its wallet are created atomically so "a user with no
  // wallet" is never a state the rest of the codebase has to null-check
  // for (docs/architecture.md §7.4). role is never taken from input — it
  // only ever gets its schema default ("user"); promoting to admin is a
  // separate operator-run script (backend/scripts/promoteAdmin.ts), not a
  // public API path (docs/architecture.md §9.1).
  const user = await prisma.user.create({
    data: {
      username: input.username,
      passwordHash,
      bio: input.bio ?? "",
      wallet: { create: { balance: env.SIGNUP_BONUS_POINTS } },
    },
    select: SELF_USER_SELECT,
  });

  return user;
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { username: input.username } });

  // Same generic error for "no such user" and "wrong password" — avoids
  // leaking which usernames exist.
  if (!user) {
    throw new HttpError(401, "아이디 또는 비밀번호가 올바르지 않습니다.");
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    throw new HttpError(401, "아이디 또는 비밀번호가 올바르지 않습니다.");
  }

  if (user.status === "dormant") {
    throw new HttpError(403, "장기간 신고 누적으로 휴면 처리된 계정입니다.");
  }

  // Re-fetch through the safe select rather than picking fields off the
  // row we just used for password verification, so this stays in lockstep
  // with signup's/`/me`'s response shape (including wallet balance)
  // instead of two hand-maintained field lists drifting apart.
  return prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: SELF_USER_SELECT });
}
