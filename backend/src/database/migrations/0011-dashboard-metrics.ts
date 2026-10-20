import { DataTypes, QueryInterface } from "sequelize";

/** Presença dos usuários (último login/visto) e índices por período usados pelo dashboard. */
export async function up(qi: QueryInterface): Promise<void> {
  await qi.addColumn("users", "lastLoginAt", { type: DataTypes.DATE, allowNull: true });
  await qi.addColumn("users", "lastSeenAt", { type: DataTypes.DATE, allowNull: true });
  await qi.addIndex("tickets", ["companyId", "createdAt"], { name: "tickets_company_created" });
  await qi.addIndex("messages", ["companyId", "createdAt"], { name: "messages_company_created" });
  await qi.addIndex("ticket_logs", ["companyId", "createdAt"], { name: "ticket_logs_company_created" });
  await qi.addIndex("ticket_logs", ["ticketId", "createdAt"], { name: "ticket_logs_ticket_created" });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.removeIndex("ticket_logs", "ticket_logs_ticket_created");
  await qi.removeIndex("ticket_logs", "ticket_logs_company_created");
  await qi.removeIndex("messages", "messages_company_created");
  await qi.removeIndex("tickets", "tickets_company_created");
  await qi.removeColumn("users", "lastSeenAt");
  await qi.removeColumn("users", "lastLoginAt");
}
