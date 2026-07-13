import { api, buildQuery } from "./client";
import type { ChatMessage, ChatRoomSummary } from "../types";

export function listMyRooms() {
  return api.get<{ rooms: ChatRoomSummary[] }>("/api/chat/rooms");
}

export function startDirectRoom(targetUserId: string) {
  return api.post<{ room: { id: string } }>("/api/chat/rooms/direct", { targetUserId });
}

export function getRoomMessages(roomId: string, before?: string) {
  return api.get<{ messages: ChatMessage[] }>(`/api/chat/rooms/${roomId}/messages${buildQuery({ before })}`);
}
