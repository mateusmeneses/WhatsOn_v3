import { Job } from "bullmq";
import request from "supertest";
import { createApp } from "../../src/app";
import { env } from "../../src/config/env";
import { Connection, Message, Ticket, TicketLog } from "../../src/models";
import { CONNECTION_ALERT_JOB } from "../../src/modules/claudia/claudia.alerts";
import { runClaudiaWatch } from "../../src/modules/claudia/claudia.watch";
import { ClaudiaPayload, enqueueGrouped, processClaudiaWebhookJob, ticketPayload } from "../../src/modules/claudia/claudia.webhook";
import { applyConnectionUpdate } from "../../src/modules/connections/connections.service";
import { handleInboundEvent } from "../../src/modules/inbound/inbound";
import { clearWebhookCache } from "../../src/modules/inbound/webhook.routes";
import * as socket from "../../src/modules/realtime/socket";
import { closeTicketInternal } from "../../src/modules/tickets/tickets.service";
import { parseEvolutionWebhook } from "../../src/modules/whatsapp/evolution/parseWebhook";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { getQueue, QueueNames } from "../../src/queues";
import { resetDb } from "../helpers/db";
import { createConnection, createContact, createMessage, createQueue, createTicket, createUser, scenario } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";
import { resetRedis } from "../helpers/redis";
import { textMessage } from "../fixtures/evolution";

const fake = new FakeProvider();
const app = createApp();
const API_TOKEN = "b".repeat(64);

async function deliver(connection: Connection, payload: Record<string, unknown>) {
  for (const event of parseEvolutionWebhook(payload)) {
    await handleInboundEvent({ connectionId: connection.id, event }, { finalAttempt: true });
  }
}

async function jobs(): Promise<Job<ClaudiaPayload>[]> {
  const list = await getQueue(QueueNames.claudiaWebhook).getJobs(["waiting", "delayed", "prioritized"]);
  return list.sort((a, b) => a.timestamp - b.timestamp) as Job<ClaudiaPayload>[];
}

const setOnline = (...ids: number[]) =>
  jest.spyOn(socket, "onlineUsers").mockResolvedValue(ids.map((userId) => ({ userId, connectedSince: Date.now(), connections: 1 })));

async function setup() {
  const s = await scenario();
  await s.connection.update({ instanceName: "inst_1", apiToken: API_TOKEN, status: "connected" });
  const claudia = await createUser(s.company.id, { name: "Claudia", queueIds: [s.queue.id], profile: "supervisor" });
  const yure = await createUser(s.company.id, { name: "Yure", queueIds: [s.queue.id] });
  const mateus = await createUser(s.company.id, { name: "Mateus Meneses", queueIds: [s.queue.id] });
  env.CLAUDIA_WEBHOOK_URL = "https://claudia.test/hook";
  env.CLAUDIA_WEBHOOK_KEY = "Bearer chave";
  env.CLAUDIA_COMPANY_ID = s.company.id;
  env.CLAUDIA_USER_ID = claudia.id;
  env.CLAUDIA_WEBHOOK_FORMATO = "v2";
  return { ...s, claudia, yure, mateus };
}

const ENV_DEFAULTS = {
  CLAUDIA_WEBHOOK_FORMATO: "v1",
  CLAUDIA_WEBHOOK_MODO: "completo",
  CLAUDIA_AUTO_REACAO: "false",
  CLAUDIA_AUTO_INATIVIDADE: "false",
  CLAUDIA_AUTO_FORA_HORARIO: "false",
  CLAUDIA_TEXTO_FORA_HORARIO: undefined,
  CLAUDIA_TEXTO_INATIVIDADE: undefined,
  ALERTA_CONEXAO_DESTINOS: "",
  ALERTA_SEM_ACEITE_DESTINOS: "",
  CLAUDIA_ALERTA_TECNICOS: "",
  CLAUDIA_AGRUPAR_SEGUNDOS_AGUARDANDO: 120,
} as const;

