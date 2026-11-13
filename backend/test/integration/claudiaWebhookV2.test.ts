import { createHmac } from "crypto";
import { Job } from "bullmq";
import request from "supertest";
import { createApp } from "../../src/app";
import { env } from "../../src/config/env";
import { ClaudiaEventLog, Connection, Ticket, TicketLog } from "../../src/models";
import { applyConnectionUpdate } from "../../src/modules/connections/connections.service";
import { onlyReaction } from "../../src/modules/claudia/claudia.v2";
import { runClaudiaWatch } from "../../src/modules/claudia/claudia.watch";
import { ClaudiaPayload, LOTE_JOB, processClaudiaWebhookJob, ticketPayload, enqueueGrouped } from "../../src/modules/claudia/claudia.webhook";
import { handleInboundEvent } from "../../src/modules/inbound/inbound";
import { clearWebhookCache } from "../../src/modules/inbound/webhook.routes";
import { closeTicketInternal } from "../../src/modules/tickets/tickets.service";
import { parseEvolutionWebhook } from "../../src/modules/whatsapp/evolution/parseWebhook";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { getQueue, QueueNames } from "../../src/queues";
import { getRedis } from "../../src/shared/redis";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createContact, createQueue, createTicket, createUser, scenario } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";
import { resetRedis } from "../helpers/redis";
import { textMessage } from "../fixtures/evolution";

const fake = new FakeProvider();
const app = createApp();
const SECRET = "segredo-hmac-de-teste-123";
const API_TOKEN = "a".repeat(64);

async function deliver(connection: Connection, payload: Record<string, unknown>) {
  for (const event of parseEvolutionWebhook(payload)) {
    await handleInboundEvent({ connectionId: connection.id, event }, { finalAttempt: true });
  }
}

async function jobs(): Promise<Job<ClaudiaPayload>[]> {
  const list = await getQueue(QueueNames.claudiaWebhook).getJobs(["waiting", "delayed", "prioritized"]);
  return list.sort((a, b) => a.timestamp - b.timestamp) as Job<ClaudiaPayload>[];
}

/** Processa o job como o worker (tentativa `attemptsMade + 1`) e devolve o que foi enviado. */
async function send(job: Job<ClaudiaPayload>, attemptsMade = 0) {
  const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
  job.attemptsMade = attemptsMade;
  await processClaudiaWebhookJob(job);
  const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  fetchMock.mockRestore();
  return { body: JSON.parse(String(init!.body)) as Record<string, any>, raw: String(init!.body), headers: init!.headers as Record<string, string> };
}

async function setup() {
  const s = await scenario();
  await s.connection.update({ instanceName: "inst_1", apiToken: API_TOKEN });
  const claudia = await createUser(s.company.id, { name: "Claudia", queueIds: [s.queue.id] });
  const tech = await createUser(s.company.id, { name: "Yure", queueIds: [s.queue.id] });
  env.CLAUDIA_WEBHOOK_URL = "https://claudia.test/hook";
  env.CLAUDIA_WEBHOOK_KEY = "Bearer chave-de-teste";
  env.CLAUDIA_COMPANY_ID = s.company.id;
  env.CLAUDIA_USER_ID = claudia.id;
  env.CLAUDIA_WATCH_NUMBERS = "5579988791352";
  env.CLAUDIA_WEBHOOK_FORMATO = "v2";
  env.CLAUDIA_WEBHOOK_SECRET = SECRET;
  env.CLAUDIA_AMBIENTE = "homologacao";
  return { ...s, claudia, tech };
}

