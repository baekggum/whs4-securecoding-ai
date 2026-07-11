import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuth } from "./AuthContext";
import { API_BASE_URL } from "../api/client";

const SocketContext = createContext<Socket | null>(null);

// One socket per logged-in session, authenticated by the same httpOnly
// session cookie as REST calls (docs/architecture.md §5) — the browser
// attaches it automatically because `withCredentials` is set, no token to
// manage on the client.
export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!user) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSocket(null);
      return;
    }

    const instance = io(API_BASE_URL || undefined, {
      withCredentials: true,
      transports: ["websocket", "polling"],
    });
    socketRef.current = instance;
    setSocket(instance);

    return () => {
      instance.disconnect();
      socketRef.current = null;
    };
  }, [user]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export function useSocket(): Socket | null {
  return useContext(SocketContext);
}
