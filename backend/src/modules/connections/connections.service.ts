import { randomBytes } from "node:crypto";
import { Op, QueryTypes } from "sequelize";
import { env } from "../../config/env";
import { sequelize } from "../../database/sequelize";
import { Company, Connection, ConnectionStatus, Ticket } from "../../models";
import { AppError, notFound } from "../../shared/errors/AppError";
import { logger } from "../../shared/logger";
import { assertQueuesBelong } from "../queues/queues.service";
import { emitter } from "../realtime/socket";
import { getProvider } from "../whatsapp/registry";

export interface ConnectionInput {
  name: string;
  isDefault?: boolean;
  defaultQueueId?: number | null;
  outOfHoursMessage?: string;
  closingMessage?: string;
  transferMessage?: string;
  botTimeoutMinutes?: number;
}

export function publicConnection(c: Connection): Record<string, unknown> {
  const { webhookToken: _hidden, apiToken, ...rest } = c.toJSON() as Record<string, unknown>;
  return { ...rest, hasApiToken: Boolean(apiToken) };
}

export function webhookUrl(c: Connection): string {
  return `${env.BACKEND_PUBLIC_URL}/webhooks/evolution/${c.webhookToken}`;
}

export function listConnections(companyId: number) {
  return Connection.findAll({ where: { companyId }, order: [["name", "ASC"]] });
}

export async function getConnectionOr404(companyId: number, id: number): Promise<Connection> {
  const connection = await Connection.findOne({ where: { id, companyId } });
  if (!connection) throw notFound("Conexão");
  return connection;
}

async function makeOnlyDefault(connection: Connection): Promise<void> {
  await Connection.update(
    { isDefault: false },
    { where: { companyId: connection.companyId, id: { [Op.ne]: connection.id } } },
  );
}

export async function createConnection(companyId: number, input: ConnectionInput): Promise<Connection> {
  if (input.defaultQueueId) await assertQueuesBelong(companyId, [input.defaultQueueId]);
  const isFirst = (await Connection.count({ where: { companyId } })) === 0;
  const connection = await Connection.create({
    companyId,
    ...input,
    isDefault: input.isDefault ?? isFirst,
    instanceName: `wo_${companyId}_${randomBytes(4).toString("hex")}`,
    webhookToken: randomBytes(24).toString("hex"),
    status: "disconnected",
  });
  try {
    await getProvider().createInstance(connection.instanceName, webhookUrl(connection));
  } catch (err) {
    await connection.destroy();
    throw err;
  }
  await connection.update({ status: "qrcode" });
  if (connection.isDefault) await makeOnlyDefault(connection);
  return connection;
}

export async function updateConnection(companyId: number, id: number, input: Partial<ConnectionInput>) {
  const connection = await getConnectionOr404(companyId, id);
  if (input.defaultQueueId) await assertQueuesBelong(companyId, [input.defaultQueueId]);
  await connection.update(input);
  if (input.isDefault) await makeOnlyDefault(connection);
  return connection;
}

export async function deleteConnection(companyId: number, id: number): Promise<void> {
  const connection = await getConnectionOr404(companyId, id);
  if ((await Ticket.count({ where: { connectionId: id } })) > 0) {
    throw new AppError(
      "CONNECTION_HAS_TICKETS",
      409,
      "Esta conexão possui atendimentos registrados; desconecte-a em vez de excluir",
    );
  }
  await getProvider().deleteInstance(connection.instanceName);
  await connection.destroy();
}

export async function getConnectionQrCode(companyId: number, id: number): Promise<{ qr: string | null }> {
  const connection = await getConnectionOr404(companyId, id);
  if (connection.status === "connected") throw new AppError("ALREADY_CONNECTED", 409, "Conexão já está ativa");
  const provider = getProvider();
  let qr: string | null;
  try {
    qr = await provider.getQrCode(connection.instanceName);
  } catch (err) {
    if (!(err instanceof AppError && err.code === "INSTANCE_NOT_FOUND")) throw err;
    // A Evolution perdeu a instância (volume recriado, banco vindo de outro ambiente): recria e pede o QR de novo.
    logger.warn({ connectionId: connection.id, instanceName: connection.instanceName }, "instância ausente na Evolution; recriando");
    await provider.createInstance(connection.instanceName, webhookUrl(connection));
    qr = await provider.getQrCode(connection.instanceName);
  }
  if (connection.status !== "qrcode") await connection.update({ status: "qrcode" });
  return { qr };
}

