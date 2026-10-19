import { DataTypes, QueryInterface } from "sequelize";

/** Requerer atendimento: permissão por usuário e, no histórico, de quem foi tirado e o recado interno. */
export async function up(qi: QueryInterface): Promise<void> {
  await qi.addColumn("users", "canClaimTickets", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await qi.addColumn("ticket_logs", "fromUserId", { type: DataTypes.INTEGER, allowNull: true });
  await qi.addColumn("ticket_logs", "note", { type: DataTypes.TEXT, allowNull: true });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.removeColumn("ticket_logs", "note");
  await qi.removeColumn("ticket_logs", "fromUserId");
  await qi.removeColumn("users", "canClaimTickets");
}
