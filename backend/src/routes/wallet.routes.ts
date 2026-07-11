import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { transferSchema, transactionsQuerySchema } from "../validators/wallet.schema";
import * as walletService from "../services/wallet.service";
import { transferLimiter } from "../middleware/rateLimiters";

export const walletRouter = Router();

walletRouter.post(
  "/transfer",
  requireAuth,
  transferLimiter,
  asyncHandler(async (req, res) => {
    const { receiverId, amount, idempotencyKey } = transferSchema.parse(req.body);
    const result = await walletService.transfer(req.currentUser!.id, receiverId, amount, idempotencyKey);
    res.json({ transfer: result });
  })
);

walletRouter.get(
  "/transactions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { before, limit, direction } = transactionsQuerySchema.parse(req.query);
    const transactions = await walletService.listTransactions(req.currentUser!.id, { before, limit, direction });
    res.json({ transactions });
  })
);
