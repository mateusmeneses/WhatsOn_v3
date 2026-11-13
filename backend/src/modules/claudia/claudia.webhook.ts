import { createHmac, randomUUID } from "crypto";
import { Job } from "bullmq";
import { env } from "../../config/env";
import { ClaudiaEventLog, ClaudiaWebhookLog, Contact, Message, MessageType, Queue, Ticket, User } from "../../models";
import { getQueue, QueueNames } from "../../queues";
import { logger } from "../../shared/logger";
import { getRedis } from "../../shared/redis";
import { CONNECTION_ALERT_JOB, ConnectionAlertData, processConnectionAlert } from "./claudia.alerts";
import { buildV2Body } from "./claudia.v2";

export type ClaudiaEvent =
  | "conversa_aguardando"
  | "bot_parado"
  | "mensagem_cliente"
  | "mensagem_pos_finalizacao"
  | "transferencia_sem_aceite"
  | "inatividade_cliente"
  | "mensagem_mateus"
  | "conexao"
  | "transferida_para_claudia"
  | "lote";

/**
 * Aviso como circula na fila (é o corpo do formato v1, seção 4 da especificação de 23/10). Nunca leva texto de
 * mensagem, documentos, valores ou senhas. `eventos` e `conversas` são internos: só o formato v2 os envia.
 */
export interface ClaudiaPayload {
  evento: ClaudiaEvent;
  id_evento: string;
  ocorrido_em: string;
  conversa: number | null;
  telefone: string | null;
  contato: string | null;
  fila: string | null;
  atendente: string | null;
  tipo_ultima_mensagem: string | null;
  minutos_sem_aceite: number | null;
  minutos_sem_resposta: number | null;
  status: "fora" | "voltou" | null;
  /** Todos os eventos juntados neste aviso, quando mais de um (o principal é `evento`). */
  eventos?: ClaudiaEvent[];
  /** Só no lote: as conversas que ele junta. */
  conversas?: { id: number | null; evento: ClaudiaEvent }[];
}

const V1_FIELDS = [
  "evento",
  "id_evento",
  "ocorrido_em",
  "conversa",
  "telefone",
  "contato",
  "fila",
  "atendente",
  "tipo_ultima_mensagem",
  "minutos_sem_aceite",
  "minutos_sem_resposta",
  "status",
] as const;

export interface ClaudiaConfig {
  url: string;
  key: string;
  keyHeader: string;
  extraHeaders: Record<string, string>;
  body: "json" | "text";
  companyId: number;
  userId: number | null;
  watchNumbers: string[];
  format: "v1" | "v2";
  secret: string | null;
  includeText: boolean;
  /** Quanto a conexão precisa ficar fora para virar aviso. */
  connectionGraceMs: number;
  environment: string;
  /** Modo econômico: só conversas com a Claudia ou de contatos com produto em `products`. */
  economy: boolean;
  products: string[];
  /** Janela de agrupamento das conversas sem atendente. */
  awaitingWindowMs: number;
  autoReaction: boolean;
  autoInactivity: boolean;
  reminderText: string;
  inactivityText: string | null;
  autoOutOfHours: boolean;
  outOfHoursText: string | null;
  connectionAlerts: string[];
  noAcceptAlerts: string[];
  alertTechnicians: number[];
}

/** Destinos "whatsapp:5579…" (só dígitos); entradas de outro tipo são ignoradas. */
export function parseDestinations(raw: string): string[] {
  return raw
    .split(",")
    .map((d) => d.trim())
    .filter((d) => /^whatsapp:/i.test(d))
    .map((d) => d.replace(/^whatsapp:/i, "").replace(/\D/g, ""))
    .filter(Boolean);
}

/** Minúsculas e sem acento, para comparar nomes de produto. */
export const normalizeText = (s: string): string =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
    }
  } catch {
    // cai no aviso abaixo
  }
  logger.warn("CLAUDIA_WEBHOOK_EXTRA_HEADERS inválido (esperado um objeto JSON); ignorado");
  return {};
}

