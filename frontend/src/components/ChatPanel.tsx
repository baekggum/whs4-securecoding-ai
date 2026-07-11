import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useSocket } from "../context/SocketContext";
import { useAuth } from "../context/AuthContext";
import * as chatApi from "../api/chat";
import { ApiError } from "../api/client";
import type { ChatMessage } from "../types";

interface Props {
  roomId: string;
  title: string;
}

// Plain-text rendering only — message content goes through JSX text nodes,
// which React escapes automatically, and dangerouslySetInnerHTML is never
// used anywhere in this app (docs/architecture.md §6 XSS defense).
export function ChatPanel({ roomId, title }: Props) {
  const socket = useSocket();
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setError(null);
    chatApi
      .getRoomMessages(roomId)
      .then(({ messages: history }) => {
        if (!cancelled) setMessages(history);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError && err.status === 403
            ? "채팅방에 접근할 권한이 없습니다."
            : "채팅 내역을 불러오지 못했습니다."
        );
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  useEffect(() => {
    if (!socket) return;

    socket.emit("join_room", { roomId }, (ack: { ok: boolean; message?: string }) => {
      if (!ack.ok) setError(ack.message ?? "채팅방에 입장할 수 없습니다.");
    });

    function onReceive(msg: ChatMessage) {
      if (msg.roomId === roomId) {
        setMessages((prev) => [...prev, msg]);
      }
    }
    function onSocketError(payload: { message: string }) {
      setError(payload.message);
    }

    socket.on("receive_message", onReceive);
    socket.on("error", onSocketError);
    return () => {
      socket.off("receive_message", onReceive);
      socket.off("error", onSocketError);
    };
  }, [socket, roomId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSend(e: FormEvent) {
    e.preventDefault();
    const content = input.trim();
    if (!content || !socket) return;

    socket.emit("send_message", { roomId, content }, (ack: { ok: boolean; message?: string }) => {
      if (!ack.ok) setError(ack.message ?? "메시지 전송에 실패했습니다.");
    });
    setInput("");
  }

  return (
    <div className="chat-panel">
      <div style={{ padding: "10px 12px", fontWeight: 600, borderBottom: "1px solid var(--color-border)" }}>
        {title}
      </div>
      <div className="chat-messages">
        {messages.length === 0 && <div className="empty-state">아직 메시지가 없습니다.</div>}
        {messages.map((m) => {
          const username = m.sender?.username ?? m.senderUsername ?? "알 수 없음";
          const status = m.sender?.status ?? m.senderStatus;
          const dormant = status === "dormant";
          return (
            <div key={m.id} className="chat-message">
              <div className={`sender${dormant ? " dormant" : ""}`}>
                <Link to={`/users/${m.senderId}`}>{dormant ? `(휴면) ${username}` : username}</Link>
                {m.senderId === user?.id ? " (나)" : ""}
              </div>
              <div className="content">{m.content}</div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      {error && (
        <div className="inline-error" style={{ padding: "0 12px 8px" }}>
          {error}
        </div>
      )}
      <form className="chat-input-row" onSubmit={handleSend}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="메시지 입력..."
          maxLength={2000}
        />
        <button className="btn btn-primary" type="submit" disabled={!socket}>
          전송
        </button>
      </form>
    </div>
  );
}
