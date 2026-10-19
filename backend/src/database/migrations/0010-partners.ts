import { DataTypes, QueryInterface } from "sequelize";

/** Sistemas parceiros (chave de API) e, na empresa, o CNPJ e o parceiro que a criou. */
export async function up(qi: QueryInterface): Promise<void> {
  await qi.createTable("partners", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    keyHash: { type: DataTypes.STRING, allowNull: false, unique: true },
    keyPrefix: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "active" },
    lastUsedAt: { type: DataTypes.DATE, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.addColumn("companies", "cnpj", { type: DataTypes.STRING(14), allowNull: true, unique: true });
  await qi.addColumn("companies", "partnerId", {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: "partners", key: "id" },
    onDelete: "RESTRICT",
  });
  await qi.addColumn("companies", "contactEmail", { type: DataTypes.STRING, allowNull: true });
  await qi.addColumn("companies", "contactPhone", { type: DataTypes.STRING, allowNull: true });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.removeColumn("companies", "contactPhone");
  await qi.removeColumn("companies", "contactEmail");
  await qi.removeColumn("companies", "partnerId");
  await qi.removeColumn("companies", "cnpj");
  await qi.dropTable("partners");
}
