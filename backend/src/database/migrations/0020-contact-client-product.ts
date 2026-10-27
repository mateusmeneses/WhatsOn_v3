import { DataTypes, QueryInterface } from "sequelize";

/** Empresa e produto do contato (com os códigos do Manager, quando a integração está ativa) e a pergunta do bot sobre o produto. */
export async function up(qi: QueryInterface): Promise<void> {
  await qi.addColumn("contacts", "clientCompany", { type: DataTypes.STRING, allowNull: true });
  await qi.addColumn("contacts", "managerClientId", { type: DataTypes.INTEGER, allowNull: true });
  await qi.addColumn("contacts", "product", { type: DataTypes.STRING, allowNull: true });
  await qi.addColumn("contacts", "managerProductId", { type: DataTypes.INTEGER, allowNull: true });
  await qi.addColumn("tickets", "chatbotConfirmNodeId", { type: DataTypes.INTEGER, allowNull: true });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.removeColumn("tickets", "chatbotConfirmNodeId");
  await qi.removeColumn("contacts", "managerProductId");
  await qi.removeColumn("contacts", "product");
  await qi.removeColumn("contacts", "managerClientId");
  await qi.removeColumn("contacts", "clientCompany");
}
