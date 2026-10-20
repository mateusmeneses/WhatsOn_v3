import { QueryInterface } from "sequelize";

/**
 * Índices para os painéis em bases grandes:
 * - cobertura por empresa/atendimento/horário: o tempo de resposta percorre as mensagens do período em ordem
 *   de atendimento sem ler a tabela (index-only scan);
 * - mensagens por conexão/horário (movimento de hoje, última mensagem) e atendimentos por contato (histórico).
 */
export async function up(qi: QueryInterface): Promise<void> {
  await qi.sequelize.query(
    `CREATE INDEX IF NOT EXISTS messages_company_ticket_created
       ON "messages" ("companyId", "ticketId", "createdAt", "id") INCLUDE ("fromMe", "isBot", "sentByUserId")`,
  );
  await qi.sequelize.query(`CREATE INDEX IF NOT EXISTS messages_connection_created ON "messages" ("connectionId", "createdAt")`);
  await qi.sequelize.query(`CREATE INDEX IF NOT EXISTS tickets_contact ON "tickets" ("contactId")`);
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.sequelize.query(`DROP INDEX IF EXISTS tickets_contact`);
  await qi.sequelize.query(`DROP INDEX IF EXISTS messages_connection_created`);
  await qi.sequelize.query(`DROP INDEX IF EXISTS messages_company_ticket_created`);
}
