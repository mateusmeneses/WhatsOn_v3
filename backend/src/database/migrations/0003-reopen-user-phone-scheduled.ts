import { DataTypes, QueryInterface } from "sequelize";

export async function up(qi: QueryInterface): Promise<void> {
  await qi.addColumn("users", "phone", { type: DataTypes.STRING, allowNull: true });
  await qi.addColumn("users", "mustChangePassword", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });

  await qi.createTable("scheduled_messages", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
    companyId: { type: DataTypes.INTEGER, allowNull: false, references: { model: "companies", key: "id" }, onDelete: "CASCADE" },
    ticketId: { type: DataTypes.INTEGER, allowNull: false, references: { model: "tickets", key: "id" }, onDelete: "CASCADE" },
    userId: { type: DataTypes.INTEGER, allowNull: true, references: { model: "users", key: "id" }, onDelete: "SET NULL" },
    body: { type: DataTypes.TEXT, allowNull: false },
    sendAt: { type: DataTypes.DATE, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "pending" },
    messageId: { type: DataTypes.INTEGER, allowNull: true, references: { model: "messages", key: "id" }, onDelete: "SET NULL" },
    error: { type: DataTypes.TEXT, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    updatedAt: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.addIndex("scheduled_messages", ["status", "sendAt"], { name: "scheduled_messages_due" });
  await qi.addIndex("scheduled_messages", ["ticketId"], { name: "scheduled_messages_ticket" });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.dropTable("scheduled_messages");
  await qi.removeColumn("users", "mustChangePassword");
  await qi.removeColumn("users", "phone");
}
