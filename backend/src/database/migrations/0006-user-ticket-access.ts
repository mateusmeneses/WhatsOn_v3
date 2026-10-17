import { DataTypes, QueryInterface } from "sequelize";

const COLUMNS = ["canViewBot", "canViewOtherQueues", "canViewOthersOpen"] as const;

/** Permissões extras de visibilidade de atendimentos para atendentes (por usuário). */
export async function up(qi: QueryInterface): Promise<void> {
  for (const column of COLUMNS) {
    await qi.addColumn("users", column, { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  }
}

export async function down(qi: QueryInterface): Promise<void> {
  for (const column of COLUMNS) await qi.removeColumn("users", column);
}
