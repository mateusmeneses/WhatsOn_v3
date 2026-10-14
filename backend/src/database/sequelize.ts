import "reflect-metadata";
import { Sequelize } from "sequelize-typescript";
import { env } from "../config/env";
import { models } from "../models";
import { logger } from "../shared/logger";

export const sequelize = new Sequelize({
  dialect: "postgres",
  host: env.DB_HOST,
  port: env.DB_PORT,
  username: env.DB_USER,
  password: env.DB_PASS,
  database: env.DB_NAME,
  models,
  logging: env.DB_LOGGING ? (sql: string) => logger.debug(sql) : false,
  pool: { max: 20, min: 0, idle: 10_000 },
});
