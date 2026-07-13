import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import * as chatApi from "../api/chat";
import { getErrorMessage } from "../api/client";

// Shared "1:1 채팅하기" flow (상품 상세 + 유저 프로필): unauthenticated users
// are sent to /login, otherwise a direct room is opened/reused and we
// navigate into it. Failures (휴면 계정 등) surface as an inline message
// instead of blanking the page.
export function useStartChat() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startChat(targetUserId: string): Promise<void> {
    if (!user) {
      navigate("/login");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const { room } = await chatApi.startDirectRoom(targetUserId);
      navigate(`/chat/${room.id}`);
    } catch (err) {
      setError(getErrorMessage(err, "채팅을 시작할 수 없습니다."));
    } finally {
      setStarting(false);
    }
  }

  return { startChat, starting, error };
}
