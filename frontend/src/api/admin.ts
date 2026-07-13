import { api, buildQuery } from "./client";
import type { AdminReport, AdminUserSummary, Product, Transfer } from "../types";

export function listUsers() {
  return api.get<{ items: AdminUserSummary[]; nextCursor: string | null }>("/api/admin/users");
}

export function setUserDormant(id: string) {
  return api.patch<{ user: AdminUserSummary }>(`/api/admin/users/${id}/dormant`);
}

export function activateUser(id: string) {
  return api.patch<{ user: AdminUserSummary }>(`/api/admin/users/${id}/activate`);
}

export function listProducts() {
  return api.get<{ items: Product[]; nextCursor: string | null }>("/api/admin/products");
}

export function deleteProduct(id: string) {
  return api.delete<void>(`/api/admin/products/${id}`);
}

export function unblockProduct(id: string) {
  return api.patch<{ product: Product }>(`/api/admin/products/${id}/unblock`);
}

export function listReports(resolved?: boolean) {
  return api.get<{ items: AdminReport[]; nextCursor: string | null }>(`/api/admin/reports${buildQuery({ resolved })}`);
}

export function resolveReport(id: string) {
  return api.patch<{ report: AdminReport }>(`/api/admin/reports/${id}/resolve`);
}

export function listAllTransactions() {
  return api.get<{ items: Transfer[]; nextCursor: string | null }>("/api/admin/wallet/transactions");
}
