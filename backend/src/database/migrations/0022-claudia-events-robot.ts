import { DataTypes, QueryInterface } from "sequelize";

/**
 * Avisos à Claudia guardados como foram enviados (reenvio igual e recuperação por GET /api/v1/webhook/eventos) e a
 * marca de contato robô (mensagens automáticas de terceiros: não geram aviso).
 */
export async function up(qi: QueryInterface): Promise<void> {
  await qi.createTable("claudia_events", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    eventId: { type: DataTypes.STRING, allowNull: false, unique: true },
    event: { type: DataTypes.STRING, allowNull: false },
    ticketId: { type: DataTypes.INTEGER, allowNull: true },
    payload: { type: DataTypes.JSONB, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.addIndex("claudia_events", ["createdAt"], { name: "claudia_events_created" });
  await qi.addIndex("claudia_events", ["ticketId", "createdAt"], { name: "claudia_events_ticket" });
  await qi.addColumn("contacts", "isRobot", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
}

export async function down(qi: QueryInterface): Promise<void> {
  await qi.removeColumn("contacts", "isRobot");
  await qi.dropTable("claudia_events");
}
