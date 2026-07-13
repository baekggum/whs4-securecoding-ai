import { api, buildQuery } from "./client";
import type { Product, ProductListItem } from "../types";

export type ListProductsOptions = {
  cursor?: string;
  sellerId?: string;
  search?: string;
};

export function listProducts(options: ListProductsOptions = {}) {
  return api.get<{ items: ProductListItem[]; nextCursor: string | null }>(`/api/products${buildQuery(options)}`);
}

export function listMyProducts() {
  return api.get<{ products: Product[] }>("/api/products/mine");
}

export function getProduct(id: string) {
  return api.get<{ product: Product }>(`/api/products/${id}`);
}

export interface CreateProductInput {
  name: string;
  description: string;
  price: number;
  image: File;
}

export function createProduct(input: CreateProductInput) {
  const formData = new FormData();
  formData.append("name", input.name);
  formData.append("description", input.description);
  formData.append("price", String(input.price));
  formData.append("image", input.image);
  return api.postForm<{ product: Product }>("/api/products", formData);
}

export function updateProduct(id: string, input: Partial<{ name: string; description: string; price: number }>) {
  return api.patch<{ product: Product }>(`/api/products/${id}`, input);
}

export function deleteProduct(id: string) {
  return api.delete<void>(`/api/products/${id}`);
}
