import { useParams } from "react-router-dom";
import { ChatPanel } from "../components/ChatPanel";
import { useAsyncData } from "../hooks/useAsyncData";
import * as chatApi from "../api/chat";

export function ChatRoomPage() {
  const { roomId } = useParams<{ roomId: string }>();

  // Lookup failures fall back to a null room (.catch 폴백) — ChatPanel still
  // renders with the generic title and surfaces its own access error.
  const { data: room } = useAsyncData(
    () =>
      chatApi
        .listMyRooms()
        .then(({ rooms }) => rooms.find((r) => r.id === roomId) ?? null)
        .catch(() => null),
    [roomId]
  );

  if (!roomId) return null;

  const title = room?.type === "global" ? "전체채팅" : room?.otherUser?.username ?? "채팅";

  return (
    <div style={{ maxWidth: 640, margin: "24px auto" }}>
      <ChatPanel roomId={roomId} title={title} />
    </div>
  );
}
