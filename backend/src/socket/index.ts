import type { Server as HttpServer } from "http";
import type { Request } from "express";
import { Server as SocketIOServer } from "socket.io";
import { ZodError } from "zod";
import { sessionMiddleware } from "../session";
import { prisma } from "../prisma";
import { FRONTEND_ORIGINS } from "../env";
import { getOrCreateGlobalRoom, assertRoomAccess, saveMessage } from "../services/chat.service";
import { joinRoomSchema, sendMessageSchema } from "../validators/chat.schema";
import { HttpError } from "../lib/HttpError";

type Ack = ((response: { ok: boolean; message?: string }) => void) | undefined;

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof HttpError) return err.message;
  if (err instanceof ZodError) return "요청 형식이 올바르지 않습니다.";
  return fallback;
}

export function createSocketServer(httpServer: HttpServer) {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: FRONTEND_ORIGINS, credentials: true },
  });

  // Reuse the exact same session middleware/store as the REST API so a
  // Socket.IO connection is authenticated by the same httpOnly session
  // cookie the browser already sends — no separate token issuance
  // (docs/architecture.md §5 "WebSocket 인증").
  io.engine.use(sessionMiddleware);

  io.use(async (socket, next) => {
    const req = socket.request as Request;
    const userId = req.session?.userId;
    if (!userId) {
      next(new Error("unauthorized"));
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "active") {
      next(new Error("unauthorized"));
      return;
    }

    socket.data.user = user;
    next();
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;

    void getOrCreateGlobalRoom().then((roomId) => socket.join(roomId));

    socket.on("join_room", async (payload: unknown, ack: Ack) => {
      try {
        const { roomId } = joinRoomSchema.parse(payload);
        await assertRoomAccess(roomId, user.id);
        await socket.join(roomId);
        ack?.({ ok: true });
      } catch (err) {
        const message = errorMessage(err, "채팅방에 입장할 수 없습니다.");
        socket.emit("error", { code: "join_room_failed", message });
        ack?.({ ok: false, message });
      }
    });

    socket.on("send_message", async (payload: unknown, ack: Ack) => {
      try {
        const { roomId, content } = sendMessageSchema.parse(payload);
        // Server always re-derives sender/room membership from the
        // authenticated session — client-supplied sender identity is
        // never trusted (docs/architecture.md §4).
        const message = await saveMessage(roomId, user.id, content);
        io.to(roomId).emit("receive_message", {
          id: message.id,
          roomId,
          senderId: user.id,
          senderUsername: user.username,
          senderStatus: user.status,
          content: message.content,
          createdAt: message.createdAt,
        });
        ack?.({ ok: true });
      } catch (err) {
        const message = errorMessage(err, "메시지 전송에 실패했습니다.");
        socket.emit("error", { code: "send_message_failed", message });
        ack?.({ ok: false, message });
      }
    });
  });

  return io;
}
