import { z } from "zod";

export const createProductSchema = z.object({
  name: z.string().trim().min(1, "상품명을 입력해주세요.").max(100, "상품명은 100자 이하여야 합니다."),
  description: z.string().trim().min(1, "상품 설명을 입력해주세요.").max(2000, "상품 설명은 2000자 이하여야 합니다."),
  price: z.coerce.number().int("가격은 정수여야 합니다.").min(0, "가격은 0 이상이어야 합니다.").max(100_000_000),
});

export const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  price: z.coerce.number().int().min(0).max(100_000_000).optional(),
});

export const productIdParamSchema = z.object({
  id: z.string().uuid("유효하지 않은 상품 ID입니다."),
});

export const productListQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  sellerId: z.string().uuid().optional(),
  search: z.string().trim().min(1).max(100).optional(),
});