describe("claudia: melhorias do modo econômico", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    clearWebhookCache();
    fake.reset();
    setProvider(fake);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    Object.assign(env, ENV_DEFAULTS, {
      CLAUDIA_WEBHOOK_URL: undefined,
      CLAUDIA_WEBHOOK_KEY: undefined,
      CLAUDIA_COMPANY_ID: undefined,
      CLAUDIA_USER_ID: undefined,
    });
  });
  afterAll(() => setProvider(null));

  describe("API de ações (como o usuário Claudia)", () => {
    const api = (method: "get" | "post", path: string) =>
      request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${API_TOKEN}`);

    it("accepts, replies (signed), appends notes, reads history and closes without message", async () => {
      const s = await setup();
      const ticket = await createTicket({ companyId: s.company.id, contactId: s.contact.id, connectionId: s.connection.id, queueId: s.queue.id });
      await createMessage(ticket, { fromMe: false, body: "Como emito NF?" });

      const accepted = await api("post", `/conversas/${ticket.id}/aceitar`);
      expect(accepted.status).toBe(200);
      expect(accepted.body.conversa).toMatchObject({ id: ticket.id, status: "atendendo", atendente: { id: s.claudia.id, nome: "Claudia" } });

      const sent = await api("post", `/conversas/${ticket.id}/mensagens`).send({ texto: "Bom dia! Vamos lá." });
      expect(sent.status).toBe(201);
      const saved = await Message.findByPk(sent.body.mensagem.id);
      expect(saved).toMatchObject({ sentByUserId: s.claudia.id, body: "*Claudia:*\nBom dia! Vamos lá." });

      await api("post", `/conversas/${ticket.id}/observacoes`).send({ texto: "Cliente quer emitir NF-e." });
      const second = await api("post", `/conversas/${ticket.id}/observacoes`).send({ texto: "Enviado passo a passo." });
      expect(second.body.observacoes.split("\n")).toEqual([
        expect.stringMatching(/^\[\d{4}-\d\d-\d\d \d\d:\d\d\] Claudia: Cliente quer emitir NF-e\.$/),
        expect.stringMatching(/Claudia: Enviado passo a passo\.$/),
      ]);
      expect((await api("get", `/conversas/${ticket.id}/observacoes`)).body.observacoes).toBe(second.body.observacoes);

      const history = await api("get", `/conversas/${ticket.id}/mensagens?limite=5`);
      expect(history.body.mensagens.map((m: { origem: string; texto: string }) => [m.origem, m.texto])).toEqual([
        ["cliente", "Como emito NF?"],
        ["claudia", "*Claudia:*\nBom dia! Vamos lá."],
      ]);

      const closed = await api("post", `/conversas/${ticket.id}/finalizar`).send({ enviar_mensagem: false });
      expect(closed.body.conversa.status).toBe("finalizado");
      expect(await Message.count({ where: { ticketId: ticket.id, isBot: true } })).toBe(0);
      expect(await TicketLog.findOne({ where: { ticketId: ticket.id, event: "closed" } })).toMatchObject({ userId: s.claudia.id });
    });

    it("transfer refuses an offline attendant and reports the final state", async () => {
      const s = await setup();
      const ticket = await createTicket({ companyId: s.company.id, contactId: s.contact.id, connectionId: s.connection.id, queueId: s.queue.id, status: "open", userId: s.claudia.id });
      setOnline(s.mateus.id);

      const offline = await api("post", `/conversas/${ticket.id}/transferir`).send({ usuario_id: s.yure.id });
      expect(offline.status).toBe(409);
      expect(offline.body.error.code).toBe("USUARIO_OFFLINE");
      expect((await Ticket.findByPk(ticket.id))!.userId).toBe(s.claudia.id);

      const ok = await api("post", `/conversas/${ticket.id}/transferir`).send({ usuario_id: s.mateus.id });
      expect(ok.status).toBe(200);
      expect(ok.body.conversa).toMatchObject({ status: "aguardando", atendente: { id: s.mateus.id } });

      const presence = await api("get", "/usuarios/presenca");
      expect(presence.body.atendentes).toEqual(
        expect.arrayContaining([
          { id: s.mateus.id, nome: "Mateus Meneses", online: true },
          { id: s.yure.id, nome: "Yure", online: false, visto_em: null },
        ]),
      );
    });

    it("404 when the token's company is not Claudia's", async () => {
      const s = await setup();
      env.CLAUDIA_COMPANY_ID = s.company.id + 1000;
      expect((await api("get", "/usuarios/presenca")).status).toBe(404);
    });
  });

  it("v2 notice lists who is online", async () => {
    const s = await setup();
    setOnline(s.yure.id);
    await deliver(s.connection, textMessage({ from: s.contact.number, text: "oi" }));
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    await processClaudiaWebhookJob((await jobs())[0]);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]!.body));
    expect(body.atendentes_online).toEqual(expect.arrayContaining([{ id: s.yure.id, nome: "Yure", online: true }]));
  });

  it("auto reaction: 'obrigado' after closing → stays closed, no notice, no bot", async () => {
    const s = await setup();
    env.CLAUDIA_AUTO_REACAO = "true";
    const old = await createTicket({ companyId: s.company.id, contactId: s.contact.id, connectionId: s.connection.id, status: "open", userId: s.yure.id });
    await closeTicketInternal(old, { userId: s.yure.id, event: "closed", sendClosingMessage: false });

    await deliver(s.connection, textMessage({ id: "1", from: s.contact.number, text: "Obrigado! 👍" }));
    const fresh = await Ticket.findOne({ where: { contactId: s.contact.id }, order: [["id", "DESC"]] });
    expect(fresh!.id).not.toBe(old.id);
    expect(fresh!.status).toBe("closed");
    expect(await jobs()).toEqual([]);

    await deliver(s.connection, textMessage({ id: "2", from: s.contact.number, text: "o sistema travou de novo" }));
    expect((await jobs()).map((j) => j.data.evento)).toEqual(["conversa_aguardando"]);
  });

  it("auto out of hours: new conversation gets the hours message once, stays waiting, no notice", async () => {
    const s = await setup();
    env.CLAUDIA_AUTO_FORA_HORARIO = "true";
    env.CLAUDIA_TEXTO_FORA_HORARIO = "Voltamos às 8h.";
    await s.queue.update({ schedule: { "9": [] } as never }); // nenhum dia aberto
    await deliver(s.connection, textMessage({ id: "1", from: s.contact.number }));
    await deliver(s.connection, textMessage({ id: "2", from: s.contact.number }));

    const ticket = (await Ticket.findOne({ where: { contactId: s.contact.id } }))!;
    expect(ticket.status).toBe("pending");
    expect((await Message.findAll({ where: { ticketId: ticket.id, isBot: true } })).map((m) => m.body)).toEqual(["Voltamos às 8h."]);
    expect(await jobs()).toEqual([]);
  });

  it("economy filter also matches the bot menu path", async () => {
    const s = await setup();
    env.CLAUDIA_WEBHOOK_MODO = "economico";
    const ticket = await createTicket({ companyId: s.company.id, contactId: s.contact.id, connectionId: s.connection.id, botPath: "Suporte técnico › Novo Multicomércio" });
    const other = await createTicket({ companyId: s.company.id, contactId: (await createContact(s.company.id)).id, connectionId: s.connection.id, botPath: "Financeiro" });
    expect(await ticketPayload("conversa_aguardando", ticket.id)).not.toBeNull();
    expect(await ticketPayload("conversa_aguardando", other.id)).toBeNull();
  });

  it("waiting conversations without attendant group in a longer window", async () => {
    const s = await setup();
    env.CLAUDIA_AGRUPAR_SEGUNDOS_AGUARDANDO = 180;
    const ticket = await createTicket({ companyId: s.company.id, contactId: s.contact.id, connectionId: s.connection.id });
    await enqueueGrouped((await ticketPayload("mensagem_cliente", ticket.id))!);
    await enqueueGrouped((await ticketPayload("mensagem_cliente", ticket.id))!);
    const [, grouped] = await jobs();
    expect(grouped.opts.delay).toBeGreaterThan(170_000);
    expect(grouped.opts.delay).toBeLessThanOrEqual(180_000);
  });

  it("auto inactivity with Claudia: reminder at 15 min, close at 30, no notice", async () => {
    const s = await setup();
    env.CLAUDIA_AUTO_INATIVIDADE = "true";
    env.CLAUDIA_TEXTO_INATIVIDADE = "Encerramos por falta de resposta.";
    const ticket = await createTicket({ companyId: s.company.id, contactId: s.contact.id, connectionId: s.connection.id, status: "open", userId: s.claudia.id });
    const base = Date.now();
    await createMessage(ticket, { fromMe: false, createdAt: new Date(base - 60_000) });
    await createMessage(ticket, { fromMe: true, sentByUserId: s.claudia.id, body: "Pode mandar o print?", createdAt: new Date(base) });
    const at = (m: number) => new Date(base + m * 60_000);

    expect(await runClaudiaWatch(at(15))).toBe(1);
    expect((await Message.findOne({ where: { ticketId: ticket.id, isBot: true } }))!.body).toBe(env.CLAUDIA_TEXTO_LEMBRETE);
    expect(await runClaudiaWatch(at(30))).toBe(1); // o lembrete não recomeça a contagem
    await ticket.reload();
    expect(ticket.status).toBe("closed");
    expect((await Message.findOne({ where: { ticketId: ticket.id }, order: [["id", "DESC"]] }))!.body).toBe("Encerramos por falta de resposta.");
    expect(await jobs()).toEqual([]);
  });

  it("no-accept alerts go straight to people, only for listed online technicians owing an answer", async () => {
    const s = await setup();
    env.ALERTA_SEM_ACEITE_DESTINOS = "whatsapp:557981384774,email:ignorado@x.com";
    env.CLAUDIA_ALERTA_TECNICOS = String(s.yure.id);
    setOnline(s.yure.id, s.mateus.id);
    const base = Date.now();
    const make = async (userId: number, lastFromClient = true) => {
      const t = await createTicket({ companyId: s.company.id, contactId: (await createContact(s.company.id, { name: `C${userId}${lastFromClient}` })).id, connectionId: s.connection.id, queueId: s.queue.id, status: "pending", userId });
      await createMessage(t, { fromMe: !lastFromClient, createdAt: new Date(base - 60_000) });
      await TicketLog.create({ companyId: s.company.id, ticketId: t.id, event: "transferred", toUserId: userId, createdAt: new Date(base) });
      return t;
    };
    const yureTicket = await make(s.yure.id);
    await make(s.mateus.id); // Mateus (Financeiro) não está na lista
    await make(s.yure.id, false); // cliente não espera resposta

    expect(await runClaudiaWatch(new Date(base + 10.5 * 60_000))).toBe(1);
    expect(fake.sent).toEqual([
      expect.objectContaining({ number: "557981384774", text: expect.stringContaining(`#${yureTicket.id}`) }),
    ]);
    expect(fake.texts()[0]).toContain("Yure e sem aceite há 10 min");
    expect(await jobs()).toEqual([]); // a Claudia não acorda
  });

  it("connection down for long → people alerted directly (even in economy mode); back → alerted again", async () => {
    const s = await setup();
    env.CLAUDIA_WEBHOOK_MODO = "economico";
    env.ALERTA_CONEXAO_DESTINOS = "whatsapp:5579988791352";
    const backup = await createConnection(s.company.id, { status: "connected", instanceName: "inst_backup" });
    await s.connection.update({ name: "Suporte" });

    await applyConnectionUpdate(s.connection, "disconnected");
    const [down] = await jobs();
    expect(down.name).toBe(CONNECTION_ALERT_JOB);
    expect(down.opts.delay).toBe(env.CLAUDIA_CONEXAO_MINUTOS * 60_000);
    await down.promote();
    await processClaudiaWebhookJob(down);
    expect(fake.sent).toEqual([
      expect.objectContaining({ instanceName: backup.instanceName, number: "5579988791352", text: expect.stringContaining('"Suporte" está fora do ar') }),
    ]);

    await applyConnectionUpdate(s.connection, "connected");
    const back = (await jobs()).find((j) => j.name === CONNECTION_ALERT_JOB && j.id !== down.id)!;
    await processClaudiaWebhookJob(back);
    expect(fake.texts()[1]).toContain("voltou a funcionar");
  });

  it("short connection blip → no alert at all", async () => {
    const s = await setup();
    env.ALERTA_CONEXAO_DESTINOS = "whatsapp:5579988791352";
    await applyConnectionUpdate(s.connection, "disconnected");
    await applyConnectionUpdate(s.connection, "connected");
    expect((await jobs()).filter((j) => j.name === CONNECTION_ALERT_JOB)).toEqual([]);
  });
});

