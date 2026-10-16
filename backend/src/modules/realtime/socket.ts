import http from "node:http";
import { Server } from "socket.io";
import { env } from "../../config/env";
import { logger } from "../../shared/logger";
import { AuthContext } from "../auth/auth.types";
import { verifyAccessToken } from "../auth/tokens";
import { userQueueIds } from "../users/userQueues";

export const rooms = {
  company: (id: number) => `company:${id}`,
  supervisors: (companyId: number) => `company:${companyId}:supervisors`,
  queue: (id: number) => `queue:${id}`,
  user: (id: number) => `user:${id}`,
  ticket: (id: number) => `ticket:${id}`,
};

export interface SocketDeps {
  canJoinTicket(auth: AuthContext, ticketId: number): Promise<boolean>;
}

let io: Server | null = null;

export function initSocket(server: http.Server, deps: SocketDeps): Server {
  io = new Server(server, { cors: { origin: env.FRONTEND_URL } });

  io.use((socket, next) => {
    try {
      const auth = verifyAccessToken(String(socket.handshake.auth?.token ?? ""));
      if (auth.mustChangePassword) return next(new Error("PASSWORD_CHANGE_REQUIRED"));
      socket.data.auth = auth;
      next();
    } catch {
      next(new Error("UNAUTHENTICATED"));
    }
  });

  io.on("connection", async (socket) => {
    const auth = socket.data.auth as AuthContext;
    try {
      socket.join(rooms.company(auth.companyId));
      socket.join(rooms.user(auth.userId));
      if (auth.profile !== "agent") socket.join(rooms.supervisors(auth.companyId));
      for (const queueId of await userQueueIds(auth.userId)) socket.join(rooms.queue(queueId));
    } catch (err) {
      logger.error({ err, userId: auth.userId }, "socket room setup failed");
      socket.disconnect(true);
      return;
    }

    socket.on("ticket:join", async (ticketId: unknown, ack?: (ok: boolean) => void) => {
      const id = Number(ticketId);
      let ok = false;
      if (Number.isInteger(id) && id > 0) {
        try {
          ok = await deps.canJoinTicket(auth, id);
        } catch (err) {
          logger.warn({ err, userId: auth.userId, ticketId: id }, "socket ticket:join check failed");
        }
      }
      if (ok) socket.join(rooms.ticket(id));
      if (typeof ack === "function") ack(ok);
    });

    socket.on("ticket:leave", (ticketId: unknown) => {
      socket.leave(rooms.ticket(Number(ticketId)));
    });

    socket.emit("ready");
  });

  return io;
}

export const emitter = {
  toRooms(targets: string[], event: string, payload: unknown): void {
    if (io && targets.length) io.to(targets).emit(event, payload);
  },
  toCompany(companyId: number, event: string, payload: unknown): void {
    emitter.toRooms([rooms.company(companyId)], event, payload);
  },
  toSupervisors(companyId: number, event: string, payload: unknown): void {
    emitter.toRooms([rooms.supervisors(companyId)], event, payload);
  },
};

export async function closeSocket(): Promise<void> {
  if (!io) return;
  const server = io;
  io = null;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
