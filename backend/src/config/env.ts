import { config } from "dotenv";
import { z } from "zod";

config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env" });

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

/** Linha vazia no .env (ex.: copiada do .env.example) vale como não definida. */
const emptyAsUndefined = (v: unknown) => (v === "" ? undefined : v);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  /** Versão do build (yyyy.MM.dd.N), vinda do version.txt pelos scripts de deploy. */
  APP_VERSION: z.preprocess(emptyAsUndefined, z.string().default("0.0.0.0")),
  /** Data/hora do build (dd/MM/yyyy HH:mm), gravada pelos scripts de deploy. */
  APP_BUILD_TIME: z.preprocess(emptyAsUndefined, z.string().default("")),
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
  /** Requisições por minuto por token na API externa (/api/v1). */
  EXTERNAL_API_RATE_LIMIT: z.coerce.number().int().min(1).default(60),
  PARTNER_API_RATE_LIMIT: z.coerce.number().int().min(1).default(60),
  BULL_BOARD_USER: z.string().optional(),
  BULL_BOARD_PASS: z.string().optional(),
  SEED_ADMIN_EMAIL: z.string().email().default("admin@whatson.local"),
  SEED_ADMIN_PASSWORD: z.string().min(6).default("admin123"),
  /** Integração com o Manager (só a empresa MANAGER_COMPANY_ID; vazio = desligada). */
  MANAGER_API_URL: z.preprocess(emptyAsUndefined, z.string().url().optional()),
  MANAGER_API_TOKEN: z.preprocess(emptyAsUndefined, z.string().min(16).optional()),
  MANAGER_COMPANY_ID: z.preprocess(emptyAsUndefined, z.coerce.number().int().positive().optional()),
  /** Super-admin da plataforma, criado na subida se ainda não existir. */
  SUPERADMIN_EMAIL: z.preprocess(emptyAsUndefined, z.string().email().optional()),
  SUPERADMIN_PASSWORD: z.preprocess(emptyAsUndefined, z.string().min(8).optional()),
});

/** Valores de exemplo (.env.example da raiz e do backend) que nunca podem ir para produção. */
export const PLACEHOLDER_SECRETS = new Set([
  "troque-esta-chave",
  "troque-por-uma-string-longa-aleatoria",
  "troque-por-outra-string-longa-aleatoria",
  "dev-access-secret-change-me-123",
  "dev-refresh-secret-change-me-123",
]);

type ProductionEnvInput = Pick<
  z.infer<typeof schema>,
  "NODE_ENV" | "JWT_SECRET" | "JWT_REFRESH_SECRET" | "EVOLUTION_API_KEY" | "SEED_ADMIN_PASSWORD"
>;

/** Em produção recusa segredos de exemplo/curtos e a senha padrão do admin. */
export function validateProductionEnv(input: ProductionEnvInput): void {
  if (input.NODE_ENV !== "production") return;
  const problems: string[] = [];
  for (const key of ["JWT_SECRET", "JWT_REFRESH_SECRET", "EVOLUTION_API_KEY"] as const) {
    const value = input[key];
    if (PLACEHOLDER_SECRETS.has(value)) problems.push(`${key} está com o valor de exemplo`);
    else if (value.length < 32) problems.push(`${key} deve ter pelo menos 32 caracteres`);
  }
  if (input.SEED_ADMIN_PASSWORD === "admin123") problems.push("SEED_ADMIN_PASSWORD não pode ser \"admin123\"");
  if (problems.length) {
    throw new Error(`Configuração insegura para produção: ${problems.join("; ")}. Ajuste o arquivo .env.`);
  }
}

export const env = schema.parse(process.env);
validateProductionEnv(env);
export type Env = typeof env;
