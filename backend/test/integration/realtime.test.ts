import http from "node:http";
import { AddressInfo } from "node:net";
import { io as ioc, Socket } from "socket.io-client";
import { closeSocket, emitter, initSocket, rooms } from "../../src/modules/realtime/socket";
import { emitTicket } from "../../src/modules/tickets/ticket.events";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createQueue, createTicket, createUser, scenario } from "../helpers/factories";

let server: http.Server;
let port: number;
const clients: Socket[] = [];

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = ioc(`http://localhost:${port}`, { auth: { token }, transports: ["websocket"], forceNew: true });
    clients.push(socket);
    socket.once("ready", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function nextEvent<T = unknown>(socket: Socket, event: string, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sem evento ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function noEvent(socket: Socket, event: string, waitMs = 300): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = () => reject(new Error(`evento inesperado ${event}`));
    socket.once(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, waitMs);
  });
}

describe("realtime", () => {
  beforeEach(async () => {
    await resetDb();
    server = http.createServer();
    initSocket(server, { canJoinTicket: async (_auth, ticketId) => ticketId !== 999 });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    clients.splice(0).forEach((c) => c.disconnect());
    await closeSocket();
  });

  it("rejects connections without a valid token", async () => {
    await expect(connect("invalido")).rejects.toThrow("UNAUTHENTICATED");
  });

  it("delivers company broadcasts", async () => {
    const { company } = await scenario();
    const agent = await createUser(company.id);
    const socket = await connect(bearer(agent).slice(7));
    const received = nextEvent(socket, "ping:test");
    emitter.toCompany(company.id, "ping:test", { ok: true });
    await expect(received).resolves.toEqual({ ok: true });
  });

  it("routes ticket updates to supervisors and to the ticket's queue only", async () => {
    const { company, connection, contact } = await scenario();
    const queueA = await createQueue(company.id);
    const queueB = await createQueue(company.id);
    const supervisor = await createUser(company.id, { profile: "supervisor" });
    const agentA = await createUser(company.id, { queueIds: [queueA.id] });
    const agentB = await createUser(company.id, { queueIds: [queueB.id] });
    const [sSup, sA, sB] = await Promise.all([supervisor, agentA, agentB].map((u) => connect(bearer(u).slice(7))));

    const ticket = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, queueId: queueA.id });
    const supGot = nextEvent<{ id: number; contact: { id: number } }>(sSup, "ticket:update");
    const aGot = nextEvent(sA, "ticket:update");
    const bSilent = noEvent(sB, "ticket:update");
    await emitTicket(ticket.id);
    const payload = await supGot;
    expect(payload.id).toBe(ticket.id);
    expect(payload.contact.id).toBe(contact.id);
    await aGot;
    await bSilent;

    await ticket.update({ queueId: queueB.id });
    const aOld = nextEvent(sA, "ticket:update");
    const bNew = nextEvent(sB, "ticket:update");
    await emitTicket(ticket.id, { queueId: queueA.id, userId: null });
    await Promise.all([aOld, bNew]);
  });

  it("joins ticket rooms only when allowed", async () => {
    const { company } = await scenario();
    const agent = await createUser(company.id);
    const socket = await connect(bearer(agent).slice(7));

    const okAck = await new Promise((resolve) => socket.emit("ticket:join", 5, resolve));
    expect(okAck).toBe(true);
    const got = nextEvent(socket, "message:new");
    emitter.toRooms([rooms.ticket(5)], "message:new", { id: 1 });
    await expect(got).resolves.toEqual({ id: 1 });

    const deniedAck = await new Promise((resolve) => socket.emit("ticket:join", 999, resolve));
    expect(deniedAck).toBe(false);
    const silent = noEvent(socket, "message:new");
    emitter.toRooms([rooms.ticket(999)], "message:new", { id: 2 });
    await silent;
  });
});