export function generateApiToken(): string {
  return randomBytes(32).toString("hex");
}

export async function getConnectionApiToken(companyId: number, id: number): Promise<{ apiToken: string | null }> {
  const connection = await getConnectionOr404(companyId, id);
  return { apiToken: connection.apiToken };
}

/** Gera (ou troca) o token da API externa; o anterior deixa de valer na hora. */
export async function regenerateConnectionApiToken(companyId: number, id: number): Promise<{ apiToken: string }> {
  const connection = await getConnectionOr404(companyId, id);
  const apiToken = generateApiToken();
  await connection.update({ apiToken });
  return { apiToken };
}

export async function disconnectConnection(companyId: number, id: number): Promise<Connection> {
  const connection = await getConnectionOr404(companyId, id);
  await getProvider().logout(connection.instanceName);
  await applyConnectionUpdate(connection, "disconnected");
  return connection;
}

export async function applyConnectionUpdate(
  connection: Connection,
  state: ConnectionStatus,
  number?: string,
): Promise<void> {
  const previous = connection.status;
  if (previous === state && (!number || number === connection.number)) return;
  await connection.update({ status: state, ...(number ? { number } : {}) });
  emitter.toSupervisors(connection.companyId, "connection:update", publicConnection(connection));
  if (previous === "connected" && state === "disconnected") {
    emitter.toSupervisors(connection.companyId, "connection:alert", { connectionId: connection.id, name: connection.name });
  }
}

export async function applyQrCode(connection: Connection, qr: string): Promise<void> {
  if (connection.status !== "qrcode") await applyConnectionUpdate(connection, "qrcode");
  emitter.toSupervisors(connection.companyId, "connection:qrcode", { connectionId: connection.id, qr });
}

export async function checkConnectionsHealth(): Promise<void> {
  const connections = await Connection.findAll();
  for (const connection of connections) {
    try {
      const state = await getProvider().getConnectionState(connection.instanceName);
      await applyConnectionUpdate(connection, state);
    } catch (err) {
      logger.warn({ err, connectionId: connection.id }, "connection health check failed");
    }
  }
}

export interface ConnectionStats {
  id: number;
  ticketsToday: number;
  messagesInToday: number;
  messagesOutToday: number;
  lastMessageAt: Date | null;
}

/** Atividade de hoje (fuso da empresa) de cada conexão, para os cartões da tela Conexões. */
export async function connectionStats(companyId: number): Promise<ConnectionStats[]> {
  const company = await Company.findByPk(companyId, { attributes: ["timezone"] });
  const tz = company?.timezone ?? "America/Sao_Paulo";
  const rows = await sequelize.query<ConnectionStats>(
    `WITH bounds AS (SELECT date_trunc('day', now() AT TIME ZONE :tz) AT TIME ZONE :tz AS "start")
     SELECT c.id,
       (SELECT count(*) FROM tickets t, bounds b WHERE t."connectionId" = c.id AND t."createdAt" >= b."start")::int AS "ticketsToday",
       (SELECT count(*) FROM messages m, bounds b WHERE m."connectionId" = c.id AND NOT m."fromMe" AND m."createdAt" >= b."start")::int AS "messagesInToday",
       (SELECT count(*) FROM messages m, bounds b WHERE m."connectionId" = c.id AND m."fromMe" AND m."createdAt" >= b."start")::int AS "messagesOutToday",
       (SELECT max(m."createdAt") FROM messages m WHERE m."connectionId" = c.id) AS "lastMessageAt"
     FROM connections c WHERE c."companyId" = :companyId ORDER BY c.name`,
    { type: QueryTypes.SELECT, replacements: { companyId, tz } },
  );
  return rows;
}
