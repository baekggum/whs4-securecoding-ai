import { z } from "zod";

export const adminIdParamSchema = z.object({
  id: z.string().uuid("유효하지 않은 ID입니다."),
});

export const adminListQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const adminReportListQuerySchema = adminListQuerySchema.extend({
  resolved: z.enum(["true", "false"]).optional(),
});

export const adminTransferListQuerySchema = adminListQuerySchema.extend({
  senderId: z.string().uuid().optional(),
  receiverId: z.string().uuid().optional(),
  before: z.string().datetime().optional(),
});
