import { z } from "zod";
import { env } from "../env";

export const transferSchema = z.object({
  receiverId: z.string().uuid("유효하지 않은 사용자 ID입니다."),
  amount: z.coerce
    .number()
    .int("금액은 정수여야 합니다.")
    .positive("금액은 0보다 커야 합니다.")
    .max(env.MAX_TRANSFER_AMOUNT, `한 번에 최대 ${env.MAX_TRANSFER_AMOUNT.toLocaleString()}까지 송금할 수 있습니다.`),
  idempotencyKey: z
    .string()
    .min(1, "idempotencyKey가 필요합니다.")
    .max(100, "idempotencyKey는 100자 이하여야 합니다."),
});

export const transactionsQuerySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  direction: z.enum(["sent", "received", "all"]).default("all"),
});

export type TransferInput = z.infer<typeof transferSchema>;
