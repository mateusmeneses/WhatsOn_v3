import http from "node:http";
import { createApp } from "./app";
import { mountBullBoard } from "./bullBoard";
import { env } from "./config/env";
import { migrator } from "./database/migrator";
import { seed } from "./database/seed";
import { sequelize } from "./database/sequelize";
import { closeSocket, initSocket } from "./modules/realtime/socket";
import { canJoinTicket } from "./modules/tickets/tickets.service";
import { getProvider } from "./modules/whatsapp/registry";
import { closeQueues } from "./queues";
import { closeRedis, getRedis } from "./shared/redis";
import { logger } from "./shared/logger";
import { scheduleRecurringJobs, startWorkers } from "./workers";

const SHUTDOWN_TIMEOUT_MS = 30_000;

async function main(): Promise<void> {
  await sequelize.authenticate();
  await migrator.up();
  const seeded = await seed();
  if (seeded.created) logger.warn({ email: env.SEED_ADMIN_EMAIL }, "admin inicial criado; troque a senha no primeiro acesso");

  const app = createApp({
    healthChecks: {
      database: () => sequelize.authenticate(),
      redis: () => getRedis().ping(),
      evolution: () => getProvider().ping(),
    },
    beforeErrorHandler: mountBullBoard,
  });

  const server = http.createServer(app);
  initSocket(server, { canJoinTicket });
  const workers = startWorkers();
  await scheduleRecurringJobs();
  server.listen(env.PORT, () => logger.info({ port: env.PORT }, "backend no ar"));

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "encerrando");
    const force = setTimeout(() => {
      logger.error("shutdown demorou demais; forçando saída");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();
    await closeSocket(); // fecha também o servidor HTTP
    await Promise.all(workers.map((w) => w.close())); // espera os jobs em andamento
    await closeQueues();
    await closeRedis();
    await sequelize.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err }, "falha ao iniciar");
  process.exit(1);
});
