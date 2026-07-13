import { api, buildQuery } from "./client";
import type { Transfer } from "../types";

export function transfer(receiverId: string, amount: number, idempotencyKey: string) {
  return api.post<{ transfer: Transfer }>("/api/wallet/transfer", { receiverId, amount, idempotencyKey });
}

export function listTransactions(direction: "sent" | "received" | "all" = "all") {
  return api.get<{ transactions: Transfer[] }>(`/api/wallet/transactions${buildQuery({ direction })}`);
}
