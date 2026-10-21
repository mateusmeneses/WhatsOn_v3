import { DataTypes, QueryInterface } from "sequelize";

/** Caminho escolhido pelo cliente na árvore do bot (ex.: "Suporte técnico › Sistema X"), exibido ao atendente. */
export async function up(qi: QueryInterface): Promise<void> {
  await qi.addColumn("tickets", "botPath", { type: DataTypes.TEXT, allowNull: true });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.removeColumn("tickets", "botPath");
}
