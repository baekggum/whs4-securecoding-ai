import { api } from "./client";
import type { SelfUser } from "../types";

export function signup(username: string, password: string, bio?: string) {
  return api.post<{ user: SelfUser }>("/api/auth/signup", { username, password, bio });
}

export function login(username: string, password: string) {
  return api.post<{ user: SelfUser }>("/api/auth/login", { username, password });
}

export function logout() {
  return api.post<void>("/api/auth/logout");
}
