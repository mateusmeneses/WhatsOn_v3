import { literal } from "sequelize";

/** Eventos que recomeçam a contagem: o tempo esperando aceite (ou na fila) nunca conta como inatividade. */
export const RESTART_EVENTS = ["reopened", "accepted", "transferred", "claimed"] as const;
const restartEventsSql = RESTART_EVENTS.map((e) => `'${e}'`).join(", ");

/** Hora do último aceite/reabertura/transferência/requisição do atendimento (consulta sobre "Ticket"). */
export const restartedAt = literal(
  `(SELECT MAX(l."createdAt") FROM ticket_logs l WHERE l."ticketId" = "Ticket"."id" AND l."event" IN (${restartEventsSql}))`,
);

/** SQL: houve aceite/reabertura/transferência/requisição do chamado `ticketId` depois de `sinceSql`. */
export const restartedAfterSql = (ticketId: number, sinceSql: string) =>
  `EXISTS (SELECT 1 FROM ticket_logs l WHERE l."ticketId" = ${Number(ticketId)} AND l."event" IN (${restartEventsSql}) ` +
  `AND l."createdAt" > ${sinceSql})`;
