import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Socket } from "socket.io-client";
import { refreshAccessToken } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { createSocket } from "./socket";

interface RealtimeValue {
  socket: Socket | null;
  epoch: number;
  /** true depois de `ready`; false após `disconnect`/`connect_error` até o próximo `ready`. */
  connected: boolean;
}

export const RealtimeContext = createContext<RealtimeValue>({ socket: null, epoch: 0, connected: false });

/** Espera entre tentativas de reconexão manual (o socket.io desiste sozinho quando o servidor recusa a conexão). */
export const RECONNECT_DELAYS = [2_000, 5_000, 10_000, 30_000];

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [value, setValue] = useState<RealtimeValue>({ socket: null, epoch: 0, connected: false });
  const hadReady = useRef(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const hasToken = Boolean(token);

  useEffect(() => {
    if (!hasToken) return;
    hadReady.current = false;
    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const socket = createSocket(() => tokenRef.current);

    const canConnect = () => !disposed && Boolean(useAuth.getState().user) && !socket.connected;
    const markDisconnected = () => {
      if (!disposed) setValue((prev) => (prev.connected ? { ...prev, connected: false } : prev));
    };
    /** Agenda uma nova tentativa quando o socket.io não vai reconectar sozinho (socket inativo). */
    const scheduleRetry = () => {
      if (disposed || socket.active || retryTimer !== undefined) return;
      const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)]!;
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (canConnect()) socket.connect();
      }, delay);
    };

    socket.on("ready", () => {
      if (disposed) return;
      if (hadReady.current) void queryClient.invalidateQueries();
      hadReady.current = true;
      attempt = 0;
      setValue((prev) => ({ socket, epoch: prev.epoch + 1, connected: true }));
    });

    socket.on("disconnect", () => {
      markDisconnected();
      scheduleRetry();
    });

    socket.on("connect_error", (err: Error) => {
      markDisconnected();
      if (disposed || socket.active) return;
      if (err.message === "UNAUTHENTICATED") {
        void refreshAccessToken().then((newToken) => {
          // Reconecta na hora só na primeira recusa; depois segue o backoff (evita laço se o servidor seguir recusando).
          if (newToken && attempt === 0 && canConnect()) {
            attempt = 1;
            socket.connect();
          } else {
            scheduleRetry();
          }
        });
      } else {
        scheduleRetry();
      }
    });

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      socket.disconnect();
      setValue({ socket: null, epoch: 0, connected: false });
    };
  }, [hasToken, queryClient]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

/** true quando o socket já esteve pronto e caiu (para o aviso de reconexão). */
export function useRealtimeReconnecting(): boolean {
  const { epoch, connected } = useContext(RealtimeContext);
  return epoch > 0 && !connected;
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
