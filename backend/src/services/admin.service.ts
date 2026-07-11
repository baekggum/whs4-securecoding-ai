import { prisma } from "../prisma";
import { HttpError } from "../lib/HttpError";
import { deleteProductImage } from "../upload/imageProcessor";

// --- Users -----------------------------------------------------------

export async function listUsers(cursor: string | undefined, limit: number) {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, status: true, role: true, reportCount: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const hasMore = users.length > limit;
  const items = hasMore ? users.slice(0, limit) : users;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;
  return { items, nextCursor };
}

export async function setUserDormant(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(404, "사용자를 찾을 수 없습니다.");
  return prisma.user.update({ where: { id: userId }, data: { status: "dormant" } });
}

export async function activateUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(404, "사용자를 찾을 수 없습니다.");
  // Reset report_count on reactivation — otherwise a single additional
  // report would immediately re-trip the threshold, which makes it
  // impossible to tell a fresh abuse pattern from leftover history
  // (docs/architecture.md §9.3).
  return prisma.user.update({ where: { id: userId }, data: { status: "active", reportCount: 0 } });
}

// --- Products ----------------------------------------------------------

// Unlike the public listing (product.service.ts listProducts), the
// minimal-exposure principle is a defense for end users browsing the
// marketplace, not for admins auditing it — the admin view intentionally
// shows every field and every status (docs/architecture.md §9.3).
export async function listProductsAdmin(cursor: string | undefined, limit: number) {
  const products = await prisma.product.findMany({
    include: { seller: { select: { id: true, username: true, status: true } } },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const hasMore = products.length > limit;
  const items = hasMore ? products.slice(0, limit) : products;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;
  return { items, nextCursor };
}

// Deliberately its own function rather than reusing product.service.ts's
// deleteProduct — that one enforces seller_id === session.userId, which an
// admin must be able to override. Keeping them separate means neither
// implementation risks accidentally picking up the other's ownership rule
// (docs/architecture.md §9.3).
export async function deleteProductAdmin(productId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new HttpError(404, "상품을 찾을 수 없습니다.");
  await prisma.product.delete({ where: { id: productId } });
  await deleteProductImage(product.imagePath);
}

export async function unblockProduct(productId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new HttpError(404, "상품을 찾을 수 없습니다.");
  return prisma.product.update({ where: { id: productId }, data: { status: "active", reportCount: 0 } });
}

// --- Reports -------------------------------------------------------------

interface ReportTargetSummary {
  type: "user" | "product";
  id: string;
  label: string;
}

export async function listReports(cursor: string | undefined, limit: number, resolved?: boolean) {
  const reports = await prisma.report.findMany({
    where: resolved === undefined ? {} : { resolved },
    include: { reporter: { select: { id: true, username: true } } },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const hasMore = reports.length > limit;
  const items = hasMore ? reports.slice(0, limit) : reports;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

  // targetId is polymorphic (user or product), so there's no single Prisma
  // relation to `include` — batch-fetch each target type once instead of
  // querying per-report (docs/architecture.md §3 "polymorphic target").
  const userTargetIds = items.filter((r) => r.targetType === "user").map((r) => r.targetId);
  const productTargetIds = items.filter((r) => r.targetType === "product").map((r) => r.targetId);

  const [targetUsers, targetProducts] = await Promise.all([
    userTargetIds.length
      ? prisma.user.findMany({ where: { id: { in: userTargetIds } }, select: { id: true, username: true } })
      : Promise.resolve([]),
    productTargetIds.length
      ? prisma.product.findMany({ where: { id: { in: productTargetIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  const userById = new Map(targetUsers.map((u) => [u.id, u]));
  const productById = new Map(targetProducts.map((p) => [p.id, p]));

  const withTarget = items.map((report) => {
    const target: ReportTargetSummary | null =
      report.targetType === "user"
        ? userById.has(report.targetId)
          ? { type: "user", id: report.targetId, label: userById.get(report.targetId)!.username }
          : null // target since deleted
        : productById.has(report.targetId)
          ? { type: "product", id: report.targetId, label: productById.get(report.targetId)!.name }
          : null;

    return { ...report, target };
  });

  return { items: withTarget, nextCursor };
}

export async function resolveReport(reportId: string, adminId: string) {
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) throw new HttpError(404, "신고를 찾을 수 없습니다.");

  return prisma.report.update({
    where: { id: reportId },
    data: { resolved: true, resolvedAt: new Date(), resolvedById: adminId },
  });
}
