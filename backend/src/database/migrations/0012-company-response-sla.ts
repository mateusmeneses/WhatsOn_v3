import { DataTypes, QueryInterface } from "sequelize";

/** Meta de primeira resposta (em minutos) usada pelo indicador "respondidas no prazo" do dashboard. */
export async function up(qi: QueryInterface): Promise<void> {
  await qi.addColumn("companies", "responseSlaMinutes", { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5 });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.removeColumn("companies", "responseSlaMinutes");
}
