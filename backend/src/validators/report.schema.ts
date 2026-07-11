import { z } from "zod";

export const createReportSchema = z.object({
  targetType: z.enum(["user", "product"]),
  targetId: z.string().uuid("유효하지 않은 신고 대상입니다."),
  reason: z
    .string()
    .trim()
    .min(10, "신고 사유는 10자 이상 입력해주세요.")
    .max(1000, "신고 사유는 1000자 이하여야 합니다."),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;
