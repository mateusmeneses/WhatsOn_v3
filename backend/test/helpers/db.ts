import { sequelize } from "../../src/database/sequelize";

const TABLES = [
  "partners",
  "companies",
  "users",
  "user_queues",
  "queues",
  "connections",
  "contacts",
  "tickets",
  "messages",
  "chatbot_nodes",
  "ticket_logs",
  "scheduled_messages",
];

export async function resetDb(): Promise<void> {
  await sequelize.query(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
}
