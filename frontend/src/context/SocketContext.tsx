import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { API_BASE_URL } from "../api/client";

const SocketContext = createContext<Socket | null>(null);

// One socket per logged-in session, authenticated by the same httpOnly
// session cookie as REST calls (docs/architecture.md §5) — the browser
// attaches it automatically because `withCredentials` is set, no token to
// manage on the client.
export function SocketProvider({ children }: { children: ReactNode }) {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
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

    // The server force-disconnects every open socket for a user the
    // instant a report pushes them over the dormant threshold (see
    // backend src/socket/index.ts subscribing to the "user:dormant" event
    // — docs/architecture.md §5 "즉시 무효화 보강"). Socket.IO reports that
    // specific case as reason "io server disconnect"; anything else (network
    // blip, tab backgrounded) is a reconnect scenario we don't want to
    // treat as a logout.
    instance.on("disconnect", (reason) => {
      if (reason === "io server disconnect") {
        refreshUser().finally(() => navigate("/login", { replace: true }));
      }
    });

    socketRef.current = instance;
    setSocket(instance);

    return () => {
      instance.disconnect();
      socketRef.current = null;
    };
  }, [user, refreshUser, navigate]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export function useSocket(): Socket | null {
  return useContext(SocketContext);
}
