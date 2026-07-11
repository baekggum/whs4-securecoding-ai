import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { HttpError } from "../lib/HttpError";

let cachedGlobalRoomId: string | null = null;

// The single global chat room is created lazily on first use and cached
// in-process; type='global' rows are otherwise unique by convention rather
// than a DB constraint (docs/architecture.md §3).
export async function getOrCreateGlobalRoom() {
  if (cachedGlobalRoomId) return cachedGlobalRoomId;

  const existing = await prisma.chatRoom.findFirst({ where: { type: "global" } });
  if (existing) {
    cachedGlobalRoomId = existing.id;
    return existing.id;
  }

  const created = await prisma.chatRoom.create({ data: { type: "global" } });
  cachedGlobalRoomId = created.id;
  return created.id;
}

function sortedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function startDirectRoom(userId: string, targetUserId: string) {
  if (userId === targetUserId) {
    throw new HttpError(400, "본인과의 채팅방은 만들 수 없습니다.");
  }

  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser) {
    throw new HttpError(404, "상대 사용자를 찾을 수 없습니다.");
  }

  const [userIdLow, userIdHigh] = sortedPair(userId, targetUserId);

  const existing = await prisma.chatRoom.findUnique({
    where: { userIdLow_userIdHigh: { userIdLow, userIdHigh } },
  });
  if (existing) return existing;

  // TOCTOU: two concurrent requests for the same pair can both pass the
  // findUnique check above and both reach here. The DB's
  // UNIQUE(userIdLow, userIdHigh) constraint lets only one INSERT win; the
  // loser's transaction throws P2002 instead of silently creating a
  // duplicate room. Treat that as "someone else just created it" and
  // return the now-existing row, so startDirectRoom stays idempotent under
  // concurrency instead of surfacing a 500.
  try {
    return await prisma.$transaction(async (tx) => {
      const room = await tx.chatRoom.create({
        data: { type: "direct", userIdLow, userIdHigh },
      });
      await tx.chatRoomParticipant.createMany({
        data: [
          { roomId: room.id, userId },
          { roomId: room.id, userId: targetUserId },
        ],
      });
      return room;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const room = await prisma.chatRoom.findUnique({
        where: { userIdLow_userIdHigh: { userIdLow, userIdHigh } },
      });
      if (room) return room;
    }
    throw err;
  }
}

export async function listMyRooms(userId: string) {
  const globalRoomId = await getOrCreateGlobalRoom();

  const directParticipations = await prisma.chatRoomParticipant.findMany({
    where: { userId, room: { type: "direct" } },
    include: {
      room: {
        include: {
          participants: { include: { user: { select: { id: true, username: true, status: true } } } },
        },
      },
    },
  });

  const directRooms = directParticipations.map(({ room }) => ({
    id: room.id,
    type: room.type,
    otherUser: room.participants.find((p) => p.userId !== userId)?.user ?? null,
  }));

  return [{ id: globalRoomId, type: "global" as const, otherUser: null }, ...directRooms];
}

// Verifies the caller is allowed to read/write in a room: everyone active
// may use the global room; direct rooms require an explicit participant
// row. Used by both the REST history endpoint and the Socket.IO handlers
// so authorization can't be bypassed via the realtime path.
export async function assertRoomAccess(roomId: string, userId: string) {
  const room = await prisma.chatRoom.findUnique({ where: { id: roomId } });
  if (!room) {
    throw new HttpError(404, "채팅방을 찾을 수 없습니다.");
  }

  if (room.type === "global") {
    return room;
  }

  const participant = await prisma.chatRoomParticipant.findUnique({
    where: { roomId_userId: { roomId, userId } },
  });
  if (!participant) {
    throw new HttpError(403, "채팅방에 접근할 권한이 없습니다.");
  }

  return room;
}

export async function getRoomMessages(roomId: string, userId: string, before: string | undefined, limit: number) {
  await assertRoomAccess(roomId, userId);

  const messages = await prisma.message.findMany({
    where: {
      roomId,
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
    },
    include: { sender: { select: { id: true, username: true, status: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return messages.reverse();
}

export async function saveMessage(roomId: string, senderId: string, content: string) {
  await assertRoomAccess(roomId, senderId);

  return prisma.message.create({
    data: { roomId, senderId, content },
    include: { sender: { select: { id: true, username: true, status: true } } },
  });
}
