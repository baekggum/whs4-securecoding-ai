import { z } from "zod";

export const roomIdParamSchema = z.object({
  id: z.string().uuid("유효하지 않은 채팅방 ID입니다."),
});

export const messagesQuerySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const startDirectRoomSchema = z.object({
  targetUserId: z.string().uuid("유효하지 않은 사용자 ID입니다."),
});

// Validated on the socket layer for send_message payloads.
export const sendMessageSchema = z.object({
  roomId: z.string().uuid(),
  content: z.string().trim().min(1).max(2000),
});

export const joinRoomSchema = z.object({
  roomId: z.string().uuid(),
});
