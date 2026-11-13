import { literal, Op } from "sequelize";
import { ClaudiaEventLog } from "../../models";
import { AppError } from "../../shared/errors/AppError";
import { claudiaFor, isoWithOffset, TIME_ZONE } from "./claudia.webhook";

export interface ReplayQuery {
  /** Avisos registrados depois deste instante (padrão: últimas 24 h). */
  desde?: Date;
  /** Cursor: avisos com sequência maior que esta (devolvida em `proximo_apos_id`). */
  aposId?: number;
  limite: number;
}

/** Houve tentativa com resposta 2xx para o aviso. */
const delivered = literal(
  `EXISTS (SELECT 1 FROM claudia_webhook_logs w WHERE w."eventId" = "ClaudiaEventLog"."eventId" AND w."statusCode" BETWEEN 200 AND 299)`,
);

/**
 * Avisos à Claudia como foram enviados, em ordem, para ela recuperar os que perdeu (seção 4.5, "reentrega manual").
 * Só para a empresa da Claudia.
 */
export async function listClaudiaEvents(companyId: number, q: ReplayQuery, now = new Date()) {
  if (!claudiaFor(companyId)) throw new AppError("NOT_FOUND", 404, "Avisos à Claudia não estão ativos nesta empresa");
  const desde = q.desde ?? new Date(now.getTime() - 24 * 3600_000);
  const rows = await ClaudiaEventLog.findAll({
    where: { createdAt: { [Op.gt]: desde }, ...(q.aposId !== undefined ? { id: { [Op.gt]: q.aposId } } : {}) },
    attributes: { include: [[delivered, "delivered"]] },
    order: [["id", "ASC"]],
    limit: q.limite + 1,
  });
  const page = rows.slice(0, q.limite);
  return {
    eventos: page.map((r) => ({
      seq: r.id,
      registrado_em: isoWithOffset(r.createdAt, TIME_ZONE),
      entregue: Boolean(r.get("delivered")),
      aviso: r.payload,
    })),
    proximo_apos_id: rows.length > q.limite ? page[page.length - 1].id : null,
  };
}
