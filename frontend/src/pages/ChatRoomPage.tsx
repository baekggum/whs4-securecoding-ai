import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ChatPanel } from "../components/ChatPanel";
import * as chatApi from "../api/chat";
import type { ChatRoomSummary } from "../types";

export function ChatRoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [room, setRoom] = useState<ChatRoomSummary | null>(null);

  useEffect(() => {
    chatApi.listMyRooms().then(({ rooms }) => {
      setRoom(rooms.find((r) => r.id === roomId) ?? null);
    });
  }, [roomId]);

  if (!roomId) return null;

  const title = room?.type === "global" ? "전체채팅" : room?.otherUser?.username ?? "채팅";

  return (
    <div style={{ maxWidth: 640, margin: "24px auto" }}>
      <ChatPanel roomId={roomId} title={title} />
    </div>
  );
}
