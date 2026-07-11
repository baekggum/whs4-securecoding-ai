import { z } from "zod";

// Username: 3-20 chars, alphanumeric + underscore only (avoids ambiguity,
// keeps it URL/display safe without extra escaping concerns).
const usernameSchema = z
  .string()
  .trim()
  .min(3, "아이디는 3자 이상이어야 합니다.")
  .max(20, "아이디는 20자 이하여야 합니다.")
  .regex(/^[a-zA-Z0-9_]+$/, "아이디는 영문, 숫자, 밑줄(_)만 사용할 수 있습니다.");

// Password: length bounds only (no composition rules) — bcrypt truncates
// input at 72 bytes, so we cap length to stay well under that.
const passwordSchema = z
  .string()
  .min(8, "비밀번호는 8자 이상이어야 합니다.")
  .max(64, "비밀번호는 64자 이하여야 합니다.");

export const signupSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  bio: z.string().max(300, "소개글은 300자 이하여야 합니다.").optional(),
});

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, "비밀번호를 입력해주세요.").max(200),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
