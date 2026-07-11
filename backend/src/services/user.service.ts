import { prisma } from "../prisma";
import { hashPassword, verifyPassword } from "../lib/password";
import { HttpError } from "../lib/HttpError";
import { PUBLIC_USER_SELECT, SELF_USER_SELECT } from "../utils/constants";

export async function getPublicProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: PUBLIC_USER_SELECT,
  });

  if (!user) {
    throw new HttpError(404, "사용자를 찾을 수 없습니다.");
  }

  return user;
}

export async function updateBio(userId: string, bio: string) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { bio },
    select: SELF_USER_SELECT,
  });
  return user;
}

export async function updatePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    throw new HttpError(400, "현재 비밀번호가 일치하지 않습니다.");
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}
