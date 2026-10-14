import { SequelizeStorage, Umzug } from "umzug";
import { migrations } from "./migrations";
import { sequelize } from "./sequelize";

export const migrator = new Umzug({
  migrations: migrations.map((m) => ({
    name: m.name,
    up: async () => m.up(sequelize.getQueryInterface()),
    down: async () => m.down(sequelize.getQueryInterface()),
  })),
  storage: new SequelizeStorage({ sequelize }),
  logger: undefined,
});
