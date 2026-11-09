import { DataTypes, QueryInterface } from "sequelize";

/** Conversas em grupo: cada mensagem recebida guarda quem falou (nome e número do participante). */
export async function up(qi: QueryInterface): Promise<void> {
  await qi.addColumn("messages", "senderName", { type: DataTypes.STRING, allowNull: true });
  await qi.addColumn("messages", "senderNumber", { type: DataTypes.STRING, allowNull: true });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.removeColumn("messages", "senderNumber");
  await qi.removeColumn("messages", "senderName");
}
