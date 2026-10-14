import { config } from "dotenv";
import { z } from "zod";

config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env" });

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().int().default(5433),
  DB_USER: z.string().min(1),
  DB_PASS: z.string().min(1),
  DB_NAME: z.string().min(1),
  DB_LOGGING: bool,
  REDIS_URL: z.string().default("redis://localhost:6380/0"),
  JWT_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  EVOLUTION_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(1),
  BACKEND_PUBLIC_URL: z.string().url(),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  MEDIA_DIR: z.string().default("./public/media"),
  INBOUND_SHARDS: z.coerce.number().int().min(1).default(8),
  OUTBOUND_SHARDS: z.coerce.number().int().min(1).default(8),
  BULL_BOARD_USER: z.string().optional(),
  BULL_BOARD_PASS: z.string().optional(),
  SEED_ADMIN_EMAIL: z.string().email().default("admin@whatson.local"),
  SEED_ADMIN_PASSWORD: z.string().min(6).default("admin123"),
});

export const env = schema.parse(process.env);
export type Env = typeof env;
