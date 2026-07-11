import { prisma } from "../prisma";
import { HttpError } from "../lib/HttpError";
import { deleteProductImage } from "../upload/imageProcessor";

interface CreateProductInput {
  name: string;
  description: string;
  price: number;
  imagePath: string | null;
}

export async function createProduct(sellerId: string, input: CreateProductInput) {
  return prisma.product.create({
    data: {
      name: input.name,
      description: input.description,
      price: input.price,
      imagePath: input.imagePath,
      sellerId,
    },
  });
}

// Minimal-exposure list: only active products, only id+name
// (docs/architecture.md §4 "목록 최소 노출 원칙"). Optional sellerId powers
// the "판매중인 상품" grid on a user's public profile page.
export async function listProducts(cursor: string | undefined, limit: number, sellerId?: string) {
  const products = await prisma.product.findMany({
    where: { status: "active", ...(sellerId ? { sellerId } : {}) },
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const hasMore = products.length > limit;
  const items = hasMore ? products.slice(0, limit) : products;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

  return { items, nextCursor };
}

export async function listMyProducts(sellerId: string) {
  return prisma.product.findMany({
    where: { sellerId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getProductDetail(productId: string, viewerId: string | undefined) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { seller: { select: { id: true, username: true, status: true } } },
  });

  if (!product) {
    throw new HttpError(404, "상품을 찾을 수 없습니다.");
  }

  // Blocked products are hidden from everyone except the seller — the
  // response looks identical to "not found" so existence isn't leaked.
  if (product.status === "blocked" && product.sellerId !== viewerId) {
    throw new HttpError(404, "상품을 찾을 수 없습니다.");
  }

  return product;
}

async function assertOwnedByUser(productId: string, sellerId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) {
    throw new HttpError(404, "상품을 찾을 수 없습니다.");
  }
  // IDOR guard: ownership is re-checked server-side on every mutation,
  // never trusted from client input (docs/architecture.md §6).
  if (product.sellerId !== sellerId) {
    throw new HttpError(403, "본인이 등록한 상품만 수정할 수 있습니다.");
  }
  return product;
}

interface UpdateProductInput {
  name?: string;
  description?: string;
  price?: number;
}

export async function updateProduct(productId: string, sellerId: string, input: UpdateProductInput) {
  await assertOwnedByUser(productId, sellerId);
  return prisma.product.update({ where: { id: productId }, data: input });
}

export async function deleteProduct(productId: string, sellerId: string) {
  const product = await assertOwnedByUser(productId, sellerId);
  await prisma.product.delete({ where: { id: productId } });
  await deleteProductImage(product.imagePath);
}