/**
 * A Evolution derruba e refaz a conexão sozinha a cada ~50 min (volta em 1–2 s). O aviso de queda espera esse prazo
 * e é cancelado se a conexão voltar antes: a Claudia só acorda por queda de verdade. No v2 o prazo é
 * CLAUDIA_CONEXAO_MINUTOS (conexao_prolongada).
 */
export const CONNECTION_GRACE_MS = 2 * 60_000;

/** Avisos para a Claudia: só ligam com URL, chave e empresa configuradas. */
export function claudiaConfig(): ClaudiaConfig | null {
  if (!env.CLAUDIA_WEBHOOK_URL || !env.CLAUDIA_WEBHOOK_KEY || !env.CLAUDIA_COMPANY_ID) return null;
  const format = env.CLAUDIA_WEBHOOK_FORMATO;
  return {
    url: env.CLAUDIA_WEBHOOK_URL,
    key: env.CLAUDIA_WEBHOOK_KEY,
    keyHeader: env.CLAUDIA_WEBHOOK_KEY_HEADER,
    extraHeaders: parseHeaders(env.CLAUDIA_WEBHOOK_EXTRA_HEADERS),
    body: env.CLAUDIA_WEBHOOK_BODY,
    companyId: env.CLAUDIA_COMPANY_ID,
    userId: env.CLAUDIA_USER_ID ?? null,
    watchNumbers: env.CLAUDIA_WATCH_NUMBERS.split(",")
      .map((n) => n.replace(/\D/g, ""))
      .filter(Boolean),
    format,
    secret: env.CLAUDIA_WEBHOOK_SECRET ?? null,
    includeText: env.CLAUDIA_WEBHOOK_INCLUIR_TEXTO === "true",
    connectionGraceMs: format === "v2" ? env.CLAUDIA_CONEXAO_MINUTOS * 60_000 : CONNECTION_GRACE_MS,
    environment: env.CLAUDIA_AMBIENTE,
    economy: env.CLAUDIA_WEBHOOK_MODO === "economico",
    products: env.CLAUDIA_PRODUTOS.split(",").map(normalizeText).filter(Boolean),
    awaitingWindowMs: env.CLAUDIA_AGRUPAR_SEGUNDOS_AGUARDANDO * 1000,
    autoReaction: env.CLAUDIA_AUTO_REACAO === "true",
    autoInactivity: env.CLAUDIA_AUTO_INATIVIDADE === "true",
    reminderText: env.CLAUDIA_TEXTO_LEMBRETE,
    inactivityText: env.CLAUDIA_TEXTO_INATIVIDADE ?? null,
    autoOutOfHours: env.CLAUDIA_AUTO_FORA_HORARIO === "true",
    outOfHoursText: env.CLAUDIA_TEXTO_FORA_HORARIO ?? null,
    connectionAlerts: parseDestinations(env.ALERTA_CONEXAO_DESTINOS),
    noAcceptAlerts: parseDestinations(env.ALERTA_SEM_ACEITE_DESTINOS || env.ALERTA_CONEXAO_DESTINOS),
    alertTechnicians: env.CLAUDIA_ALERTA_TECNICOS.split(",")
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  };
}

/**
 * Modo econômico: a conversa está com a Claudia, ou o Produto do contato ou a opção escolhida no menu do bot é um dos
 * produtos que ela atende.
 */
export function claudiaHandles(
  cfg: ClaudiaConfig,
  ticket: Pick<Ticket, "userId" | "botPath">,
  contact: Pick<Contact, "product"> | null | undefined,
): boolean {
  if (!cfg.economy) return true;
  if (cfg.userId !== null && ticket.userId === cfg.userId) return true;
  const matches = (text: string | null | undefined) => {
    const t = text ? normalizeText(text) : "";
    return t !== "" && cfg.products.some((p) => t.includes(p));
  };
  return matches(contact?.product) || matches(ticket.botPath);
}

