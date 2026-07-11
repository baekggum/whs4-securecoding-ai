import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { HttpError } from "../lib/HttpError";
import { PRODUCT_REPORT_THRESHOLD, USER_REPORT_THRESHOLD } from "../utils/constants";
import type { CreateReportInput } from "../validators/report.schema";
import { domainEvents } from "../events";

// Report creation, count increment, and threshold status transition all
// happen inside one DB transaction. The UPDATE ... SET report_count =
// report_count + 1 takes a row lock, so concurrent reports on the same
// target serialize instead of racing and losing an increment
// (docs/architecture.md §3/§6 — race-condition-safe auto-block/dormant).
export async function createReport(reporterId: string, input: CreateReportInput) {
  const { targetType, targetId, reason } = input;

  if (targetType === "user" && targetId === reporterId) {
    throw new HttpError(400, "본인을 신고할 수 없습니다.");
  }

  if (targetType === "user") {
    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) {
      throw new HttpError(404, "신고 대상을 찾을 수 없습니다.");
    }
  } else {
    const target = await prisma.product.findUnique({ where: { id: targetId } });
    if (!target) {
      throw new HttpError(404, "신고 대상을 찾을 수 없습니다.");
    }
    if (target.sellerId === reporterId) {
      throw new HttpError(400, "본인이 등록한 상품은 신고할 수 없습니다.");
    }
  }

  let becameDormantUserId: string | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.report.create({ data: { reporterId, targetType, targetId, reason } });

      if (targetType === "product") {
        const updated = await tx.product.update({
          where: { id: targetId },
          data: { reportCount: { increment: 1 } },
        });
        if (updated.status === "active" && updated.reportCount >= PRODUCT_REPORT_THRESHOLD) {
          await tx.product.update({ where: { id: targetId }, data: { status: "blocked" } });
        }
      } else {
        const updated = await tx.user.update({
          where: { id: targetId },
          data: { reportCount: { increment: 1 } },
        });
        if (updated.status === "active" && updated.reportCount >= USER_REPORT_THRESHOLD) {
          await tx.user.update({ where: { id: targetId }, data: { status: "dormant" } });
          becameDormantUserId = targetId;
        }
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "이미 신고한 대상입니다.");
    }
    throw err;
  }

  // Emitted only after the transaction has committed, so the socket layer
  // never disconnects a user whose dormant transition could still roll
  // back (docs/architecture.md §5 "WebSocket 연결의 즉시 무효화 보강").
  if (becameDormantUserId) {
    domainEvents.emitEvent("user:dormant", { userId: becameDormantUserId });
  }
}
