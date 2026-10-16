import { DataTypes, QueryInterface } from "sequelize";

export async function up(qi: QueryInterface): Promise<void> {
  await qi.addColumn("messages", "editedAt", { type: DataTypes.DATE, allowNull: true });
  await qi.addColumn("messages", "deletedAt", { type: DataTypes.DATE, allowNull: true });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.removeColumn("messages", "deletedAt");
  await qi.removeColumn("messages", "editedAt");
}
