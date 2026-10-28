import { randomUUID } from "crypto";
import { Job } from "bullmq";
import { env } from "../../config/env";
import { ClaudiaWebhookLog, Contact, Message, MessageType, Queue, Ticket, User } from "../../models";
import { getQueue, QueueNames } from "../../queues";
import { logger } from "../../shared/logger";
import { getRedis } from "../../shared/redis";

export type ClaudiaEvent =
  | "conversa_aguardando"
  | "bot_parado"
  | "mensagem_cliente"
  | "mensagem_pos_finalizacao"
  | "transferencia_sem_aceite"
  | "inatividade_cliente"
  | "mensagem_mateus"
  | "conexao";

/** Corpo do aviso (seção 4 da especificação). Nunca leva texto de mensagem, documentos, valores ou senhas. */
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
}

export interface ClaudiaConfig {
  url: string;
  key: string;
  keyHeader: string;
  extraHeaders: Record<string, string>;
  body: "json" | "text";
  companyId: number;
  userId: number | null;
  watchNumbers: string[];
}

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

/** Avisos para a Claudia: só ligam com URL, chave e empresa configuradas. */
export function claudiaConfig(): ClaudiaConfig | null {
  if (!env.CLAUDIA_WEBHOOK_URL || !env.CLAUDIA_WEBHOOK_KEY || !env.CLAUDIA_COMPANY_ID) return null;
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
  };
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

const MESSAGE_TYPES: Record<MessageType, string> = {
  text: "texto",
  audio: "audio",
  image: "imagem",
  video: "video",
  document: "arquivo",
  sticker: "figurinha",
  location: "localizacao",
};

const TIME_ZONE = "America/Sao_Paulo";

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

/** Monta o aviso de uma conversa: só onde olhar (nº, telefone, nome, fila, atendente), nunca o conteúdo. */
export async function ticketPayload(
  evento: ClaudiaEvent,
  ticketId: number,
  extra: Partial<Pick<ClaudiaPayload, "minutos_sem_aceite" | "minutos_sem_resposta">> = {},
  now = new Date(),
): Promise<ClaudiaPayload | null> {
  const ticket = await Ticket.findByPk(ticketId, {
    include: [
      { model: Contact, attributes: ["id", "name", "number"] },
      { model: Queue, attributes: ["id", "name"] },
      { model: User, attributes: ["id", "name"] },
    ],
  });
  if (!ticket) return null;
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

/**
 * A Evolution derruba e refaz a conexão sozinha a cada ~50 min (volta em 1–2 s). O aviso de queda espera esse prazo
 * e é cancelado se a conexão voltar antes: a Claudia só acorda por queda de verdade.
 */
export const CONNECTION_GRACE_MS = 2 * 60_000;

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
  transferencia_sem_aceite: 3,
  inatividade_cliente: 3,
  mensagem_mateus: 2,
  conversa_aguardando: 1,
  bot_parado: 1,
  mensagem_cliente: 1,
  mensagem_pos_finalizacao: 1,
  conexao: 1,
};

const windowKey = (conversa: number | null) => `claudia:window:${conversa}`;
const pendingKey = (conversa: number | null) => `claudia:pending:${conversa}`;

export async function enqueueGrouped(payload: ClaudiaPayload): Promise<void> {
  const redis = getRedis();
  const opened = await redis.set(windowKey(payload.conversa), String(Date.now()), "PX", GROUP_WINDOW_MS, "NX");
  if (opened) return enqueueClaudia(payload);

  const [start, ttl, stored] = await Promise.all([
    redis.get(windowKey(payload.conversa)),
    redis.pttl(windowKey(payload.conversa)),
    redis.get(pendingKey(payload.conversa)),
  ]);
  const previous = stored ? (JSON.parse(stored) as ClaudiaPayload) : null;
  if (!previous || PRIORITY[payload.evento] >= PRIORITY[previous.evento]) {
    await redis.set(pendingKey(payload.conversa), JSON.stringify(payload), "PX", Math.max(ttl, 0) + GROUP_WINDOW_MS);
  }
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
  await redis.set(windowKey(payload.conversa), String(Date.now()), "PX", GROUP_WINDOW_MS);
  // Reenvios usam o mesmo aviso (mesmo id_evento).
  await job.updateData(payload).catch(() => undefined);
  return payload;
}

/** Marco único (ex.: 10 min sem aceite desta transferência): só o primeiro a marcar envia. */
export async function markOnce(key: string): Promise<boolean> {
  return (await getRedis().set(`claudia:once:${key}`, "1", "EX", 3 * 24 * 3600, "NX")) === "OK";
}

const TIMEOUT_MS = 10_000;

export async function deliver(cfg: ClaudiaConfig, payload: ClaudiaPayload): Promise<Response> {
  const body = cfg.body === "text" ? { text: JSON.stringify(payload) } : payload;
  return fetch(cfg.url, {
    method: "POST",
    headers: { ...cfg.extraHeaders, "Content-Type": "application/json; charset=utf-8", [cfg.keyHeader]: cfg.key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Worker: envia, registra cada tentativa e falha (para o BullMQ reenviar) em erro ou resposta não-2xx. */
export async function processClaudiaWebhookJob(job: Job<ClaudiaPayload>): Promise<void> {
  const cfg = claudiaConfig();
  if (!cfg) return;
  const payload = job.name === GROUP_JOB && job.attemptsMade === 0 ? await takeGrouped(job) : job.data;
  const attempt = job.attemptsMade + 1;
  const final = attempt >= (job.opts.attempts ?? 1);
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    const res = await deliver(cfg, payload);
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
