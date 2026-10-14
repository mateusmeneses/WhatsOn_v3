import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Socket } from "socket.io-client";
import { refreshAccessToken } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { createSocket } from "./socket";

interface RealtimeValue {
  socket: Socket | null;
  epoch: number;
}

export const RealtimeContext = createContext<RealtimeValue>({ socket: null, epoch: 0 });

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [value, setValue] = useState<RealtimeValue>({ socket: null, epoch: 0 });
  const hadReady = useRef(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const hasToken = Boolean(token);

  useEffect(() => {
    if (!hasToken) return;
    hadReady.current = false;
    const socket = createSocket(() => tokenRef.current);

    socket.on("ready", () => {
      if (hadReady.current) void queryClient.invalidateQueries();
      hadReady.current = true;
      setValue((prev) => ({ socket, epoch: prev.epoch + 1 }));
    });

    socket.on("connect_error", (err: Error) => {
      if (err.message === "UNAUTHENTICATED") {
        void refreshAccessToken().then((newToken) => {
          if (newToken && !socket.connected) socket.connect();
        });
      }
    });

    return () => {
      socket.disconnect();
      setValue({ socket: null, epoch: 0 });
    };
  }, [hasToken, queryClient]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useSocket(): Socket | null {
  return useContext(RealtimeContext).socket;
}

export function useRealtimeEvent<T>(event: string, handler: (payload: T) => void): void {
  const socket = useSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!socket) return;
    const listener = (payload: T) => handlerRef.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [socket, event]);
}

/** Entra na sala do ticket (e reentra a cada reconexão) para receber eventos de mensagem. */
export function useTicketRoom(ticketId: number | null): void {
  const { socket, epoch } = useContext(RealtimeContext);
  useEffect(() => {
    if (!socket || ticketId === null) return;
    socket.emit("ticket:join", ticketId, () => undefined);
    return () => {
      socket.emit("ticket:leave", ticketId);
    };
  }, [socket, epoch, ticketId]);
}
