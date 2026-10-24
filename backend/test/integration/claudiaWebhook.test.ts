import { Job } from "bullmq";
import { env } from "../../src/config/env";
import { ClaudiaWebhookLog, Connection, Ticket, TicketLog } from "../../src/models";
import { applyConnectionUpdate } from "../../src/modules/connections/connections.service";
import { runClaudiaWatch } from "../../src/modules/claudia/claudia.watch";
import {
  claudiaBackoff,
  enqueueGrouped,
  GROUP_JOB,
  ClaudiaPayload,
  isoWithOffset,
  processClaudiaWebhookJob,
  ticketPayload,
} from "../../src/modules/claudia/claudia.webhook";
import { handleInboundEvent } from "../../src/modules/inbound/inbound";
import { clearWebhookCache } from "../../src/modules/inbound/webhook.routes";
import { closeTicketInternal } from "../../src/modules/tickets/tickets.service";
import { parseEvolutionWebhook } from "../../src/modules/whatsapp/evolution/parseWebhook";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { getQueue, QueueNames } from "../../src/queues";
import { resetDb } from "../helpers/db";
import { createConnection, createContact, createMessage, createNode, createTicket, createUser, scenario } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";
import { resetRedis } from "../helpers/redis";
import { imageMessage, textMessage } from "../fixtures/evolution";

const fake = new FakeProvider();
const minutesAgo = (m: number, from = Date.now()) => new Date(from - m * 60_000);

async function deliver(connection: Connection, payload: Record<string, unknown>) {
  for (const event of parseEvolutionWebhook(payload)) {
    await handleInboundEvent({ connectionId: connection.id, event }, { finalAttempt: true });
  }
}

/** Avisos na fila de envio (imediatos e agrupados/atrasados), na ordem em que entraram. */
async function queued(): Promise<{ data: ClaudiaPayload; delay: number; id: string }[]> {
  const jobs = await getQueue(QueueNames.claudiaWebhook).getJobs(["waiting", "delayed", "prioritized"]);
  return jobs
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((j) => ({ data: j.data as ClaudiaPayload, delay: j.opts.delay ?? 0, id: String(j.id) }));
}
const events = async () => (await queued()).map((j) => j.data.evento);

async function setup() {
  const s = await scenario();
  await s.connection.update({ instanceName: "inst_1" });
  const claudia = await createUser(s.company.id, { name: "Claudia", queueIds: [s.queue.id] });
  const tech = await createUser(s.company.id, { name: "Yure", queueIds: [s.queue.id] });
  env.CLAUDIA_WEBHOOK_URL = "https://claudia.test/hook";
  env.CLAUDIA_WEBHOOK_KEY = "Bearer chave-de-teste";
  env.CLAUDIA_COMPANY_ID = s.company.id;
  env.CLAUDIA_USER_ID = claudia.id;
  env.CLAUDIA_WATCH_NUMBERS = "5579988791352";
  return { ...s, claudia, tech };
}

