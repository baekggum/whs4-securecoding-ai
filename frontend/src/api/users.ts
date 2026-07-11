import { api } from "./client";
import type { PublicUser, SelfUser } from "../types";

export function getMe() {
  return api.get<{ user: SelfUser }>("/api/users/me");
}

export function updateBio(bio: string) {
  return api.patch<{ user: SelfUser }>("/api/users/me", { bio });
}

export function updatePassword(currentPassword: string, newPassword: string) {
  return api.patch<void>("/api/users/me/password", { currentPassword, newPassword });
}

export function getPublicProfile(id: string) {
  return api.get<{ user: PublicUser }>(`/api/users/${id}`);
}
