import { DataTypes, QueryInterface } from "sequelize";

/** Registro de cada tentativa de aviso (webhook) enviado à Claudia: data, evento, conversa e código de resposta. */
export async function up(qi: QueryInterface): Promise<void> {
  await qi.createTable("claudia_webhook_logs", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    eventId: { type: DataTypes.STRING, allowNull: false },
    event: { type: DataTypes.STRING, allowNull: false },
    ticketId: { type: DataTypes.INTEGER, allowNull: true },
    attempt: { type: DataTypes.INTEGER, allowNull: false },
    statusCode: { type: DataTypes.INTEGER, allowNull: true },
    error: { type: DataTypes.TEXT, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.addIndex("claudia_webhook_logs", ["createdAt"], { name: "claudia_webhook_logs_created" });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.dropTable("claudia_webhook_logs");
}
