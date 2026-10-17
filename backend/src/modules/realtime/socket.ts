import http from "node:http";
import { Server } from "socket.io";
import { env } from "../../config/env";
import { logger } from "../../shared/logger";
import { AuthContext, SessionContext } from "../auth/auth.types";
import { isCompanyBlocked } from "../companies/companyStatus";
import { verifyAccessToken } from "../auth/tokens";
import { loadAgentScope, watchesAllTickets } from "../tickets/visibility";
import { userQueueIds } from "../users/userQueues";

export const rooms = {
  company: (id: number) => `company:${id}`,
  supervisors: (companyId: number) => `company:${companyId}:supervisors`,
  /** Atendentes com permissão de ver chamados além das suas filas (recebem todo ticket:update). */
  ticketWatchers: (companyId: number) => `company:${companyId}:ticket-watchers`,
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

  io.use(async (socket, next) => {
    let auth: SessionContext;
    try {
      auth = verifyAccessToken(String(socket.handshake.auth?.token ?? ""));
    } catch {
      return next(new Error("UNAUTHENTICATED"));
    }
    if (auth.mustChangePassword) return next(new Error("PASSWORD_CHANGE_REQUIRED"));
    try {
      if (auth.companyId !== null && !auth.superAdmin && (await isCompanyBlocked(auth.companyId))) {
        return next(new Error("COMPANY_BLOCKED"));
      }
    } catch (err) {
      return next(err instanceof Error ? err : new Error(String(err)));
    }
    socket.data.auth = auth;
    next();
  });

  io.on("connection", async (socket) => {
    const session = socket.data.auth as SessionContext;
    try {
      socket.join(rooms.user(session.userId));
      if (session.companyId !== null) {
        socket.join(rooms.company(session.companyId));
        if (session.profile !== "agent") socket.join(rooms.supervisors(session.companyId));
        for (const queueId of await userQueueIds(session.userId)) socket.join(rooms.queue(queueId));
        if (session.profile === "agent" && watchesAllTickets(await loadAgentScope(session as AuthContext))) {
          socket.join(rooms.ticketWatchers(session.companyId));
        }
      }
    } catch (err) {
      logger.error({ err, userId: session.userId }, "socket room setup failed");
      socket.disconnect(true);
      return;
    }
    // Super-admin fora de uma empresa: sem salas de empresa nem de ticket.
    if (session.companyId === null) {
      socket.emit("ready");
      return;
    }
    const auth = session as AuthContext;

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

/** Empresa bloqueada: avisa e derruba os sockets dos usuários dela (o super-admin continua). */
export async function disconnectCompany(companyId: number): Promise<void> {
  if (!io) return;
  const sockets = await io.in(rooms.company(companyId)).fetchSockets();
  for (const socket of sockets) {
    if ((socket.data.auth as SessionContext | undefined)?.superAdmin) continue;
    socket.emit("company:blocked");
    socket.disconnect(true);
  }
}

export async function closeSocket(): Promise<void> {
  if (!io) return;
  const server = io;
  io = null;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
