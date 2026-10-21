import { DataTypes, QueryInterface } from "sequelize";

/** Vínculos do atendimento com o Manager (OS aberta e atendimento registrado). */
export async function up(qi: QueryInterface): Promise<void> {
  await qi.addColumn("tickets", "managerOsId", { type: DataTypes.INTEGER, allowNull: true });
  await qi.addColumn("tickets", "managerOsUrl", { type: DataTypes.TEXT, allowNull: true });
  await qi.addColumn("tickets", "managerAtendimentoId", { type: DataTypes.INTEGER, allowNull: true });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.removeColumn("tickets", "managerAtendimentoId");
  await qi.removeColumn("tickets", "managerOsUrl");
  await qi.removeColumn("tickets", "managerOsId");
}
