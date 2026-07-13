import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth, requireCurrentUser } from "../middleware/auth";
import { createReportSchema } from "../validators/report.schema";
import * as reportService from "../services/report.service";
import { reportLimiter } from "../middleware/rateLimiters";

export const reportRouter = Router();

reportRouter.post(
  "/",
  requireAuth,
  reportLimiter,
  asyncHandler(async (req, res) => {
    const input = createReportSchema.parse(req.body);
    await reportService.createReport(requireCurrentUser(req).id, input);
    res.status(201).json({ message: "신고가 접수되었습니다." });
  })
);
