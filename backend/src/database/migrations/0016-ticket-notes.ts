import { DataTypes, QueryInterface } from "sequelize";

/** Observações internas do atendimento (nunca enviadas ao cliente). */
export async function up(qi: QueryInterface): Promise<void> {
  await qi.addColumn("tickets", "notes", { type: DataTypes.TEXT, allowNull: false, defaultValue: "" });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.removeColumn("tickets", "notes");
}