/** Config ativa e da empresa do atendimento; senão null (os ganchos não fazem nada). */
export function claudiaFor(companyId: number): ClaudiaConfig | null {
  const cfg = claudiaConfig();
  return cfg && cfg.companyId === companyId ? cfg : null;
}

/** Celular brasileiro com e sem o nono dígito (o WhatsApp às vezes guarda sem). */
function numberVariants(digits: string): string[] {
  const m = /^55(\d{2})(9?)(\d{8})$/.exec(digits);
  if (!m) return [digits];
  return [`55${m[1]}9${m[3]}`, `55${m[1]}${m[3]}`];
}

export function isWatchedNumber(cfg: ClaudiaConfig, number: string): boolean {
  const mine = numberVariants(number.replace(/\D/g, ""));
  return cfg.watchNumbers.some((watched) => numberVariants(watched).some((v) => mine.includes(v)));
}

/** Data/hora ISO 8601 com o deslocamento do fuso (ex.: 2026-10-23T16:12:05-03:00). */
export function isoWithOffset(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "longOffset",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const offset = parts.timeZoneName === "GMT" ? "+00:00" : parts.timeZoneName.replace("GMT", "");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

export const MESSAGE_TYPES: Record<MessageType, string> = {
  text: "texto",
  audio: "audio",
  image: "imagem",
  video: "video",
  document: "arquivo",
  sticker: "figurinha",
  location: "localizacao",
};

export const TIME_ZONE = "America/Sao_Paulo";

function emptyPayload(evento: ClaudiaEvent, now: Date): ClaudiaPayload {
  return {
    evento,
    id_evento: randomUUID(),
    ocorrido_em: isoWithOffset(now, TIME_ZONE),
    conversa: null,
    telefone: null,
    contato: null,
    fila: null,
    atendente: null,
    tipo_ultima_mensagem: null,
    minutos_sem_aceite: null,
    minutos_sem_resposta: null,
    status: null,
  };
}

/**
 * Monta o aviso de uma conversa: só onde olhar (nº, telefone, nome, fila, atendente), nunca o conteúdo.
 * Contato marcado como robô, ou conversa fora do modo econômico, não gera aviso nenhum (null).
 */
export async function ticketPayload(
  evento: ClaudiaEvent,
  ticketId: number,
  extra: Partial<Pick<ClaudiaPayload, "minutos_sem_aceite" | "minutos_sem_resposta">> = {},
  now = new Date(),
): Promise<ClaudiaPayload | null> {
  const ticket = await Ticket.findByPk(ticketId, {
    include: [
      { model: Contact, attributes: ["id", "name", "number", "isRobot", "product"] },
      { model: Queue, attributes: ["id", "name"] },
      { model: User, attributes: ["id", "name"] },
    ],
  });
  if (!ticket || ticket.contact?.isRobot) return null;
  const cfg = claudiaConfig();
  if (cfg && !claudiaHandles(cfg, ticket, ticket.contact)) return null;
  const last = await Message.findOne({
    where: { ticketId },
    attributes: ["type"],
    order: [
      ["createdAt", "DESC"],
      ["id", "DESC"],
    ],
  });
  return {
    ...emptyPayload(evento, now),
    conversa: ticket.id,
    telefone: ticket.contact?.number.replace(/\D/g, "") ?? null,
    contato: ticket.contact?.name ?? null,
    fila: ticket.queue?.name ?? null,
    atendente: ticket.user?.name ?? null,
    tipo_ultima_mensagem: last ? MESSAGE_TYPES[last.type] ?? last.type : null,
    ...extra,
  };
}

export function connectionPayload(status: "fora" | "voltou", now = new Date()): ClaudiaPayload {
  return { ...emptyPayload("conexao", now), status };
}

/** Reenvio após 30 s, 2 min e 10 min (seção 6). */
export const RETRY_DELAYS_MS = [30_000, 120_000, 600_000];
export const claudiaBackoff = (attemptsMade: number): number =>
  RETRY_DELAYS_MS[Math.min(attemptsMade, RETRY_DELAYS_MS.length) - 1] ?? RETRY_DELAYS_MS[0];

const JOB_OPTS = {
  attempts: RETRY_DELAYS_MS.length + 1,
  backoff: { type: "custom" },
  removeOnComplete: 1000,
  removeOnFail: 1000,
};

/** Põe o aviso na fila de envio; o id do job é o id_evento (o mesmo aviso nunca entra duas vezes). */
export async function enqueueClaudia(payload: ClaudiaPayload, delayMs = 0, jobId = payload.id_evento): Promise<void> {
  await getQueue(QueueNames.claudiaWebhook).add(payload.evento, payload, { ...JOB_OPTS, jobId, delay: delayMs });
}

/**
 * Uma conversa, um aviso por vez: no máximo 1 a cada 60 s, qualquer que seja o evento. O primeiro sai na hora;
 * os que chegam no meio viram um único aviso no fim da janela, com o evento mais importante (o mais recente no empate).
 */
export const GROUP_WINDOW_MS = 60_000;
export const GROUP_JOB = "grupo";

/** Escalonamentos pedem ação específica (avisar o Mateus, alertar o Whatyson): não podem ser engolidos por mensagens. */
const PRIORITY: Record<ClaudiaEvent, number> = {
  transferida_para_claudia: 3,
  transferencia_sem_aceite: 3,
  inatividade_cliente: 3,
  mensagem_mateus: 2,
  conversa_aguardando: 1,
  bot_parado: 1,
  mensagem_cliente: 1,
  mensagem_pos_finalizacao: 1,
  conexao: 1,
  lote: 1,
};

/** O evento principal de um aviso que junta vários: o mais importante; no empate, o primeiro da lista. */
export function primaryEvent(events: ClaudiaEvent[]): ClaudiaEvent {
  return events.reduce((best, e) => (PRIORITY[e] > PRIORITY[best] ? e : best));
}

const eventsOf = (p: ClaudiaPayload): ClaudiaEvent[] => p.eventos ?? [p.evento];

const windowKey = (conversa: number | null) => `claudia:window:${conversa}`;
const pendingKey = (conversa: number | null) => `claudia:pending:${conversa}`;

/** Rajada (v2): mais de BURST_LIMIT avisos em BURST_WINDOW_MS viram um único aviso "lote" no fim da janela. */
export const BURST_WINDOW_MS = 30_000;
export const BURST_LIMIT = 5;
export const LOTE_JOB = "lote";
const BURST_KEY = "claudia:burst";
const BURST_START_KEY = "claudia:burst-start";
const LOTE_KEY = "claudia:lote";

async function enqueueNow(payload: ClaudiaPayload): Promise<void> {
  if (claudiaConfig()?.format !== "v2") return enqueueClaudia(payload);
  const redis = getRedis();
  const start = String(Date.now());
  await redis.set(BURST_START_KEY, start, "PX", BURST_WINDOW_MS, "NX");
  await redis.set(BURST_KEY, "0", "PX", BURST_WINDOW_MS, "NX");
  const count = await redis.incr(BURST_KEY);
  if (count <= BURST_LIMIT) return enqueueClaudia(payload);

  const [burstStart, ttl] = await Promise.all([redis.get(BURST_START_KEY), redis.pttl(BURST_KEY)]);
  const delay = Math.max(ttl, 0);
  await redis.rpush(LOTE_KEY, JSON.stringify({ id: payload.conversa, evento: payload.evento }));
  await redis.pexpire(LOTE_KEY, delay + 10 * BURST_WINDOW_MS);
  // jobId fixo por rajada: tudo que passa do limite vira um único aviso, montado na hora de enviar.
  await getQueue(QueueNames.claudiaWebhook).add(LOTE_JOB, emptyPayload("lote", new Date()), {
    ...JOB_OPTS,
    jobId: `claudia-lote-${burstStart ?? start}`,
    delay,
  });
}

/** Conversa sem atendente usa a janela maior (cliente costuma mandar várias mensagens seguidas). */
export function windowFor(payload: Pick<ClaudiaPayload, "conversa" | "atendente">): number {
  const awaiting = payload.conversa !== null && payload.atendente === null;
  return awaiting ? claudiaConfig()?.awaitingWindowMs ?? GROUP_WINDOW_MS : GROUP_WINDOW_MS;
}

export async function enqueueGrouped(payload: ClaudiaPayload): Promise<void> {
  const redis = getRedis();
  const windowMs = windowFor(payload);
  const opened = await redis.set(windowKey(payload.conversa), String(Date.now()), "PX", windowMs, "NX");
  if (opened) return enqueueNow(payload);

  const [start, ttl, stored] = await Promise.all([
    redis.get(windowKey(payload.conversa)),
    redis.pttl(windowKey(payload.conversa)),
    redis.get(pendingKey(payload.conversa)),
  ]);
  const previous = stored ? (JSON.parse(stored) as ClaudiaPayload) : null;
  const winner = !previous || PRIORITY[payload.evento] >= PRIORITY[previous.evento] ? payload : previous;
  const merged = [...new Set([...(previous ? eventsOf(previous) : []), ...eventsOf(payload)])];
  const pending: ClaudiaPayload = { ...winner, eventos: merged.length > 1 ? merged : undefined };
  await redis.set(pendingKey(payload.conversa), JSON.stringify(pending), "PX", Math.max(ttl, 0) + windowMs);
  // jobId fixo por janela: tudo que chega no meio vira um único aviso, montado na hora de enviar.
  await getQueue(QueueNames.claudiaWebhook).add(GROUP_JOB, payload, {
    ...JOB_OPTS,
    jobId: `claudia-grupo-${payload.conversa}-${start}`,
    delay: Math.max(ttl, 0),
  });
}

/** No fim da janela: pega o aviso guardado e abre nova janela (o aviso agrupado conta como o envio dela). */
async function takeGrouped(job: Job<ClaudiaPayload>): Promise<ClaudiaPayload> {
  const redis = getRedis();
  const stored = await redis.getdel(pendingKey(job.data.conversa));
  const payload = stored ? (JSON.parse(stored) as ClaudiaPayload) : job.data;
  await redis.set(windowKey(payload.conversa), String(Date.now()), "PX", windowFor(payload));
  // Reenvios usam o mesmo aviso (mesmo id_evento).
  await job.updateData(payload).catch(() => undefined);
  return payload;
}

/** Fim da rajada: junta as conversas guardadas num único aviso "lote" (uma entrada por conversa). */
async function takeLote(job: Job<ClaudiaPayload>): Promise<ClaudiaPayload> {
  const redis = getRedis();
  const [[, raw]] = (await redis.multi().lrange(LOTE_KEY, 0, -1).del(LOTE_KEY).exec()) as [[unknown, string[]]];
  const byConversation = new Map<number | null, ClaudiaEvent>();
  for (const item of raw ?? []) {
    const { id, evento } = JSON.parse(item) as { id: number | null; evento: ClaudiaEvent };
    const current = byConversation.get(id);
    byConversation.set(id, current && PRIORITY[current] > PRIORITY[evento] ? current : evento);
  }
  const payload: ClaudiaPayload = {
    ...job.data,
    conversas: [...byConversation].map(([id, evento]) => ({ id, evento })),
  };
  await job.updateData(payload).catch(() => undefined);
  return payload;
}

/** Marco único (ex.: 10 min sem aceite desta transferência): só o primeiro a marcar envia. */
export async function markOnce(key: string): Promise<boolean> {
  return (await getRedis().set(`claudia:once:${key}`, "1", "EX", 3 * 24 * 3600, "NX")) === "OK";
}

export function v1Body(payload: ClaudiaPayload): Record<string, unknown> {
  return Object.fromEntries(V1_FIELDS.map((f) => [f, payload[f]]));
}

/**
 * Corpo do aviso, montado uma vez só e guardado (claudia_events): reenvios mandam exatamente o mesmo conteúdo
 * e GET /api/v1/webhook/eventos devolve o que foi enviado.
 */
async function storedBody(cfg: ClaudiaConfig, payload: ClaudiaPayload): Promise<Record<string, unknown>> {
  const existing = await ClaudiaEventLog.findOne({ where: { eventId: payload.id_evento }, attributes: ["payload"] });
  if (existing) return existing.payload;
  const body = cfg.format === "v2" ? await buildV2Body(cfg, payload) : v1Body(payload);
  const [row] = await ClaudiaEventLog.findOrCreate({
    where: { eventId: payload.id_evento },
    defaults: { eventId: payload.id_evento, event: String(body.evento), ticketId: payload.conversa, payload: body },
  });
  return row.payload;
}

const TIMEOUT_MS = 10_000;

/** Assinatura do corpo exato que vai na requisição: `sha256=<HMAC-SHA256 hex>`. */
export function signBody(secret: string, raw: string): string {
  return `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`;
}

export async function deliver(cfg: ClaudiaConfig, payload: Record<string, unknown>): Promise<Response> {
  const raw = JSON.stringify(cfg.body === "text" ? { text: JSON.stringify(payload) } : payload);
  const signature: Record<string, string> = cfg.secret
    ? { "X-WhatsOn-Timestamp": String(Math.floor(Date.now() / 1000)), "X-WhatsOn-Assinatura": signBody(cfg.secret, raw) }
    : {};
  return fetch(cfg.url, {
    method: "POST",
    headers: {
      ...cfg.extraHeaders,
      "Content-Type": "application/json; charset=utf-8",
      [cfg.keyHeader]: cfg.key,
      ...signature,
    },
    body: raw,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Worker: envia, registra cada tentativa e falha (para o BullMQ reenviar) em erro ou resposta não-2xx. */
export async function processClaudiaWebhookJob(job: Job<ClaudiaPayload>): Promise<void> {
  const cfg = claudiaConfig();
  if (!cfg) return;
  if (job.name === CONNECTION_ALERT_JOB) {
    return processConnectionAlert(job.data as unknown as ConnectionAlertData, cfg.connectionAlerts);
  }
  let payload = job.data;
  if (job.attemptsMade === 0 && job.name === GROUP_JOB) payload = await takeGrouped(job);
  if (job.attemptsMade === 0 && job.name === LOTE_JOB) payload = await takeLote(job);
  if (payload.evento === "lote" && !payload.conversas?.length) return;
  const attempt = job.attemptsMade + 1;
  const final = attempt >= (job.opts.attempts ?? 1);
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    const stored = await storedBody(cfg, payload);
    // v2: `tentativa` logo depois do id_evento; o resto é idêntico em todos os reenvios.
    const { evento, id_evento, ...rest } = stored;
    const body = cfg.format === "v2" ? { evento, id_evento, tentativa: attempt, ...rest } : stored;
    const res = await deliver(cfg, body);
    statusCode = res.status;
    if (!res.ok) error = (await res.text().catch(() => "")).slice(0, 500) || `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  await ClaudiaWebhookLog.create({
    eventId: payload.id_evento,
    event: payload.evento,
    ticketId: payload.conversa,
    attempt,
    statusCode,
    error,
  }).catch((err) => logger.warn({ err }, "falha ao registrar envio de aviso à Claudia"));
  if (!error) return;
  const ctx = { eventId: payload.id_evento, event: payload.evento, ticketId: payload.conversa, attempt, statusCode, error };
  if (final) logger.error(ctx, "aviso à Claudia não entregue; desistindo após os reenvios");
  else logger.warn(ctx, "aviso à Claudia falhou; vai reenviar");
  throw new Error(`aviso à Claudia falhou: ${error}`);
}
