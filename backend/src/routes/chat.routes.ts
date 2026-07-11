import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { messagesQuerySchema, roomIdParamSchema, startDirectRoomSchema } from "../validators/chat.schema";
import * as chatService from "../services/chat.service";

export const chatRouter = Router();

chatRouter.get(
  "/rooms",
  requireAuth,
  asyncHandler(async (req, res) => {
    const rooms = await chatService.listMyRooms(req.currentUser!.id);
    res.json({ rooms });
  })
);

chatRouter.post(
  "/rooms/direct",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { targetUserId } = startDirectRoomSchema.parse(req.body);
    const room = await chatService.startDirectRoom(req.currentUser!.id, targetUserId);
    res.status(201).json({ room });
  })
);

chatRouter.get(
  "/rooms/:id/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = roomIdParamSchema.parse(req.params);
    const { before, limit } = messagesQuerySchema.parse(req.query);
    const messages = await chatService.getRoomMessages(id, req.currentUser!.id, before, limit);
    res.json({ messages });
  })
);
