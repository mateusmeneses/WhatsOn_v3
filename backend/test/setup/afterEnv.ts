import { sequelize } from "../../src/database/sequelize";
import { closeQueues } from "../../src/queues";
import { closeRedis } from "../../src/shared/redis";

afterAll(async () => {
  await closeQueues();
  await closeRedis();
  await sequelize.close();
});
