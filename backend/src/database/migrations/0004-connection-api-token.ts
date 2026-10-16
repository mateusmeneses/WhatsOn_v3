import { DataTypes, QueryInterface } from "sequelize";

export async function up(qi: QueryInterface): Promise<void> {
  await qi.addColumn("connections", "apiToken", { type: DataTypes.STRING, allowNull: true });
  await qi.addIndex("connections", ["apiToken"], { name: "connections_api_token", unique: true });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.removeIndex("connections", "connections_api_token");
  await qi.removeColumn("connections", "apiToken");
}