describe("claudia webhook", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    clearWebhookCache();
    fake.reset();
    setProvider(fake);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    env.CLAUDIA_WEBHOOK_URL = undefined;
    env.CLAUDIA_WEBHOOK_KEY = undefined;
    env.CLAUDIA_COMPANY_ID = undefined;
    env.CLAUDIA_USER_ID = undefined;
    env.CLAUDIA_WATCH_NUMBERS = "";
    env.CLAUDIA_WEBHOOK_BODY = "json";
    env.CLAUDIA_WEBHOOK_EXTRA_HEADERS = undefined;
  });
  afterAll(() => setProvider(null));

  it("does nothing when not configured or for another company", async () => {
    const s = await setup();
    env.CLAUDIA_COMPANY_ID = s.company.id + 1000;
    await deliver(s.connection, textMessage({ text: "Oi" }));
    env.CLAUDIA_COMPANY_ID = s.company.id;
    env.CLAUDIA_WEBHOOK_URL = undefined;
    await deliver(s.connection, textMessage({ id: "M2", from: "5511977776666" }));
    expect(await queued()).toEqual([]);
  });

  it("new conversation without bot → conversa_aguardando, with only where to look (no message text)", async () => {
    const s = await setup();
    await deliver(s.connection, textMessage({ from: "5579999999999", pushName: "Maria", text: "meu CPF é 123" }));
    const [job] = await queued();
    const ticket = await Ticket.findOne();
    expect(job.data).toEqual({
      evento: "conversa_aguardando",
      id_evento: expect.stringMatching(/^[0-9a-f-]{36}$/),
      ocorrido_em: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d-03:00$/),
      conversa: ticket!.id,
      telefone: "5579999999999",
      contato: "Maria",
      fila: s.queue.name,
      atendente: null,
      tipo_ultima_mensagem: "texto",
      minutos_sem_aceite: null,
      minutos_sem_resposta: null,
      status: null,
    });
    expect(job.id).toBe(job.data.id_evento);
    expect(JSON.stringify(job.data)).not.toContain("CPF");
  });

  it("bot: invalid answer → bot_parado; transfer by the bot → conversa_aguardando", async () => {
    const s = await setup();
    const root = await createNode(s.connection, { message: "Escolha:" });
    await createNode(s.connection, { parentId: root.id, key: "1", title: "Suporte", action: "transfer_queue", queueId: s.queue.id });

    await deliver(s.connection, textMessage({ id: "A", text: "Oi" }));
    expect(await events()).toEqual([]);
    await deliver(s.connection, imageMessage({ id: "B" }));
    expect(await events()).toEqual(["bot_parado"]);
    expect((await queued())[0].data.tipo_ultima_mensagem).toBe("texto"); // o "Opção inválida" do bot é a última

    await deliver(s.connection, textMessage({ id: "C", text: "1" }));
    expect(await events()).toEqual(["bot_parado", "conversa_aguardando"]);
  });

  it("client message in a conversation with Claudia → mensagem_cliente, grouped to 1 per 60 s", async () => {
    const s = await setup();
    const ticket = await createTicket({
      companyId: s.company.id,
      contactId: s.contact.id,
      connectionId: s.connection.id,
      queueId: s.queue.id,
      status: "open",
      userId: s.claudia.id,
    });
    const from = s.contact.number;
    await deliver(s.connection, textMessage({ id: "1", from }));
    await deliver(s.connection, textMessage({ id: "2", from }));
    await deliver(s.connection, textMessage({ id: "3", from }));

    const jobs = await queued();
    expect(jobs.map((j) => [j.data.evento, j.data.conversa])).toEqual([
      ["mensagem_cliente", ticket.id],
      ["mensagem_cliente", ticket.id],
    ]);
    expect(jobs[0].data.atendente).toBe("Claudia");
    expect(jobs[0].delay).toBe(0);
    expect(jobs[1].delay).toBeGreaterThan(50_000);
    expect(jobs[1].delay).toBeLessThanOrEqual(60_000);
  });

  it("message from a technician's conversation or sent by us → no event", async () => {
    const s = await setup();
    await createTicket({
      companyId: s.company.id,
      contactId: s.contact.id,
      connectionId: s.connection.id,
      status: "open",
      userId: s.tech.id,
    });
    await deliver(s.connection, textMessage({ id: "1", from: s.contact.number, text: "continua" }));
    await deliver(s.connection, textMessage({ id: "2", from: s.contact.number, fromMe: true, text: "resposta" }));
    expect(await queued()).toEqual([]);
  });

  it("watched number (even without the 9th digit) → mensagem_mateus only", async () => {
    const s = await setup();
    await deliver(s.connection, textMessage({ from: "557988791352", text: "oi Claudia" }));
    expect(await events()).toEqual(["mensagem_mateus"]);
  });

  it("first message up to 24 h after closing → mensagem_pos_finalizacao", async () => {
    const s = await setup();
    const old = await createTicket({
      companyId: s.company.id,
      contactId: s.contact.id,
      connectionId: s.connection.id,
      status: "open",
      userId: s.tech.id,
    });
    await closeTicketInternal(old, { userId: s.tech.id, event: "closed", sendClosingMessage: false });
    await deliver(s.connection, textMessage({ id: "1", from: s.contact.number, text: "obrigado" }));
    expect((await events()).sort()).toEqual(["conversa_aguardando", "mensagem_pos_finalizacao"]);
  });

  it("closed more than 24 h ago → no mensagem_pos_finalizacao", async () => {
    const s = await setup();
    await createTicket({
      companyId: s.company.id,
      contactId: s.contact.id,
      connectionId: s.connection.id,
      status: "closed",
      closedAt: minutesAgo(25 * 60),
    });
    await deliver(s.connection, textMessage({ id: "1", from: s.contact.number }));
    expect(await events()).toEqual(["conversa_aguardando"]);
  });

  it("watch: transfer not accepted at 10 and 20 min, once each", async () => {
    const s = await setup();
    const ticket = await createTicket({
      companyId: s.company.id,
      contactId: s.contact.id,
      connectionId: s.connection.id,
      status: "pending",
      userId: s.tech.id,
    });
    const base = Date.now();
    await TicketLog.create({ companyId: s.company.id, ticketId: ticket.id, event: "transferred", toUserId: s.tech.id, createdAt: new Date(base) });
    const at = (m: number) => new Date(base + m * 60_000);

    expect(await runClaudiaWatch(at(9))).toBe(0);
    expect(await runClaudiaWatch(at(10.5))).toBe(1);
    expect(await runClaudiaWatch(at(11))).toBe(0);
    expect(await runClaudiaWatch(at(20.5))).toBe(1);
    expect(await runClaudiaWatch(at(25))).toBe(0);
    const jobs = await queued();
    expect(jobs.map((j) => [j.data.evento, j.data.minutos_sem_aceite, j.data.atendente])).toEqual([
      ["transferencia_sem_aceite", 10, "Yure"],
      ["transferencia_sem_aceite", 20, "Yure"],
    ]);
  });

  it("watch: client silent with Claudia at 15 and 30 min; a client answer restarts", async () => {
    const s = await setup();
    const ticket = await createTicket({
      companyId: s.company.id,
      contactId: s.contact.id,
      connectionId: s.connection.id,
      status: "open",
      userId: s.claudia.id,
    });
    const base = Date.now();
    await createMessage(ticket, { fromMe: false, createdAt: new Date(base - 60_000) });
    await createMessage(ticket, { fromMe: true, body: "pode me mandar o print?", createdAt: new Date(base) });
    const at = (m: number) => new Date(base + m * 60_000);

    expect(await runClaudiaWatch(at(14))).toBe(0);
    expect(await runClaudiaWatch(at(15))).toBe(1);
    expect(await runClaudiaWatch(at(16))).toBe(0);
    expect(await runClaudiaWatch(at(30))).toBe(1);
    expect((await queued()).map((j) => j.data.minutos_sem_resposta)).toEqual([15, 30]);

    await createMessage(ticket, { fromMe: false, createdAt: at(31) });
    expect(await runClaudiaWatch(at(50))).toBe(0); // cliente respondeu: Claudia que deve
  });

  it("watch: bot stuck for 3 min, once per stop; old stops are ignored", async () => {
    const s = await setup();
    const base = Date.now();
    const ticket = await createTicket({
      companyId: s.company.id,
      contactId: s.contact.id,
      connectionId: s.connection.id,
      status: "bot",
      lastMessageAt: new Date(base),
    });
    await createTicket({
      companyId: s.company.id,
      contactId: (await createContact(s.company.id)).id,
      connectionId: s.connection.id,
      status: "bot",
      lastMessageAt: minutesAgo(120, base),
    });
    const at = (m: number) => new Date(base + m * 60_000);
    expect(await runClaudiaWatch(at(2))).toBe(0);
    expect(await runClaudiaWatch(at(3))).toBe(1);
    expect(await runClaudiaWatch(at(5))).toBe(0);
    expect((await queued()).map((j) => [j.data.evento, j.data.conversa])).toEqual([["bot_parado", ticket.id]]);
  });

  it("connection down → conexao fora; back → voltou (only after a fora)", async () => {
    const s = await setup();
    await applyConnectionUpdate(s.connection, "disconnected");
    await applyConnectionUpdate(s.connection, "qrcode");
    await applyConnectionUpdate(s.connection, "connected");
    await applyConnectionUpdate(s.connection, "connected");
    const fresh = await createConnection(s.company.id, { status: "qrcode" });
    await applyConnectionUpdate(fresh, "connected"); // primeira conexão: não houve "fora"
    const jobs = await queued();
    expect(jobs.map((j) => [j.data.evento, j.data.status, j.data.conversa])).toEqual([
      ["conexao", "fora", null],
      ["conexao", "voltou", null],
    ]);
  });

  it("groups per conversation whatever the event: 1 now, the rest in one notice at the end of the 60 s window", async () => {
    const s = await setup();
    const ticket = await createTicket({
      companyId: s.company.id,
      contactId: s.contact.id,
      connectionId: s.connection.id,
      status: "pending",
      userId: s.tech.id,
    });
    const other = await createTicket({
      companyId: s.company.id,
      contactId: (await createContact(s.company.id)).id,
      connectionId: s.connection.id,
    });
    const notice = async (evento: Parameters<typeof ticketPayload>[0], id = ticket.id, extra = {}) =>
      enqueueGrouped((await ticketPayload(evento, id, extra))!);

    await notice("mensagem_pos_finalizacao");
    await notice("bot_parado");
    await notice("transferencia_sem_aceite", ticket.id, { minutos_sem_aceite: 20 });
    await notice("conversa_aguardando"); // menos importante que o escalonamento: não o substitui
    await notice("bot_parado", other.id); // outra conversa: janela própria

    const jobs = await getQueue(QueueNames.claudiaWebhook).getJobs(["waiting", "delayed"]);
    const mine = jobs.filter((j) => j.data.conversa === ticket.id);
    expect(mine.map((j) => [j.name, j.data.evento]).sort()).toEqual([
      [GROUP_JOB, "bot_parado"],
      ["mensagem_pos_finalizacao", "mensagem_pos_finalizacao"],
    ]);
    expect(jobs.filter((j) => j.data.conversa === other.id).map((j) => j.opts.delay ?? 0)).toEqual([0]);

    // Fim da janela: sai um só aviso, com o escalonamento guardado, e ele abre a próxima janela.
    const grouped = mine.find((j) => j.name === GROUP_JOB)!;
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    await processClaudiaWebhookJob(grouped as Job<ClaudiaPayload>);
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]!.body)) as ClaudiaPayload;
    expect(sent).toMatchObject({ evento: "transferencia_sem_aceite", conversa: ticket.id, minutos_sem_aceite: 20 });
    expect((await getQueue(QueueNames.claudiaWebhook).getJob(grouped.id!))!.data.evento).toBe("transferencia_sem_aceite"); // reenvio = mesmo aviso

    await notice("mensagem_cliente");
    const after = await getQueue(QueueNames.claudiaWebhook).getJobs(["waiting", "delayed"]);
    expect(after.filter((j) => j.data.conversa === ticket.id && j.data.evento === "mensagem_cliente").map((j) => j.name)).toEqual([
      GROUP_JOB,
    ]);
  });

  describe("delivery", () => {
    const job = (data: ClaudiaPayload, attemptsMade = 0) =>
      ({ data, attemptsMade, opts: { attempts: 4 } }) as unknown as Job<ClaudiaPayload>;

    it("posts JSON with the key header, logs 2xx", async () => {
      const s = await setup();
      const ticket = await createTicket({ companyId: s.company.id, contactId: s.contact.id, connectionId: s.connection.id });
      const payload = (await ticketPayload("conversa_aguardando", ticket.id))!;
      const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 202 }));
      await processClaudiaWebhookJob(job(payload));

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://claudia.test/hook");
      expect(init!.method).toBe("POST");
      expect(init!.headers).toMatchObject({ Authorization: "Bearer chave-de-teste", "Content-Type": "application/json; charset=utf-8" });
      expect(JSON.parse(String(init!.body))).toEqual(payload);
      const logs = await ClaudiaWebhookLog.findAll();
      expect(logs.map((l) => [l.eventId, l.event, l.ticketId, l.attempt, l.statusCode, l.error])).toEqual([
        [payload.id_evento, "conversa_aguardando", ticket.id, 1, 202, null],
      ]);
    });

    it("error or non-2xx: logs and throws so it is resent with the same id", async () => {
      await setup();
      const payload = { evento: "conexao", id_evento: "abc", conversa: null } as ClaudiaPayload;
      jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("nope", { status: 500 }));
      await expect(processClaudiaWebhookJob(job(payload))).rejects.toThrow("nope");
      jest.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));
      await expect(processClaudiaWebhookJob(job(payload, 3))).rejects.toThrow("timeout");
      const logs = await ClaudiaWebhookLog.findAll({ order: [["id", "ASC"]] });
      expect(logs.map((l) => [l.eventId, l.attempt, l.statusCode, l.error])).toEqual([
        ["abc", 1, 500, "nope"],
        ["abc", 4, null, "timeout"],
      ]);
    });

    it("text body mode wraps the notice and sends extra headers", async () => {
      await setup();
      env.CLAUDIA_WEBHOOK_BODY = "text";
      env.CLAUDIA_WEBHOOK_EXTRA_HEADERS = '{"anthropic-version":"2023-06-01"}';
      const payload = { evento: "conexao", id_evento: "x", status: "fora" } as ClaudiaPayload;
      const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
      await processClaudiaWebhookJob(job(payload));
      const init = fetchMock.mock.calls[0][1]!;
      expect(init.headers).toMatchObject({ "anthropic-version": "2023-06-01" });
      expect(JSON.parse(JSON.parse(String(init.body)).text)).toEqual(payload);
    });

    it("retry delays: 30 s, 2 min, 10 min", () => {
      expect([1, 2, 3].map(claudiaBackoff)).toEqual([30_000, 120_000, 600_000]);
    });
  });

  it("formats ISO time with the timezone offset", () => {
    expect(isoWithOffset(new Date("2026-10-23T19:12:05Z"), "America/Sao_Paulo")).toBe("2026-10-23T16:12:05-03:00");
    expect(isoWithOffset(new Date("2026-10-23T19:12:05Z"), "UTC")).toBe("2026-10-23T19:12:05+00:00");
  });
});
