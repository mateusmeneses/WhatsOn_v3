import { DataTypes, QueryInterface } from "sequelize";

/** Encerramento automático por inatividade do cliente: tempo (0 = desligado) e mensagem enviada ao finalizar. */
export async function up(qi: QueryInterface): Promise<void> {
  await qi.addColumn("companies", "inactivityCloseMinutes", { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
  await qi.addColumn("companies", "inactivityCloseMessage", { type: DataTypes.TEXT, allowNull: false, defaultValue: "" });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.removeColumn("companies", "inactivityCloseMessage");
  await qi.removeColumn("companies", "inactivityCloseMinutes");
}