describe("claudia webhook v2", () => {
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
    env.CLAUDIA_WEBHOOK_FORMATO = "v1";
    env.CLAUDIA_WEBHOOK_SECRET = undefined;
    env.CLAUDIA_WEBHOOK_INCLUIR_TEXTO = "false";
    env.CLAUDIA_CONEXAO_MINUTOS = 10;
    env.CLAUDIA_AMBIENTE = "producao";
  });
  afterAll(() => setProvider(null));

  it("full payload, signed; resends keep the body and bump tentativa", async () => {
    const s = await setup();
    await s.contact.update({ clientCompany: "Padaria Exemplo", product: "Novo Multicomércio (Nuvem)", number: "5579999991133" });
    await deliver(s.connection, textMessage({ from: "5579999991133", pushName: "Maria", text: "meu CPF é 123" }));
    const [job] = await jobs();
    const first = await send(job);

    expect(first.body).toEqual({
      evento: "conversa_aguardando",
      id_evento: job.data.id_evento,
      tentativa: 1,
      ocorrido_em: expect.stringMatching(/-03:00$/),
      ambiente: "homologacao",
      eventos: ["conversa_aguardando"],
      conversa: {
        id: job.data.conversa,
        status: "aguardando",
        fila: s.queue.name,
        menu_escolhido: [],
        atendente: null,
        aguardando_desde: expect.stringMatching(/-03:00$/),
      },
      contato: { nome: s.contact.name, telefone_final: "1133", cadastrado: true, automatico: false },
      empresa: { nome: "Padaria Exemplo", contrato: null, software: "Novo Multicomércio (Nuvem)" },
      mensagens_recentes: [
        { id: expect.any(Number), em: expect.stringMatching(/-03:00$/), origem: "cliente", tipo: "texto", texto: null, anexos: 0, anexo: null },
      ],
      faixa_horario: "tecnicos",
      minutos_sem_aceite: null,
      minutos_sem_resposta: null,
      status: null,
      apenas_reacao: null,
      ultima_mensagem_origem: "cliente",
      observacoes_resumo: null,
      atendentes_online: expect.arrayContaining([{ id: s.tech.id, nome: "Yure", online: false, visto_em: null }]),
      conversas: null,
    });
    expect(first.body.atendentes_online.map((a: { id: number }) => a.id)).not.toContain(s.claudia.id);
    expect(first.raw).not.toContain("CPF");
    expect(first.headers["X-WhatsOn-Assinatura"]).toBe(`sha256=${createHmac("sha256", SECRET).update(first.raw).digest("hex")}`);
    expect(Number(first.headers["X-WhatsOn-Timestamp"])).toBeCloseTo(Date.now() / 1000, -1);

    // Mensagem nova antes do reenvio não muda o aviso: mesmo corpo, só a tentativa.
    await deliver(s.connection, textMessage({ id: "M2", from: "5579999991133", text: "alô" }));
    const retry = await send(job, 1);
    expect(retry.body).toEqual({ ...first.body, tentativa: 2 });
  });

  it("includes message text only when configured", async () => {
    const s = await setup();
    env.CLAUDIA_WEBHOOK_INCLUIR_TEXTO = "true";
    await deliver(s.connection, textMessage({ from: s.contact.number, text: "Como emito NF?" }));
    const { body } = await send((await jobs())[0]);
    expect(body.mensagens_recentes.map((m: { texto: string }) => m.texto)).toEqual(["Como emito NF?"]);
  });

  it("same message → one notice with every event; post-close thanks → apenas_reacao", async () => {
    const s = await setup();
    const old = await createTicket({ companyId: s.company.id, contactId: s.contact.id, connectionId: s.connection.id, status: "open", userId: s.tech.id });
    await closeTicketInternal(old, { userId: s.tech.id, event: "closed", sendClosingMessage: false });
    await deliver(s.connection, textMessage({ from: s.contact.number, text: "Obrigado!! 👍🏻" }));

    const queued = await jobs();
    expect(queued).toHaveLength(1);
    const { body } = await send(queued[0]);
    expect(body.evento).toBe("conversa_aguardando");
    expect(body.eventos).toEqual(["conversa_aguardando", "mensagem_pos_finalizacao"]);
    expect(body.apenas_reacao).toBe(true);
  });

  it("unassigned waiting conversation: mensagem_cliente, but not right after its conversa_aguardando", async () => {
    const s = await setup();
    await deliver(s.connection, textMessage({ id: "1", from: s.contact.number }));
    await deliver(s.connection, textMessage({ id: "2", from: s.contact.number }));
    expect((await jobs()).map((j) => j.data.evento)).toEqual(["conversa_aguardando"]);

    await getRedis().del(`claudia:aguardando:${(await jobs())[0].data.conversa}`); // passou a janela
    await deliver(s.connection, textMessage({ id: "3", from: s.contact.number }));
    expect((await jobs()).map((j) => j.data.evento)).toEqual(["conversa_aguardando", "mensagem_cliente"]);
  });

  it("robot contact → no notice at all (also in v1)", async () => {
    const s = await setup();
    await s.contact.update({ isRobot: true });
    await deliver(s.connection, textMessage({ id: "1", from: s.contact.number, text: "Cardápio do dia" }));
    env.CLAUDIA_WEBHOOK_FORMATO = "v1";
    await deliver(s.connection, textMessage({ id: "2", from: s.contact.number, text: "4" }));
    const ticket = (await Ticket.findOne({ where: { contactId: s.contact.id } }))!;
    await ticket.update({ status: "bot", lastMessageAt: new Date(Date.now() - 4 * 60_000) });
    expect(await runClaudiaWatch()).toBe(0);
    expect(await ticketPayload("bot_parado", ticket.id)).toBeNull();
    expect(await jobs()).toEqual([]);
  });

  it("watched number → mensagem_numero_especial; connection → conexao_prolongada after N min", async () => {
    const s = await setup();
    env.CLAUDIA_CONEXAO_MINUTOS = 7;
    await deliver(s.connection, textMessage({ from: "557988791352", text: "oi" }));
    await applyConnectionUpdate(s.connection, "disconnected");
    const [special, down] = await jobs();
    expect((await send(special)).body.evento).toBe("mensagem_numero_especial");
    expect(down.opts.delay).toBe(7 * 60_000);
    const sent = (await send(down)).body;
    expect(sent).toMatchObject({ evento: "conexao_prolongada", eventos: ["conexao_prolongada"], status: "fora", conversa: null });
  });

  it("burst: more than 5 notices in 30 s → the extra ones go in a single lote", async () => {
    const s = await setup();
    const ids: number[] = [];
    for (let i = 0; i < 7; i++) {
      const contact = await createContact(s.company.id);
      const t = await createTicket({ companyId: s.company.id, contactId: contact.id, connectionId: s.connection.id });
      ids.push(t.id);
      await enqueueGrouped((await ticketPayload("conversa_aguardando", t.id))!);
    }
    const queued = await jobs();
    expect(queued.filter((j) => j.name !== LOTE_JOB)).toHaveLength(5);
    const lote = queued.filter((j) => j.name === LOTE_JOB);
    expect(lote).toHaveLength(1);
    expect(lote[0].opts.delay).toBeGreaterThan(25_000);

    const { body } = await send(lote[0]);
    expect(body).toMatchObject({
      evento: "lote",
      conversas: [
        { id: ids[5], evento: "conversa_aguardando" },
        { id: ids[6], evento: "conversa_aguardando" },
      ],
    });
  });

  it("transfer marks count only queue working hours", async () => {
    const s = await setup();
    // Quinta-feira; expediente 8–12 e 14–17:30.
    const queue = await createQueue(s.company.id, { schedule: { "4": ["08:00-12:00", "14:00-17:30"] } });
    const ticket = await createTicket({ companyId: s.company.id, contactId: s.contact.id, connectionId: s.connection.id, queueId: queue.id, status: "pending", userId: s.tech.id });
    const base = new Date("2026-11-12T11:55:00-03:00");
    await TicketLog.create({ companyId: s.company.id, ticketId: ticket.id, event: "transferred", toUserId: s.tech.id, createdAt: base });

    expect(await runClaudiaWatch(new Date("2026-11-12T12:30:00-03:00"))).toBe(0); // 5 min de expediente
    expect(await runClaudiaWatch(new Date("2026-11-12T14:05:30-03:00"))).toBe(1); // 10
    expect(await runClaudiaWatch(new Date("2026-11-12T14:15:30-03:00"))).toBe(1); // 20
    expect((await jobs()).map((j) => j.data.minutos_sem_aceite)).toEqual([10, 20]);
  });

  it("GET /api/v1/webhook/eventos lists sent notices with cursor; only for Claudia's company", async () => {
    const s = await setup();
    for (const id of ["1", "2", "3"]) {
      const contact = await createContact(s.company.id);
      await deliver(s.connection, textMessage({ id, from: contact.number }));
    }
    const queued = await jobs();
    for (const j of queued.slice(0, 2)) await send(j);
    jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("down", { status: 503 }));
    await expect(processClaudiaWebhookJob(queued[2])).rejects.toThrow();
    expect(await ClaudiaEventLog.count()).toBe(3);

    const page1 = await request(app).get("/api/v1/webhook/eventos?limite=2").set("Authorization", `Bearer ${API_TOKEN}`);
    expect(page1.status).toBe(200);
    expect(page1.body.eventos.map((e: { aviso: { evento: string }; entregue: boolean }) => [e.aviso.evento, e.entregue])).toEqual([
      ["conversa_aguardando", true],
      ["conversa_aguardando", true],
    ]);
    expect(page1.body.eventos[0].aviso).not.toHaveProperty("tentativa");
    const page2 = await request(app)
      .get(`/api/v1/webhook/eventos?limite=2&apos_id=${page1.body.proximo_apos_id}`)
      .set("Authorization", `Bearer ${API_TOKEN}`);
    expect(page2.body.eventos.map((e: { entregue: boolean }) => e.entregue)).toEqual([false]);
    expect(page2.body.proximo_apos_id).toBeNull();

    env.CLAUDIA_COMPANY_ID = s.company.id + 1000;
    const other = await request(app).get("/api/v1/webhook/eventos").set("Authorization", `Bearer ${API_TOKEN}`);
    expect(other.status).toBe(404);
  });

  it("transfer to Claudia → transferida_para_claudia right away", async () => {
    const s = await setup();
    const admin = await createUser(s.company.id, { profile: "admin" });
    const ticket = await createTicket({ companyId: s.company.id, contactId: s.contact.id, connectionId: s.connection.id, queueId: s.queue.id, status: "open", userId: s.tech.id });
    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/transfer`)
      .set("Authorization", bearer(admin))
      .send({ userId: s.claudia.id });
    expect(res.status).toBe(200);
    const [job] = await jobs();
    expect(job.data).toMatchObject({ evento: "transferida_para_claudia", conversa: ticket.id, atendente: "Claudia" });
    expect(job.opts.delay ?? 0).toBe(0);

    await request(app).post(`/api/tickets/${ticket.id}/transfer`).set("Authorization", bearer(admin)).send({ userId: s.tech.id });
    expect(await jobs()).toHaveLength(1); // para outro técnico: nada
  });

  describe("economy mode", () => {
    beforeEach(() => {
      env.CLAUDIA_WEBHOOK_MODO = "economico";
    });
    afterEach(() => {
      env.CLAUDIA_WEBHOOK_MODO = "completo";
      env.CLAUDIA_PRODUTOS = "multicomercio";
    });

    it("only conversations with Claudia or of contacts whose product she handles", async () => {
      const s = await setup();
      const other = await createContact(s.company.id, { product: "Simples Comércio" });
      const multi = await createContact(s.company.id, { product: "Novo MULTICOMÉRCIO (Nuvem)" });
      await deliver(s.connection, textMessage({ id: "1", from: other.number }));
      await deliver(s.connection, textMessage({ id: "2", from: s.contact.number })); // sem produto
      await deliver(s.connection, textMessage({ id: "3", from: "557988791352" })); // número vigiado também não
      expect(await jobs()).toEqual([]);

      await deliver(s.connection, textMessage({ id: "4", from: multi.number }));
      const withClaudia = await createTicket({
        companyId: s.company.id,
        contactId: (await createContact(s.company.id)).id,
        connectionId: s.connection.id,
        status: "open",
        userId: s.claudia.id,
      });
      await enqueueGrouped((await ticketPayload("mensagem_cliente", withClaudia.id))!);
      expect((await jobs()).map((j) => [j.data.evento, j.data.telefone])).toEqual([
        ["conversa_aguardando", multi.number],
        ["mensagem_cliente", expect.any(String)],
      ]);
    });

    it("no connection notices", async () => {
      const s = await setup();
      await applyConnectionUpdate(s.connection, "disconnected");
      expect(await jobs()).toEqual([]);
    });
  });

  it("onlyReaction: stickers, emojis and short thanks", () => {
    const m = (body: string, type = "text") => onlyReaction({ body, type } as never);
    expect(m("👍")).toBe(true);
    expect(m("Obrigada, valeu!")).toBe(true);
    expect(m("ok ❤️")).toBe(true);
    expect(m("", "sticker")).toBe(true);
    expect(m("obrigado, mas não funcionou")).toBe(false);
    expect(m("4")).toBe(false);
    expect(m("", "image")).toBe(false);
  });
});
