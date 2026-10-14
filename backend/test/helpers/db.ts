import { sequelize } from "../../src/database/sequelize";

const TABLES = [
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
];

export async function resetDb(): Promise<void> {
  await sequelize.query(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
}
