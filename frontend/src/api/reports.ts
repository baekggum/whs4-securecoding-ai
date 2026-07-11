import { api } from "./client";
import type { ReportTargetType } from "../types";

export function createReport(targetType: ReportTargetType, targetId: string, reason: string) {
  return api.post<{ message: string }>("/api/reports", { targetType, targetId, reason });
}
