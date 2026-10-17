import { DataTypes, QueryInterface } from "sequelize";

/** Transferência direta para um técnico: o histórico passa a registrar para quem foi. */
export async function up(qi: QueryInterface): Promise<void> {
  await qi.addColumn("ticket_logs", "toUserId", { type: DataTypes.INTEGER, allowNull: true });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.removeColumn("ticket_logs", "toUserId");
}
