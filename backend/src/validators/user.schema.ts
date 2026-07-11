import { z } from "zod";

export const updateBioSchema = z.object({
  bio: z.string().max(300, "소개글은 300자 이하여야 합니다.").default(""),
});

export const updatePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "현재 비밀번호를 입력해주세요.").max(200),
    newPassword: z.string().min(8, "새 비밀번호는 8자 이상이어야 합니다.").max(64),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "새 비밀번호는 현재 비밀번호와 달라야 합니다.",
    path: ["newPassword"],
  });

export const userIdParamSchema = z.object({
  id: z.string().uuid("유효하지 않은 사용자 ID입니다."),
});
