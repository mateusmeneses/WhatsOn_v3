import { DataTypes, QueryInterface } from "sequelize";

/** Alerta escalonado ao técnico que não responde o cliente: intervalo na empresa e o estágio já avisado em cada atendimento. */
export async function up(qi: QueryInterface): Promise<void> {
  await qi.addColumn("companies", "idleAlertMinutes", { type: DataTypes.INTEGER, allowNull: false, defaultValue: 15 });
  await qi.addColumn("tickets", "idleAlertLevel", { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
  await qi.addColumn("tickets", "idleAlertSince", { type: DataTypes.DATE, allowNull: true });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.removeColumn("tickets", "idleAlertSince");
  await qi.removeColumn("tickets", "idleAlertLevel");
  await qi.removeColumn("companies", "idleAlertMinutes");
}
