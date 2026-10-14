# WHATSON2 Backend do Núcleo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o backend do subprojeto 1 do WHATSON2 (multiempresa, usuários, filas, conexões via Evolution API, contatos, tickets, mensagens, chatbot de menu e tempo real), pronto para ser consumido pelo frontend (Plano B).

**Architecture:** API Express em camadas (routes → service → models Sequelize) organizada por módulo em `backend/src/modules/*`. Webhooks da Evolution API entram por uma rota fina que só enfileira; workers BullMQ particionados em shards (concorrência 1 por shard) processam entrada e saída em ordem por contato/ticket. O motor do chatbot é uma função pura (`step`) e todo acesso ao WhatsApp passa pela interface `WhatsAppProvider`.

**Tech Stack:** Node 24, TypeScript 5, Express 4, Sequelize 6 + sequelize-typescript 2, Postgres 16, Redis 7, BullMQ 5, Socket.io 4, pino, zod 3, Jest 29 + ts-jest + supertest + nock, Docker Compose, Evolution API v2.

**Spec:** `docs/superpowers/specs/2026-10-13-whatson2-nucleo-design.md`

**Escopo deste plano:** apenas o backend (seções 2–7, 9 e 10 da spec, exceto itens de UI). O frontend (telas, identidade Clean SaaS, seção 8 da spec) vem no **Plano B**, escrito depois que este plano estiver executado, porque depende dos contratos de API definidos aqui.

## Global Constraints

- Node.js ≥ 24 local; imagem Docker `node:24-alpine`.
- Postgres 16 (`postgres:16-alpine`), Redis 7 (`redis:7-alpine`), Evolution API v2 (`evoapicloud/evolution-api`).
- Portas no host: Postgres `5433`, Redis `6380`, Evolution `8080`, backend `4000` (evita conflito com o WHATSON v1).
- Sem integrações externas (Typebot, n8n, Dify, OpenAI, Dialogflow), sem campanhas, sem Cloud API oficial, sem grupos.
- Identificadores de código em inglês; mensagens para usuário final e erros da API em pt-BR.
- Toda resposta de erro da API: `{ "error": { "code": string, "message": string } }`.
- Toda query de dados de negócio filtra por `companyId` vindo do token (`req.auth.companyId`), nunca do corpo da requisição.
- Perfis: `admin`, `supervisor`, `agent`.
- Status de ticket: `bot`, `pending`, `open`, `closed`. Ack de mensagem: `pending`, `sent`, `delivered`, `read`, `failed`.
- Chatbot: máximo de **3** entradas inválidas antes de transferir para a fila padrão; timeout padrão **30** minutos.
- Todas as colunas de model declaram `DataType` explicitamente (o `tsx` não emite metadata de decorators).
- Testes rodam com `jest --runInBand` contra Postgres/Redis reais do `docker compose` (banco `whatson_test`, Redis db 1).

## Review Focus

1. Eco da própria mensagem: a Evolution devolve como `fromMe` uma mensagem que acabamos de enviar antes de gravarmos o `providerMessageId` → não pode duplicar no chat (teste na Task 14).
2. Contatos com JID `@lid` (novo formato do WhatsApp): quando o payload traz `remoteJidAlt`/`senderPn`, o contato deve usar o número de telefone real (teste na Task 7).
3. Cliente manda mensagem enquanto o ticket está `pending` (já transferido pelo bot) → mensagem entra no ticket e o bot **não** responde de novo (teste na Task 14).
4. Cliente manda mensagem depois do ticket `closed` → nasce um ticket novo, que passa de novo pelo bot (teste na Task 14).
5. Fila excluída que ainda está como destino de uma opção do bot (`queueId` virou `NULL`) → o bot transfere para a fila padrão da conexão em vez de deixar o ticket sem fila (teste na Task 10).

## File Structure

```
docker-compose.yml                    # postgres, redis (Task 1) + evolution, backend (Task 15)
docker/postgres/init.sql              # cria bancos evolution e whatson_test
.env.example                          # variáveis do compose
docs/smoke-test.md                    # roteiro manual com Evolution real (Task 15)
backend/
  package.json, tsconfig.json, tsconfig.build.json, jest.config.js, Dockerfile
  .env.example, .env.test
  src/
    server.ts                         # bootstrap: migrations, seed, http, socket, workers, shutdown
    app.ts                            # createApp(): middlewares, rotas, error handler
    routes.ts                         # monta os routers dos módulos em /api
    workers.ts                        # inicia workers e jobs recorrentes
    bullBoard.ts                      # painel /admin/queues
    config/env.ts                     # variáveis de ambiente validadas com zod
    types/express.d.ts                # req.auth
    shared/
      logger.ts                       # pino
      redis.ts                        # conexões ioredis
      health.ts                       # createHealthHandler
      http.ts                         # idParam, PAGE_SIZE, paginate
      errors/AppError.ts, errors/errorHandler.ts
    database/
      sequelize.ts, migrator.ts, cli.ts, seed.ts
      migrations/index.ts, migrations/0001-initial.ts
    models/                           # um arquivo por tabela + index.ts
    queues/
      index.ts                        # getQueue, createWorker, shardFor, QueueNames
      botTimeout.ts                   # agendar/cancelar timeout do bot
    modules/
      auth/        auth.types.ts tokens.ts auth.middleware.ts auth.service.ts auth.routes.ts
      queues/      schedule.ts queues.service.ts queues.routes.ts
      users/       userQueues.ts users.service.ts users.routes.ts
      companies/   companies.routes.ts
      contacts/    contacts.service.ts contacts.routes.ts
      media/       media.storage.ts media.routes.ts
      whatsapp/    provider.ts registry.ts evolution/parseWebhook.ts evolution/EvolutionProvider.ts
      realtime/    socket.ts
      connections/ connections.service.ts connections.routes.ts maintenance.ts
      messages/    messages.service.ts outbound.ts agentMessages.service.ts messages.routes.ts
      tickets/     ticket.events.ts visibility.ts tickets.service.ts tickets.routes.ts
      chatbot/     engine.ts chatbot.service.ts chatbot.routes.ts botTimeout.worker.ts
      inbound/     inbound.ts handleMessage.ts webhook.routes.ts
  test/
    setup/globalSetup.ts, setup/afterEnv.ts
    helpers/db.ts, redis.ts, factories.ts, auth.ts, fakeProvider.ts, waitFor.ts
    fixtures/evolution.ts
    unit/*.test.ts, integration/*.test.ts
```

---

### Task 1: Scaffold do backend e infraestrutura local

**Files:**
- Create: `docker-compose.yml`, `docker/postgres/init.sql`, `.env.example`
- Modify: `.gitignore`
- Create: `backend/package.json` (via npm), `backend/tsconfig.json`, `backend/tsconfig.build.json`, `backend/jest.config.js`, `backend/.env.example`, `backend/.env.test`
- Create: `backend/src/config/env.ts`, `backend/src/shared/logger.ts`, `backend/src/shared/errors/AppError.ts`, `backend/src/shared/errors/errorHandler.ts`, `backend/src/shared/health.ts`, `backend/src/routes.ts`, `backend/src/app.ts`
- Test: `backend/test/unit/health.test.ts`, `backend/test/unit/errorHandler.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `env` (objeto tipado) em `src/config/env.ts` com todas as variáveis usadas no plano.
  - `logger` (pino) em `src/shared/logger.ts`.
  - `class AppError(code: string, status = 400, message?: string)` e `notFound(what?: string): AppError` em `src/shared/errors/AppError.ts`.
  - `errorHandler: ErrorRequestHandler`.
  - `type HealthCheck = () => Promise<unknown>`; `createHealthHandler(checks: Record<string, HealthCheck>): RequestHandler`.
  - `createApp(options?: { healthChecks?: Record<string, HealthCheck>; beforeErrorHandler?: (app: Express) => void }): Express`.
  - `apiRoutes: Router` em `src/routes.ts`.

- [x] **Step 1: Infra Docker (Postgres + Redis)**

`docker-compose.yml`:

```yaml
name: whatson2

services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${DB_USER:-whatson}
      POSTGRES_PASSWORD: ${DB_PASS:-whatson}
      POSTGRES_DB: ${DB_NAME:-whatson}
    ports:
      - "5433:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-whatson} -d ${DB_NAME:-whatson}"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - "6380:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  postgres_data:
  redis_data:
```

`docker/postgres/init.sql`:

```sql
CREATE DATABASE evolution;
CREATE DATABASE whatson_test;
```

`.env.example` (raiz, usado pelo compose):

```env
DB_USER=whatson
DB_PASS=whatson
DB_NAME=whatson
EVOLUTION_API_KEY=troque-esta-chave
JWT_SECRET=troque-por-uma-string-longa-aleatoria
JWT_REFRESH_SECRET=troque-por-outra-string-longa-aleatoria
FRONTEND_URL=http://localhost:5173
SEED_ADMIN_EMAIL=admin@whatson.local
SEED_ADMIN_PASSWORD=admin123
BULL_BOARD_USER=admin
BULL_BOARD_PASS=troque-esta-senha
```

Acrescente ao `.gitignore` da raiz:

```gitignore
backend/tmp/
backend/public/media/
coverage/
```

- [x] **Step 2: Subir a infra e conferir**

Run: `docker compose up -d postgres redis && docker compose ps`
Expected: `postgres` e `redis` com status `healthy`.

Run: `docker compose exec postgres psql -U whatson -l`
Expected: lista contém `evolution`, `whatson`, `whatson_test`.

- [x] **Step 3: Criar o projeto Node e instalar dependências**

Run (em `backend/`):

```bash
npm init -y
npm pkg set name=whatson2-backend version=0.1.0 private=true
npm pkg set scripts.dev="tsx watch src/server.ts" scripts.build="tsc -p tsconfig.build.json" scripts.start="node dist/server.js" scripts.test="jest --runInBand" scripts.typecheck="tsc --noEmit" scripts.migrate="tsx src/database/cli.ts up" scripts.migrate:down="tsx src/database/cli.ts down" scripts.seed="tsx src/database/seed.ts"
npm i express@4 express-async-errors@3 cors@2 helmet@7 zod@3 dotenv@16 pino@9 multer@2 sequelize@6 sequelize-typescript@2 reflect-metadata@0.2 pg@8 pg-hstore@2 umzug@3 bullmq@5 ioredis@5 socket.io@4 jsonwebtoken@9 bcryptjs@2 axios@1 @bull-board/api@6 @bull-board/express@6 express-basic-auth@1
npm i -D typescript@5 tsx@4 jest@29 ts-jest@29 @types/jest@29 supertest@7 @types/supertest@6 @types/express@4 @types/cors@2 @types/jsonwebtoken@9 @types/bcryptjs@2 @types/multer@1 @types/node@22 nock@13 socket.io-client@4
```

Expected: instalação sem erros.

- [x] **Step 4: Configuração TypeScript, Jest e env**

`backend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "lib": ["ES2022"],
    "module": "commonjs",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node", "jest"]
  },
  "include": ["src", "test"]
}
```

`backend/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "types": ["node"] },
  "include": ["src"]
}
```

`backend/jest.config.js`:

```js
/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  testTimeout: 15000,
};
```

`backend/.env.example` (desenvolvimento local com backend fora do Docker):

```env
NODE_ENV=development
PORT=4000
LOG_LEVEL=debug
DB_HOST=localhost
DB_PORT=5433
DB_USER=whatson
DB_PASS=whatson
DB_NAME=whatson
DB_LOGGING=false
REDIS_URL=redis://localhost:6380/0
JWT_SECRET=dev-access-secret-change-me-123
JWT_REFRESH_SECRET=dev-refresh-secret-change-me-123
EVOLUTION_URL=http://localhost:8080
EVOLUTION_API_KEY=troque-esta-chave
# URL pela qual o container da Evolution alcança este backend
BACKEND_PUBLIC_URL=http://host.docker.internal:4000
FRONTEND_URL=http://localhost:5173
MEDIA_DIR=./public/media
INBOUND_SHARDS=8
OUTBOUND_SHARDS=8
SEED_ADMIN_EMAIL=admin@whatson.local
SEED_ADMIN_PASSWORD=admin123
```

`backend/.env.test` (versionado; só valores de teste):

```env
NODE_ENV=test
LOG_LEVEL=silent
DB_HOST=localhost
DB_PORT=5433
DB_USER=whatson
DB_PASS=whatson
DB_NAME=whatson_test
REDIS_URL=redis://localhost:6380/1
JWT_SECRET=test-access-secret-0123456789
JWT_REFRESH_SECRET=test-refresh-secret-0123456789
EVOLUTION_URL=http://evolution.test
EVOLUTION_API_KEY=test-evolution-key
BACKEND_PUBLIC_URL=http://backend.test
FRONTEND_URL=http://localhost:5173
MEDIA_DIR=./tmp/test-media
INBOUND_SHARDS=2
OUTBOUND_SHARDS=2
```

- [x] **Step 5: Escrever os testes que falham**

`backend/test/unit/health.test.ts`:

```ts
import express from "express";
import request from "supertest";
import { createHealthHandler, HealthCheck } from "../../src/shared/health";

function appWith(checks: Record<string, HealthCheck>) {
  const app = express();
  app.get("/health", createHealthHandler(checks));
  return app;
}

describe("health handler", () => {
  it("returns 200 when every check passes", async () => {
    const res = await request(appWith({ database: async () => undefined })).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.checks).toEqual({ database: "ok" });
  });

  it("returns 503 and reports which check failed", async () => {
    const res = await request(
      appWith({
        database: async () => undefined,
        redis: async () => {
          throw new Error("down");
        },
      }),
    ).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks).toEqual({ database: "ok", redis: "fail" });
  });

  it("fails a check that hangs longer than the timeout", async () => {
    const res = await request(appWith({ slow: () => new Promise(() => undefined) })).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ slow: "fail" });
  }, 10000);
});
```

`backend/test/unit/errorHandler.test.ts`:

```ts
import "express-async-errors";
import express from "express";
import request from "supertest";
import { z } from "zod";
import { AppError } from "../../src/shared/errors/AppError";
import { errorHandler } from "../../src/shared/errors/errorHandler";

const app = express();
app.use(express.json());
app.get("/app-error", () => {
  throw new AppError("TEAPOT", 418, "Sou um bule");
});
app.get("/zod", () => {
  z.object({ name: z.string() }).parse({});
});
app.get("/boom", async () => {
  throw new Error("detalhe secreto");
});
app.post("/json", (_req, res) => {
  res.json({ ok: true });
});
app.use(errorHandler);

describe("errorHandler", () => {
  it("serializes AppError with its status", async () => {
    const res = await request(app).get("/app-error");
    expect(res.status).toBe(418);
    expect(res.body).toEqual({ error: { code: "TEAPOT", message: "Sou um bule" } });
  });

  it("turns ZodError into 400 VALIDATION_ERROR", async () => {
    const res = await request(app).get("/zod");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toContain("name");
  });

  it("hides unexpected errors behind 500", async () => {
    const res = await request(app).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Erro interno" } });
  });

  it("answers 400 for malformed JSON", async () => {
    const res = await request(app).post("/json").set("Content-Type", "application/json").send("{ruim");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });
});
```

- [x] **Step 6: Rodar e ver falhar**

Run (em `backend/`): `npx jest test/unit`
Expected: FAIL com `Cannot find module '../../src/shared/health'`.

- [x] **Step 7: Implementar**

`backend/src/config/env.ts`:

```ts
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
```

`backend/src/shared/logger.ts`:

```ts
import pino from "pino";
import { env } from "../config/env";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});
```

`backend/src/shared/errors/AppError.ts`:

```ts
export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400, message?: string) {
    super(message ?? code);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export function notFound(what = "Registro"): AppError {
  return new AppError("NOT_FOUND", 404, `${what} não encontrado`);
}
```

`backend/src/shared/errors/errorHandler.ts`:

```ts
import { ErrorRequestHandler } from "express";
import { MulterError } from "multer";
import { ZodError } from "zod";
import { logger } from "../logger";
import { AppError } from "./AppError";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message } });
    return;
  }
  if (err instanceof MulterError) {
    res.status(400).json({ error: { code: "UPLOAD_ERROR", message: err.message } });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "INVALID_JSON", message: "JSON inválido" } });
    return;
  }
  logger.error({ err, path: req.path }, "unhandled error");
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Erro interno" } });
};
```

`backend/src/shared/health.ts`:

```ts
import { RequestHandler } from "express";

export type HealthCheck = () => Promise<unknown>;

const CHECK_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createHealthHandler(checks: Record<string, HealthCheck>): RequestHandler {
  return async (_req, res) => {
    const results: Record<string, "ok" | "fail"> = {};
    await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          await withTimeout(check(), CHECK_TIMEOUT_MS);
          results[name] = "ok";
        } catch {
          results[name] = "fail";
        }
      }),
    );
    const healthy = Object.values(results).every((r) => r === "ok");
    res.status(healthy ? 200 : 503).json({
      status: healthy ? "ok" : "degraded",
      checks: results,
      timestamp: new Date().toISOString(),
    });
  };
}
```

`backend/src/routes.ts`:

```ts
import { Router } from "express";

export const apiRoutes = Router();
```

`backend/src/app.ts`:

```ts
import "express-async-errors";
import path from "node:path";
import cors from "cors";
import express, { Express } from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { apiRoutes } from "./routes";
import { errorHandler } from "./shared/errors/errorHandler";
import { createHealthHandler, HealthCheck } from "./shared/health";

export interface AppOptions {
  healthChecks?: Record<string, HealthCheck>;
  beforeErrorHandler?: (app: Express) => void;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors({ origin: env.FRONTEND_URL }));
  app.use(express.json({ limit: "5mb" }));

  app.get("/health", createHealthHandler(options.healthChecks ?? {}));
  app.use("/media", express.static(path.resolve(env.MEDIA_DIR), { index: false }));
  app.use("/api", apiRoutes);

  options.beforeErrorHandler?.(app);
  app.use(errorHandler);
  return app;
}
```

- [x] **Step 8: Rodar testes e typecheck**

Run: `npx jest test/unit && npm run typecheck`
Expected: 7 testes PASS; `tsc` sem erros.

- [x] **Step 9: Commit**

```bash
git add .gitignore docker-compose.yml docker .env.example backend
git commit -m "chore: scaffold do backend e infra local (postgres, redis)"
```

---

### Task 2: Banco de dados, filas e harness de testes

**Files:**
- Create: `backend/src/models/{Company,User,Queue,UserQueue,Connection,Contact,Ticket,Message,ChatbotNode,TicketLog,index}.ts`
- Create: `backend/src/database/{sequelize,migrator,cli}.ts`, `backend/src/database/migrations/{index,0001-initial}.ts`
- Create: `backend/src/shared/redis.ts`, `backend/src/queues/index.ts`, `backend/src/queues/botTimeout.ts`
- Modify: `backend/src/app.ts` (importar o sequelize), `backend/jest.config.js`
- Create: `backend/test/setup/{globalSetup,afterEnv}.ts`, `backend/test/helpers/{db,redis,factories,waitFor}.ts`
- Test: `backend/test/integration/constraints.test.ts`, `backend/test/integration/queuesInfra.test.ts`

**Interfaces:**
- Consumes: `env`, `logger` (Task 1).
- Produces:
  - Models (todos exportados de `src/models/index.ts`): `Company`, `User`, `Queue`, `UserQueue`, `Connection`, `Contact`, `Ticket`, `Message`, `ChatbotNode`, `TicketLog`.
  - Tipos: `Profile`, `WeekSchedule`, `ConnectionStatus`, `TicketStatus`, `MessageType`, `Ack`, `BotAction`, `TicketEvent`.
  - `sequelize` (instância), `migrator` (Umzug).
  - `getRedis(): IORedis`, `createRedis(): IORedis`, `closeRedis(): Promise<void>`.
  - `QueueNames = { inbound(shard), outbound(shard), botTimeout: "bot-timeout", maintenance: "maintenance" }`.
  - `shardFor(key: string, shards: number): number`, `getQueue(name: string): Queue`, `createWorker<T>(name, processor, opts?): Worker<T>`, `closeQueues(): Promise<void>`.
  - `scheduleBotTimeout(ticketId: number, minutes: number): Promise<void>`, `cancelBotTimeout(ticketId: number): Promise<void>`, `botTimeoutJobId(ticketId: number): string`.
  - Helpers de teste: `resetDb()`, `resetRedis()`, `waitFor(fn, predicate, timeoutMs?)`, factories `createCompany`, `createUser`, `createQueue`, `createConnection`, `createContact`, `createTicket`, `createMessage`, `createNode`, `scenario()`.

- [x] **Step 1: Models**

`backend/src/models/Company.ts`:

```ts
import { Column, DataType, Model, Table } from "sequelize-typescript";

@Table({ tableName: "companies" })
export class Company extends Model {
  @Column({ type: DataType.STRING, allowNull: false })
  name!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "active" })
  status!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "America/Sao_Paulo" })
  timezone!: string;
}
```

`backend/src/models/User.ts`:

```ts
import { Column, DataType, Model, Table } from "sequelize-typescript";

export type Profile = "admin" | "supervisor" | "agent";

@Table({ tableName: "users" })
export class User extends Model {
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId!: number;

  @Column({ type: DataType.STRING, allowNull: false })
  name!: string;

  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  email!: string;

  @Column({ type: DataType.STRING, allowNull: false })
  passwordHash!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "agent" })
  profile!: Profile;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  online!: boolean;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  tokenVersion!: number;
}
```

`backend/src/models/Queue.ts`:

```ts
import { Column, DataType, Model, Table } from "sequelize-typescript";

export type WeekDay = "0" | "1" | "2" | "3" | "4" | "5" | "6";
/** Chave = dia da semana (0 = domingo). Valor = intervalos "HH:mm-HH:mm". Objeto vazio = sempre aberto. */
export type WeekSchedule = Partial<Record<WeekDay, string[]>>;

@Table({ tableName: "queues" })
export class Queue extends Model {
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId!: number;

  @Column({ type: DataType.STRING, allowNull: false })
  name!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "#6d5dfc" })
  color!: string;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {} })
  schedule!: WeekSchedule;
}
```

`backend/src/models/UserQueue.ts`:

```ts
import { Column, DataType, Model, PrimaryKey, Table } from "sequelize-typescript";

@Table({ tableName: "user_queues", timestamps: false })
export class UserQueue extends Model {
  @PrimaryKey
  @Column({ type: DataType.INTEGER, allowNull: false })
  userId!: number;

  @PrimaryKey
  @Column({ type: DataType.INTEGER, allowNull: false })
  queueId!: number;
}
```

`backend/src/models/Connection.ts`:

```ts
import { Column, DataType, Model, Table } from "sequelize-typescript";

export type ConnectionStatus = "disconnected" | "qrcode" | "connected";

export const DEFAULT_TRANSFER_MESSAGE = "Aguarde, em instantes um atendente irá falar com você.";
export const DEFAULT_OUT_OF_HOURS_MESSAGE =
  "Nosso horário de atendimento encerrou. Sua mensagem foi registrada e responderemos assim que possível.";

@Table({ tableName: "connections" })
export class Connection extends Model {
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId!: number;

  @Column({ type: DataType.STRING, allowNull: false })
  name!: string;

  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  instanceName!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "disconnected" })
  status!: ConnectionStatus;

  @Column({ type: DataType.STRING, allowNull: true })
  number!: string | null;

  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  webhookToken!: string;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  isDefault!: boolean;

  @Column({ type: DataType.INTEGER, allowNull: true })
  defaultQueueId!: number | null;

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: DEFAULT_OUT_OF_HOURS_MESSAGE })
  outOfHoursMessage!: string;

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: "" })
  closingMessage!: string;

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: DEFAULT_TRANSFER_MESSAGE })
  transferMessage!: string;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 30 })
  botTimeoutMinutes!: number;
}
```

`backend/src/models/Contact.ts`:

```ts
import { Column, DataType, Model, Table } from "sequelize-typescript";

@Table({ tableName: "contacts" })
export class Contact extends Model {
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId!: number;

  @Column({ type: DataType.STRING, allowNull: false })
  name!: string;

  @Column({ type: DataType.STRING, allowNull: false })
  number!: string;

  @Column({ type: DataType.STRING, allowNull: true })
  profilePicUrl!: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  isGroup!: boolean;
}
```

`backend/src/models/Ticket.ts`:

```ts
import { BelongsTo, Column, DataType, Model, Table } from "sequelize-typescript";
import { Connection } from "./Connection";
import { Contact } from "./Contact";
import { Queue } from "./Queue";
import { User } from "./User";

export type TicketStatus = "bot" | "pending" | "open" | "closed";

@Table({ tableName: "tickets" })
export class Ticket extends Model {
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId!: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  contactId!: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  connectionId!: number;

  @Column({ type: DataType.INTEGER, allowNull: true })
  queueId!: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  userId!: number | null;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "pending" })
  status!: TicketStatus;

  @Column({ type: DataType.INTEGER, allowNull: true })
  chatbotNodeId!: number | null;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  chatbotAttempts!: number;

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: "" })
  lastMessage!: string;

  @Column({ type: DataType.DATE, allowNull: true })
  lastMessageAt!: Date | null;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  unreadCount!: number;

  @Column({ type: DataType.DATE, allowNull: true })
  closedAt!: Date | null;

  @BelongsTo(() => Contact, "contactId")
  contact?: Contact;

  @BelongsTo(() => Connection, "connectionId")
  connection?: Connection;

  @BelongsTo(() => Queue, "queueId")
  queue?: Queue | null;

  @BelongsTo(() => User, "userId")
  user?: User | null;
}
```

`backend/src/models/Message.ts`:

```ts
import { BelongsTo, Column, DataType, Model, Table } from "sequelize-typescript";
import { Ticket } from "./Ticket";

export type MessageType = "text" | "image" | "audio" | "video" | "document" | "sticker" | "location";
export type Ack = "pending" | "sent" | "delivered" | "read" | "failed";

@Table({ tableName: "messages" })
export class Message extends Model {
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId!: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  ticketId!: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  connectionId!: number;

  @Column({ type: DataType.STRING, allowNull: true })
  providerMessageId!: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  fromMe!: boolean;

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: "" })
  body!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "text" })
  type!: MessageType;

  @Column({ type: DataType.STRING, allowNull: true })
  mediaUrl!: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  mediaMime!: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  mediaName!: string | null;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "sent" })
  ack!: Ack;

  @Column({ type: DataType.INTEGER, allowNull: true })
  quotedMessageId!: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  sentByUserId!: number | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  isBot!: boolean;

  @BelongsTo(() => Ticket, "ticketId")
  ticket?: Ticket;
}
```

`backend/src/models/ChatbotNode.ts`:

```ts
import { Column, DataType, Model, Table } from "sequelize-typescript";

export type BotAction = "submenu" | "reply" | "transfer_queue" | "transfer_agent" | "close";

@Table({ tableName: "chatbot_nodes" })
export class ChatbotNode extends Model {
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId!: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  connectionId!: number;

  @Column({ type: DataType.INTEGER, allowNull: true })
  parentId!: number | null;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  order!: number;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "" })
  key!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "" })
  title!: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: "submenu" })
  action!: BotAction;

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: "" })
  message!: string;

  @Column({ type: DataType.STRING, allowNull: true })
  mediaUrl!: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  mediaMime!: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  mediaName!: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  queueId!: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  userId!: number | null;
}
```

`backend/src/models/TicketLog.ts`:

```ts
import { Column, DataType, Model, Table } from "sequelize-typescript";

export type TicketEvent = "created" | "accepted" | "transferred" | "closed" | "bot_timeout";

@Table({ tableName: "ticket_logs", updatedAt: false })
export class TicketLog extends Model {
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId!: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  ticketId!: number;

  @Column({ type: DataType.STRING, allowNull: false })
  event!: TicketEvent;

  @Column({ type: DataType.INTEGER, allowNull: true })
  userId!: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  fromQueueId!: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  toQueueId!: number | null;
}
```

`backend/src/models/index.ts`:

```ts
import { ChatbotNode } from "./ChatbotNode";
import { Company } from "./Company";
import { Connection } from "./Connection";
import { Contact } from "./Contact";
import { Message } from "./Message";
import { Queue } from "./Queue";
import { Ticket } from "./Ticket";
import { TicketLog } from "./TicketLog";
import { User } from "./User";
import { UserQueue } from "./UserQueue";

export * from "./ChatbotNode";
export * from "./Company";
export * from "./Connection";
export * from "./Contact";
export * from "./Message";
export * from "./Queue";
export * from "./Ticket";
export * from "./TicketLog";
export * from "./User";
export * from "./UserQueue";

export const models = [Company, User, Queue, UserQueue, Connection, Contact, Ticket, Message, ChatbotNode, TicketLog];
```

- [x] **Step 2: Sequelize, migration e migrator**

`backend/src/database/sequelize.ts`:

```ts
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
```

`backend/src/database/migrations/0001-initial.ts`:

```ts
import { DataTypes, Op, QueryInterface } from "sequelize";

const id = { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false };
const timestamps = {
  createdAt: { type: DataTypes.DATE, allowNull: false },
  updatedAt: { type: DataTypes.DATE, allowNull: false },
};
const fk = (model: string, onDelete: "CASCADE" | "SET NULL" | "RESTRICT", allowNull = false) => ({
  type: DataTypes.INTEGER,
  allowNull,
  references: { model, key: "id" },
  onDelete,
  onUpdate: "CASCADE",
});
const str = (allowNull = false, defaultValue?: string) => ({
  type: DataTypes.STRING,
  allowNull,
  ...(defaultValue !== undefined ? { defaultValue } : {}),
});
const text = (defaultValue: string) => ({ type: DataTypes.TEXT, allowNull: false, defaultValue });
const bool = (defaultValue: boolean) => ({ type: DataTypes.BOOLEAN, allowNull: false, defaultValue });
const int = (defaultValue: number) => ({ type: DataTypes.INTEGER, allowNull: false, defaultValue });
const nullableInt = { type: DataTypes.INTEGER, allowNull: true };
const nullableDate = { type: DataTypes.DATE, allowNull: true };

export async function up(qi: QueryInterface): Promise<void> {
  await qi.createTable("companies", {
    id,
    name: str(),
    status: str(false, "active"),
    timezone: str(false, "America/Sao_Paulo"),
    ...timestamps,
  });

  await qi.createTable("users", {
    id,
    companyId: fk("companies", "CASCADE"),
    name: str(),
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    passwordHash: str(),
    profile: str(false, "agent"),
    online: bool(false),
    tokenVersion: int(0),
    ...timestamps,
  });

  await qi.createTable("queues", {
    id,
    companyId: fk("companies", "CASCADE"),
    name: str(),
    color: str(false, "#6d5dfc"),
    schedule: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    ...timestamps,
  });

  await qi.createTable("user_queues", {
    userId: { ...fk("users", "CASCADE"), primaryKey: true },
    queueId: { ...fk("queues", "CASCADE"), primaryKey: true },
  });

  await qi.createTable("connections", {
    id,
    companyId: fk("companies", "CASCADE"),
    name: str(),
    instanceName: { type: DataTypes.STRING, allowNull: false, unique: true },
    status: str(false, "disconnected"),
    number: str(true),
    webhookToken: { type: DataTypes.STRING, allowNull: false, unique: true },
    isDefault: bool(false),
    defaultQueueId: fk("queues", "SET NULL", true),
    outOfHoursMessage: text(
      "Nosso horário de atendimento encerrou. Sua mensagem foi registrada e responderemos assim que possível.",
    ),
    closingMessage: text(""),
    transferMessage: text("Aguarde, em instantes um atendente irá falar com você."),
    botTimeoutMinutes: int(30),
    ...timestamps,
  });

  await qi.createTable("contacts", {
    id,
    companyId: fk("companies", "CASCADE"),
    name: str(),
    number: str(),
    profilePicUrl: str(true),
    isGroup: bool(false),
    ...timestamps,
  });
  await qi.addIndex("contacts", ["companyId", "number"], { unique: true, name: "contacts_company_number_unique" });

  await qi.createTable("tickets", {
    id,
    companyId: fk("companies", "CASCADE"),
    contactId: fk("contacts", "RESTRICT"),
    connectionId: fk("connections", "RESTRICT"),
    queueId: fk("queues", "SET NULL", true),
    userId: fk("users", "SET NULL", true),
    status: str(false, "pending"),
    chatbotNodeId: nullableInt,
    chatbotAttempts: int(0),
    lastMessage: text(""),
    lastMessageAt: nullableDate,
    unreadCount: int(0),
    closedAt: nullableDate,
    ...timestamps,
  });
  await qi.addIndex("tickets", ["contactId", "connectionId"], {
    unique: true,
    name: "tickets_one_open_per_contact",
    where: { status: { [Op.ne]: "closed" } },
  });
  await qi.addIndex("tickets", ["companyId", "status", "lastMessageAt"], { name: "tickets_company_status_last" });

  await qi.createTable("messages", {
    id,
    companyId: fk("companies", "CASCADE"),
    ticketId: fk("tickets", "CASCADE"),
    connectionId: fk("connections", "CASCADE"),
    providerMessageId: str(true),
    fromMe: bool(false),
    body: text(""),
    type: str(false, "text"),
    mediaUrl: str(true),
    mediaMime: str(true),
    mediaName: str(true),
    ack: str(false, "sent"),
    quotedMessageId: fk("messages", "SET NULL", true),
    sentByUserId: fk("users", "SET NULL", true),
    isBot: bool(false),
    ...timestamps,
  });
  await qi.addIndex("messages", ["connectionId", "providerMessageId"], {
    unique: true,
    name: "messages_provider_id_unique",
  });
  await qi.addIndex("messages", ["ticketId", "id"], { name: "messages_ticket_id" });

  await qi.createTable("chatbot_nodes", {
    id,
    companyId: fk("companies", "CASCADE"),
    connectionId: fk("connections", "CASCADE"),
    parentId: fk("chatbot_nodes", "CASCADE", true),
    order: int(0),
    key: str(false, ""),
    title: str(false, ""),
    action: str(false, "submenu"),
    message: text(""),
    mediaUrl: str(true),
    mediaMime: str(true),
    mediaName: str(true),
    queueId: fk("queues", "SET NULL", true),
    userId: fk("users", "SET NULL", true),
    ...timestamps,
  });
  await qi.addIndex("chatbot_nodes", ["connectionId"], {
    unique: true,
    name: "chatbot_one_root_per_connection",
    where: { parentId: null },
  });
  await qi.addIndex("chatbot_nodes", ["parentId", "key"], {
    unique: true,
    name: "chatbot_unique_key_per_parent",
    where: { parentId: { [Op.ne]: null } },
  });

  await qi.createTable("ticket_logs", {
    id,
    companyId: fk("companies", "CASCADE"),
    ticketId: fk("tickets", "CASCADE"),
    event: str(),
    userId: fk("users", "SET NULL", true),
    fromQueueId: fk("queues", "SET NULL", true),
    toQueueId: fk("queues", "SET NULL", true),
    createdAt: { type: DataTypes.DATE, allowNull: false },
  });
}

export async function down(qi: QueryInterface): Promise<void> {
  for (const table of [
    "ticket_logs",
    "chatbot_nodes",
    "messages",
    "tickets",
    "contacts",
    "connections",
    "user_queues",
    "queues",
    "users",
    "companies",
  ]) {
    await qi.dropTable(table);
  }
}
```

`backend/src/database/migrations/index.ts`:

```ts
import { QueryInterface } from "sequelize";
import * as m0001 from "./0001-initial";

export interface MigrationModule {
  name: string;
  up(qi: QueryInterface): Promise<void>;
  down(qi: QueryInterface): Promise<void>;
}

export const migrations: MigrationModule[] = [{ name: "0001-initial", up: m0001.up, down: m0001.down }];
```

`backend/src/database/migrator.ts`:

```ts
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
```

`backend/src/database/cli.ts`:

```ts
import { migrator } from "./migrator";
import { sequelize } from "./sequelize";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "up";
  if (command === "up") await migrator.up();
  else if (command === "down") await migrator.down();
  else throw new Error(`comando desconhecido: ${command}`);
  console.log(`migrations ${command}: ok`);
  await sequelize.close();
}

main().catch(async (err) => {
  console.error(err);
  await sequelize.close();
  process.exit(1);
});
```

Acrescente o script de produção: `npm pkg set scripts.migrate:prod="node dist/database/cli.js up"`.

Em `backend/src/app.ts`, adicione logo abaixo de `import "express-async-errors";`:

```ts
import "./database/sequelize";
```

- [x] **Step 3: Redis e filas**

`backend/src/shared/redis.ts`:

```ts
import IORedis from "ioredis";
import { env } from "../config/env";

let shared: IORedis | null = null;

/** Conexão compartilhada para comandos comuns e Queues do BullMQ. */
export function getRedis(): IORedis {
  if (!shared) shared = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return shared;
}

/** Conexão dedicada (Workers do BullMQ usam comandos bloqueantes). */
export function createRedis(): IORedis {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export async function closeRedis(): Promise<void> {
  if (shared) {
    await shared.quit();
    shared = null;
  }
}
```

`backend/src/queues/index.ts`:

```ts
import { Processor, Queue, Worker, WorkerOptions } from "bullmq";
import IORedis from "ioredis";
import { createRedis, getRedis } from "../shared/redis";

export const QueueNames = {
  inbound: (shard: number) => `inbound-${shard}`,
  outbound: (shard: number) => `outbound-${shard}`,
  botTimeout: "bot-timeout",
  maintenance: "maintenance",
} as const;

/** Hash estável → shard. Mesmo key sempre cai no mesmo shard. */
export function shardFor(key: string, shards: number): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0;
  return hash % shards;
}

const queues = new Map<string, Queue>();
const workerConnections: IORedis[] = [];

export function getQueue(name: string): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: false,
      },
    });
    queues.set(name, queue);
  }
  return queue;
}

export function createWorker<T>(name: string, processor: Processor<T>, opts: Partial<WorkerOptions> = {}): Worker<T> {
  const connection = createRedis();
  workerConnections.push(connection);
  return new Worker<T>(name, processor, { ...opts, connection });
}

export function allQueueNames(inboundShards: number, outboundShards: number): string[] {
  return [
    ...Array.from({ length: inboundShards }, (_, i) => QueueNames.inbound(i)),
    ...Array.from({ length: outboundShards }, (_, i) => QueueNames.outbound(i)),
    QueueNames.botTimeout,
    QueueNames.maintenance,
  ];
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  await Promise.all(workerConnections.map((c) => c.quit().catch(() => undefined)));
  workerConnections.length = 0;
}
```

`backend/src/queues/botTimeout.ts`:

```ts
import { getQueue, QueueNames } from "./index";

export const botTimeoutJobId = (ticketId: number) => `bot-timeout-${ticketId}`;

export async function cancelBotTimeout(ticketId: number): Promise<void> {
  const job = await getQueue(QueueNames.botTimeout).getJob(botTimeoutJobId(ticketId));
  if (job) await job.remove().catch(() => undefined);
}

/** Reagenda o timeout do bot: remove o job anterior (se houver) e cria outro com o atraso cheio. */
export async function scheduleBotTimeout(ticketId: number, minutes: number): Promise<void> {
  await cancelBotTimeout(ticketId);
  await getQueue(QueueNames.botTimeout).add(
    "timeout",
    { ticketId },
    {
      jobId: botTimeoutJobId(ticketId),
      delay: minutes * 60_000,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
```

- [x] **Step 4: Harness de testes**

`backend/jest.config.js` (substituir):

```js
/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  globalSetup: "<rootDir>/test/setup/globalSetup.ts",
  setupFilesAfterEnv: ["<rootDir>/test/setup/afterEnv.ts"],
  testTimeout: 15000,
};
```

`backend/test/setup/globalSetup.ts`:

```ts
export default async function globalSetup(): Promise<void> {
  process.env.NODE_ENV = "test";
  const { sequelize } = await import("../../src/database/sequelize");
  const { migrator } = await import("../../src/database/migrator");
  await sequelize.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrator.up();
  await sequelize.close();
}
```

`backend/test/setup/afterEnv.ts`:

```ts
import { sequelize } from "../../src/database/sequelize";
import { closeQueues } from "../../src/queues";
import { closeRedis } from "../../src/shared/redis";

afterAll(async () => {
  await closeQueues();
  await closeRedis();
  await sequelize.close();
});
```

`backend/test/helpers/db.ts`:

```ts
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
```

`backend/test/helpers/redis.ts`:

```ts
import { getRedis } from "../../src/shared/redis";

export async function resetRedis(): Promise<void> {
  await getRedis().flushdb();
}
```

`backend/test/helpers/waitFor.ts`:

```ts
export async function waitFor<T>(fn: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (predicate(value)) return value;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: tempo esgotado");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
```

`backend/test/helpers/factories.ts`:

```ts
import "../../src/database/sequelize";
import bcrypt from "bcryptjs";
import {
  ChatbotNode,
  Company,
  Connection,
  Contact,
  Message,
  Profile,
  Queue,
  Ticket,
  TicketStatus,
  User,
  UserQueue,
  WeekSchedule,
} from "../../src/models";

let seq = 0;
const next = () => ++seq;

export function createCompany(attrs: Partial<{ name: string; timezone: string }> = {}) {
  return Company.create({ name: `Empresa ${next()}`, ...attrs });
}

export async function createUser(
  companyId: number,
  attrs: Partial<{ name: string; email: string; password: string; profile: Profile; queueIds: number[] }> = {},
) {
  const n = next();
  const { password = "secret123", queueIds = [], ...rest } = attrs;
  const user = await User.create({
    companyId,
    name: `Usuário ${n}`,
    email: `user${n}@test.local`,
    profile: "agent",
    passwordHash: await bcrypt.hash(password, 4),
    ...rest,
  });
  if (queueIds.length) await UserQueue.bulkCreate(queueIds.map((queueId) => ({ userId: user.id, queueId })));
  return user;
}

export function createQueue(companyId: number, attrs: Partial<{ name: string; color: string; schedule: WeekSchedule }> = {}) {
  return Queue.create({ companyId, name: `Fila ${next()}`, ...attrs });
}

export function createConnection(companyId: number, attrs: Record<string, unknown> = {}) {
  const n = next();
  return Connection.create({
    companyId,
    name: `Conexão ${n}`,
    instanceName: `inst_${n}`,
    webhookToken: `token_${n}`,
    status: "connected",
    number: "5511999990000",
    ...attrs,
  });
}

export function createContact(companyId: number, attrs: Record<string, unknown> = {}) {
  const n = next();
  return Contact.create({ companyId, name: `Contato ${n}`, number: `5511${90000000 + n}`, ...attrs });
}

export function createTicket(
  attrs: { companyId: number; contactId: number; connectionId: number; status?: TicketStatus } & Record<string, unknown>,
) {
  return Ticket.create({ status: "pending", ...attrs });
}

export function createMessage(ticket: Ticket, attrs: Record<string, unknown> = {}) {
  return Message.create({
    companyId: ticket.companyId,
    ticketId: ticket.id,
    connectionId: ticket.connectionId,
    fromMe: false,
    body: "oi",
    type: "text",
    ack: "delivered",
    ...attrs,
  });
}

export function createNode(connection: Connection, attrs: Record<string, unknown> = {}) {
  return ChatbotNode.create({
    companyId: connection.companyId,
    connectionId: connection.id,
    parentId: null,
    order: 0,
    key: "",
    title: "",
    action: "submenu",
    message: "",
    ...attrs,
  });
}

/** Empresa + fila + conexão (com a fila como padrão) + contato. */
export async function scenario() {
  const company = await createCompany();
  const queue = await createQueue(company.id);
  const connection = await createConnection(company.id, { defaultQueueId: queue.id });
  const contact = await createContact(company.id);
  return { company, queue, connection, contact };
}
```

- [x] **Step 5: Escrever os testes que falham**

`backend/test/integration/constraints.test.ts`:

```ts
import { UniqueConstraintError } from "sequelize";
import { resetDb } from "../helpers/db";
import { createContact, createMessage, createTicket, createCompany, createNode, scenario } from "../helpers/factories";

describe("database constraints", () => {
  beforeEach(resetDb);

  it("allows only one non-closed ticket per contact and connection", async () => {
    const { company, connection, contact } = await scenario();
    const base = { companyId: company.id, contactId: contact.id, connectionId: connection.id };
    await createTicket({ ...base, status: "pending" });
    await expect(createTicket({ ...base, status: "bot" })).rejects.toThrow(UniqueConstraintError);
  });

  it("allows a new ticket once the previous one is closed", async () => {
    const { company, connection, contact } = await scenario();
    const base = { companyId: company.id, contactId: contact.id, connectionId: connection.id };
    await createTicket({ ...base, status: "closed" });
    await expect(createTicket({ ...base, status: "bot" })).resolves.toBeDefined();
  });

  it("rejects a duplicate providerMessageId on the same connection", async () => {
    const { company, connection, contact } = await scenario();
    const ticket = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id });
    await createMessage(ticket, { providerMessageId: "ABC" });
    await expect(createMessage(ticket, { providerMessageId: "ABC" })).rejects.toThrow(UniqueConstraintError);
    await expect(createMessage(ticket, { providerMessageId: null })).resolves.toBeDefined();
    await expect(createMessage(ticket, { providerMessageId: null })).resolves.toBeDefined();
  });

  it("keeps contact numbers unique per company only", async () => {
    const a = await createCompany();
    const b = await createCompany();
    await createContact(a.id, { number: "5511911112222" });
    await expect(createContact(a.id, { number: "5511911112222" })).rejects.toThrow(UniqueConstraintError);
    await expect(createContact(b.id, { number: "5511911112222" })).resolves.toBeDefined();
  });

  it("allows a single chatbot root per connection", async () => {
    const { connection } = await scenario();
    const root = await createNode(connection);
    await expect(createNode(connection)).rejects.toThrow(UniqueConstraintError);
    await createNode(connection, { parentId: root.id, key: "1", title: "A" });
    await expect(createNode(connection, { parentId: root.id, key: "1", title: "B" })).rejects.toThrow(
      UniqueConstraintError,
    );
  });
});
```

`backend/test/integration/queuesInfra.test.ts`:

```ts
import { getQueue, QueueNames, shardFor } from "../../src/queues";
import { botTimeoutJobId, cancelBotTimeout, scheduleBotTimeout } from "../../src/queues/botTimeout";
import { resetRedis } from "../helpers/redis";

describe("shardFor", () => {
  it("is deterministic and within range", () => {
    for (const key of ["1:5511999990000", "2:5511888880000", "x"]) {
      const shard = shardFor(key, 8);
      expect(shard).toBe(shardFor(key, 8));
      expect(shard).toBeGreaterThanOrEqual(0);
      expect(shard).toBeLessThan(8);
    }
  });

  it("spreads different keys over more than one shard", () => {
    const shards = new Set(Array.from({ length: 50 }, (_, i) => shardFor(`1:55119${i}`, 8)));
    expect(shards.size).toBeGreaterThan(1);
  });
});

describe("bot timeout scheduling", () => {
  beforeEach(resetRedis);

  it("keeps a single delayed job per ticket and cancels it", async () => {
    const queue = getQueue(QueueNames.botTimeout);
    await scheduleBotTimeout(42, 30);
    await scheduleBotTimeout(42, 30);
    const delayed = await queue.getJobs(["delayed"]);
    expect(delayed.map((j) => j.id)).toEqual([botTimeoutJobId(42)]);
    expect(delayed[0].data).toEqual({ ticketId: 42 });

    await cancelBotTimeout(42);
    expect(await queue.getJobs(["delayed"])).toHaveLength(0);
  });
});
```

- [x] **Step 6: Rodar e ver falhar → implementar → passar**

Os arquivos de implementação foram criados nos Steps 1–4. Se algum teste falhar, corrija antes de seguir.

Run: `npx jest`
Expected: todos PASS (unit da Task 1 + 8 novos). Se aparecer `Model not initialized`, confira se o arquivo de teste importa `../helpers/factories` (que importa o sequelize).

Run: `npm run typecheck`
Expected: sem erros.

- [x] **Step 7: Commit**

```bash
git add backend
git commit -m "feat(db): models, migration inicial, filas BullMQ e harness de testes"
```

---

### Task 3: Autenticação e perfis

**Files:**
- Create: `backend/src/modules/auth/{auth.types,tokens,auth.middleware,auth.service,auth.routes}.ts`, `backend/src/types/express.d.ts`
- Modify: `backend/src/routes.ts`
- Create: `backend/test/helpers/auth.ts`
- Test: `backend/test/integration/auth.test.ts`

**Interfaces:**
- Consumes: `User`, `Profile` (Task 2), `AppError`, `notFound`, `env`.
- Produces:
  - `interface AuthContext { userId: number; companyId: number; profile: Profile }`.
  - `signAccessToken(u: { id: number; companyId: number; profile: Profile }): string`, `verifyAccessToken(token: string): AuthContext`, `signRefreshToken(u: { id: number; tokenVersion: number }): string`, `verifyRefreshToken(token: string): { userId: number; tokenVersion: number }`.
  - Middlewares `isAuth`, `requireProfile(...profiles: Profile[])`; helper `currentAuth(req: Request): AuthContext`.
  - `interface PublicUser { id; companyId; name; email; profile }`, `toPublicUser(u: User): PublicUser`.
  - Rotas: `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me`.
  - Helper de teste: `bearer(user): string`.

- [x] **Step 1: Escrever os testes que falham**

`backend/test/helpers/auth.ts`:

```ts
import { Profile } from "../../src/models";
import { signAccessToken } from "../../src/modules/auth/tokens";

export function bearer(user: { id: number; companyId: number; profile: Profile }): string {
  return `Bearer ${signAccessToken(user)}`;
}
```

`backend/test/integration/auth.test.ts`:

```ts
import "express-async-errors";
import express from "express";
import request from "supertest";
import { createApp } from "../../src/app";
import { isAuth, requireProfile } from "../../src/modules/auth/auth.middleware";
import { errorHandler } from "../../src/shared/errors/errorHandler";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCompany, createUser } from "../helpers/factories";

const app = createApp();

async function setup() {
  const company = await createCompany();
  const user = await createUser(company.id, { email: "ana@test.local", password: "senha123", profile: "admin" });
  return { company, user };
}

describe("auth", () => {
  beforeEach(resetDb);

  it("logs in with valid credentials, ignoring e-mail case", async () => {
    await setup();
    const res = await request(app).post("/api/auth/login").send({ email: "ANA@test.local", password: "senha123" });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: "ana@test.local", profile: "admin" });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("rejects a wrong password", async () => {
    await setup();
    const res = await request(app).post("/api/auth/login").send({ email: "ana@test.local", password: "errada" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns the current user on /me and 401 without a token", async () => {
    const { user } = await setup();
    const ok = await request(app).get("/api/auth/me").set("Authorization", bearer(user));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: user.id, email: "ana@test.local" });

    const missing = await request(app).get("/api/auth/me");
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe("UNAUTHENTICATED");

    const garbage = await request(app).get("/api/auth/me").set("Authorization", "Bearer xyz");
    expect(garbage.status).toBe(401);
  });

  it("refreshes tokens and invalidates them on logout", async () => {
    await setup();
    const login = await request(app).post("/api/auth/login").send({ email: "ana@test.local", password: "senha123" });
    const refreshed = await request(app).post("/api/auth/refresh").send({ refreshToken: login.body.refreshToken });
    expect(refreshed.status).toBe(200);

    await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${refreshed.body.accessToken}`)
      .expect(204);

    const again = await request(app).post("/api/auth/refresh").send({ refreshToken: refreshed.body.refreshToken });
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe("INVALID_REFRESH");
  });

  it("does not accept an access token as refresh token", async () => {
    const { user } = await setup();
    const res = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: bearer(user).slice("Bearer ".length) });
    expect(res.status).toBe(401);
  });

  it("blocks profiles not allowed by requireProfile", async () => {
    const company = await createCompany();
    const agent = await createUser(company.id, { profile: "agent" });
    const admin = await createUser(company.id, { profile: "admin" });
    const mini = express();
    mini.get("/admin-only", isAuth, requireProfile("admin"), (_req, res) => {
      res.json({ ok: true });
    });
    mini.use(errorHandler);

    expect((await request(mini).get("/admin-only").set("Authorization", bearer(agent))).status).toBe(403);
    expect((await request(mini).get("/admin-only").set("Authorization", bearer(admin))).status).toBe(200);
  });
});
```

- [x] **Step 2: Rodar e ver falhar**

Run: `npx jest test/integration/auth.test.ts`
Expected: FAIL com `Cannot find module '../../src/modules/auth/tokens'`.

- [x] **Step 3: Implementar**

`backend/src/modules/auth/auth.types.ts`:

```ts
import { Profile } from "../../models";

export interface AuthContext {
  userId: number;
  companyId: number;
  profile: Profile;
}
```

`backend/src/types/express.d.ts`:

```ts
import { AuthContext } from "../modules/auth/auth.types";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
```

`backend/src/modules/auth/tokens.ts`:

```ts
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { Profile } from "../../models";
import { AuthContext } from "./auth.types";

export function signAccessToken(u: { id: number; companyId: number; profile: Profile }): string {
  return jwt.sign({ companyId: u.companyId, profile: u.profile, typ: "access" }, env.JWT_SECRET, {
    subject: String(u.id),
    expiresIn: "15m",
  });
}

export function verifyAccessToken(token: string): AuthContext {
  const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  if (payload.typ !== "access" || typeof payload.sub !== "string" || typeof payload.companyId !== "number") {
    throw new Error("invalid access token");
  }
  return { userId: Number(payload.sub), companyId: payload.companyId, profile: payload.profile as Profile };
}

export function signRefreshToken(u: { id: number; tokenVersion: number }): string {
  return jwt.sign({ tv: u.tokenVersion, typ: "refresh" }, env.JWT_REFRESH_SECRET, {
    subject: String(u.id),
    expiresIn: "7d",
  });
}

export function verifyRefreshToken(token: string): { userId: number; tokenVersion: number } {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;
  if (payload.typ !== "refresh" || typeof payload.sub !== "string") throw new Error("invalid refresh token");
  return { userId: Number(payload.sub), tokenVersion: Number(payload.tv) };
}
```

`backend/src/modules/auth/auth.middleware.ts`:

```ts
import { NextFunction, Request, RequestHandler, Response } from "express";
import { Profile } from "../../models";
import { AppError } from "../../shared/errors/AppError";
import { AuthContext } from "./auth.types";
import { verifyAccessToken } from "./tokens";

export function isAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new AppError("UNAUTHENTICATED", 401, "Token ausente");
  try {
    req.auth = verifyAccessToken(header.slice("Bearer ".length));
  } catch {
    throw new AppError("UNAUTHENTICATED", 401, "Token inválido ou expirado");
  }
  next();
}

export function requireProfile(...profiles: Profile[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth || !profiles.includes(req.auth.profile)) {
      throw new AppError("FORBIDDEN", 403, "Sem permissão para esta ação");
    }
    next();
  };
}

export function currentAuth(req: Request): AuthContext {
  if (!req.auth) throw new AppError("UNAUTHENTICATED", 401, "Token ausente");
  return req.auth;
}
```

`backend/src/modules/auth/auth.service.ts`:

```ts
import bcrypt from "bcryptjs";
import { Profile, User } from "../../models";
import { AppError, notFound } from "../../shared/errors/AppError";
import { AuthContext } from "./auth.types";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "./tokens";

export interface PublicUser {
  id: number;
  companyId: number;
  name: string;
  email: string;
  profile: Profile;
}

export function toPublicUser(u: User): PublicUser {
  return { id: u.id, companyId: u.companyId, name: u.name, email: u.email, profile: u.profile };
}

function issueTokens(u: User) {
  return { accessToken: signAccessToken(u), refreshToken: signRefreshToken(u) };
}

export async function login(email: string, password: string) {
  const user = await User.findOne({ where: { email: email.trim().toLowerCase() } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError("INVALID_CREDENTIALS", 401, "E-mail ou senha inválidos");
  }
  return { ...issueTokens(user), user: toPublicUser(user) };
}

export async function refresh(refreshToken: string) {
  const invalid = new AppError("INVALID_REFRESH", 401, "Sessão expirada, faça login novamente");
  let payload: { userId: number; tokenVersion: number };
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw invalid;
  }
  const user = await User.findByPk(payload.userId);
  if (!user || user.tokenVersion !== payload.tokenVersion) throw invalid;
  return { ...issueTokens(user), user: toPublicUser(user) };
}

export async function logout(userId: number): Promise<void> {
  await User.increment("tokenVersion", { where: { id: userId } });
}

export async function me(auth: AuthContext): Promise<PublicUser> {
  const user = await User.findOne({ where: { id: auth.userId, companyId: auth.companyId } });
  if (!user) throw notFound("Usuário");
  return toPublicUser(user);
}
```

`backend/src/modules/auth/auth.routes.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import { currentAuth, isAuth } from "./auth.middleware";
import { login, logout, me, refresh } from "./auth.service";

export const authRoutes = Router();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });

authRoutes.post("/login", async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  res.json(await login(email, password));
});

authRoutes.post("/refresh", async (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  res.json(await refresh(refreshToken));
});

authRoutes.post("/logout", isAuth, async (req, res) => {
  await logout(currentAuth(req).userId);
  res.status(204).end();
});

authRoutes.get("/me", isAuth, async (req, res) => {
  res.json(await me(currentAuth(req)));
});
```

`backend/src/routes.ts` (substituir):

```ts
import { Router } from "express";
import { authRoutes } from "./modules/auth/auth.routes";

export const apiRoutes = Router();

apiRoutes.use("/auth", authRoutes);
```

- [x] **Step 4: Rodar e ver passar**

Run: `npx jest && npm run typecheck`
Expected: todos PASS, sem erros de tipo.

- [x] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(auth): login JWT, refresh, logout e controle por perfil"
```

---

### Task 4: Filas (setores) e horário de expediente

**Files:**
- Create: `backend/src/shared/http.ts`
- Create: `backend/src/modules/queues/{schedule,queues.service,queues.routes}.ts`
- Modify: `backend/src/routes.ts`
- Test: `backend/test/unit/schedule.test.ts`, `backend/test/integration/queues.test.ts`

**Interfaces:**
- Consumes: `Queue`, `WeekSchedule`, `isAuth`, `requireProfile`, `currentAuth`, `AppError`, `notFound`.
- Produces:
  - `idParam(req: Request, name?: string): number`, `PAGE_SIZE = 30`, `pageParam(value: unknown): number`, `paginate<T>(rows: T[]): { items: T[]; hasMore: boolean }` em `src/shared/http.ts`.
  - `isOpen(schedule: WeekSchedule | null | undefined, now: Date, timeZone: string): boolean`.
  - `listQueues(companyId)`, `getQueueOr404(companyId, id)`, `createQueue(companyId, input)`, `updateQueue(companyId, id, input)`, `deleteQueue(companyId, id)`, `assertQueuesBelong(companyId: number, ids: number[]): Promise<void>` (lança `INVALID_QUEUE` 400).
  - Rotas: `GET/POST /api/queues`, `PUT/DELETE /api/queues/:id`.

- [x] **Step 1: Escrever os testes que falham**

`backend/test/unit/schedule.test.ts`:

```ts
import { isOpen } from "../../src/modules/queues/schedule";

const TZ = "America/Sao_Paulo";
// 2026-10-12 é uma segunda-feira (dia "1"). São Paulo = UTC-3.
const mondayAt = (utcHour: number, minute = 0) =>
  new Date(Date.UTC(2026, 9, 12, utcHour, minute));

describe("isOpen", () => {
  it("treats an empty schedule as always open", () => {
    expect(isOpen({}, mondayAt(3), TZ)).toBe(true);
    expect(isOpen(null, mondayAt(3), TZ)).toBe(true);
  });

  it("is open inside a range in the company time zone", () => {
    // 13:00 UTC = 10:00 em São Paulo
    expect(isOpen({ "1": ["08:00-12:00"] }, mondayAt(13), TZ)).toBe(true);
  });

  it("is closed outside every range", () => {
    // 16:00 UTC = 13:00 em São Paulo
    expect(isOpen({ "1": ["08:00-12:00"] }, mondayAt(16), TZ)).toBe(false);
  });

  it("supports several ranges per day and treats the end as exclusive", () => {
    const schedule = { "1": ["08:00-12:00", "13:00-18:00"] };
    expect(isOpen(schedule, mondayAt(17), TZ)).toBe(true); // 14:00
    expect(isOpen(schedule, mondayAt(15), TZ)).toBe(false); // 12:00
  });

  it("is closed on days without ranges when the schedule is not empty", () => {
    expect(isOpen({ "2": ["08:00-18:00"] }, mondayAt(13), TZ)).toBe(false);
  });

  it("uses the local weekday, not the UTC weekday", () => {
    // 2026-10-13 02:00 UTC = segunda 23:00 em São Paulo
    const lateMonday = new Date(Date.UTC(2026, 9, 13, 2, 0));
    expect(isOpen({ "1": ["22:00-23:59"] }, lateMonday, TZ)).toBe(true);
    expect(isOpen({ "2": ["00:00-23:59"] }, lateMonday, TZ)).toBe(false);
  });
});
```

`backend/test/integration/queues.test.ts`:

```ts
import request from "supertest";
import { createApp } from "../../src/app";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCompany, createQueue, createUser } from "../helpers/factories";

const app = createApp();

describe("queues API", () => {
  beforeEach(resetDb);

  it("lets admins create, update and delete queues", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, { profile: "admin" });

    const created = await request(app)
      .post("/api/queues")
      .set("Authorization", bearer(admin))
      .send({ name: "Financeiro", color: "#ff0000", schedule: { "1": ["08:00-18:00"] } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Financeiro", color: "#ff0000", companyId: company.id });

    const updated = await request(app)
      .put(`/api/queues/${created.body.id}`)
      .set("Authorization", bearer(admin))
      .send({ name: "Cobrança" });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("Cobrança");

    await request(app).delete(`/api/queues/${created.body.id}`).set("Authorization", bearer(admin)).expect(204);
    const list = await request(app).get("/api/queues").set("Authorization", bearer(admin));
    expect(list.body).toEqual([]);
  });

  it("forbids agents from creating queues", async () => {
    const company = await createCompany();
    const agent = await createUser(company.id, { profile: "agent" });
    const res = await request(app).post("/api/queues").set("Authorization", bearer(agent)).send({ name: "X" });
    expect(res.status).toBe(403);
  });

  it("rejects malformed or inverted schedule ranges", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, { profile: "admin" });
    for (const schedule of [{ "1": ["8h-12h"] }, { "1": ["12:00-08:00"] }, { "9": ["08:00-12:00"] }]) {
      const res = await request(app)
        .post("/api/queues")
        .set("Authorization", bearer(admin))
        .send({ name: "X", schedule });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("never exposes or changes queues of another company", async () => {
    const mine = await createCompany();
    const other = await createCompany();
    const admin = await createUser(mine.id, { profile: "admin" });
    const foreign = await createQueue(other.id, { name: "Deles" });

    const list = await request(app).get("/api/queues").set("Authorization", bearer(admin));
    expect(list.body).toEqual([]);

    const res = await request(app)
      .put(`/api/queues/${foreign.id}`)
      .set("Authorization", bearer(admin))
      .send({ name: "Hack" });
    expect(res.status).toBe(404);
  });
});
```

- [x] **Step 2: Rodar e ver falhar**

Run: `npx jest test/unit/schedule.test.ts test/integration/queues.test.ts`
Expected: FAIL com `Cannot find module '../../src/modules/queues/schedule'`.

- [x] **Step 3: Implementar**

`backend/src/shared/http.ts`:

```ts
import { Request } from "express";
import { AppError } from "./errors/AppError";

export const PAGE_SIZE = 30;

export function idParam(req: Request, name = "id"): number {
  const value = Number(req.params[name]);
  if (!Number.isInteger(value) || value <= 0) throw new AppError("INVALID_ID", 400, "Id inválido");
  return value;
}

export function pageParam(value: unknown): number {
  const page = Number(value ?? 1);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** Recebe até PAGE_SIZE + 1 linhas e devolve a página + se há mais. */
export function paginate<T>(rows: T[], size = PAGE_SIZE): { items: T[]; hasMore: boolean } {
  return { items: rows.slice(0, size), hasMore: rows.length > size };
}
```

`backend/src/modules/queues/schedule.ts`:

```ts
import { WeekDay, WeekSchedule } from "../../models";

const WEEKDAYS: Record<string, WeekDay> = { Sun: "0", Mon: "1", Tue: "2", Wed: "3", Thu: "4", Fri: "5", Sat: "6" };

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

function localParts(now: Date, timeZone: string): { day: WeekDay; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: WEEKDAYS[get("weekday")], minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Schedule vazio = sempre aberto. Intervalos são [início, fim). */
export function isOpen(schedule: WeekSchedule | null | undefined, now: Date, timeZone: string): boolean {
  if (!schedule || Object.keys(schedule).length === 0) return true;
  const { day, minutes } = localParts(now, timeZone);
  return (schedule[day] ?? []).some((range) => {
    const [start, end] = range.split("-");
    return minutes >= toMinutes(start) && minutes < toMinutes(end);
  });
}
```

`backend/src/modules/queues/queues.service.ts`:

```ts
import { Op } from "sequelize";
import { Queue, WeekSchedule } from "../../models";
import { AppError, notFound } from "../../shared/errors/AppError";

export interface QueueInput {
  name: string;
  color?: string;
  schedule?: WeekSchedule;
}

export function listQueues(companyId: number) {
  return Queue.findAll({ where: { companyId }, order: [["name", "ASC"]] });
}

export async function getQueueOr404(companyId: number, id: number): Promise<Queue> {
  const queue = await Queue.findOne({ where: { id, companyId } });
  if (!queue) throw notFound("Fila");
  return queue;
}

export function createQueue(companyId: number, input: QueueInput) {
  return Queue.create({ companyId, ...input });
}

export async function updateQueue(companyId: number, id: number, input: Partial<QueueInput>) {
  const queue = await getQueueOr404(companyId, id);
  return queue.update(input);
}

export async function deleteQueue(companyId: number, id: number): Promise<void> {
  const queue = await getQueueOr404(companyId, id);
  await queue.destroy();
}

export async function assertQueuesBelong(companyId: number, ids: number[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const count = await Queue.count({ where: { companyId, id: { [Op.in]: unique } } });
  if (count !== unique.length) throw new AppError("INVALID_QUEUE", 400, "Fila inválida");
}
```

`backend/src/modules/queues/queues.routes.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../shared/http";
import { currentAuth, isAuth, requireProfile } from "../auth/auth.middleware";
import { createQueue, deleteQueue, listQueues, updateQueue } from "./queues.service";

const RANGE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

export const scheduleSchema = z.record(
  z.enum(["0", "1", "2", "3", "4", "5", "6"]),
  z.array(
    z
      .string()
      .regex(RANGE, "use o formato HH:mm-HH:mm")
      .refine((r) => {
        const [start, end] = r.split("-");
        return start < end;
      }, "o início deve ser antes do fim"),
  ),
);

const queueSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  schedule: scheduleSchema.optional(),
});

export const queueRoutes = Router();
queueRoutes.use(isAuth);

queueRoutes.get("/", async (req, res) => {
  res.json(await listQueues(currentAuth(req).companyId));
});

queueRoutes.post("/", requireProfile("admin"), async (req, res) => {
  const input = queueSchema.parse(req.body);
  res.status(201).json(await createQueue(currentAuth(req).companyId, input));
});

queueRoutes.put("/:id", requireProfile("admin"), async (req, res) => {
  const input = queueSchema.partial().parse(req.body);
  res.json(await updateQueue(currentAuth(req).companyId, idParam(req), input));
});

queueRoutes.delete("/:id", requireProfile("admin"), async (req, res) => {
  await deleteQueue(currentAuth(req).companyId, idParam(req));
  res.status(204).end();
});
```

Em `backend/src/routes.ts`, acrescente:

```ts
import { queueRoutes } from "./modules/queues/queues.routes";
// ...
apiRoutes.use("/queues", queueRoutes);
```

- [x] **Step 4: Rodar e ver passar**

Run: `npx jest && npm run typecheck`
Expected: todos PASS.

- [x] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(queues): CRUD de filas e cálculo de expediente com fuso"
```

---

### Task 5: Usuários (atendentes), vínculo com filas e dados da empresa

**Files:**
- Create: `backend/src/modules/users/{userQueues,users.service,users.routes}.ts`
- Create: `backend/src/modules/companies/companies.routes.ts`
- Modify: `backend/src/routes.ts`
- Test: `backend/test/integration/users.test.ts`, `backend/test/integration/company.test.ts`

**Interfaces:**
- Consumes: `User`, `UserQueue`, `Profile`, `toPublicUser`, `PublicUser`, `assertQueuesBelong`, `idParam`, middlewares de auth.
- Produces:
  - `userQueueIds(userId: number): Promise<number[]>`, `setUserQueues(userId: number, queueIds: number[]): Promise<void>`.
  - `interface UserView extends PublicUser { queueIds: number[] }`.
  - `listUsers(companyId)`, `createUser(companyId, input)`, `updateUser(companyId, id, input)`, `deleteUser(auth, id)`, `getUserOr404(companyId: number, id: number): Promise<User>`.
  - Rotas: `GET/POST /api/users`, `PUT/DELETE /api/users/:id`.
  - Rotas da empresa do usuário logado: `GET /api/company` (todos), `PUT /api/company` (admin; `{ name?, timezone? }`, timezone IANA validado com `Intl`).

- [x] **Step 1: Escrever os testes que falham**

`backend/test/integration/company.test.ts`:

```ts
import request from "supertest";
import { createApp } from "../../src/app";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCompany, createUser } from "../helpers/factories";

const app = createApp();

describe("company settings", () => {
  beforeEach(resetDb);

  it("returns the caller's company and lets admins update it", async () => {
    const company = await createCompany({ name: "Loja X" });
    const admin = await createUser(company.id, { profile: "admin" });
    const me = await request(app).get("/api/company").set("Authorization", bearer(admin));
    expect(me.body).toMatchObject({ id: company.id, name: "Loja X", timezone: "America/Sao_Paulo" });

    const res = await request(app)
      .put("/api/company")
      .set("Authorization", bearer(admin))
      .send({ name: "Loja Y", timezone: "America/Manaus" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Loja Y", timezone: "America/Manaus" });
  });

  it("rejects invalid time zones and non-admin updates", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, { profile: "admin" });
    const agent = await createUser(company.id, { profile: "agent" });
    const bad = await request(app).put("/api/company").set("Authorization", bearer(admin)).send({ timezone: "Mars/Base" });
    expect(bad.status).toBe(400);
    const forbidden = await request(app).put("/api/company").set("Authorization", bearer(agent)).send({ name: "X" });
    expect(forbidden.status).toBe(403);
  });
});
```

`backend/test/integration/users.test.ts`:

```ts
import request from "supertest";
import { createApp } from "../../src/app";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCompany, createQueue, createUser } from "../helpers/factories";

const app = createApp();

describe("users API", () => {
  beforeEach(resetDb);

  async function setup() {
    const company = await createCompany();
    const admin = await createUser(company.id, { profile: "admin" });
    const queue = await createQueue(company.id);
    return { company, admin, queue };
  }

  it("creates an agent linked to queues and lets them log in", async () => {
    const { admin, queue } = await setup();
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", bearer(admin))
      .send({ name: "Bruno", email: "Bruno@Test.local", password: "senha123", profile: "agent", queueIds: [queue.id] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Bruno", email: "bruno@test.local", profile: "agent", queueIds: [queue.id] });
    expect(res.body.passwordHash).toBeUndefined();

    const login = await request(app).post("/api/auth/login").send({ email: "bruno@test.local", password: "senha123" });
    expect(login.status).toBe(200);
  });

  it("rejects a duplicate e-mail with 409", async () => {
    const { admin } = await setup();
    const body = { name: "A", email: "dup@test.local", password: "senha123", profile: "agent" };
    await request(app).post("/api/users").set("Authorization", bearer(admin)).send(body).expect(201);
    const res = await request(app).post("/api/users").set("Authorization", bearer(admin)).send(body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_IN_USE");
  });

  it("rejects queues from another company", async () => {
    const { admin } = await setup();
    const other = await createCompany();
    const foreignQueue = await createQueue(other.id);
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", bearer(admin))
      .send({ name: "A", email: "a@test.local", password: "senha123", profile: "agent", queueIds: [foreignQueue.id] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_QUEUE");
  });

  it("lets supervisors list but not create users", async () => {
    const { company } = await setup();
    const supervisor = await createUser(company.id, { profile: "supervisor" });
    expect((await request(app).get("/api/users").set("Authorization", bearer(supervisor))).status).toBe(200);
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", bearer(supervisor))
      .send({ name: "A", email: "a@test.local", password: "senha123", profile: "agent" });
    expect(res.status).toBe(403);
  });

  it("only lists users of the caller's company", async () => {
    const { admin } = await setup();
    const other = await createCompany();
    await createUser(other.id, { name: "Estranho" });
    const res = await request(app).get("/api/users").set("Authorization", bearer(admin));
    expect(res.body.map((u: { name: string }) => u.name)).not.toContain("Estranho");
  });

  it("updates queues and password, invalidating old refresh tokens", async () => {
    const { company, admin, queue } = await setup();
    const agent = await createUser(company.id, { email: "c@test.local", password: "antiga1" });
    const login = await request(app).post("/api/auth/login").send({ email: "c@test.local", password: "antiga1" });

    const res = await request(app)
      .put(`/api/users/${agent.id}`)
      .set("Authorization", bearer(admin))
      .send({ password: "nova123", queueIds: [queue.id] });
    expect(res.status).toBe(200);
    expect(res.body.queueIds).toEqual([queue.id]);

    const refreshed = await request(app).post("/api/auth/refresh").send({ refreshToken: login.body.refreshToken });
    expect(refreshed.status).toBe(401);
    const relogin = await request(app).post("/api/auth/login").send({ email: "c@test.local", password: "nova123" });
    expect(relogin.status).toBe(200);
  });

  it("does not let an admin delete themselves", async () => {
    const { admin } = await setup();
    const res = await request(app).delete(`/api/users/${admin.id}`).set("Authorization", bearer(admin));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CANNOT_DELETE_SELF");
  });
});
```

- [x] **Step 2: Rodar e ver falhar**

Run: `npx jest test/integration/users.test.ts test/integration/company.test.ts`
Expected: FAIL com 404 nas rotas `/api/users` e `/api/company` (rotas ainda não existem).

- [x] **Step 3: Implementar**

`backend/src/modules/users/userQueues.ts`:

```ts
import { UserQueue } from "../../models";

export async function userQueueIds(userId: number): Promise<number[]> {
  const rows = await UserQueue.findAll({ where: { userId } });
  return rows.map((r) => r.queueId);
}

export async function setUserQueues(userId: number, queueIds: number[]): Promise<void> {
  await UserQueue.destroy({ where: { userId } });
  const unique = [...new Set(queueIds)];
  if (unique.length) await UserQueue.bulkCreate(unique.map((queueId) => ({ userId, queueId })));
}
```

`backend/src/modules/users/users.service.ts`:

```ts
import bcrypt from "bcryptjs";
import { Profile, User } from "../../models";
import { AppError, notFound } from "../../shared/errors/AppError";
import { AuthContext } from "../auth/auth.types";
import { PublicUser, toPublicUser } from "../auth/auth.service";
import { assertQueuesBelong } from "../queues/queues.service";
import { setUserQueues, userQueueIds } from "./userQueues";

export interface UserInput {
  name: string;
  email: string;
  password: string;
  profile: Profile;
  queueIds?: number[];
}

export interface UserView extends PublicUser {
  queueIds: number[];
}

async function view(user: User): Promise<UserView> {
  return { ...toPublicUser(user), queueIds: await userQueueIds(user.id) };
}

export async function getUserOr404(companyId: number, id: number): Promise<User> {
  const user = await User.findOne({ where: { id, companyId } });
  if (!user) throw notFound("Usuário");
  return user;
}

async function assertEmailFree(email: string, exceptId?: number): Promise<void> {
  const existing = await User.findOne({ where: { email } });
  if (existing && existing.id !== exceptId) throw new AppError("EMAIL_IN_USE", 409, "E-mail já cadastrado");
}

export async function listUsers(companyId: number): Promise<UserView[]> {
  const users = await User.findAll({ where: { companyId }, order: [["name", "ASC"]] });
  return Promise.all(users.map(view));
}

export async function createUser(companyId: number, input: UserInput): Promise<UserView> {
  const email = input.email.trim().toLowerCase();
  await assertEmailFree(email);
  await assertQueuesBelong(companyId, input.queueIds ?? []);
  const user = await User.create({
    companyId,
    name: input.name,
    email,
    profile: input.profile,
    passwordHash: await bcrypt.hash(input.password, 10),
  });
  await setUserQueues(user.id, input.queueIds ?? []);
  return view(user);
}

export async function updateUser(companyId: number, id: number, input: Partial<UserInput>): Promise<UserView> {
  const user = await getUserOr404(companyId, id);
  const patch: Partial<Pick<User, "name" | "email" | "profile" | "passwordHash" | "tokenVersion">> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.profile !== undefined) patch.profile = input.profile;
  if (input.email !== undefined) {
    patch.email = input.email.trim().toLowerCase();
    await assertEmailFree(patch.email, user.id);
  }
  if (input.password !== undefined) {
    patch.passwordHash = await bcrypt.hash(input.password, 10);
    patch.tokenVersion = user.tokenVersion + 1;
  }
  if (input.queueIds !== undefined) await assertQueuesBelong(companyId, input.queueIds);
  await user.update(patch);
  if (input.queueIds !== undefined) await setUserQueues(user.id, input.queueIds);
  return view(user);
}

export async function deleteUser(auth: AuthContext, id: number): Promise<void> {
  if (id === auth.userId) throw new AppError("CANNOT_DELETE_SELF", 400, "Você não pode excluir a si mesmo");
  const user = await getUserOr404(auth.companyId, id);
  await user.destroy();
}
```

`backend/src/modules/users/users.routes.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../shared/http";
import { currentAuth, isAuth, requireProfile } from "../auth/auth.middleware";
import { createUser, deleteUser, listUsers, updateUser } from "./users.service";

const userSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  profile: z.enum(["admin", "supervisor", "agent"]),
  queueIds: z.array(z.number().int().positive()).optional(),
});

export const userRoutes = Router();
userRoutes.use(isAuth);

userRoutes.get("/", requireProfile("admin", "supervisor"), async (req, res) => {
  res.json(await listUsers(currentAuth(req).companyId));
});

userRoutes.post("/", requireProfile("admin"), async (req, res) => {
  const input = userSchema.parse(req.body);
  res.status(201).json(await createUser(currentAuth(req).companyId, input));
});

userRoutes.put("/:id", requireProfile("admin"), async (req, res) => {
  const input = userSchema.partial().parse(req.body);
  res.json(await updateUser(currentAuth(req).companyId, idParam(req), input));
});

userRoutes.delete("/:id", requireProfile("admin"), async (req, res) => {
  await deleteUser(currentAuth(req), idParam(req));
  res.status(204).end();
});
```

`backend/src/modules/companies/companies.routes.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import { Company } from "../../models";
import { notFound } from "../../shared/errors/AppError";
import { currentAuth, isAuth, requireProfile } from "../auth/auth.middleware";

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const companySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  timezone: z.string().refine(isTimeZone, "fuso horário inválido").optional(),
});

async function myCompany(companyId: number): Promise<Company> {
  const company = await Company.findByPk(companyId);
  if (!company) throw notFound("Empresa");
  return company;
}

export const companyRoutes = Router();
companyRoutes.use(isAuth);

companyRoutes.get("/", async (req, res) => {
  res.json(await myCompany(currentAuth(req).companyId));
});

companyRoutes.put("/", requireProfile("admin"), async (req, res) => {
  const input = companySchema.parse(req.body);
  const company = await myCompany(currentAuth(req).companyId);
  res.json(await company.update(input));
});
```

Em `backend/src/routes.ts`, acrescente:

```ts
import { companyRoutes } from "./modules/companies/companies.routes";
import { userRoutes } from "./modules/users/users.routes";
// ...
apiRoutes.use("/company", companyRoutes);
apiRoutes.use("/users", userRoutes);
```

- [x] **Step 4: Rodar e ver passar**

Run: `npx jest && npm run typecheck`
Expected: todos PASS.

- [x] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(users): CRUD de usuários com vínculo a filas e dados da empresa"
```

---

### Task 6: Contatos e armazenamento de mídia

**Files:**
- Create: `backend/src/modules/contacts/{contacts.service,contacts.routes}.ts`
- Create: `backend/src/modules/media/{media.storage,media.routes}.ts`
- Modify: `backend/src/routes.ts`
- Test: `backend/test/integration/contacts.test.ts`, `backend/test/integration/media.test.ts`

**Interfaces:**
- Consumes: `Contact`, `paginate`, `pageParam`, `PAGE_SIZE`, `idParam`, auth.
- Produces:
  - `listContacts(companyId, { search?: string; page: number })`, `getContactOr404(companyId, id)`, `updateContact(companyId, id, { name })`.
  - `interface StoredMedia { url: string; mime: string; name: string | null }`.
  - `saveBuffer(companyId: number, buffer: Buffer, mime: string, name?: string | null): Promise<StoredMedia>`.
  - `saveBase64(companyId: number, base64: string, mime: string, name?: string | null): Promise<StoredMedia>`.
  - `resolveMediaPath(companyId: number, url: string): string` (lança `INVALID_MEDIA` 400).
  - `readMediaBase64(companyId: number, url: string): Promise<string>`.
  - `mediaTypeFromMime(mime: string): "image" | "audio" | "video" | "document"`.
  - Rotas: `GET /api/contacts`, `GET/PUT /api/contacts/:id`, `POST /api/media` (multipart, campo `file`, até 16 MB). Arquivos servidos em `GET /media/{companyId}/{arquivo}`.

- [x] **Step 1: Escrever os testes que falham**

`backend/test/integration/contacts.test.ts`:

```ts
import request from "supertest";
import { createApp } from "../../src/app";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCompany, createContact, createUser } from "../helpers/factories";

const app = createApp();

describe("contacts API", () => {
  beforeEach(resetDb);

  it("lists and searches by name or number", async () => {
    const company = await createCompany();
    const agent = await createUser(company.id);
    await createContact(company.id, { name: "Maria Souza", number: "5511988887777" });
    await createContact(company.id, { name: "João Lima", number: "5521977776666" });

    const all = await request(app).get("/api/contacts").set("Authorization", bearer(agent));
    expect(all.body.items).toHaveLength(2);
    expect(all.body.hasMore).toBe(false);

    const byName = await request(app).get("/api/contacts?search=maria").set("Authorization", bearer(agent));
    expect(byName.body.items.map((c: { name: string }) => c.name)).toEqual(["Maria Souza"]);

    const byNumber = await request(app).get("/api/contacts?search=219777").set("Authorization", bearer(agent));
    expect(byNumber.body.items.map((c: { name: string }) => c.name)).toEqual(["João Lima"]);
  });

  it("renames a contact", async () => {
    const company = await createCompany();
    const agent = await createUser(company.id);
    const contact = await createContact(company.id);
    const res = await request(app)
      .put(`/api/contacts/${contact.id}`)
      .set("Authorization", bearer(agent))
      .send({ name: "Cliente VIP" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Cliente VIP");
  });

  it("hides contacts of other companies", async () => {
    const company = await createCompany();
    const other = await createCompany();
    const agent = await createUser(company.id);
    const foreign = await createContact(other.id);
    const res = await request(app).get(`/api/contacts/${foreign.id}`).set("Authorization", bearer(agent));
    expect(res.status).toBe(404);
  });
});
```

`backend/test/integration/media.test.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { createApp } from "../../src/app";
import { env } from "../../src/config/env";
import { mediaTypeFromMime, resolveMediaPath, saveBase64 } from "../../src/modules/media/media.storage";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCompany, createUser } from "../helpers/factories";

const app = createApp();

describe("media storage", () => {
  beforeEach(resetDb);
  afterAll(() => fs.rm(path.resolve(env.MEDIA_DIR), { recursive: true, force: true }));

  it("uploads a file and serves it back", async () => {
    const company = await createCompany();
    const agent = await createUser(company.id);
    const res = await request(app)
      .post("/api/media")
      .set("Authorization", bearer(agent))
      .attach("file", Buffer.from("conteudo"), { filename: "nota.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(new RegExp(`^/media/${company.id}/[a-f0-9-]+\\.pdf$`));
    expect(res.body).toMatchObject({ mime: "application/pdf", name: "nota.pdf" });

    const served = await request(app).get(res.body.url);
    expect(served.status).toBe(200);
    expect(served.body.toString()).toBe("conteudo");
  });

  it("requires a file", async () => {
    const company = await createCompany();
    const agent = await createUser(company.id);
    const res = await request(app).post("/api/media").set("Authorization", bearer(agent));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("FILE_REQUIRED");
  });

  it("stores base64 payloads, stripping data-url prefixes and mime parameters", async () => {
    const stored = await saveBase64(7, "data:audio/ogg;base64," + Buffer.from("ogg").toString("base64"), "audio/ogg; codecs=opus");
    expect(stored.url).toMatch(/^\/media\/7\/[a-f0-9-]+\.ogg$/);
    expect(stored.mime).toBe("audio/ogg");
    const content = await fs.readFile(resolveMediaPath(7, stored.url));
    expect(content.toString()).toBe("ogg");
  });

  it("refuses paths outside the company folder", () => {
    expect(() => resolveMediaPath(1, "/media/1/../../etc/passwd")).toThrow("Mídia inválida");
    expect(() => resolveMediaPath(1, "/media/2/abc.png")).toThrow("Mídia inválida");
    expect(() => resolveMediaPath(1, "https://evil.test/x.png")).toThrow("Mídia inválida");
  });

  it("maps mime types to message types", () => {
    expect(mediaTypeFromMime("image/png")).toBe("image");
    expect(mediaTypeFromMime("audio/ogg")).toBe("audio");
    expect(mediaTypeFromMime("video/mp4")).toBe("video");
    expect(mediaTypeFromMime("application/pdf")).toBe("document");
  });
});
```

- [x] **Step 2: Rodar e ver falhar**

Run: `npx jest test/integration/contacts.test.ts test/integration/media.test.ts`
Expected: FAIL com `Cannot find module '../../src/modules/media/media.storage'`.

- [x] **Step 3: Implementar**

`backend/src/modules/contacts/contacts.service.ts`:

```ts
import { Op } from "sequelize";
import { Contact } from "../../models";
import { notFound } from "../../shared/errors/AppError";
import { PAGE_SIZE, paginate } from "../../shared/http";

export async function listContacts(companyId: number, { search, page }: { search?: string; page: number }) {
  const term = search?.trim();
  const where = {
    companyId,
    isGroup: false,
    ...(term
      ? { [Op.or]: [{ name: { [Op.iLike]: `%${term}%` } }, { number: { [Op.like]: `%${term}%` } }] }
      : {}),
  };
  const rows = await Contact.findAll({
    where,
    order: [["name", "ASC"]],
    limit: PAGE_SIZE + 1,
    offset: (page - 1) * PAGE_SIZE,
  });
  return paginate(rows);
}

export async function getContactOr404(companyId: number, id: number): Promise<Contact> {
  const contact = await Contact.findOne({ where: { id, companyId } });
  if (!contact) throw notFound("Contato");
  return contact;
}

export async function updateContact(companyId: number, id: number, input: { name: string }) {
  const contact = await getContactOr404(companyId, id);
  return contact.update({ name: input.name });
}
```

`backend/src/modules/contacts/contacts.routes.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import { idParam, pageParam } from "../../shared/http";
import { currentAuth, isAuth } from "../auth/auth.middleware";
import { getContactOr404, listContacts, updateContact } from "./contacts.service";

export const contactRoutes = Router();
contactRoutes.use(isAuth);

contactRoutes.get("/", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  res.json(await listContacts(currentAuth(req).companyId, { search, page: pageParam(req.query.page) }));
});

contactRoutes.get("/:id", async (req, res) => {
  res.json(await getContactOr404(currentAuth(req).companyId, idParam(req)));
});

contactRoutes.put("/:id", async (req, res) => {
  const input = z.object({ name: z.string().trim().min(1).max(120) }).parse(req.body);
  res.json(await updateContact(currentAuth(req).companyId, idParam(req), input));
});
```

`backend/src/modules/media/media.storage.ts`:

```ts
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env";
import { AppError } from "../../shared/errors/AppError";

export interface StoredMedia {
  url: string;
  mime: string;
  name: string | null;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
};

function extensionFor(mime: string, name?: string | null): string {
  const known = EXTENSIONS[mime];
  if (known) return known;
  const fromName = name ? path.extname(name).slice(1).replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() : "";
  return fromName || "bin";
}

export async function saveBuffer(
  companyId: number,
  buffer: Buffer,
  mime: string,
  name: string | null = null,
): Promise<StoredMedia> {
  const baseMime = mime.split(";")[0].trim().toLowerCase() || "application/octet-stream";
  const fileName = `${randomUUID()}.${extensionFor(baseMime, name)}`;
  const dir = path.resolve(env.MEDIA_DIR, String(companyId));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), buffer);
  return { url: `/media/${companyId}/${fileName}`, mime: baseMime, name };
}

export function saveBase64(companyId: number, base64: string, mime: string, name: string | null = null) {
  const raw = base64.replace(/^data:[^,]*,/, "");
  return saveBuffer(companyId, Buffer.from(raw, "base64"), mime, name);
}

const MEDIA_URL = /^\/media\/(\d+)\/([a-f0-9-]+\.[a-z0-9]+)$/i;

export function resolveMediaPath(companyId: number, url: string): string {
  const match = MEDIA_URL.exec(url);
  if (!match || Number(match[1]) !== companyId) throw new AppError("INVALID_MEDIA", 400, "Mídia inválida");
  return path.resolve(env.MEDIA_DIR, match[1], match[2]);
}

export async function readMediaBase64(companyId: number, url: string): Promise<string> {
  return (await fs.readFile(resolveMediaPath(companyId, url))).toString("base64");
}

export function mediaTypeFromMime(mime: string): "image" | "audio" | "video" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}
```

`backend/src/modules/media/media.routes.ts`:

```ts
import { Router } from "express";
import multer from "multer";
import { AppError } from "../../shared/errors/AppError";
import { currentAuth, isAuth } from "../auth/auth.middleware";
import { saveBuffer } from "./media.storage";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

export const mediaRoutes = Router();

mediaRoutes.post("/", isAuth, upload.single("file"), async (req, res) => {
  if (!req.file) throw new AppError("FILE_REQUIRED", 400, "Arquivo obrigatório");
  const stored = await saveBuffer(currentAuth(req).companyId, req.file.buffer, req.file.mimetype, req.file.originalname);
  res.status(201).json(stored);
});
```

Em `backend/src/routes.ts`, acrescente:

```ts
import { contactRoutes } from "./modules/contacts/contacts.routes";
import { mediaRoutes } from "./modules/media/media.routes";
// ...
apiRoutes.use("/contacts", contactRoutes);
apiRoutes.use("/media", mediaRoutes);
```

- [x] **Step 4: Rodar e ver passar**

Run: `npx jest && npm run typecheck`
Expected: todos PASS.

- [x] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(contacts,media): contatos com busca e armazenamento local de mídia"
```

---

### Task 7: Provider de WhatsApp (interface + Evolution API)

**Files:**
- Create: `backend/src/modules/whatsapp/{provider,registry}.ts`, `backend/src/modules/whatsapp/evolution/{parseWebhook,EvolutionProvider}.ts`
- Create: `backend/test/fixtures/evolution.ts`, `backend/test/helpers/fakeProvider.ts`
- Test: `backend/test/unit/evolutionParse.test.ts`, `backend/test/unit/evolutionProvider.test.ts`

**Interfaces:**
- Consumes: `MessageType`, `Ack`, `ConnectionStatus` (models), `AppError`, `env`, `logger`.
- Produces (em `provider.ts`):

```ts
export interface InboundMessage {
  kind: "message";
  instanceName: string;
  providerMessageId: string;
  remoteNumber: string;
  isGroup: boolean;
  fromMe: boolean;
  pushName?: string;
  type: MessageType;
  body: string;
  media?: { mimetype: string; fileName?: string };
  quotedProviderMessageId?: string;
  timestamp: number;
}
export interface AckUpdate { kind: "ack"; instanceName: string; providerMessageId: string; remoteNumber: string | null; ack: Ack }
export interface ConnectionUpdate { kind: "connection"; instanceName: string; state: ConnectionStatus; number?: string }
export interface QrCodeUpdate { kind: "qrcode"; instanceName: string; qrBase64: string }
export type InboundEvent = InboundMessage | AckUpdate | ConnectionUpdate | QrCodeUpdate;
export type OutboundMediaType = "image" | "audio" | "video" | "document";
export interface OutboundMedia { type: OutboundMediaType; base64: string; mimetype: string; fileName?: string; caption?: string }
export interface SendResult { providerMessageId: string }
export interface WhatsAppProvider {
  ping(): Promise<void>;
  createInstance(instanceName: string, webhookUrl: string): Promise<void>;
  deleteInstance(instanceName: string): Promise<void>;
  logout(instanceName: string): Promise<void>;
  getQrCode(instanceName: string): Promise<string | null>;
  getConnectionState(instanceName: string): Promise<ConnectionStatus>;
  sendText(instanceName: string, number: string, text: string, quotedProviderMessageId?: string): Promise<SendResult>;
  sendMedia(instanceName: string, number: string, media: OutboundMedia): Promise<SendResult>;
  downloadMedia(instanceName: string, providerMessageId: string): Promise<{ base64: string; mimetype: string }>;
  parseWebhook(payload: unknown): InboundEvent[];
}
```

  - `parseEvolutionWebhook(payload: unknown): InboundEvent[]`.
  - `class EvolutionProvider implements WhatsAppProvider` (`constructor(baseURL = env.EVOLUTION_URL, apiKey = env.EVOLUTION_API_KEY)`).
  - `getProvider(): WhatsAppProvider`, `setProvider(p: WhatsAppProvider | null): void`.
  - Teste: `class FakeProvider` com `sent`, `instances`, `state`, `failNext(method, times?)`, `reset()`, `texts()`.

- [x] **Step 1: Escrever fixtures e testes que falham**

`backend/test/fixtures/evolution.ts`:

```ts
type Json = Record<string, unknown>;

export function upsert(data: Json, instance = "inst_1"): Json {
  return { event: "messages.upsert", instance, data };
}

export function textMessage(opts: { id?: string; from?: string; text?: string; fromMe?: boolean; pushName?: string } = {}): Json {
  return upsert({
    key: { remoteJid: `${opts.from ?? "5511988887777"}@s.whatsapp.net`, fromMe: opts.fromMe ?? false, id: opts.id ?? "MSG1" },
    pushName: opts.pushName ?? "Maria",
    message: { conversation: opts.text ?? "Oi" },
    messageType: "conversation",
    messageTimestamp: 1760000000,
  });
}

export function imageMessage(opts: { id?: string; from?: string; caption?: string } = {}): Json {
  return upsert({
    key: { remoteJid: `${opts.from ?? "5511988887777"}@s.whatsapp.net`, fromMe: false, id: opts.id ?? "IMG1" },
    pushName: "Maria",
    message: { imageMessage: { caption: opts.caption ?? "comprovante", mimetype: "image/jpeg" } },
    messageType: "imageMessage",
    messageTimestamp: 1760000000,
  });
}

export function ackUpdate(id: string, status: string, from = "5511988887777"): Json {
  return {
    event: "messages.update",
    instance: "inst_1",
    data: { keyId: id, remoteJid: `${from}@s.whatsapp.net`, fromMe: true, status },
  };
}

export function connectionUpdate(state: string): Json {
  return {
    event: "connection.update",
    instance: "inst_1",
    data: { instance: "inst_1", state, wuid: "5511999990000@s.whatsapp.net" },
  };
}

export function qrcodeUpdate(): Json {
  return {
    event: "qrcode.updated",
    instance: "inst_1",
    data: { qrcode: { instance: "inst_1", code: "2@abc", base64: "data:image/png;base64,QRDATA" } },
  };
}
```

`backend/test/unit/evolutionParse.test.ts`:

```ts
import { parseEvolutionWebhook } from "../../src/modules/whatsapp/evolution/parseWebhook";
import { ackUpdate, connectionUpdate, imageMessage, qrcodeUpdate, textMessage, upsert } from "../fixtures/evolution";

describe("parseEvolutionWebhook", () => {
  it("parses a plain text message", () => {
    expect(parseEvolutionWebhook(textMessage())).toEqual([
      {
        kind: "message",
        instanceName: "inst_1",
        providerMessageId: "MSG1",
        remoteNumber: "5511988887777",
        isGroup: false,
        fromMe: false,
        pushName: "Maria",
        type: "text",
        body: "Oi",
        media: undefined,
        quotedProviderMessageId: undefined,
        timestamp: 1760000000,
      },
    ]);
  });

  it("parses extended text with a quoted message", () => {
    const [event] = parseEvolutionWebhook(
      upsert({
        key: { remoteJid: "5511988887777@s.whatsapp.net", fromMe: false, id: "M2" },
        message: { extendedTextMessage: { text: "isso aqui", contextInfo: { stanzaId: "M1" } } },
      }),
    );
    expect(event).toMatchObject({ kind: "message", type: "text", body: "isso aqui", quotedProviderMessageId: "M1" });
  });

  it("parses image with caption and media info", () => {
    const [event] = parseEvolutionWebhook(imageMessage());
    expect(event).toMatchObject({ type: "image", body: "comprovante", media: { mimetype: "image/jpeg" } });
  });

  it("parses documents (also wrapped with caption) using caption or file name as body", () => {
    const [plain] = parseEvolutionWebhook(
      upsert({
        key: { remoteJid: "5511988887777@s.whatsapp.net", fromMe: false, id: "D1" },
        message: { documentMessage: { fileName: "boleto.pdf", mimetype: "application/pdf" } },
      }),
    );
    expect(plain).toMatchObject({ type: "document", body: "boleto.pdf", media: { mimetype: "application/pdf", fileName: "boleto.pdf" } });

    const [wrapped] = parseEvolutionWebhook(
      upsert({
        key: { remoteJid: "5511988887777@s.whatsapp.net", fromMe: false, id: "D2" },
        message: {
          documentWithCaptionMessage: {
            message: { documentMessage: { fileName: "nf.pdf", caption: "segue a nota", mimetype: "application/pdf" } },
          },
        },
      }),
    );
    expect(wrapped).toMatchObject({ type: "document", body: "segue a nota" });
  });

  it("parses audio, sticker and location", () => {
    const base = { key: { remoteJid: "5511988887777@s.whatsapp.net", fromMe: false, id: "X" } };
    expect(parseEvolutionWebhook(upsert({ ...base, message: { audioMessage: { mimetype: "audio/ogg; codecs=opus" } } }))[0]).toMatchObject({ type: "audio", body: "" });
    expect(parseEvolutionWebhook(upsert({ ...base, message: { stickerMessage: { mimetype: "image/webp" } } }))[0]).toMatchObject({ type: "sticker" });
    expect(parseEvolutionWebhook(upsert({ ...base, message: { locationMessage: { degreesLatitude: -23.5, degreesLongitude: -46.6 } } }))[0]).toMatchObject({ type: "location", body: "-23.5,-46.6" });
  });

  it("flags group messages", () => {
    const [event] = parseEvolutionWebhook(
      upsert({ key: { remoteJid: "120363000000@g.us", fromMe: false, id: "G1" }, message: { conversation: "oi grupo" } }),
    );
    expect(event).toMatchObject({ isGroup: true });
  });

  it("uses the real phone number for @lid contacts when available", () => {
    const [withAlt] = parseEvolutionWebhook(
      upsert({
        key: { remoteJid: "123456789012345@lid", remoteJidAlt: "5511977776666@s.whatsapp.net", fromMe: false, id: "L1" },
        message: { conversation: "oi" },
      }),
    );
    expect(withAlt).toMatchObject({ remoteNumber: "5511977776666", isGroup: false });

    const [withSenderPn] = parseEvolutionWebhook(
      upsert({
        key: { remoteJid: "123456789012345@lid", senderPn: "5511966665555@s.whatsapp.net", fromMe: false, id: "L2" },
        message: { conversation: "oi" },
      }),
    );
    expect(withSenderPn).toMatchObject({ remoteNumber: "5511966665555" });
  });

  it("ignores reactions, protocol messages, status broadcasts and garbage", () => {
    const key = { remoteJid: "5511988887777@s.whatsapp.net", fromMe: false, id: "R1" };
    expect(parseEvolutionWebhook(upsert({ key, message: { reactionMessage: { text: "👍" } } }))).toEqual([]);
    expect(parseEvolutionWebhook(upsert({ key, message: { protocolMessage: {} } }))).toEqual([]);
    expect(parseEvolutionWebhook(upsert({ key: { ...key, remoteJid: "status@broadcast" }, message: { conversation: "x" } }))).toEqual([]);
    expect(parseEvolutionWebhook(null)).toEqual([]);
    expect(parseEvolutionWebhook({ event: "chats.update", data: {} })).toEqual([]);
  });

  it("accepts uppercase event names", () => {
    const payload = { ...textMessage(), event: "MESSAGES_UPSERT" };
    expect(parseEvolutionWebhook(payload)).toHaveLength(1);
  });

  it("maps ack statuses", () => {
    expect(parseEvolutionWebhook(ackUpdate("M1", "SERVER_ACK"))).toEqual([
      { kind: "ack", instanceName: "inst_1", providerMessageId: "M1", remoteNumber: "5511988887777", ack: "sent" },
    ]);
    expect(parseEvolutionWebhook(ackUpdate("M1", "DELIVERY_ACK"))[0]).toMatchObject({ ack: "delivered" });
    expect(parseEvolutionWebhook(ackUpdate("M1", "READ"))[0]).toMatchObject({ ack: "read" });
    expect(parseEvolutionWebhook(ackUpdate("M1", "PLAYED"))[0]).toMatchObject({ ack: "read" });
    expect(parseEvolutionWebhook(ackUpdate("M1", "ERROR"))[0]).toMatchObject({ ack: "failed" });
    expect(parseEvolutionWebhook(ackUpdate("M1", "WHATEVER"))).toEqual([]);
  });

  it("maps connection states and QR codes", () => {
    expect(parseEvolutionWebhook(connectionUpdate("open"))).toEqual([
      { kind: "connection", instanceName: "inst_1", state: "connected", number: "5511999990000" },
    ]);
    expect(parseEvolutionWebhook(connectionUpdate("connecting"))[0]).toMatchObject({ state: "qrcode" });
    expect(parseEvolutionWebhook(connectionUpdate("close"))[0]).toMatchObject({ state: "disconnected" });
    expect(parseEvolutionWebhook(qrcodeUpdate())).toEqual([
      { kind: "qrcode", instanceName: "inst_1", qrBase64: "data:image/png;base64,QRDATA" },
    ]);
  });
});
```

`backend/test/unit/evolutionProvider.test.ts`:

```ts
import nock from "nock";
import { EvolutionProvider } from "../../src/modules/whatsapp/evolution/EvolutionProvider";

const BASE = "http://evolution.test";
const provider = new EvolutionProvider(BASE, "key-123");
const api = () => nock(BASE, { reqheaders: { apikey: "key-123" } });

describe("EvolutionProvider", () => {
  beforeAll(() => nock.disableNetConnect());
  afterEach(() => nock.cleanAll());
  afterAll(() => nock.enableNetConnect());

  it("creates an instance with the webhook configured without base64", async () => {
    const scope = api()
      .post("/instance/create", (body) =>
        body.instanceName === "wo_1_ab" &&
        body.integration === "WHATSAPP-BAILEYS" &&
        body.qrcode === true &&
        body.groupsIgnore === true &&
        body.webhook.url === "http://hook" &&
        body.webhook.base64 === false &&
        body.webhook.byEvents === false &&
        ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"].every((e) => body.webhook.events.includes(e)),
      )
      .reply(201, { instance: { instanceName: "wo_1_ab" } });
    await provider.createInstance("wo_1_ab", "http://hook");
    expect(scope.isDone()).toBe(true);
  });

  it("sends text and returns the WhatsApp message id", async () => {
    api().post("/message/sendText/inst", { number: "5511988887777", text: "olá" }).reply(201, { key: { id: "SENT1" } });
    await expect(provider.sendText("inst", "5511988887777", "olá")).resolves.toEqual({ providerMessageId: "SENT1" });
  });

  it("sends quoted text", async () => {
    api()
      .post("/message/sendText/inst", { number: "5511988887777", text: "sim", quoted: { key: { id: "Q1" } } })
      .reply(201, { key: { id: "SENT2" } });
    await expect(provider.sendText("inst", "5511988887777", "sim", "Q1")).resolves.toEqual({ providerMessageId: "SENT2" });
  });

  it("sends audio as a WhatsApp voice note", async () => {
    api().post("/message/sendWhatsAppAudio/inst", { number: "5511988887777", audio: "QVVE" }).reply(201, { key: { id: "AUD1" } });
    const result = await provider.sendMedia("inst", "5511988887777", { type: "audio", base64: "QVVE", mimetype: "audio/ogg" });
    expect(result.providerMessageId).toBe("AUD1");
  });

  it("sends documents through sendMedia", async () => {
    api()
      .post("/message/sendMedia/inst", {
        number: "5511988887777",
        mediatype: "document",
        mimetype: "application/pdf",
        media: "UERG",
        fileName: "a.pdf",
        caption: "segue",
      })
      .reply(201, { key: { id: "DOC1" } });
    const result = await provider.sendMedia("inst", "5511988887777", {
      type: "document",
      base64: "UERG",
      mimetype: "application/pdf",
      fileName: "a.pdf",
      caption: "segue",
    });
    expect(result.providerMessageId).toBe("DOC1");
  });

  it("maps connection state", async () => {
    api().get("/instance/connectionState/inst").reply(200, { instance: { instanceName: "inst", state: "open" } });
    await expect(provider.getConnectionState("inst")).resolves.toBe("connected");
    api().get("/instance/connectionState/inst").reply(200, { instance: { state: "connecting" } });
    await expect(provider.getConnectionState("inst")).resolves.toBe("qrcode");
    api().get("/instance/connectionState/inst").reply(200, { instance: { state: "close" } });
    await expect(provider.getConnectionState("inst")).resolves.toBe("disconnected");
  });

  it("returns the QR code base64", async () => {
    api().get("/instance/connect/inst").reply(200, { base64: "data:image/png;base64,AAA", code: "2@x" });
    await expect(provider.getQrCode("inst")).resolves.toBe("data:image/png;base64,AAA");
  });

  it("downloads media by message id", async () => {
    api()
      .post("/chat/getBase64FromMediaMessage/inst", { message: { key: { id: "M1" } }, convertToMp4: false })
      .reply(201, { base64: "QUJD", mimetype: "image/jpeg" });
    await expect(provider.downloadMedia("inst", "M1")).resolves.toEqual({ base64: "QUJD", mimetype: "image/jpeg" });
  });

  it("tolerates 404 when deleting or logging out an instance", async () => {
    api().delete("/instance/logout/inst").reply(404, {});
    api().delete("/instance/delete/inst").reply(404, {});
    await expect(provider.logout("inst")).resolves.toBeUndefined();
    await expect(provider.deleteInstance("inst")).resolves.toBeUndefined();
  });

  it("wraps failures in a PROVIDER_ERROR AppError", async () => {
    api().post("/message/sendText/inst").reply(500, { error: "boom" });
    await expect(provider.sendText("inst", "5511988887777", "x")).rejects.toMatchObject({ code: "PROVIDER_ERROR", status: 502 });
  });

  it("pings the API root", async () => {
    api().get("/").reply(200, { status: 200 });
    await expect(provider.ping()).resolves.toBeUndefined();
  });
});
```

- [x] **Step 2: Rodar e ver falhar**

Run: `npx jest test/unit/evolutionParse.test.ts test/unit/evolutionProvider.test.ts`
Expected: FAIL com `Cannot find module '../../src/modules/whatsapp/evolution/parseWebhook'`.

- [x] **Step 3: Implementar**

`backend/src/modules/whatsapp/provider.ts`: exatamente o bloco de tipos da seção **Interfaces** acima, com o import:

```ts
import { Ack, ConnectionStatus, MessageType } from "../../models";
```

`backend/src/modules/whatsapp/evolution/parseWebhook.ts`:

```ts
import { Ack, ConnectionStatus, MessageType } from "../../../models";
import { AckUpdate, InboundEvent, InboundMessage } from "../provider";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const ACKS: Record<string, Ack> = {
  PENDING: "pending",
  SERVER_ACK: "sent",
  DELIVERY_ACK: "delivered",
  READ: "read",
  PLAYED: "read",
  ERROR: "failed",
};

const STATES: Record<string, ConnectionStatus> = { open: "connected", connecting: "qrcode", close: "disconnected" };

const jidUser = (jid: string) => jid.split("@")[0].split(":")[0];

function resolveRemote(key: Json): { number: string; isGroup: boolean } | null {
  const jid: unknown = key?.remoteJid;
  if (typeof jid !== "string" || !jid) return null;
  if (jid.endsWith("@broadcast")) return null;
  if (jid.endsWith("@g.us")) return { number: jidUser(jid), isGroup: true };
  if (jid.endsWith("@lid")) {
    const alt = key.remoteJidAlt ?? key.senderPn;
    return { number: jidUser(typeof alt === "string" && alt ? alt : jid), isGroup: false };
  }
  return { number: jidUser(jid), isGroup: false };
}

interface Content {
  type: MessageType;
  body: string;
  media?: { mimetype: string; fileName?: string };
  quotedId?: string;
}

function mediaContent(type: MessageType, node: Json, body: string): Content {
  return {
    type,
    body,
    media: { mimetype: node.mimetype ?? "application/octet-stream", fileName: node.fileName ?? undefined },
    quotedId: node.contextInfo?.stanzaId ?? undefined,
  };
}

function extractContent(raw: Json): Content | null {
  const m: Json =
    raw.ephemeralMessage?.message ??
    raw.viewOnceMessage?.message ??
    raw.viewOnceMessageV2?.message ??
    raw.documentWithCaptionMessage?.message ??
    raw;
  if (typeof m.conversation === "string") return { type: "text", body: m.conversation };
  if (m.extendedTextMessage) {
    return {
      type: "text",
      body: m.extendedTextMessage.text ?? "",
      quotedId: m.extendedTextMessage.contextInfo?.stanzaId ?? undefined,
    };
  }
  if (m.imageMessage) return mediaContent("image", m.imageMessage, m.imageMessage.caption ?? "");
  if (m.videoMessage) return mediaContent("video", m.videoMessage, m.videoMessage.caption ?? "");
  if (m.audioMessage) return mediaContent("audio", m.audioMessage, "");
  if (m.documentMessage) {
    return mediaContent("document", m.documentMessage, m.documentMessage.caption ?? m.documentMessage.fileName ?? "");
  }
  if (m.stickerMessage) return mediaContent("sticker", m.stickerMessage, "");
  if (m.locationMessage) {
    return { type: "location", body: `${m.locationMessage.degreesLatitude},${m.locationMessage.degreesLongitude}` };
  }
  return null;
}

function parseMessage(instanceName: string, d: Json): InboundMessage[] {
  if (!d?.key?.id || !d.message) return [];
  const remote = resolveRemote(d.key);
  if (!remote) return [];
  const content = extractContent(d.message);
  if (!content) return [];
  return [
    {
      kind: "message",
      instanceName,
      providerMessageId: String(d.key.id),
      remoteNumber: remote.number,
      isGroup: remote.isGroup,
      fromMe: Boolean(d.key.fromMe),
      pushName: d.pushName || undefined,
      type: content.type,
      body: content.body,
      media: content.media,
      quotedProviderMessageId: content.quotedId,
      timestamp: Number(d.messageTimestamp ?? Math.floor(Date.now() / 1000)),
    },
  ];
}

function parseAck(instanceName: string, d: Json): AckUpdate[] {
  const id = d?.keyId ?? d?.key?.id;
  const ack = ACKS[String(d?.status ?? "")];
  if (!id || !ack) return [];
  const remote = resolveRemote({ remoteJid: d.remoteJid ?? d.key?.remoteJid });
  return [{ kind: "ack", instanceName, providerMessageId: String(id), remoteNumber: remote?.number ?? null, ack }];
}

export function parseEvolutionWebhook(payload: unknown): InboundEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Json;
  const event = String(p.event ?? "").toLowerCase().replace(/_/g, ".");
  const instanceName = String(p.instance ?? p.data?.instance ?? "");
  const items: Json[] = Array.isArray(p.data) ? p.data : [p.data ?? {}];

  switch (event) {
    case "messages.upsert":
      return items.flatMap((d) => parseMessage(instanceName, d));
    case "messages.update":
      return items.flatMap((d) => parseAck(instanceName, d));
    case "connection.update": {
      const state = STATES[String(p.data?.state ?? "")];
      if (!state) return [];
      const wuid = p.data?.wuid;
      return [
        {
          kind: "connection",
          instanceName,
          state,
          ...(typeof wuid === "string" && wuid ? { number: jidUser(wuid) } : {}),
        },
      ];
    }
    case "qrcode.updated": {
      const qr = p.data?.qrcode?.base64;
      return typeof qr === "string" && qr ? [{ kind: "qrcode", instanceName, qrBase64: qr }] : [];
    }
    default:
      return [];
  }
}
```

`backend/src/modules/whatsapp/evolution/EvolutionProvider.ts`:

```ts
import axios, { AxiosInstance, AxiosResponse } from "axios";
import { env } from "../../../config/env";
import { ConnectionStatus } from "../../../models";
import { AppError } from "../../../shared/errors/AppError";
import { logger } from "../../../shared/logger";
import { InboundEvent, OutboundMedia, SendResult, WhatsAppProvider } from "../provider";
import { parseEvolutionWebhook } from "./parseWebhook";

const STATES: Record<string, ConnectionStatus> = { open: "connected", connecting: "qrcode", close: "disconnected" };
const WEBHOOK_EVENTS = ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"];

export class EvolutionProvider implements WhatsAppProvider {
  private readonly http: AxiosInstance;

  constructor(baseURL = env.EVOLUTION_URL, apiKey = env.EVOLUTION_API_KEY) {
    this.http = axios.create({ baseURL, headers: { apikey: apiKey }, timeout: 30_000 });
  }

  private async call<T>(request: () => Promise<AxiosResponse<T>>, allow404 = false): Promise<T | null> {
    try {
      return (await request()).data;
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (allow404 && status === 404) return null;
      logger.warn({ err: axios.isAxiosError(err) ? err.message : err, status }, "evolution request failed");
      throw new AppError("PROVIDER_ERROR", 502, `Falha na Evolution API${status ? ` (${status})` : ""}`);
    }
  }

  private sentId(data: { key?: { id?: string } } | null): SendResult {
    const id = data?.key?.id;
    if (!id) throw new AppError("PROVIDER_ERROR", 502, "Evolution API não retornou o id da mensagem");
    return { providerMessageId: id };
  }

  async ping(): Promise<void> {
    await this.call(() => this.http.get("/"));
  }

  async createInstance(instanceName: string, webhookUrl: string): Promise<void> {
    await this.call(() =>
      this.http.post("/instance/create", {
        instanceName,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        groupsIgnore: true,
        webhook: { url: webhookUrl, byEvents: false, base64: false, events: WEBHOOK_EVENTS },
      }),
    );
  }

  async deleteInstance(instanceName: string): Promise<void> {
    await this.call(() => this.http.delete(`/instance/delete/${instanceName}`), true);
  }

  async logout(instanceName: string): Promise<void> {
    await this.call(() => this.http.delete(`/instance/logout/${instanceName}`), true);
  }

  async getQrCode(instanceName: string): Promise<string | null> {
    const data = await this.call<{ base64?: string }>(() => this.http.get(`/instance/connect/${instanceName}`));
    return data?.base64 ?? null;
  }

  async getConnectionState(instanceName: string): Promise<ConnectionStatus> {
    const data = await this.call<{ instance?: { state?: string } }>(
      () => this.http.get(`/instance/connectionState/${instanceName}`),
      true,
    );
    return STATES[data?.instance?.state ?? ""] ?? "disconnected";
  }

  async sendText(instanceName: string, number: string, text: string, quotedProviderMessageId?: string): Promise<SendResult> {
    const body = {
      number,
      text,
      ...(quotedProviderMessageId ? { quoted: { key: { id: quotedProviderMessageId } } } : {}),
    };
    return this.sentId(await this.call(() => this.http.post(`/message/sendText/${instanceName}`, body)));
  }

  async sendMedia(instanceName: string, number: string, media: OutboundMedia): Promise<SendResult> {
    if (media.type === "audio") {
      return this.sentId(
        await this.call(() => this.http.post(`/message/sendWhatsAppAudio/${instanceName}`, { number, audio: media.base64 })),
      );
    }
    const body = {
      number,
      mediatype: media.type,
      mimetype: media.mimetype,
      media: media.base64,
      ...(media.fileName ? { fileName: media.fileName } : {}),
      ...(media.caption ? { caption: media.caption } : {}),
    };
    return this.sentId(await this.call(() => this.http.post(`/message/sendMedia/${instanceName}`, body)));
  }

  async downloadMedia(instanceName: string, providerMessageId: string): Promise<{ base64: string; mimetype: string }> {
    const data = await this.call<{ base64?: string; mimetype?: string }>(() =>
      this.http.post(`/chat/getBase64FromMediaMessage/${instanceName}`, {
        message: { key: { id: providerMessageId } },
        convertToMp4: false,
      }),
    );
    if (!data?.base64) throw new AppError("PROVIDER_ERROR", 502, "Mídia indisponível na Evolution API");
    return { base64: data.base64, mimetype: data.mimetype ?? "application/octet-stream" };
  }

  parseWebhook(payload: unknown): InboundEvent[] {
    return parseEvolutionWebhook(payload);
  }
}
```

`backend/src/modules/whatsapp/registry.ts`:

```ts
import { EvolutionProvider } from "./evolution/EvolutionProvider";
import { WhatsAppProvider } from "./provider";

let current: WhatsAppProvider | null = null;

export function getProvider(): WhatsAppProvider {
  if (!current) current = new EvolutionProvider();
  return current;
}

/** Usado em testes para injetar um provider falso; `null` volta ao padrão. */
export function setProvider(provider: WhatsAppProvider | null): void {
  current = provider;
}
```

`backend/test/helpers/fakeProvider.ts`:

```ts
import { ConnectionStatus } from "../../src/models";
import { parseEvolutionWebhook } from "../../src/modules/whatsapp/evolution/parseWebhook";
import { InboundEvent, OutboundMedia, SendResult, WhatsAppProvider } from "../../src/modules/whatsapp/provider";
import { AppError } from "../../src/shared/errors/AppError";

type Method = "createInstance" | "deleteInstance" | "logout" | "getQrCode" | "send" | "downloadMedia";

export interface SentItem {
  instanceName: string;
  number: string;
  text?: string;
  quoted?: string;
  media?: OutboundMedia;
}

export class FakeProvider implements WhatsAppProvider {
  sent: SentItem[] = [];
  instances = new Map<string, string>();
  state: ConnectionStatus = "connected";
  private failures = new Map<Method, number>();
  private counter = 0;

  reset(): void {
    this.sent = [];
    this.instances.clear();
    this.state = "connected";
    this.failures.clear();
    this.counter = 0;
  }

  failNext(method: Method, times = 1): void {
    this.failures.set(method, times);
  }

  texts(): string[] {
    return this.sent.flatMap((s) => (s.text !== undefined ? [s.text] : []));
  }

  private maybeFail(method: Method): void {
    const left = this.failures.get(method) ?? 0;
    if (left > 0) {
      this.failures.set(method, left - 1);
      throw new AppError("PROVIDER_ERROR", 502, `fake ${method} failure`);
    }
  }

  async ping(): Promise<void> {}

  async createInstance(instanceName: string, webhookUrl: string): Promise<void> {
    this.maybeFail("createInstance");
    this.instances.set(instanceName, webhookUrl);
  }

  async deleteInstance(instanceName: string): Promise<void> {
    this.maybeFail("deleteInstance");
    this.instances.delete(instanceName);
  }

  async logout(): Promise<void> {
    this.maybeFail("logout");
  }

  async getQrCode(): Promise<string | null> {
    this.maybeFail("getQrCode");
    return "data:image/png;base64,FAKEQR";
  }

  async getConnectionState(): Promise<ConnectionStatus> {
    return this.state;
  }

  async sendText(instanceName: string, number: string, text: string, quoted?: string): Promise<SendResult> {
    this.maybeFail("send");
    this.sent.push({ instanceName, number, text, quoted });
    return { providerMessageId: `fake-${++this.counter}` };
  }

  async sendMedia(instanceName: string, number: string, media: OutboundMedia): Promise<SendResult> {
    this.maybeFail("send");
    this.sent.push({ instanceName, number, media });
    return { providerMessageId: `fake-${++this.counter}` };
  }

  async downloadMedia(): Promise<{ base64: string; mimetype: string }> {
    this.maybeFail("downloadMedia");
    return { base64: Buffer.from("fake-media").toString("base64"), mimetype: "image/jpeg" };
  }

  parseWebhook(payload: unknown): InboundEvent[] {
    return parseEvolutionWebhook(payload);
  }
}
```

- [x] **Step 4: Rodar e ver passar**

Run: `npx jest && npm run typecheck`
Expected: todos PASS.

- [x] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(whatsapp): interface WhatsAppProvider e implementação Evolution API"
```

---

### Task 8: Tempo real (Socket.io) e eventos de ticket/mensagem

**Files:**
- Create: `backend/src/modules/realtime/socket.ts`, `backend/src/modules/tickets/ticket.events.ts`
- Test: `backend/test/integration/realtime.test.ts`

**Interfaces:**
- Consumes: `verifyAccessToken`, `AuthContext`, `userQueueIds`, models `Ticket`, `Contact`, `Queue`, `User`, `Message`.
- Produces:
  - `rooms = { company(id), supervisors(companyId), queue(id), user(id), ticket(id) }` → strings `company:1`, `company:1:supervisors`, `queue:1`, `user:1`, `ticket:1`.
  - `initSocket(server: http.Server, deps: { canJoinTicket(auth: AuthContext, ticketId: number): Promise<boolean> }): Server`.
  - `emitter = { toRooms(rooms: string[], event: string, payload: unknown), toCompany(companyId, event, payload), toSupervisors(companyId, event, payload) }` (no-op se o socket não foi iniciado).
  - `closeSocket(): Promise<void>`.
  - Evento servidor → cliente `ready` depois que o socket entrou nas salas; cliente → servidor `ticket:join` (ticketId, ack?(ok: boolean)) e `ticket:leave` (ticketId).
  - `TICKET_INCLUDE` (includes padrão do ticket), `emitTicket(ticketId: number, prev?: { queueId: number | null; userId: number | null }): Promise<void>` → evento `ticket:update` com o ticket completo; `emitMessage(message: Message, event: "message:new" | "message:update"): void`; `emitMessageDeleted(message: Message): void` → evento `message:delete` `{ id, ticketId }`.

- [x] **Step 1: Escrever o teste que falha**

`backend/test/integration/realtime.test.ts`:

```ts
import http from "node:http";
import { AddressInfo } from "node:net";
import { io as ioc, Socket } from "socket.io-client";
import { closeSocket, emitter, initSocket, rooms } from "../../src/modules/realtime/socket";
import { emitTicket } from "../../src/modules/tickets/ticket.events";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createQueue, createTicket, createUser, scenario } from "../helpers/factories";

let server: http.Server;
let port: number;
const clients: Socket[] = [];

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = ioc(`http://localhost:${port}`, { auth: { token }, transports: ["websocket"], forceNew: true });
    clients.push(socket);
    socket.once("ready", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function nextEvent<T = unknown>(socket: Socket, event: string, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sem evento ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function noEvent(socket: Socket, event: string, waitMs = 300): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = () => reject(new Error(`evento inesperado ${event}`));
    socket.once(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, waitMs);
  });
}

describe("realtime", () => {
  beforeEach(async () => {
    await resetDb();
    server = http.createServer();
    initSocket(server, { canJoinTicket: async (_auth, ticketId) => ticketId !== 999 });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    clients.splice(0).forEach((c) => c.disconnect());
    await closeSocket();
  });

  it("rejects connections without a valid token", async () => {
    await expect(connect("invalido")).rejects.toThrow("UNAUTHENTICATED");
  });

  it("delivers company broadcasts", async () => {
    const { company } = await scenario();
    const agent = await createUser(company.id);
    const socket = await connect(bearer(agent).slice(7));
    const received = nextEvent(socket, "ping:test");
    emitter.toCompany(company.id, "ping:test", { ok: true });
    await expect(received).resolves.toEqual({ ok: true });
  });

  it("routes ticket updates to supervisors and to the ticket's queue only", async () => {
    const { company, connection, contact } = await scenario();
    const queueA = await createQueue(company.id);
    const queueB = await createQueue(company.id);
    const supervisor = await createUser(company.id, { profile: "supervisor" });
    const agentA = await createUser(company.id, { queueIds: [queueA.id] });
    const agentB = await createUser(company.id, { queueIds: [queueB.id] });
    const [sSup, sA, sB] = await Promise.all([supervisor, agentA, agentB].map((u) => connect(bearer(u).slice(7))));

    const ticket = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, queueId: queueA.id });
    const supGot = nextEvent<{ id: number; contact: { id: number } }>(sSup, "ticket:update");
    const aGot = nextEvent(sA, "ticket:update");
    const bSilent = noEvent(sB, "ticket:update");
    await emitTicket(ticket.id);
    const payload = await supGot;
    expect(payload.id).toBe(ticket.id);
    expect(payload.contact.id).toBe(contact.id);
    await aGot;
    await bSilent;

    await ticket.update({ queueId: queueB.id });
    const aOld = nextEvent(sA, "ticket:update");
    const bNew = nextEvent(sB, "ticket:update");
    await emitTicket(ticket.id, { queueId: queueA.id, userId: null });
    await Promise.all([aOld, bNew]);
  });

  it("joins ticket rooms only when allowed", async () => {
    const { company } = await scenario();
    const agent = await createUser(company.id);
    const socket = await connect(bearer(agent).slice(7));

    const okAck = await new Promise((resolve) => socket.emit("ticket:join", 5, resolve));
    expect(okAck).toBe(true);
    const got = nextEvent(socket, "message:new");
    emitter.toRooms([rooms.ticket(5)], "message:new", { id: 1 });
    await expect(got).resolves.toEqual({ id: 1 });

    const deniedAck = await new Promise((resolve) => socket.emit("ticket:join", 999, resolve));
    expect(deniedAck).toBe(false);
    const silent = noEvent(socket, "message:new");
    emitter.toRooms([rooms.ticket(999)], "message:new", { id: 2 });
    await silent;
  });
});
```

- [x] **Step 2: Rodar e ver falhar**

Run: `npx jest test/integration/realtime.test.ts`
Expected: FAIL com `Cannot find module '../../src/modules/realtime/socket'`.

- [x] **Step 3: Implementar**

`backend/src/modules/realtime/socket.ts`:

```ts
import http from "node:http";
import { Server } from "socket.io";
import { env } from "../../config/env";
import { logger } from "../../shared/logger";
import { AuthContext } from "../auth/auth.types";
import { verifyAccessToken } from "../auth/tokens";
import { userQueueIds } from "../users/userQueues";

export const rooms = {
  company: (id: number) => `company:${id}`,
  supervisors: (companyId: number) => `company:${companyId}:supervisors`,
  queue: (id: number) => `queue:${id}`,
  user: (id: number) => `user:${id}`,
  ticket: (id: number) => `ticket:${id}`,
};

export interface SocketDeps {
  canJoinTicket(auth: AuthContext, ticketId: number): Promise<boolean>;
}

let io: Server | null = null;

export function initSocket(server: http.Server, deps: SocketDeps): Server {
  io = new Server(server, { cors: { origin: env.FRONTEND_URL } });

  io.use((socket, next) => {
    try {
      socket.data.auth = verifyAccessToken(String(socket.handshake.auth?.token ?? ""));
      next();
    } catch {
      next(new Error("UNAUTHENTICATED"));
    }
  });

  io.on("connection", async (socket) => {
    const auth = socket.data.auth as AuthContext;
    try {
      socket.join(rooms.company(auth.companyId));
      socket.join(rooms.user(auth.userId));
      if (auth.profile !== "agent") socket.join(rooms.supervisors(auth.companyId));
      for (const queueId of await userQueueIds(auth.userId)) socket.join(rooms.queue(queueId));
    } catch (err) {
      logger.error({ err, userId: auth.userId }, "socket room setup failed");
    }

    socket.on("ticket:join", async (ticketId: unknown, ack?: (ok: boolean) => void) => {
      const id = Number(ticketId);
      const ok = Number.isInteger(id) && (await deps.canJoinTicket(auth, id).catch(() => false));
      if (ok) socket.join(rooms.ticket(id));
      if (typeof ack === "function") ack(ok);
    });

    socket.on("ticket:leave", (ticketId: unknown) => {
      socket.leave(rooms.ticket(Number(ticketId)));
    });

    socket.emit("ready");
  });

  return io;
}

export const emitter = {
  toRooms(targets: string[], event: string, payload: unknown): void {
    if (io && targets.length) io.to(targets).emit(event, payload);
  },
  toCompany(companyId: number, event: string, payload: unknown): void {
    emitter.toRooms([rooms.company(companyId)], event, payload);
  },
  toSupervisors(companyId: number, event: string, payload: unknown): void {
    emitter.toRooms([rooms.supervisors(companyId)], event, payload);
  },
};

export async function closeSocket(): Promise<void> {
  if (!io) return;
  const server = io;
  io = null;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
```

`backend/src/modules/tickets/ticket.events.ts`:

```ts
import { Contact, Message, Queue, Ticket, User } from "../../models";
import { emitter, rooms } from "../realtime/socket";

export const TICKET_INCLUDE = [
  { model: Contact },
  { model: Queue },
  { model: User, attributes: ["id", "name"] },
];

export async function emitTicket(
  ticketId: number,
  prev?: { queueId: number | null; userId: number | null },
): Promise<void> {
  const ticket = await Ticket.findByPk(ticketId, { include: TICKET_INCLUDE });
  if (!ticket) return;
  const targets = new Set<string>([rooms.supervisors(ticket.companyId)]);
  for (const side of [ticket, prev]) {
    if (!side) continue;
    if (side.queueId) targets.add(rooms.queue(side.queueId));
    if (side.userId) targets.add(rooms.user(side.userId));
  }
  emitter.toRooms([...targets], "ticket:update", ticket.toJSON());
}

export function emitMessage(message: Message, event: "message:new" | "message:update"): void {
  emitter.toRooms([rooms.ticket(message.ticketId)], event, message.toJSON());
}

export function emitMessageDeleted(message: Message): void {
  emitter.toRooms([rooms.ticket(message.ticketId)], "message:delete", { id: message.id, ticketId: message.ticketId });
}
```

- [x] **Step 4: Rodar e ver passar**

Run: `npx jest && npm run typecheck`
Expected: todos PASS.

- [x] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(realtime): socket.io com salas por empresa, fila, usuário e ticket"
```

---

### Task 9: Conexões WhatsApp

**Files:**
- Create: `backend/src/modules/connections/{connections.service,connections.routes,maintenance}.ts`
- Modify: `backend/src/routes.ts`
- Test: `backend/test/integration/connections.test.ts`

**Interfaces:**
- Consumes: `Connection`, `ConnectionStatus`, `Ticket`, `getProvider`, `emitter`, `assertQueuesBelong`, `idParam`, auth, `env.BACKEND_PUBLIC_URL`.
- Produces:
  - `interface ConnectionInput { name: string; isDefault?: boolean; defaultQueueId?: number | null; outOfHoursMessage?: string; closingMessage?: string; transferMessage?: string; botTimeoutMinutes?: number }`.
  - `publicConnection(c: Connection): Record<string, unknown>` (sem `webhookToken`).
  - `webhookUrl(c: Connection): string` → `${BACKEND_PUBLIC_URL}/webhooks/evolution/${webhookToken}`.
  - `listConnections(companyId)`, `getConnectionOr404(companyId, id)`, `createConnection(companyId, input)`, `updateConnection(companyId, id, input)`, `deleteConnection(companyId, id)`, `getConnectionQrCode(companyId, id): Promise<{ qr: string | null }>`, `disconnectConnection(companyId, id)`.
  - `applyConnectionUpdate(connection: Connection, state: ConnectionStatus, number?: string): Promise<void>` → emite `connection:update` para supervisores; `connected → disconnected` também emite `connection:alert` `{ connectionId, name }`.
  - `applyQrCode(connection: Connection, qr: string): Promise<void>` → emite `connection:qrcode` `{ connectionId, qr }`.
  - `checkConnectionsHealth(): Promise<void>`, `processMaintenanceJob(job: Job): Promise<void>` (job `connection-health`).
  - Rotas: `GET /api/connections` (todos), `POST /api/connections`, `PUT/DELETE /api/connections/:id`, `GET /api/connections/:id/qrcode`, `POST /api/connections/:id/disconnect` (admin).

- [x] **Step 1: Escrever o teste que falha**

`backend/test/integration/connections.test.ts`:

```ts
import request from "supertest";
import { createApp } from "../../src/app";
import { Connection } from "../../src/models";
import {
  applyConnectionUpdate,
  checkConnectionsHealth,
} from "../../src/modules/connections/connections.service";
import { emitter } from "../../src/modules/realtime/socket";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createCompany, createConnection, createTicket, createUser, scenario } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";

const app = createApp();
const fake = new FakeProvider();

async function admin() {
  const company = await createCompany();
  const user = await createUser(company.id, { profile: "admin" });
  return { company, user };
}

describe("connections", () => {
  beforeEach(async () => {
    await resetDb();
    fake.reset();
    setProvider(fake);
  });
  afterAll(() => setProvider(null));

  it("creates a connection, registers the instance and hides the webhook token", async () => {
    const { user } = await admin();
    const res = await request(app).post("/api/connections").set("Authorization", bearer(user)).send({ name: "Comercial" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Comercial", status: "qrcode", isDefault: true });
    expect(res.body.webhookToken).toBeUndefined();

    const saved = await Connection.findByPk(res.body.id);
    expect(fake.instances.get(saved!.instanceName)).toBe(`http://backend.test/webhooks/evolution/${saved!.webhookToken}`);
  });

  it("rolls back when the provider fails", async () => {
    const { user } = await admin();
    fake.failNext("createInstance");
    const res = await request(app).post("/api/connections").set("Authorization", bearer(user)).send({ name: "X" });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("PROVIDER_ERROR");
    expect(await Connection.count()).toBe(0);
  });

  it("keeps a single default connection per company", async () => {
    const { user } = await admin();
    const first = await request(app).post("/api/connections").set("Authorization", bearer(user)).send({ name: "A" });
    const second = await request(app)
      .post("/api/connections")
      .set("Authorization", bearer(user))
      .send({ name: "B", isDefault: true });
    expect(second.body.isDefault).toBe(true);
    expect((await Connection.findByPk(first.body.id))!.isDefault).toBe(false);
  });

  it("refuses to delete a connection that has tickets", async () => {
    const { company, connection, contact } = await scenario();
    const user = await createUser(company.id, { profile: "admin" });
    await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id });
    const res = await request(app).delete(`/api/connections/${connection.id}`).set("Authorization", bearer(user));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONNECTION_HAS_TICKETS");
  });

  it("deletes the instance at the provider", async () => {
    const { company, user } = await admin();
    const connection = await createConnection(company.id);
    fake.instances.set(connection.instanceName, "x");
    await request(app).delete(`/api/connections/${connection.id}`).set("Authorization", bearer(user)).expect(204);
    expect(fake.instances.has(connection.instanceName)).toBe(false);
    expect(await Connection.count()).toBe(0);
  });

  it("returns a QR code for a disconnected connection", async () => {
    const { company, user } = await admin();
    const connection = await createConnection(company.id, { status: "disconnected" });
    const res = await request(app).get(`/api/connections/${connection.id}/qrcode`).set("Authorization", bearer(user));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ qr: "data:image/png;base64,FAKEQR" });
    expect((await Connection.findByPk(connection.id))!.status).toBe("qrcode");
  });

  it("lets agents list connections but not create them", async () => {
    const { company } = await admin();
    const agent = await createUser(company.id, { profile: "agent" });
    await createConnection(company.id);
    const list = await request(app).get("/api/connections").set("Authorization", bearer(agent));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].webhookToken).toBeUndefined();
    const res = await request(app).post("/api/connections").set("Authorization", bearer(agent)).send({ name: "X" });
    expect(res.status).toBe(403);
  });

  it("emits an alert when a connected instance drops", async () => {
    const { company } = await admin();
    const connection = await createConnection(company.id, { status: "connected" });
    const spy = jest.spyOn(emitter, "toSupervisors");
    await applyConnectionUpdate(connection, "disconnected");
    expect(spy).toHaveBeenCalledWith(company.id, "connection:alert", { connectionId: connection.id, name: connection.name });
    expect((await Connection.findByPk(connection.id))!.status).toBe("disconnected");
    spy.mockRestore();
  });

  it("health check fixes divergent statuses", async () => {
    const { company } = await admin();
    const connection = await createConnection(company.id, { status: "connected" });
    fake.state = "disconnected";
    await checkConnectionsHealth();
    expect((await Connection.findByPk(connection.id))!.status).toBe("disconnected");
  });
});
```

- [x] **Step 2: Rodar e ver falhar**

Run: `npx jest test/integration/connections.test.ts`
Expected: FAIL com `Cannot find module '../../src/modules/connections/connections.service'`.

- [x] **Step 3: Implementar**

`backend/src/modules/connections/connections.service.ts`:

```ts
import { randomBytes } from "node:crypto";
import { Op } from "sequelize";
import { env } from "../../config/env";
import { Connection, ConnectionStatus, Ticket } from "../../models";
import { AppError, notFound } from "../../shared/errors/AppError";
import { logger } from "../../shared/logger";
import { assertQueuesBelong } from "../queues/queues.service";
import { emitter } from "../realtime/socket";
import { getProvider } from "../whatsapp/registry";

export interface ConnectionInput {
  name: string;
  isDefault?: boolean;
  defaultQueueId?: number | null;
  outOfHoursMessage?: string;
  closingMessage?: string;
  transferMessage?: string;
  botTimeoutMinutes?: number;
}

export function publicConnection(c: Connection): Record<string, unknown> {
  const { webhookToken: _hidden, ...rest } = c.toJSON() as Record<string, unknown>;
  return rest;
}

export function webhookUrl(c: Connection): string {
  return `${env.BACKEND_PUBLIC_URL}/webhooks/evolution/${c.webhookToken}`;
}

export function listConnections(companyId: number) {
  return Connection.findAll({ where: { companyId }, order: [["name", "ASC"]] });
}

export async function getConnectionOr404(companyId: number, id: number): Promise<Connection> {
  const connection = await Connection.findOne({ where: { id, companyId } });
  if (!connection) throw notFound("Conexão");
  return connection;
}

async function makeOnlyDefault(connection: Connection): Promise<void> {
  await Connection.update(
    { isDefault: false },
    { where: { companyId: connection.companyId, id: { [Op.ne]: connection.id } } },
  );
}

export async function createConnection(companyId: number, input: ConnectionInput): Promise<Connection> {
  if (input.defaultQueueId) await assertQueuesBelong(companyId, [input.defaultQueueId]);
  const isFirst = (await Connection.count({ where: { companyId } })) === 0;
  const connection = await Connection.create({
    companyId,
    ...input,
    isDefault: input.isDefault ?? isFirst,
    instanceName: `wo_${companyId}_${randomBytes(4).toString("hex")}`,
    webhookToken: randomBytes(24).toString("hex"),
    status: "disconnected",
  });
  try {
    await getProvider().createInstance(connection.instanceName, webhookUrl(connection));
  } catch (err) {
    await connection.destroy();
    throw err;
  }
  await connection.update({ status: "qrcode" });
  if (connection.isDefault) await makeOnlyDefault(connection);
  return connection;
}

export async function updateConnection(companyId: number, id: number, input: Partial<ConnectionInput>) {
  const connection = await getConnectionOr404(companyId, id);
  if (input.defaultQueueId) await assertQueuesBelong(companyId, [input.defaultQueueId]);
  await connection.update(input);
  if (input.isDefault) await makeOnlyDefault(connection);
  return connection;
}

export async function deleteConnection(companyId: number, id: number): Promise<void> {
  const connection = await getConnectionOr404(companyId, id);
  if ((await Ticket.count({ where: { connectionId: id } })) > 0) {
    throw new AppError(
      "CONNECTION_HAS_TICKETS",
      409,
      "Esta conexão possui atendimentos registrados; desconecte-a em vez de excluir",
    );
  }
  await getProvider().deleteInstance(connection.instanceName);
  await connection.destroy();
}

export async function getConnectionQrCode(companyId: number, id: number): Promise<{ qr: string | null }> {
  const connection = await getConnectionOr404(companyId, id);
  if (connection.status === "connected") throw new AppError("ALREADY_CONNECTED", 409, "Conexão já está ativa");
  const qr = await getProvider().getQrCode(connection.instanceName);
  if (connection.status !== "qrcode") await connection.update({ status: "qrcode" });
  return { qr };
}

export async function disconnectConnection(companyId: number, id: number): Promise<Connection> {
  const connection = await getConnectionOr404(companyId, id);
  await getProvider().logout(connection.instanceName);
  await applyConnectionUpdate(connection, "disconnected");
  return connection;
}

export async function applyConnectionUpdate(
  connection: Connection,
  state: ConnectionStatus,
  number?: string,
): Promise<void> {
  const previous = connection.status;
  if (previous === state && (!number || number === connection.number)) return;
  await connection.update({ status: state, ...(number ? { number } : {}) });
  emitter.toSupervisors(connection.companyId, "connection:update", publicConnection(connection));
  if (previous === "connected" && state === "disconnected") {
    emitter.toSupervisors(connection.companyId, "connection:alert", { connectionId: connection.id, name: connection.name });
  }
}

export async function applyQrCode(connection: Connection, qr: string): Promise<void> {
  if (connection.status !== "qrcode") await applyConnectionUpdate(connection, "qrcode");
  emitter.toSupervisors(connection.companyId, "connection:qrcode", { connectionId: connection.id, qr });
}

export async function checkConnectionsHealth(): Promise<void> {
  const connections = await Connection.findAll();
  for (const connection of connections) {
    try {
      const state = await getProvider().getConnectionState(connection.instanceName);
      await applyConnectionUpdate(connection, state);
    } catch (err) {
      logger.warn({ err, connectionId: connection.id }, "connection health check failed");
    }
  }
}
```

`backend/src/modules/connections/maintenance.ts`:

```ts
import { Job } from "bullmq";
import { checkConnectionsHealth } from "./connections.service";

export async function processMaintenanceJob(job: Job): Promise<void> {
  if (job.name === "connection-health") await checkConnectionsHealth();
}
```

`backend/src/modules/connections/connections.routes.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../shared/http";
import { currentAuth, isAuth, requireProfile } from "../auth/auth.middleware";
import {
  createConnection,
  deleteConnection,
  disconnectConnection,
  getConnectionQrCode,
  listConnections,
  publicConnection,
  updateConnection,
} from "./connections.service";

const connectionSchema = z.object({
  name: z.string().trim().min(1).max(60),
  isDefault: z.boolean().optional(),
  defaultQueueId: z.number().int().positive().nullable().optional(),
  outOfHoursMessage: z.string().max(2000).optional(),
  closingMessage: z.string().max(2000).optional(),
  transferMessage: z.string().max(2000).optional(),
  botTimeoutMinutes: z.number().int().min(1).max(1440).optional(),
});

export const connectionRoutes = Router();
connectionRoutes.use(isAuth);

connectionRoutes.get("/", async (req, res) => {
  const connections = await listConnections(currentAuth(req).companyId);
  res.json(connections.map(publicConnection));
});

connectionRoutes.post("/", requireProfile("admin"), async (req, res) => {
  const input = connectionSchema.parse(req.body);
  res.status(201).json(publicConnection(await createConnection(currentAuth(req).companyId, input)));
});

connectionRoutes.put("/:id", requireProfile("admin"), async (req, res) => {
  const input = connectionSchema.partial().parse(req.body);
  res.json(publicConnection(await updateConnection(currentAuth(req).companyId, idParam(req), input)));
});

connectionRoutes.delete("/:id", requireProfile("admin"), async (req, res) => {
  await deleteConnection(currentAuth(req).companyId, idParam(req));
  res.status(204).end();
});

connectionRoutes.get("/:id/qrcode", requireProfile("admin"), async (req, res) => {
  res.json(await getConnectionQrCode(currentAuth(req).companyId, idParam(req)));
});

connectionRoutes.post("/:id/disconnect", requireProfile("admin"), async (req, res) => {
  res.json(publicConnection(await disconnectConnection(currentAuth(req).companyId, idParam(req))));
});
```

Em `backend/src/routes.ts`, acrescente:

```ts
import { connectionRoutes } from "./modules/connections/connections.routes";
// ...
apiRoutes.use("/connections", connectionRoutes);
```

- [x] **Step 4: Rodar e ver passar**

Run: `npx jest && npm run typecheck`
Expected: todos PASS.

- [x] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(connections): conexões Evolution com QR code, status e health check"
```

---

### Task 10: Motor do chatbot (função pura)

**Files:**
- Create: `backend/src/modules/chatbot/engine.ts`
- Test: `backend/test/unit/chatbotEngine.test.ts`

**Interfaces:**
- Consumes: `BotAction` (models), `StoredMedia` (tipo).
- Produces:

```ts
export interface BotNode {
  id: number; parentId: number | null; order: number; key: string; title: string; action: BotAction;
  message: string; mediaUrl: string | null; mediaMime: string | null; mediaName: string | null;
  queueId: number | null; userId: number | null;
}
export interface BotState { nodeId: number | null; attempts: number }
export interface BotContext {
  nodes: BotNode[];
  defaultQueueId: number | null;
  isQueueOpen(queueId: number): boolean;
  messages: { transfer: string; outOfHours: string; invalid: string };
}
export type BotEffect =
  | { type: "send_text"; text: string }
  | { type: "send_media"; media: StoredMedia; caption: string }
  | { type: "transfer"; queueId: number | null; userId: number | null }
  | { type: "close" };
export interface StepResult { effects: BotEffect[]; state: BotState; finished: boolean }
export const MAX_INVALID_ATTEMPTS = 3;
export const INVALID_OPTION_MESSAGE = "Opção inválida.";
export function renderMenu(node: BotNode, children: BotNode[]): string;
export function step(state: BotState, input: string | null, ctx: BotContext): StepResult;
```

`input = null` significa mensagem não-texto (conta como inválida). `state.nodeId = null` (ou nó que não existe mais) = primeira interação: o bot envia o menu da raiz e ignora a entrada.

- [ ] **Step 1: Escrever o teste que falha**

`backend/test/unit/chatbotEngine.test.ts`:

```ts
import { BotContext, BotNode, renderMenu, step } from "../../src/modules/chatbot/engine";

const node = (n: Partial<BotNode> & Pick<BotNode, "id">): BotNode => ({
  parentId: null,
  order: 0,
  key: "",
  title: "",
  action: "submenu",
  message: "",
  mediaUrl: null,
  mediaMime: null,
  mediaName: null,
  queueId: null,
  userId: null,
  ...n,
});

const nodes: BotNode[] = [
  node({ id: 1, message: "Olá! Bem-vindo à Empresa X." }),
  node({ id: 2, parentId: 1, order: 1, key: "1", title: "Financeiro", action: "submenu", message: "Financeiro:" }),
  node({ id: 3, parentId: 1, order: 2, key: "2", title: "Suporte", action: "transfer_queue", queueId: 20 }),
  node({ id: 4, parentId: 1, order: 3, key: "3", title: "Encerrar", action: "close", message: "Até logo!" }),
  node({ id: 5, parentId: 1, order: 4, key: "4", title: "Falar com Ana", action: "transfer_agent", userId: 99 }),
  node({ id: 6, parentId: 2, order: 1, key: "1", title: "2ª via", action: "reply", message: "Acesse: https://exemplo.com/boleto" }),
  node({ id: 7, parentId: 2, order: 2, key: "2", title: "Falar com o financeiro", action: "transfer_queue", queueId: 10, message: "Transferindo para o financeiro." }),
  node({ id: 8, parentId: 2, order: 3, key: "3", title: "Fila removida", action: "transfer_queue", queueId: null }),
];

const ctx = (overrides: Partial<BotContext> = {}): BotContext => ({
  nodes,
  defaultQueueId: 30,
  isQueueOpen: (id) => id !== 20,
  messages: { transfer: "Aguarde um atendente.", outOfHours: "Estamos fora do horário.", invalid: "Opção inválida." },
  ...overrides,
});

const ROOT_MENU = "Olá! Bem-vindo à Empresa X.\n\n1 - Financeiro\n2 - Suporte\n3 - Encerrar\n4 - Falar com Ana";
const FIN_MENU = "Financeiro:\n\n1 - 2ª via\n2 - Falar com o financeiro\n3 - Fila removida\n0 - Voltar";
const text = (t: string) => ({ type: "send_text", text: t });

describe("renderMenu", () => {
  it("lists children in order and adds Voltar only below the root", () => {
    expect(renderMenu(nodes[0], nodes.filter((n) => n.parentId === 1))).toBe(ROOT_MENU);
    expect(renderMenu(nodes[1], nodes.filter((n) => n.parentId === 2))).toBe(FIN_MENU);
  });

  it("omits the header when the node has no message", () => {
    expect(renderMenu(node({ id: 50, parentId: 1 }), [node({ id: 51, parentId: 50, key: "1", title: "A" })])).toBe(
      "1 - A\n0 - Voltar",
    );
  });
});

describe("step", () => {
  it("greets with the root menu on first contact, ignoring the input", () => {
    expect(step({ nodeId: null, attempts: 0 }, "oi", ctx())).toEqual({
      effects: [text(ROOT_MENU)],
      state: { nodeId: 1, attempts: 0 },
      finished: false,
    });
  });

  it("restarts at the root when the current node no longer exists", () => {
    expect(step({ nodeId: 999, attempts: 1 }, "1", ctx()).effects).toEqual([text(ROOT_MENU)]);
  });

  it("opens a submenu (trimming whitespace)", () => {
    expect(step({ nodeId: 1, attempts: 0 }, " 1 ", ctx())).toEqual({
      effects: [text(FIN_MENU)],
      state: { nodeId: 2, attempts: 0 },
      finished: false,
    });
  });

  it("replies and shows the current menu again", () => {
    expect(step({ nodeId: 2, attempts: 0 }, "1", ctx())).toEqual({
      effects: [text("Acesse: https://exemplo.com/boleto"), text(FIN_MENU)],
      state: { nodeId: 2, attempts: 0 },
      finished: false,
    });
  });

  it("replies with media when the node has a file", () => {
    const withMedia = nodes.map((n) =>
      n.id === 6 ? { ...n, mediaUrl: "/media/1/a.pdf", mediaMime: "application/pdf", mediaName: "boleto.pdf" } : n,
    );
    const result = step({ nodeId: 2, attempts: 0 }, "1", ctx({ nodes: withMedia }));
    expect(result.effects[0]).toEqual({
      type: "send_media",
      media: { url: "/media/1/a.pdf", mime: "application/pdf", name: "boleto.pdf" },
      caption: "Acesse: https://exemplo.com/boleto",
    });
    expect(result.effects[1]).toEqual(text(FIN_MENU));
  });

  it("transfers to an open queue with the node message", () => {
    expect(step({ nodeId: 2, attempts: 0 }, "2", ctx())).toEqual({
      effects: [text("Transferindo para o financeiro."), { type: "transfer", queueId: 10, userId: null }],
      state: { nodeId: null, attempts: 0 },
      finished: true,
    });
  });

  it("sends the out-of-hours message when the target queue is closed", () => {
    expect(step({ nodeId: 1, attempts: 0 }, "2", ctx()).effects).toEqual([
      text("Estamos fora do horário."),
      { type: "transfer", queueId: 20, userId: null },
    ]);
  });

  it("falls back to the transfer message when no out-of-hours message is set", () => {
    const result = step({ nodeId: 1, attempts: 0 }, "2", ctx({ messages: { transfer: "Aguarde.", outOfHours: "", invalid: "x" } }));
    expect(result.effects[0]).toEqual(text("Aguarde."));
  });

  it("transfers to a specific agent", () => {
    expect(step({ nodeId: 1, attempts: 0 }, "4", ctx()).effects).toEqual([
      text("Aguarde um atendente."),
      { type: "transfer", queueId: null, userId: 99 },
    ]);
  });

  it("sends a deleted queue target to the default queue", () => {
    expect(step({ nodeId: 2, attempts: 0 }, "3", ctx()).effects).toEqual([
      text("Aguarde um atendente."),
      { type: "transfer", queueId: 30, userId: null },
    ]);
  });

  it("closes with the node message", () => {
    expect(step({ nodeId: 1, attempts: 0 }, "3", ctx())).toEqual({
      effects: [text("Até logo!"), { type: "close" }],
      state: { nodeId: null, attempts: 0 },
      finished: true,
    });
  });

  it("goes back to the parent with 0", () => {
    expect(step({ nodeId: 2, attempts: 0 }, "0", ctx())).toEqual({
      effects: [text(ROOT_MENU)],
      state: { nodeId: 1, attempts: 0 },
      finished: false,
    });
  });

  it("treats 0 at the root as invalid", () => {
    expect(step({ nodeId: 1, attempts: 0 }, "0", ctx()).state).toEqual({ nodeId: 1, attempts: 1 });
  });

  it("counts invalid input and repeats the menu", () => {
    expect(step({ nodeId: 1, attempts: 0 }, "9", ctx())).toEqual({
      effects: [text("Opção inválida."), text(ROOT_MENU)],
      state: { nodeId: 1, attempts: 1 },
      finished: false,
    });
  });

  it("counts non-text input (null) as invalid", () => {
    expect(step({ nodeId: 1, attempts: 0 }, null, ctx()).state).toEqual({ nodeId: 1, attempts: 1 });
  });

  it("transfers to the default queue on the third invalid input", () => {
    expect(step({ nodeId: 1, attempts: 2 }, "x", ctx())).toEqual({
      effects: [text("Aguarde um atendente."), { type: "transfer", queueId: 30, userId: null }],
      state: { nodeId: null, attempts: 0 },
      finished: true,
    });
  });

  it("resets the attempt counter after a valid option", () => {
    expect(step({ nodeId: 1, attempts: 2 }, "1", ctx()).state).toEqual({ nodeId: 2, attempts: 0 });
  });

  it("transfers right away when the root has no options", () => {
    const result = step({ nodeId: null, attempts: 0 }, "oi", ctx({ nodes: [node({ id: 1, message: "Oi" })] }));
    expect(result).toEqual({
      effects: [text("Oi"), text("Aguarde um atendente."), { type: "transfer", queueId: 30, userId: null }],
      state: { nodeId: null, attempts: 0 },
      finished: true,
    });
  });

  it("transfers when there is no tree at all", () => {
    expect(step({ nodeId: null, attempts: 0 }, "oi", ctx({ nodes: [] })).effects).toEqual([
      text("Aguarde um atendente."),
      { type: "transfer", queueId: 30, userId: null },
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest test/unit/chatbotEngine.test.ts`
Expected: FAIL com `Cannot find module '../../src/modules/chatbot/engine'`.

- [ ] **Step 3: Implementar**

`backend/src/modules/chatbot/engine.ts`:

```ts
import type { BotAction } from "../../models";
import type { StoredMedia } from "../media/media.storage";

export interface BotNode {
  id: number;
  parentId: number | null;
  order: number;
  key: string;
  title: string;
  action: BotAction;
  message: string;
  mediaUrl: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  queueId: number | null;
  userId: number | null;
}

export interface BotState {
  nodeId: number | null;
  attempts: number;
}

export interface BotContext {
  nodes: BotNode[];
  defaultQueueId: number | null;
  isQueueOpen(queueId: number): boolean;
  messages: { transfer: string; outOfHours: string; invalid: string };
}

export type BotEffect =
  | { type: "send_text"; text: string }
  | { type: "send_media"; media: StoredMedia; caption: string }
  | { type: "transfer"; queueId: number | null; userId: number | null }
  | { type: "close" };

export interface StepResult {
  effects: BotEffect[];
  state: BotState;
  finished: boolean;
}

export const MAX_INVALID_ATTEMPTS = 3;
export const INVALID_OPTION_MESSAGE = "Opção inválida.";

export function renderMenu(node: BotNode, children: BotNode[]): string {
  const lines = children.map((c) => `${c.key} - ${c.title}`);
  if (node.parentId !== null) lines.push("0 - Voltar");
  return [node.message.trim(), lines.join("\n")].filter(Boolean).join("\n\n");
}

const sendText = (text: string): BotEffect => ({ type: "send_text", text });
const DONE: BotState = { nodeId: null, attempts: 0 };

export function step(state: BotState, input: string | null, ctx: BotContext): StepResult {
  const byId = new Map(ctx.nodes.map((n) => [n.id, n]));
  const childrenOf = (id: number) =>
    ctx.nodes.filter((n) => n.parentId === id).sort((a, b) => a.order - b.order || a.id - b.id);

  const transfer = (
    queueId: number | null,
    userId: number | null,
    nodeMessage: string,
    prefix: BotEffect[] = [],
  ): StepResult => {
    const targetQueue = queueId ?? (userId === null ? ctx.defaultQueueId : null);
    let message = nodeMessage || ctx.messages.transfer;
    if (targetQueue !== null && !ctx.isQueueOpen(targetQueue)) message = ctx.messages.outOfHours || message;
    const effects = [...prefix];
    if (message) effects.push(sendText(message));
    effects.push({ type: "transfer", queueId: targetQueue, userId });
    return { effects, state: DONE, finished: true };
  };

  const showMenu = (node: BotNode, prefix: BotEffect[] = [], attempts = 0): StepResult => {
    const children = childrenOf(node.id);
    if (node.parentId === null && children.length === 0) {
      return transfer(null, null, "", node.message ? [...prefix, sendText(node.message)] : prefix);
    }
    return { effects: [...prefix, sendText(renderMenu(node, children))], state: { nodeId: node.id, attempts }, finished: false };
  };

  const root = ctx.nodes.find((n) => n.parentId === null);
  if (!root) return transfer(null, null, "");

  const current = state.nodeId !== null ? byId.get(state.nodeId) : undefined;
  if (!current) return showMenu(root);

  const choice = input?.trim() ?? null;
  if (choice === "0" && current.parentId !== null) return showMenu(byId.get(current.parentId) ?? root);

  const chosen = choice ? childrenOf(current.id).find((c) => c.key === choice) : undefined;
  if (!chosen) {
    const attempts = state.attempts + 1;
    if (attempts >= MAX_INVALID_ATTEMPTS) return transfer(ctx.defaultQueueId, null, "");
    return showMenu(current, [sendText(ctx.messages.invalid)], attempts);
  }

  switch (chosen.action) {
    case "submenu":
      return showMenu(chosen);
    case "reply": {
      const prefix: BotEffect[] = chosen.mediaUrl
        ? [
            {
              type: "send_media",
              media: { url: chosen.mediaUrl, mime: chosen.mediaMime ?? "application/octet-stream", name: chosen.mediaName },
              caption: chosen.message,
            },
          ]
        : chosen.message
          ? [sendText(chosen.message)]
          : [];
      return showMenu(current, prefix);
    }
    case "transfer_queue":
      return transfer(chosen.queueId, null, chosen.message);
    case "transfer_agent":
      return transfer(chosen.queueId, chosen.userId, chosen.message);
    case "close":
      return {
        effects: [...(chosen.message ? [sendText(chosen.message)] : []), { type: "close" }],
        state: DONE,
        finished: true,
      };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest test/unit/chatbotEngine.test.ts && npm run typecheck`
Expected: 21 testes PASS.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(chatbot): motor puro do menu numérico"
```

---

### Task 11: Mensagens de saída, fila de envio e acks

**Files:**
- Create: `backend/src/modules/messages/{messages.service,outbound}.ts`
- Test: `backend/test/integration/outbound.test.ts`

**Interfaces:**
- Consumes: `Message`, `Ticket`, `Contact`, `Connection`, `MessageType`, `Ack`, `getQueue`, `QueueNames`, `shardFor`, `env.OUTBOUND_SHARDS`, `getProvider`, `OutboundMediaType`, `StoredMedia`, `readMediaBase64`, `mediaTypeFromMime`, `emitTicket`, `emitMessage`, `emitMessageDeleted`.
- Produces:
  - `interface OutgoingInput { body?: string; media?: StoredMedia | null; quotedMessageId?: number | null; sentByUserId?: number | null; isBot?: boolean }`.
  - `createOutgoingMessage(ticket: Ticket, input: OutgoingInput): Promise<Message>` (grava `ack = pending`, atualiza `lastMessage`, emite e enfileira).
  - `previewOf(m: { body: string; type: MessageType }): string`.
  - `applyAck(connectionId: number, providerMessageId: string, ack: Ack): Promise<void>` (só avança).
  - `interface OutboundJob { messageId: number }`, `enqueueOutbound(messageId: number, ticketId: number): Promise<void>`, `processOutboundJob(job: Job<OutboundJob>): Promise<void>`.

- [ ] **Step 1: Escrever o teste que falha**

`backend/test/integration/outbound.test.ts`:

```ts
import { Job } from "bullmq";
import { env } from "../../src/config/env";
import { Message } from "../../src/models";
import { saveBuffer } from "../../src/modules/media/media.storage";
import { applyAck, createOutgoingMessage } from "../../src/modules/messages/messages.service";
import { OutboundJob, processOutboundJob } from "../../src/modules/messages/outbound";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { getQueue, QueueNames, shardFor } from "../../src/queues";
import { resetDb } from "../helpers/db";
import { createMessage, createTicket, scenario } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";
import { resetRedis } from "../helpers/redis";

const fake = new FakeProvider();
const job = (messageId: number, attemptsMade = 0) =>
  ({ data: { messageId }, attemptsMade, opts: { attempts: 5 } }) as unknown as Job<OutboundJob>;

async function openTicket() {
  const s = await scenario();
  const ticket = await createTicket({ companyId: s.company.id, contactId: s.contact.id, connectionId: s.connection.id, status: "open" });
  return { ...s, ticket };
}

describe("outgoing messages", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    fake.reset();
    setProvider(fake);
  });
  afterAll(() => setProvider(null));

  it("creates a pending message, updates the ticket and enqueues it on the ticket shard", async () => {
    const { ticket } = await openTicket();
    const message = await createOutgoingMessage(ticket, { body: "Olá!" });
    expect(message).toMatchObject({ ack: "pending", fromMe: true, type: "text", providerMessageId: null });
    await ticket.reload();
    expect(ticket.lastMessage).toBe("Olá!");
    const queue = getQueue(QueueNames.outbound(shardFor(String(ticket.id), env.OUTBOUND_SHARDS)));
    const jobs = await queue.getJobs(["waiting"]);
    expect(jobs.map((j) => j.data.messageId)).toContain(message.id);
  });

  it("sends text through the provider and stores the provider id", async () => {
    const { ticket, contact, connection } = await openTicket();
    const message = await createOutgoingMessage(ticket, { body: "Olá!" });
    await processOutboundJob(job(message.id));
    expect(fake.sent).toEqual([{ instanceName: connection.instanceName, number: contact.number, text: "Olá!", quoted: undefined }]);
    await message.reload();
    expect(message).toMatchObject({ ack: "sent", providerMessageId: "fake-1" });
  });

  it("passes the quoted provider id", async () => {
    const { ticket } = await openTicket();
    const original = await createMessage(ticket, { providerMessageId: "ORIG" });
    const reply = await createOutgoingMessage(ticket, { body: "sim", quotedMessageId: original.id });
    await processOutboundJob(job(reply.id));
    expect(fake.sent[0].quoted).toBe("ORIG");
  });

  it("sends media as base64 read from storage", async () => {
    const { ticket, company } = await openTicket();
    const stored = await saveBuffer(company.id, Buffer.from("PDF"), "application/pdf", "a.pdf");
    const message = await createOutgoingMessage(ticket, { body: "segue", media: stored });
    expect(message.type).toBe("document");
    await processOutboundJob(job(message.id));
    expect(fake.sent[0].media).toEqual({
      type: "document",
      base64: Buffer.from("PDF").toString("base64"),
      mimetype: "application/pdf",
      fileName: "a.pdf",
      caption: "segue",
    });
  });

  it("keeps the message pending and rethrows on a non-final failure", async () => {
    const { ticket } = await openTicket();
    const message = await createOutgoingMessage(ticket, { body: "x" });
    fake.failNext("send");
    await expect(processOutboundJob(job(message.id, 0))).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect((await message.reload()).ack).toBe("pending");
  });

  it("marks the message failed on the final attempt", async () => {
    const { ticket } = await openTicket();
    const message = await createOutgoingMessage(ticket, { body: "x" });
    fake.failNext("send");
    await expect(processOutboundJob(job(message.id, 4))).rejects.toBeDefined();
    expect((await message.reload()).ack).toBe("failed");
  });

  it("does not resend a message that already has a provider id", async () => {
    const { ticket } = await openTicket();
    const message = await createOutgoingMessage(ticket, { body: "x" });
    await processOutboundJob(job(message.id));
    await processOutboundJob(job(message.id));
    expect(fake.sent).toHaveLength(1);
  });

  it("replaces an echo stored before the provider id was saved", async () => {
    const { ticket } = await openTicket();
    const message = await createOutgoingMessage(ticket, { body: "Olá" });
    const echo = await createMessage(ticket, { fromMe: true, body: "Olá", providerMessageId: "fake-1", ack: "sent" });
    await processOutboundJob(job(message.id));
    expect(await Message.findByPk(echo.id)).toBeNull();
    expect((await message.reload()).providerMessageId).toBe("fake-1");
  });

  it("applies acks only forward", async () => {
    const { ticket, connection } = await openTicket();
    const message = await createMessage(ticket, { fromMe: true, providerMessageId: "P1", ack: "sent" });
    await applyAck(connection.id, "P1", "read");
    expect((await message.reload()).ack).toBe("read");
    await applyAck(connection.id, "P1", "delivered");
    expect((await message.reload()).ack).toBe("read");
    await applyAck(connection.id, "UNKNOWN", "read");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest test/integration/outbound.test.ts`
Expected: FAIL com `Cannot find module '../../src/modules/messages/messages.service'`.

- [ ] **Step 3: Implementar**

`backend/src/modules/messages/outbound.ts`:

```ts
import { Job } from "bullmq";
import { Op, UniqueConstraintError } from "sequelize";
import { env } from "../../config/env";
import { Connection, Contact, Message, Ticket } from "../../models";
import { getQueue, QueueNames, shardFor } from "../../queues";
import { readMediaBase64 } from "../media/media.storage";
import { emitMessage, emitMessageDeleted } from "../tickets/ticket.events";
import { OutboundMediaType } from "../whatsapp/provider";
import { getProvider } from "../whatsapp/registry";

export interface OutboundJob {
  messageId: number;
}

export async function enqueueOutbound(messageId: number, ticketId: number): Promise<void> {
  const shard = shardFor(String(ticketId), env.OUTBOUND_SHARDS);
  await getQueue(QueueNames.outbound(shard)).add("send", { messageId });
}

async function markSent(message: Message, providerMessageId: string): Promise<void> {
  try {
    await Message.update({ providerMessageId, ack: "sent" }, { where: { id: message.id } });
  } catch (err) {
    if (!(err instanceof UniqueConstraintError)) throw err;
    // O eco (fromMe) chegou pelo webhook antes de gravarmos o id: ficamos com a nossa mensagem.
    const echoes = await Message.findAll({
      where: { connectionId: message.connectionId, providerMessageId, id: { [Op.ne]: message.id } },
    });
    await Message.destroy({ where: { id: echoes.map((e) => e.id) } });
    echoes.forEach(emitMessageDeleted);
    await Message.update({ providerMessageId, ack: "sent" }, { where: { id: message.id } });
  }
  await message.reload();
  emitMessage(message, "message:update");
}

export async function processOutboundJob(job: Job<OutboundJob>): Promise<void> {
  const message = await Message.findByPk(job.data.messageId, {
    include: [{ model: Ticket, include: [Contact, Connection] }],
  });
  if (!message || message.providerMessageId || message.ack !== "pending") return;
  const { contact, connection } = message.ticket!;

  try {
    const provider = getProvider();
    let result;
    if (message.mediaUrl) {
      result = await provider.sendMedia(connection!.instanceName, contact!.number, {
        type: message.type as OutboundMediaType,
        base64: await readMediaBase64(message.companyId, message.mediaUrl),
        mimetype: message.mediaMime ?? "application/octet-stream",
        fileName: message.mediaName ?? undefined,
        caption: message.body || undefined,
      });
    } else {
      const quoted = message.quotedMessageId ? await Message.findByPk(message.quotedMessageId) : null;
      result = await provider.sendText(
        connection!.instanceName,
        contact!.number,
        message.body,
        quoted?.providerMessageId ?? undefined,
      );
    }
    await markSent(message, result.providerMessageId);
  } catch (err) {
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (finalAttempt) {
      await Message.update({ ack: "failed" }, { where: { id: message.id, ack: "pending" } });
      await message.reload();
      emitMessage(message, "message:update");
    }
    throw err;
  }
}
```

`backend/src/modules/messages/messages.service.ts`:

```ts
import { Ack, Message, MessageType, Ticket } from "../../models";
import { mediaTypeFromMime, StoredMedia } from "../media/media.storage";
import { emitMessage, emitTicket } from "../tickets/ticket.events";
import { enqueueOutbound } from "./outbound";

export interface OutgoingInput {
  body?: string;
  media?: StoredMedia | null;
  quotedMessageId?: number | null;
  sentByUserId?: number | null;
  isBot?: boolean;
}

const TYPE_LABEL: Record<MessageType, string> = {
  text: "",
  image: "📷 Imagem",
  audio: "🎤 Áudio",
  video: "🎬 Vídeo",
  document: "📄 Documento",
  sticker: "Figurinha",
  location: "📍 Localização",
};

export function previewOf(m: { body: string; type: MessageType }): string {
  return m.body || TYPE_LABEL[m.type];
}

export async function createOutgoingMessage(ticket: Ticket, input: OutgoingInput): Promise<Message> {
  const media = input.media ?? null;
  const message = await Message.create({
    companyId: ticket.companyId,
    ticketId: ticket.id,
    connectionId: ticket.connectionId,
    fromMe: true,
    body: input.body ?? "",
    type: media ? mediaTypeFromMime(media.mime) : "text",
    mediaUrl: media?.url ?? null,
    mediaMime: media?.mime ?? null,
    mediaName: media?.name ?? null,
    ack: "pending",
    quotedMessageId: input.quotedMessageId ?? null,
    sentByUserId: input.sentByUserId ?? null,
    isBot: input.isBot ?? false,
  });
  await ticket.update({ lastMessage: previewOf(message), lastMessageAt: new Date() });
  emitMessage(message, "message:new");
  await emitTicket(ticket.id);
  await enqueueOutbound(message.id, ticket.id);
  return message;
}

const ACK_RANK: Record<Ack, number> = { failed: -1, pending: 0, sent: 1, delivered: 2, read: 3 };

export async function applyAck(connectionId: number, providerMessageId: string, ack: Ack): Promise<void> {
  const message = await Message.findOne({ where: { connectionId, providerMessageId } });
  if (!message) return;
  const allowed =
    ack === "failed" ? message.ack === "pending" || message.ack === "sent" : ACK_RANK[ack] > ACK_RANK[message.ack];
  if (!allowed) return;
  await message.update({ ack });
  emitMessage(message, "message:update");
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest && npm run typecheck`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(messages): envio via fila particionada por ticket, retries e acks"
```

---

### Task 12: Tickets (visibilidade, aceitar, transferir, finalizar) e mensagens do atendente

**Files:**
- Create: `backend/src/modules/tickets/{visibility,tickets.service,tickets.routes}.ts`
- Create: `backend/src/modules/messages/{agentMessages.service,messages.routes}.ts`
- Modify: `backend/src/routes.ts`
- Test: `backend/test/integration/tickets.test.ts`, `backend/test/integration/agentMessages.test.ts`

**Interfaces:**
- Consumes: models, `AuthContext`, `userQueueIds`, `emitTicket`, `emitMessage`, `TICKET_INCLUDE`, `createOutgoingMessage`, `enqueueOutbound`, `cancelBotTimeout`, `assertQueuesBelong`, `getUserOr404`, `resolveMediaPath`, `StoredMedia`, `PAGE_SIZE`, `paginate`, `pageParam`, `idParam`.
- Produces:
  - `canView(auth: AuthContext, queueIds: number[], ticket: Ticket): boolean`; `type TicketFilter = Record<string | symbol, unknown>`; `visibilityWhere(auth, queueIds, status: TicketStatus): TicketFilter | null` (`null` = nada visível).
  - `logTicket(ticket: Ticket, event: TicketEvent, extra?: { userId?: number | null; fromQueueId?: number | null; toQueueId?: number | null }): Promise<void>`.
  - `loadTicket(id: number): Promise<Ticket | null>` (com `TICKET_INCLUDE`).
  - `listTickets(auth, { status, search?, page })`, `getVisibleTicket(auth, id): Promise<Ticket>`, `canJoinTicket(auth, ticketId): Promise<boolean>`, `acceptTicket(auth, id)`, `transferTicket(auth, id, { queueId?, userId? })`, `closeTicket(auth, id)`, `markTicketRead(auth, id)`.
  - Para uso interno (bot/inbound): `moveToPending(ticket: Ticket, queueId: number | null, userId: number | null): Promise<void>`, `closeTicketInternal(ticket: Ticket, opts: { userId: number | null; event: "closed" | "bot_timeout"; sendClosingMessage: boolean }): Promise<void>`.
  - `listMessages(auth, ticketId, { before?: number; limit?: number })`, `sendAgentMessage(auth, ticketId, { body?, quotedMessageId?, media? })`, `resendMessage(auth, messageId)`.
  - Rotas: `GET /api/tickets?status=&search=&page=`, `GET /api/tickets/:id`, `POST /api/tickets/:id/accept|transfer|close|read`, `GET/POST /api/tickets/:ticketId/messages`, `POST /api/messages/:id/resend`.

- [ ] **Step 1: Escrever os testes que falham**

`backend/test/integration/tickets.test.ts`:

```ts
import request from "supertest";
import { createApp } from "../../src/app";
import { Message, TicketLog } from "../../src/models";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createContact, createQueue, createTicket, createUser, scenario } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";
import { resetRedis } from "../helpers/redis";

const app = createApp();
const fake = new FakeProvider();

async function world() {
  const s = await scenario();
  const queueB = await createQueue(s.company.id);
  const agentA = await createUser(s.company.id, { queueIds: [s.queue.id] });
  const agentA2 = await createUser(s.company.id, { queueIds: [s.queue.id] });
  const agentB = await createUser(s.company.id, { queueIds: [queueB.id] });
  const supervisor = await createUser(s.company.id, { profile: "supervisor" });
  const ticketFor = async (attrs: Record<string, unknown>) => {
    const contact = await createContact(s.company.id);
    return createTicket({ companyId: s.company.id, contactId: contact.id, connectionId: s.connection.id, ...attrs });
  };
  return { ...s, queueA: s.queue, queueB, agentA, agentA2, agentB, supervisor, ticketFor };
}

const ids = (res: request.Response) => res.body.items.map((t: { id: number }) => t.id).sort();

describe("tickets", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    fake.reset();
    setProvider(fake);
  });
  afterAll(() => setProvider(null));

  it("shows agents only pending tickets of their queues or assigned to them", async () => {
    const w = await world();
    const inA = await w.ticketFor({ status: "pending", queueId: w.queueA.id });
    const inB = await w.ticketFor({ status: "pending", queueId: w.queueB.id });
    const assigned = await w.ticketFor({ status: "pending", queueId: w.queueB.id, userId: w.agentA.id });

    const res = await request(app).get("/api/tickets?status=pending").set("Authorization", bearer(w.agentA));
    expect(ids(res)).toEqual([inA.id, assigned.id].sort());
    expect(ids(res)).not.toContain(inB.id);
  });

  it("shows agents only their own open tickets and no bot tickets", async () => {
    const w = await world();
    const mine = await w.ticketFor({ status: "open", queueId: w.queueA.id, userId: w.agentA.id });
    await w.ticketFor({ status: "open", queueId: w.queueA.id, userId: w.agentA2.id });
    await w.ticketFor({ status: "bot" });

    expect(ids(await request(app).get("/api/tickets?status=open").set("Authorization", bearer(w.agentA)))).toEqual([mine.id]);
    expect((await request(app).get("/api/tickets?status=bot").set("Authorization", bearer(w.agentA))).body.items).toEqual([]);
    expect((await request(app).get("/api/tickets?status=bot").set("Authorization", bearer(w.supervisor))).body.items).toHaveLength(1);
  });

  it("lets exactly one of two concurrent agents accept a ticket", async () => {
    const w = await world();
    const ticket = await w.ticketFor({ status: "pending", queueId: w.queueA.id });
    const [r1, r2] = await Promise.all([
      request(app).post(`/api/tickets/${ticket.id}/accept`).set("Authorization", bearer(w.agentA)),
      request(app).post(`/api/tickets/${ticket.id}/accept`).set("Authorization", bearer(w.agentA2)),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.body.error.code).toBe("TICKET_ALREADY_ACCEPTED");
    expect(await TicketLog.count({ where: { ticketId: ticket.id, event: "accepted" } })).toBe(1);
  });

  it("forbids accepting a ticket from another queue", async () => {
    const w = await world();
    const ticket = await w.ticketFor({ status: "pending", queueId: w.queueB.id });
    const res = await request(app).post(`/api/tickets/${ticket.id}/accept`).set("Authorization", bearer(w.agentA));
    expect(res.status).toBe(403);
  });

  it("transfers a ticket to another queue and logs it", async () => {
    const w = await world();
    const ticket = await w.ticketFor({ status: "open", queueId: w.queueA.id, userId: w.agentA.id });
    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/transfer`)
      .set("Authorization", bearer(w.agentA))
      .send({ queueId: w.queueB.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "pending", queueId: w.queueB.id, userId: null });
    const log = await TicketLog.findOne({ where: { ticketId: ticket.id, event: "transferred" } });
    expect(log).toMatchObject({ fromQueueId: w.queueA.id, toQueueId: w.queueB.id, userId: w.agentA.id });
  });

  it("does not let an agent transfer someone else's ticket", async () => {
    const w = await world();
    const ticket = await w.ticketFor({ status: "open", queueId: w.queueA.id, userId: w.agentA2.id });
    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/transfer`)
      .set("Authorization", bearer(w.agentA))
      .send({ queueId: w.queueB.id });
    expect(res.status).toBe(403);
  });

  it("closes a ticket sending the closing message", async () => {
    const w = await world();
    await w.connection.update({ closingMessage: "Obrigado pelo contato!" });
    const ticket = await w.ticketFor({ status: "open", queueId: w.queueA.id, userId: w.agentA.id });
    const res = await request(app).post(`/api/tickets/${ticket.id}/close`).set("Authorization", bearer(w.agentA));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("closed");
    expect(res.body.closedAt).toBeTruthy();
    const sent = await Message.findOne({ where: { ticketId: ticket.id, fromMe: true } });
    expect(sent).toMatchObject({ body: "Obrigado pelo contato!", isBot: true, ack: "pending" });
  });

  it("hides tickets from other companies", async () => {
    const w = await world();
    const other = await scenario();
    const foreign = await createTicket({ companyId: other.company.id, contactId: other.contact.id, connectionId: other.connection.id });
    const res = await request(app).get(`/api/tickets/${foreign.id}`).set("Authorization", bearer(w.supervisor));
    expect(res.status).toBe(404);
  });

  it("resets the unread counter", async () => {
    const w = await world();
    const ticket = await w.ticketFor({ status: "open", userId: w.agentA.id, unreadCount: 4 });
    const res = await request(app).post(`/api/tickets/${ticket.id}/read`).set("Authorization", bearer(w.agentA));
    expect(res.body.unreadCount).toBe(0);
  });
});
```

`backend/test/integration/agentMessages.test.ts`:

```ts
import request from "supertest";
import { createApp } from "../../src/app";
import { saveBuffer } from "../../src/modules/media/media.storage";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createMessage, createTicket, createUser, scenario } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";
import { resetRedis } from "../helpers/redis";

const app = createApp();
const fake = new FakeProvider();

async function setup(status: "open" | "pending" = "open") {
  const s = await scenario();
  const agent = await createUser(s.company.id, { queueIds: [s.queue.id] });
  const ticket = await createTicket({
    companyId: s.company.id,
    contactId: s.contact.id,
    connectionId: s.connection.id,
    queueId: s.queue.id,
    status,
    userId: status === "open" ? agent.id : null,
  });
  return { ...s, agent, ticket };
}

describe("agent messages", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    fake.reset();
    setProvider(fake);
  });
  afterAll(() => setProvider(null));

  it("pages messages oldest-first with a before cursor", async () => {
    const { agent, ticket } = await setup();
    const created = [];
    for (let i = 0; i < 5; i++) created.push(await createMessage(ticket, { body: `m${i}` }));

    const last = await request(app).get(`/api/tickets/${ticket.id}/messages?limit=2`).set("Authorization", bearer(agent));
    expect(last.body.items.map((m: { body: string }) => m.body)).toEqual(["m3", "m4"]);
    expect(last.body.hasMore).toBe(true);

    const older = await request(app)
      .get(`/api/tickets/${ticket.id}/messages?limit=2&before=${created[3].id}`)
      .set("Authorization", bearer(agent));
    expect(older.body.items.map((m: { body: string }) => m.body)).toEqual(["m1", "m2"]);
  });

  it("sends a text message on an open ticket", async () => {
    const { agent, ticket } = await setup();
    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/messages`)
      .set("Authorization", bearer(agent))
      .send({ body: "Bom dia!" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ body: "Bom dia!", fromMe: true, ack: "pending", sentByUserId: agent.id });
  });

  it("requires the ticket to be accepted before replying", async () => {
    const { agent, ticket } = await setup("pending");
    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/messages`)
      .set("Authorization", bearer(agent))
      .send({ body: "oi" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TICKET_NOT_OPEN");
  });

  it("sends uploaded media but refuses media of another company", async () => {
    const { agent, ticket, company } = await setup();
    const mine = await saveBuffer(company.id, Buffer.from("img"), "image/png", "a.png");
    const ok = await request(app)
      .post(`/api/tickets/${ticket.id}/messages`)
      .set("Authorization", bearer(agent))
      .send({ media: mine });
    expect(ok.status).toBe(201);
    expect(ok.body.type).toBe("image");

    const foreign = await saveBuffer(company.id + 1000, Buffer.from("img"), "image/png", "b.png");
    const bad = await request(app)
      .post(`/api/tickets/${ticket.id}/messages`)
      .set("Authorization", bearer(agent))
      .send({ media: foreign });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_MEDIA");
  });

  it("rejects an empty message", async () => {
    const { agent, ticket } = await setup();
    const res = await request(app).post(`/api/tickets/${ticket.id}/messages`).set("Authorization", bearer(agent)).send({});
    expect(res.status).toBe(400);
  });

  it("resends only failed messages", async () => {
    const { agent, ticket } = await setup();
    const failed = await createMessage(ticket, { fromMe: true, ack: "failed", body: "x" });
    const ok = await request(app).post(`/api/messages/${failed.id}/resend`).set("Authorization", bearer(agent));
    expect(ok.status).toBe(200);
    expect(ok.body.ack).toBe("pending");

    const again = await request(app).post(`/api/messages/${failed.id}/resend`).set("Authorization", bearer(agent));
    expect(again.status).toBe(409);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest test/integration/tickets.test.ts test/integration/agentMessages.test.ts`
Expected: FAIL (rotas `/api/tickets` respondem 404).

- [ ] **Step 3: Implementar**

`backend/src/modules/tickets/visibility.ts`:

```ts
import { Op } from "sequelize";
import { Ticket, TicketStatus } from "../../models";
import { AuthContext } from "../auth/auth.types";

export type TicketFilter = Record<string | symbol, unknown>;

export function canView(auth: AuthContext, queueIds: number[], ticket: Ticket): boolean {
  if (ticket.companyId !== auth.companyId) return false;
  if (auth.profile !== "agent") return true;
  if (ticket.userId === auth.userId) return true;
  return (
    ticket.status === "pending" && ticket.userId === null && ticket.queueId !== null && queueIds.includes(ticket.queueId)
  );
}

/** Filtro adicional para a listagem por status; `null` = o perfil não vê nada nesse status. */
export function visibilityWhere(auth: AuthContext, queueIds: number[], status: TicketStatus): TicketFilter | null {
  if (auth.profile !== "agent") return {};
  if (status === "bot") return null;
  if (status === "pending") {
    return { [Op.or]: [{ userId: auth.userId }, { userId: null, queueId: { [Op.in]: queueIds } }] };
  }
  return { userId: auth.userId };
}
```

`backend/src/modules/tickets/tickets.service.ts`:

```ts
import { Op } from "sequelize";
import { Connection, Contact, Ticket, TicketEvent, TicketLog, TicketStatus, User } from "../../models";
import { cancelBotTimeout } from "../../queues/botTimeout";
import { AppError, notFound } from "../../shared/errors/AppError";
import { PAGE_SIZE, paginate } from "../../shared/http";
import { AuthContext } from "../auth/auth.types";
import { createOutgoingMessage } from "../messages/messages.service";
import { assertQueuesBelong } from "../queues/queues.service";
import { userQueueIds } from "../users/userQueues";
import { getUserOr404 } from "../users/users.service";
import { emitTicket, TICKET_INCLUDE } from "./ticket.events";
import { canView, visibilityWhere } from "./visibility";

export async function logTicket(
  ticket: Ticket,
  event: TicketEvent,
  extra: { userId?: number | null; fromQueueId?: number | null; toQueueId?: number | null } = {},
): Promise<void> {
  await TicketLog.create({
    companyId: ticket.companyId,
    ticketId: ticket.id,
    event,
    userId: extra.userId ?? null,
    fromQueueId: extra.fromQueueId ?? null,
    toQueueId: extra.toQueueId ?? null,
  });
}

export function loadTicket(id: number) {
  return Ticket.findByPk(id, { include: TICKET_INCLUDE });
}

const queueIdsFor = (auth: AuthContext) => (auth.profile === "agent" ? userQueueIds(auth.userId) : Promise.resolve([]));

export async function listTickets(auth: AuthContext, opts: { status: TicketStatus; search?: string; page: number }) {
  const visibility = visibilityWhere(auth, await queueIdsFor(auth), opts.status);
  if (visibility === null) return { items: [], hasMore: false };
  const term = opts.search?.trim();
  const rows = await Ticket.findAll({
    where: { companyId: auth.companyId, status: opts.status, ...visibility },
    include: [
      {
        model: Contact,
        ...(term
          ? { where: { [Op.or]: [{ name: { [Op.iLike]: `%${term}%` } }, { number: { [Op.like]: `%${term}%` } }] } }
          : {}),
      },
      ...TICKET_INCLUDE.slice(1),
    ],
    order: [
      ["lastMessageAt", "DESC NULLS LAST"],
      ["id", "DESC"],
    ],
    limit: PAGE_SIZE + 1,
    offset: (opts.page - 1) * PAGE_SIZE,
  });
  return paginate(rows);
}

export async function getVisibleTicket(auth: AuthContext, id: number): Promise<Ticket> {
  const ticket = await Ticket.findOne({ where: { id, companyId: auth.companyId } });
  if (!ticket) throw notFound("Ticket");
  if (!canView(auth, await queueIdsFor(auth), ticket)) throw new AppError("FORBIDDEN", 403, "Sem acesso a este ticket");
  return ticket;
}

export async function canJoinTicket(auth: AuthContext, ticketId: number): Promise<boolean> {
  try {
    await getVisibleTicket(auth, ticketId);
    return true;
  } catch {
    return false;
  }
}

function assertCanHandle(auth: AuthContext, ticket: Ticket): void {
  if (auth.profile === "agent" && ticket.userId !== auth.userId) {
    throw new AppError("FORBIDDEN", 403, "Este atendimento não está com você");
  }
}

export async function acceptTicket(auth: AuthContext, id: number) {
  const ticket = await getVisibleTicket(auth, id);
  const [updated] = await Ticket.update(
    { status: "open", userId: auth.userId },
    {
      where: {
        id,
        companyId: auth.companyId,
        status: "pending",
        [Op.or]: [{ userId: null }, { userId: auth.userId }],
      },
    },
  );
  if (updated === 0) {
    const current = await Ticket.findByPk(id, { include: [{ model: User, attributes: ["id", "name"] }] });
    const by = current?.user ? ` por ${current.user.name}` : "";
    throw new AppError("TICKET_ALREADY_ACCEPTED", 409, `Este atendimento já foi aceito${by}`);
  }
  await logTicket(ticket, "accepted", { userId: auth.userId });
  await emitTicket(id, { queueId: ticket.queueId, userId: ticket.userId });
  return loadTicket(id);
}

export async function transferTicket(auth: AuthContext, id: number, input: { queueId?: number; userId?: number }) {
  const ticket = await getVisibleTicket(auth, id);
  if (ticket.status === "closed") throw new AppError("TICKET_CLOSED", 409, "Atendimento finalizado");
  assertCanHandle(auth, ticket);
  if (input.queueId) await assertQueuesBelong(auth.companyId, [input.queueId]);
  if (input.userId) await getUserOr404(auth.companyId, input.userId);

  const prev = { queueId: ticket.queueId, userId: ticket.userId };
  const queueId = input.queueId ?? ticket.queueId;
  await ticket.update({ status: "pending", queueId, userId: input.userId ?? null, chatbotNodeId: null, chatbotAttempts: 0 });
  await cancelBotTimeout(ticket.id);
  await logTicket(ticket, "transferred", { userId: auth.userId, fromQueueId: prev.queueId, toQueueId: queueId });
  await emitTicket(ticket.id, prev);
  return loadTicket(id);
}

export async function closeTicket(auth: AuthContext, id: number) {
  const ticket = await getVisibleTicket(auth, id);
  if (ticket.status === "closed") throw new AppError("TICKET_CLOSED", 409, "Atendimento já finalizado");
  assertCanHandle(auth, ticket);
  await closeTicketInternal(ticket, { userId: auth.userId, event: "closed", sendClosingMessage: true });
  return loadTicket(id);
}

export async function markTicketRead(auth: AuthContext, id: number) {
  const ticket = await getVisibleTicket(auth, id);
  if (ticket.unreadCount !== 0) {
    await ticket.update({ unreadCount: 0 });
    await emitTicket(ticket.id);
  }
  return loadTicket(id);
}

/** Usado pelo chatbot: tira o ticket do bot e coloca na fila (ou com o atendente). */
export async function moveToPending(ticket: Ticket, queueId: number | null, userId: number | null): Promise<void> {
  const prev = { queueId: ticket.queueId, userId: ticket.userId };
  await ticket.update({ status: "pending", queueId, userId, chatbotNodeId: null, chatbotAttempts: 0 });
  await cancelBotTimeout(ticket.id);
  await logTicket(ticket, "transferred", { fromQueueId: prev.queueId, toQueueId: queueId });
  await emitTicket(ticket.id, prev);
}

export async function closeTicketInternal(
  ticket: Ticket,
  opts: { userId: number | null; event: "closed" | "bot_timeout"; sendClosingMessage: boolean },
): Promise<void> {
  if (opts.sendClosingMessage) {
    const connection = await Connection.findByPk(ticket.connectionId);
    if (connection?.closingMessage) await createOutgoingMessage(ticket, { body: connection.closingMessage, isBot: true });
  }
  const prev = { queueId: ticket.queueId, userId: ticket.userId };
  await ticket.update({ status: "closed", closedAt: new Date(), chatbotNodeId: null, chatbotAttempts: 0, unreadCount: 0 });
  await cancelBotTimeout(ticket.id);
  await logTicket(ticket, opts.event, { userId: opts.userId });
  await emitTicket(ticket.id, prev);
}
```

`backend/src/modules/tickets/tickets.routes.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../shared/http";
import { currentAuth, isAuth } from "../auth/auth.middleware";
import {
  acceptTicket,
  closeTicket,
  getVisibleTicket,
  listTickets,
  loadTicket,
  markTicketRead,
  transferTicket,
} from "./tickets.service";

const listSchema = z.object({
  status: z.enum(["bot", "pending", "open", "closed"]).default("pending"),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

const transferSchema = z
  .object({ queueId: z.number().int().positive().optional(), userId: z.number().int().positive().optional() })
  .refine((v) => v.queueId !== undefined || v.userId !== undefined, "informe a fila ou o atendente");

export const ticketRoutes = Router();
ticketRoutes.use(isAuth);

ticketRoutes.get("/", async (req, res) => {
  res.json(await listTickets(currentAuth(req), listSchema.parse(req.query)));
});

ticketRoutes.get("/:id", async (req, res) => {
  const ticket = await getVisibleTicket(currentAuth(req), idParam(req));
  res.json(await loadTicket(ticket.id));
});

ticketRoutes.post("/:id/accept", async (req, res) => {
  res.json(await acceptTicket(currentAuth(req), idParam(req)));
});

ticketRoutes.post("/:id/transfer", async (req, res) => {
  res.json(await transferTicket(currentAuth(req), idParam(req), transferSchema.parse(req.body)));
});

ticketRoutes.post("/:id/close", async (req, res) => {
  res.json(await closeTicket(currentAuth(req), idParam(req)));
});

ticketRoutes.post("/:id/read", async (req, res) => {
  res.json(await markTicketRead(currentAuth(req), idParam(req)));
});
```

`backend/src/modules/messages/agentMessages.service.ts`:

```ts
import { Op } from "sequelize";
import { Message } from "../../models";
import { AppError, notFound } from "../../shared/errors/AppError";
import { paginate } from "../../shared/http";
import { AuthContext } from "../auth/auth.types";
import { resolveMediaPath, StoredMedia } from "../media/media.storage";
import { emitMessage } from "../tickets/ticket.events";
import { getVisibleTicket } from "../tickets/tickets.service";
import { createOutgoingMessage } from "./messages.service";
import { enqueueOutbound } from "./outbound";

export async function listMessages(auth: AuthContext, ticketId: number, opts: { before?: number; limit?: number }) {
  await getVisibleTicket(auth, ticketId);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const rows = await Message.findAll({
    where: { ticketId, ...(opts.before ? { id: { [Op.lt]: opts.before } } : {}) },
    order: [["id", "DESC"]],
    limit: limit + 1,
  });
  const page = paginate(rows, limit);
  return { items: page.items.reverse(), hasMore: page.hasMore };
}

export async function sendAgentMessage(
  auth: AuthContext,
  ticketId: number,
  input: { body?: string; quotedMessageId?: number; media?: StoredMedia },
) {
  const ticket = await getVisibleTicket(auth, ticketId);
  if (ticket.status !== "open") throw new AppError("TICKET_NOT_OPEN", 409, "Aceite o atendimento antes de responder");
  if (auth.profile === "agent" && ticket.userId !== auth.userId) {
    throw new AppError("FORBIDDEN", 403, "Este atendimento não está com você");
  }
  if (input.media) resolveMediaPath(auth.companyId, input.media.url);
  if (input.quotedMessageId) {
    const quoted = await Message.findOne({ where: { id: input.quotedMessageId, ticketId } });
    if (!quoted) throw new AppError("INVALID_QUOTED", 400, "Mensagem citada inválida");
  }
  return createOutgoingMessage(ticket, {
    body: input.body,
    media: input.media ?? null,
    quotedMessageId: input.quotedMessageId ?? null,
    sentByUserId: auth.userId,
  });
}

export async function resendMessage(auth: AuthContext, messageId: number) {
  const message = await Message.findOne({ where: { id: messageId, companyId: auth.companyId } });
  if (!message) throw notFound("Mensagem");
  await getVisibleTicket(auth, message.ticketId);
  if (message.ack !== "failed") throw new AppError("MESSAGE_NOT_FAILED", 409, "Só mensagens com falha podem ser reenviadas");
  await message.update({ ack: "pending" });
  emitMessage(message, "message:update");
  await enqueueOutbound(message.id, message.ticketId);
  return message;
}
```

`backend/src/modules/messages/messages.routes.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../shared/http";
import { currentAuth, isAuth } from "../auth/auth.middleware";
import { listMessages, resendMessage, sendAgentMessage } from "./agentMessages.service";

const listSchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

const sendSchema = z
  .object({
    body: z.string().max(4096).optional(),
    quotedMessageId: z.number().int().positive().optional(),
    media: z.object({ url: z.string(), mime: z.string(), name: z.string().nullable() }).optional(),
  })
  .refine((v) => (v.body && v.body.trim()) || v.media, "informe um texto ou um arquivo");

export const messageRoutes = Router();

messageRoutes.get("/tickets/:ticketId/messages", isAuth, async (req, res) => {
  res.json(await listMessages(currentAuth(req), idParam(req, "ticketId"), listSchema.parse(req.query)));
});

messageRoutes.post("/tickets/:ticketId/messages", isAuth, async (req, res) => {
  const message = await sendAgentMessage(currentAuth(req), idParam(req, "ticketId"), sendSchema.parse(req.body));
  res.status(201).json(message);
});

messageRoutes.post("/messages/:id/resend", isAuth, async (req, res) => {
  res.json(await resendMessage(currentAuth(req), idParam(req)));
});
```

Em `backend/src/routes.ts`, acrescente (o `messageRoutes` é montado sem prefixo porque define caminhos completos):

```ts
import { messageRoutes } from "./modules/messages/messages.routes";
import { ticketRoutes } from "./modules/tickets/tickets.routes";
// ...
apiRoutes.use("/tickets", ticketRoutes);
apiRoutes.use(messageRoutes);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest && npm run typecheck`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(tickets): visibilidade por perfil, aceitar/transferir/finalizar e mensagens do atendente"
```

---

### Task 13: Chatbot — árvore, simulador, execução e timeout

**Files:**
- Create: `backend/src/modules/chatbot/{chatbot.service,chatbot.routes,botTimeout.worker}.ts`
- Modify: `backend/src/routes.ts`
- Test: `backend/test/integration/chatbot.test.ts`

**Interfaces:**
- Consumes: `step`, `BotNode`, `BotContext`, `BotState`, `INVALID_OPTION_MESSAGE` (Task 10); `ChatbotNode`, `Company`, `Queue`, `Connection`, `Ticket`; `isOpen`; `assertQueuesBelong`; `getUserOr404`; `getConnectionOr404`; `resolveMediaPath`; `createOutgoingMessage`; `moveToPending`, `closeTicketInternal`; `scheduleBotTimeout`.
- Produces:
  - `interface NodeInput { parentId: number | null; key: string; title: string; action: BotAction; message?: string; mediaUrl?: string | null; mediaMime?: string | null; mediaName?: string | null; queueId?: number | null; userId?: number | null }`.
  - `toBotNode(n: ChatbotNode): BotNode`, `loadTree(connectionId): Promise<BotNode[]>`, `hasBot(connectionId): Promise<boolean>`, `buildBotContext(connection, nodes, now?): Promise<BotContext>`.
  - `listNodes(companyId, connectionId)`, `createNode(companyId, connectionId, input)`, `updateNode(companyId, id, input)`, `deleteNode(companyId, id)`, `reorderChildren(companyId, parentId, ids: number[])`, `simulate(companyId, connectionId, state: BotState, input: string | null): Promise<StepResult>`.
  - `runBot(ticket: Ticket, input: string | null): Promise<void>`.
  - `processBotTimeoutJob(job: Job<{ ticketId: number }>): Promise<void>`.
  - Rotas: `GET /api/connections/:connectionId/chatbot`, `POST /api/connections/:connectionId/chatbot/nodes`, `POST /api/connections/:connectionId/chatbot/simulate`, `PUT/DELETE /api/chatbot/nodes/:id`, `PUT /api/chatbot/nodes/:id/children-order`.

- [ ] **Step 1: Escrever o teste que falha**

`backend/test/integration/chatbot.test.ts`:

```ts
import { Job } from "bullmq";
import request from "supertest";
import { createApp } from "../../src/app";
import { ChatbotNode, Message, Ticket, TicketLog } from "../../src/models";
import { processBotTimeoutJob } from "../../src/modules/chatbot/botTimeout.worker";
import { runBot } from "../../src/modules/chatbot/chatbot.service";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { getQueue, QueueNames } from "../../src/queues";
import { botTimeoutJobId } from "../../src/queues/botTimeout";
import { bearer } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { createNode, createTicket, createUser, scenario } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";
import { resetRedis } from "../helpers/redis";

const app = createApp();
const fake = new FakeProvider();

async function setup() {
  const s = await scenario();
  const admin = await createUser(s.company.id, { profile: "admin" });
  const base = `/api/connections/${s.connection.id}/chatbot`;
  const post = (body: Record<string, unknown>) =>
    request(app).post(`${base}/nodes`).set("Authorization", bearer(admin)).send(body);
  return { ...s, admin, base, post };
}

describe("chatbot tree API", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    fake.reset();
    setProvider(fake);
  });
  afterAll(() => setProvider(null));

  it("builds a tree and validates options", async () => {
    const { post, queue } = await setup();
    const root = await post({ parentId: null, message: "Olá!" });
    expect(root.status).toBe(201);
    expect(root.body).toMatchObject({ parentId: null, action: "submenu", key: "" });

    expect((await post({ parentId: null, message: "outra" })).body.error.code).toBe("ROOT_EXISTS");

    const missingQueue = await post({ parentId: root.body.id, key: "1", title: "Suporte", action: "transfer_queue" });
    expect(missingQueue.status).toBe(400);
    expect(missingQueue.body.error.code).toBe("QUEUE_REQUIRED");

    const support = await post({ parentId: root.body.id, key: "1", title: "Suporte", action: "transfer_queue", queueId: queue.id });
    expect(support.status).toBe(201);
    expect(support.body.order).toBe(1);

    const duplicate = await post({ parentId: root.body.id, key: "1", title: "Outro", action: "close" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("KEY_IN_USE");

    const reply = await post({ parentId: root.body.id, key: "2", title: "Horário", action: "reply", message: "8h às 18h" });
    const underReply = await post({ parentId: reply.body.id, key: "1", title: "X", action: "close" });
    expect(underReply.status).toBe(400);
    expect(underReply.body.error.code).toBe("INVALID_PARENT");

    const badKey = await post({ parentId: root.body.id, key: "0", title: "X", action: "close" });
    expect(badKey.status).toBe(400);
  });

  it("lists, reorders and deletes options", async () => {
    const { connection, admin, base } = await setup();
    const root = await createNode(connection, { message: "Olá" });
    const a = await createNode(connection, { parentId: root.id, key: "1", title: "A", action: "close", order: 1 });
    const b = await createNode(connection, { parentId: root.id, key: "2", title: "B", action: "close", order: 2 });

    await request(app)
      .put(`/api/chatbot/nodes/${root.id}/children-order`)
      .set("Authorization", bearer(admin))
      .send({ ids: [b.id, a.id] })
      .expect(200);
    const list = await request(app).get(base).set("Authorization", bearer(admin));
    const children = list.body.filter((n: { parentId: number | null }) => n.parentId === root.id);
    expect(children.map((n: { id: number }) => n.id)).toEqual([b.id, a.id]);

    const wrongIds = await request(app)
      .put(`/api/chatbot/nodes/${root.id}/children-order`)
      .set("Authorization", bearer(admin))
      .send({ ids: [a.id] });
    expect(wrongIds.status).toBe(400);

    await request(app).delete(`/api/chatbot/nodes/${root.id}`).set("Authorization", bearer(admin)).expect(204);
    expect(await ChatbotNode.count()).toBe(0);
  });

  it("updates an option and refuses to turn a submenu with children into another type", async () => {
    const { connection, admin } = await setup();
    const root = await createNode(connection, { message: "Olá" });
    const sub = await createNode(connection, { parentId: root.id, key: "1", title: "Sub", action: "submenu" });
    await createNode(connection, { parentId: sub.id, key: "1", title: "Fim", action: "close" });

    const renamed = await request(app)
      .put(`/api/chatbot/nodes/${sub.id}`)
      .set("Authorization", bearer(admin))
      .send({ title: "Financeiro" });
    expect(renamed.body.title).toBe("Financeiro");

    const res = await request(app)
      .put(`/api/chatbot/nodes/${sub.id}`)
      .set("Authorization", bearer(admin))
      .send({ action: "close" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("HAS_CHILDREN");
  });

  it("simulates a conversation without sending anything", async () => {
    const { connection, admin, base, queue } = await setup();
    const root = await createNode(connection, { message: "Olá!" });
    await createNode(connection, { parentId: root.id, key: "1", title: "Suporte", action: "transfer_queue", queueId: queue.id });

    const greet = await request(app)
      .post(`${base}/simulate`)
      .set("Authorization", bearer(admin))
      .send({ state: { nodeId: null, attempts: 0 }, input: "oi" });
    expect(greet.body.effects).toEqual([{ type: "send_text", text: "Olá!\n\n1 - Suporte" }]);

    const choose = await request(app)
      .post(`${base}/simulate`)
      .set("Authorization", bearer(admin))
      .send({ state: greet.body.state, input: "1" });
    expect(choose.body.finished).toBe(true);
    expect(choose.body.effects.at(-1)).toEqual({ type: "transfer", queueId: queue.id, userId: null });
    expect(fake.sent).toHaveLength(0);
  });
});

describe("runBot", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    fake.reset();
    setProvider(fake);
  });
  afterAll(() => setProvider(null));

  async function botTicket() {
    const s = await scenario();
    const root = await createNode(s.connection, { message: "Olá!" });
    await createNode(s.connection, { parentId: root.id, key: "1", title: "Suporte", action: "transfer_queue", queueId: s.queue.id });
    const ticket = await createTicket({ companyId: s.company.id, contactId: s.contact.id, connectionId: s.connection.id, status: "bot" });
    return { ...s, root, ticket };
  }

  it("greets, stores the bot state and schedules the timeout", async () => {
    const { ticket, root } = await botTicket();
    await runBot(ticket, "oi");
    await ticket.reload();
    expect(ticket.chatbotNodeId).toBe(root.id);
    const sent = await Message.findAll({ where: { ticketId: ticket.id } });
    expect(sent.map((m) => [m.body, m.isBot, m.ack])).toEqual([["Olá!\n\n1 - Suporte", true, "pending"]]);
    const job = await getQueue(QueueNames.botTimeout).getJob(botTimeoutJobId(ticket.id));
    expect(job).toBeDefined();
  });

  it("transfers to the chosen queue and cancels the timeout", async () => {
    const { ticket, queue } = await botTicket();
    await runBot(ticket, "oi");
    await runBot(ticket, "1");
    await ticket.reload();
    expect(ticket).toMatchObject({ status: "pending", queueId: queue.id, chatbotNodeId: null });
    expect(await getQueue(QueueNames.botTimeout).getJob(botTimeoutJobId(ticket.id))).toBeUndefined();
  });

  it("closes tickets still in the bot when the timeout fires", async () => {
    const { ticket } = await botTicket();
    await processBotTimeoutJob({ data: { ticketId: ticket.id } } as Job<{ ticketId: number }>);
    await ticket.reload();
    expect(ticket.status).toBe("closed");
    expect(await TicketLog.count({ where: { ticketId: ticket.id, event: "bot_timeout" } })).toBe(1);
  });

  it("ignores the timeout when the ticket already left the bot", async () => {
    const { ticket } = await botTicket();
    await ticket.update({ status: "pending" });
    await processBotTimeoutJob({ data: { ticketId: ticket.id } } as Job<{ ticketId: number }>);
    expect((await Ticket.findByPk(ticket.id))!.status).toBe("pending");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest test/integration/chatbot.test.ts`
Expected: FAIL com `Cannot find module '../../src/modules/chatbot/botTimeout.worker'`.

- [ ] **Step 3: Implementar**

`backend/src/modules/chatbot/chatbot.service.ts`:

```ts
import { UniqueConstraintError } from "sequelize";
import { BotAction, ChatbotNode, Company, Connection, Queue, Ticket } from "../../models";
import { scheduleBotTimeout } from "../../queues/botTimeout";
import { AppError, notFound } from "../../shared/errors/AppError";
import { getConnectionOr404 } from "../connections/connections.service";
import { resolveMediaPath } from "../media/media.storage";
import { createOutgoingMessage } from "../messages/messages.service";
import { assertQueuesBelong } from "../queues/queues.service";
import { isOpen } from "../queues/schedule";
import { closeTicketInternal, moveToPending } from "../tickets/tickets.service";
import { getUserOr404 } from "../users/users.service";
import { BotContext, BotNode, BotState, INVALID_OPTION_MESSAGE, step, StepResult } from "./engine";

export interface NodeInput {
  parentId: number | null;
  key: string;
  title: string;
  action: BotAction;
  message?: string;
  mediaUrl?: string | null;
  mediaMime?: string | null;
  mediaName?: string | null;
  queueId?: number | null;
  userId?: number | null;
}

export function toBotNode(n: ChatbotNode): BotNode {
  return {
    id: n.id,
    parentId: n.parentId,
    order: n.order,
    key: n.key,
    title: n.title,
    action: n.action,
    message: n.message,
    mediaUrl: n.mediaUrl,
    mediaMime: n.mediaMime,
    mediaName: n.mediaName,
    queueId: n.queueId,
    userId: n.userId,
  };
}

export async function loadTree(connectionId: number): Promise<BotNode[]> {
  return (await ChatbotNode.findAll({ where: { connectionId } })).map(toBotNode);
}

export async function hasBot(connectionId: number): Promise<boolean> {
  return (await ChatbotNode.count({ where: { connectionId, parentId: null } })) > 0;
}

export async function buildBotContext(connection: Connection, nodes: BotNode[], now = new Date()): Promise<BotContext> {
  const [company, queues] = await Promise.all([
    Company.findByPk(connection.companyId),
    Queue.findAll({ where: { companyId: connection.companyId } }),
  ]);
  const timeZone = company?.timezone ?? "America/Sao_Paulo";
  return {
    nodes,
    defaultQueueId: connection.defaultQueueId,
    isQueueOpen: (queueId) => {
      const queue = queues.find((q) => q.id === queueId);
      return queue ? isOpen(queue.schedule, now, timeZone) : true;
    },
    messages: {
      transfer: connection.transferMessage,
      outOfHours: connection.outOfHoursMessage,
      invalid: INVALID_OPTION_MESSAGE,
    },
  };
}

export async function listNodes(companyId: number, connectionId: number) {
  await getConnectionOr404(companyId, connectionId);
  return ChatbotNode.findAll({
    where: { connectionId },
    order: [
      ["parentId", "ASC NULLS FIRST"],
      ["order", "ASC"],
      ["id", "ASC"],
    ],
  });
}

async function getNodeOr404(companyId: number, id: number): Promise<ChatbotNode> {
  const node = await ChatbotNode.findOne({ where: { id, companyId } });
  if (!node) throw notFound("Opção do chatbot");
  return node;
}

async function validateNode(companyId: number, connectionId: number, input: NodeInput): Promise<void> {
  if (input.parentId !== null) {
    const parent = await ChatbotNode.findOne({ where: { id: input.parentId, connectionId } });
    if (!parent) throw new AppError("INVALID_PARENT", 400, "Opção pai inválida");
    if (parent.parentId !== null && parent.action !== "submenu") {
      throw new AppError("INVALID_PARENT", 400, "Só submenus podem ter opções");
    }
  }
  if (input.action === "transfer_queue" && !input.queueId) {
    throw new AppError("QUEUE_REQUIRED", 400, "Selecione a fila de destino");
  }
  if (input.action === "transfer_agent" && !input.userId) {
    throw new AppError("USER_REQUIRED", 400, "Selecione o atendente");
  }
  if (input.queueId) await assertQueuesBelong(companyId, [input.queueId]);
  if (input.userId) await getUserOr404(companyId, input.userId);
  if (input.mediaUrl) resolveMediaPath(companyId, input.mediaUrl);
}

function rethrowUnique(err: unknown): never {
  if (err instanceof UniqueConstraintError) {
    throw new AppError("KEY_IN_USE", 409, "Já existe uma opção com este número neste menu");
  }
  throw err;
}

const ROOT_FIELDS = { key: "", action: "submenu" as BotAction, queueId: null, userId: null };

export async function createNode(companyId: number, connectionId: number, input: NodeInput) {
  await getConnectionOr404(companyId, connectionId);
  const isRoot = input.parentId === null;
  if (isRoot && (await hasBot(connectionId))) {
    throw new AppError("ROOT_EXISTS", 409, "O chatbot desta conexão já tem uma mensagem inicial");
  }
  const data: NodeInput = isRoot ? { ...input, ...ROOT_FIELDS, title: input.title || "Início" } : input;
  await validateNode(companyId, connectionId, data);
  const maxOrder = isRoot ? 0 : ((await ChatbotNode.max("order", { where: { parentId: input.parentId } })) as number | null);
  try {
    return await ChatbotNode.create({ companyId, connectionId, ...data, order: isRoot ? 0 : (maxOrder ?? 0) + 1 });
  } catch (err) {
    rethrowUnique(err);
  }
}

export async function updateNode(companyId: number, id: number, input: Partial<Omit<NodeInput, "parentId">>) {
  const node = await getNodeOr404(companyId, id);
  const pick = <K extends keyof Omit<NodeInput, "parentId">>(k: K) =>
    (input[k] !== undefined ? input[k] : node[k]) as NodeInput[K];
  const merged: NodeInput = {
    parentId: node.parentId,
    key: pick("key"),
    title: pick("title"),
    action: pick("action"),
    message: pick("message") ?? "",
    mediaUrl: pick("mediaUrl") ?? null,
    mediaMime: pick("mediaMime") ?? null,
    mediaName: pick("mediaName") ?? null,
    queueId: pick("queueId") ?? null,
    userId: pick("userId") ?? null,
    ...(node.parentId === null ? ROOT_FIELDS : {}),
  };
  if (merged.action !== "submenu" && (await ChatbotNode.count({ where: { parentId: node.id } })) > 0) {
    throw new AppError("HAS_CHILDREN", 400, "Remova as opções internas antes de mudar o tipo deste submenu");
  }
  await validateNode(companyId, node.connectionId, merged);
  try {
    return await node.update(merged);
  } catch (err) {
    rethrowUnique(err);
  }
}

export async function deleteNode(companyId: number, id: number): Promise<void> {
  const node = await getNodeOr404(companyId, id);
  await node.destroy();
}

export async function reorderChildren(companyId: number, parentId: number, ids: number[]) {
  await getNodeOr404(companyId, parentId);
  const children = await ChatbotNode.findAll({ where: { parentId } });
  const current = children.map((c) => c.id).sort((a, b) => a - b);
  const requested = [...ids].sort((a, b) => a - b);
  if (current.length !== requested.length || current.some((id, i) => id !== requested[i])) {
    throw new AppError("INVALID_ORDER", 400, "A nova ordem precisa conter exatamente as opções deste menu");
  }
  await Promise.all(ids.map((id, index) => ChatbotNode.update({ order: index + 1 }, { where: { id } })));
  return ChatbotNode.findAll({ where: { parentId }, order: [["order", "ASC"]] });
}

export async function simulate(
  companyId: number,
  connectionId: number,
  state: BotState,
  input: string | null,
): Promise<StepResult> {
  const connection = await getConnectionOr404(companyId, connectionId);
  const nodes = await loadTree(connectionId);
  return step(state, input, await buildBotContext(connection, nodes));
}

export async function runBot(ticket: Ticket, input: string | null): Promise<void> {
  const connection = await Connection.findByPk(ticket.connectionId);
  if (!connection) return;
  const ctx = await buildBotContext(connection, await loadTree(connection.id));
  const result = step({ nodeId: ticket.chatbotNodeId, attempts: ticket.chatbotAttempts }, input, ctx);

  for (const effect of result.effects) {
    switch (effect.type) {
      case "send_text":
        await createOutgoingMessage(ticket, { body: effect.text, isBot: true });
        break;
      case "send_media":
        await createOutgoingMessage(ticket, { body: effect.caption, media: effect.media, isBot: true });
        break;
      case "transfer":
        await moveToPending(ticket, effect.queueId, effect.userId);
        break;
      case "close":
        await closeTicketInternal(ticket, { userId: null, event: "closed", sendClosingMessage: false });
        break;
    }
  }

  if (!result.finished) {
    await ticket.update({ chatbotNodeId: result.state.nodeId, chatbotAttempts: result.state.attempts });
    await scheduleBotTimeout(ticket.id, connection.botTimeoutMinutes);
  }
}
```

`backend/src/modules/chatbot/botTimeout.worker.ts`:

```ts
import { Job } from "bullmq";
import { Ticket } from "../../models";
import { closeTicketInternal } from "../tickets/tickets.service";

export async function processBotTimeoutJob(job: Job<{ ticketId: number }>): Promise<void> {
  const ticket = await Ticket.findByPk(job.data.ticketId);
  if (!ticket || ticket.status !== "bot") return;
  await closeTicketInternal(ticket, { userId: null, event: "bot_timeout", sendClosingMessage: false });
}
```

`backend/src/modules/chatbot/chatbot.routes.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../shared/http";
import { currentAuth, isAuth, requireProfile } from "../auth/auth.middleware";
import { createNode, deleteNode, listNodes, reorderChildren, simulate, updateNode } from "./chatbot.service";

const nodeFields = {
  key: z.string().regex(/^[1-9]\d?$/, "use um número de 1 a 99"),
  title: z.string().trim().min(1).max(60),
  action: z.enum(["submenu", "reply", "transfer_queue", "transfer_agent", "close"]),
  message: z.string().max(4096),
  mediaUrl: z.string().nullable(),
  mediaMime: z.string().nullable(),
  mediaName: z.string().nullable(),
  queueId: z.number().int().positive().nullable(),
  userId: z.number().int().positive().nullable(),
};

const createSchema = z
  .object({
    parentId: z.number().int().positive().nullable(),
    key: nodeFields.key.optional(),
    title: nodeFields.title.optional(),
    action: nodeFields.action.optional(),
    message: nodeFields.message.optional(),
    mediaUrl: nodeFields.mediaUrl.optional(),
    mediaMime: nodeFields.mediaMime.optional(),
    mediaName: nodeFields.mediaName.optional(),
    queueId: nodeFields.queueId.optional(),
    userId: nodeFields.userId.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.parentId === null) return;
    for (const field of ["key", "title", "action"] as const) {
      if (!v[field]) ctx.addIssue({ code: "custom", path: [field], message: "obrigatório" });
    }
  });

const updateSchema = z.object(nodeFields).partial();
const orderSchema = z.object({ ids: z.array(z.number().int().positive()) });
const simulateSchema = z.object({
  state: z.object({ nodeId: z.number().int().positive().nullable(), attempts: z.number().int().min(0) }),
  input: z.string().max(4096).nullable(),
});

export const chatbotRoutes = Router();

chatbotRoutes.get("/connections/:connectionId/chatbot", isAuth, requireProfile("admin", "supervisor"), async (req, res) => {
  res.json(await listNodes(currentAuth(req).companyId, idParam(req, "connectionId")));
});

chatbotRoutes.post("/connections/:connectionId/chatbot/nodes", isAuth, requireProfile("admin"), async (req, res) => {
  const v = createSchema.parse(req.body);
  const node = await createNode(currentAuth(req).companyId, idParam(req, "connectionId"), {
    ...v,
    key: v.key ?? "",
    title: v.title ?? "",
    action: v.action ?? "submenu",
  });
  res.status(201).json(node);
});

chatbotRoutes.post("/connections/:connectionId/chatbot/simulate", isAuth, requireProfile("admin"), async (req, res) => {
  const { state, input } = simulateSchema.parse(req.body);
  res.json(await simulate(currentAuth(req).companyId, idParam(req, "connectionId"), state, input));
});

chatbotRoutes.put("/chatbot/nodes/:id", isAuth, requireProfile("admin"), async (req, res) => {
  res.json(await updateNode(currentAuth(req).companyId, idParam(req), updateSchema.parse(req.body)));
});

chatbotRoutes.delete("/chatbot/nodes/:id", isAuth, requireProfile("admin"), async (req, res) => {
  await deleteNode(currentAuth(req).companyId, idParam(req));
  res.status(204).end();
});

chatbotRoutes.put("/chatbot/nodes/:id/children-order", isAuth, requireProfile("admin"), async (req, res) => {
  const { ids } = orderSchema.parse(req.body);
  res.json(await reorderChildren(currentAuth(req).companyId, idParam(req), ids));
});
```

Em `backend/src/routes.ts`, acrescente **antes** de `apiRoutes.use("/connections", connectionRoutes)` (para que `/connections/:id/chatbot` não seja engolido por outro handler):

```ts
import { chatbotRoutes } from "./modules/chatbot/chatbot.routes";
// ...
apiRoutes.use(chatbotRoutes);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest && npm run typecheck`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(chatbot): CRUD da árvore, simulador, execução nos tickets e timeout"
```

---

### Task 14: Pipeline de entrada (webhook → fila → ticket → bot)

**Files:**
- Create: `backend/src/modules/inbound/{inbound,handleMessage,webhook.routes}.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/test/integration/inbound.test.ts`

**Interfaces:**
- Consumes: `InboundEvent`, `InboundMessage`, `getProvider`, `getQueue`, `QueueNames`, `shardFor`, `createWorker`, `env.INBOUND_SHARDS`, `applyAck`, `previewOf`, `applyConnectionUpdate`, `applyQrCode`, `runBot`, `hasBot`, `logTicket`, `emitMessage`, `emitTicket`, `cancelBotTimeout`, `saveBase64`, `StoredMedia`, `logger`.
- Produces:
  - `interface InboundJob { connectionId: number; event: InboundEvent }`.
  - `routingKey(connectionId: number, event: InboundEvent): string`, `enqueueInbound(connectionId, event): Promise<void>`.
  - `handleInboundEvent(job: InboundJob, opts: { finalAttempt: boolean }): Promise<void>`, `processInboundJob(job: Job<InboundJob>): Promise<void>`.
  - `handleInboundMessage(connection: Connection, ev: InboundMessage, opts: { finalAttempt: boolean }): Promise<void>`.
  - `webhookRoutes` (`POST /webhooks/evolution/:token`), `clearWebhookCache(): void`.

- [ ] **Step 1: Escrever o teste que falha**

`backend/test/integration/inbound.test.ts`:

```ts
import request from "supertest";
import { createApp } from "../../src/app";
import { env } from "../../src/config/env";
import { Connection, Contact, Message, Ticket } from "../../src/models";
import { handleInboundEvent, processInboundJob, routingKey } from "../../src/modules/inbound/inbound";
import { clearWebhookCache } from "../../src/modules/inbound/webhook.routes";
import { createOutgoingMessage } from "../../src/modules/messages/messages.service";
import { parseEvolutionWebhook } from "../../src/modules/whatsapp/evolution/parseWebhook";
import { setProvider } from "../../src/modules/whatsapp/registry";
import { createWorker, getQueue, QueueNames, shardFor } from "../../src/queues";
import { resetDb } from "../helpers/db";
import { createNode, createTicket, scenario } from "../helpers/factories";
import { FakeProvider } from "../helpers/fakeProvider";
import { resetRedis } from "../helpers/redis";
import { waitFor } from "../helpers/waitFor";
import { ackUpdate, connectionUpdate, imageMessage, textMessage, upsert } from "../fixtures/evolution";

const app = createApp();
const fake = new FakeProvider();

async function deliver(connection: Connection, payload: Record<string, unknown>, finalAttempt = false) {
  for (const event of parseEvolutionWebhook(payload)) {
    await handleInboundEvent({ connectionId: connection.id, event }, { finalAttempt });
  }
}

async function withBot(connection: Connection, queueId: number) {
  const root = await createNode(connection, { message: "Olá! Escolha:" });
  await createNode(connection, { parentId: root.id, key: "1", title: "Atendimento", action: "transfer_queue", queueId });
  return root;
}

const ticketMessages = (ticketId: number) => Message.findAll({ where: { ticketId }, order: [["id", "ASC"]] });

describe("inbound pipeline", () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
    clearWebhookCache();
    fake.reset();
    setProvider(fake);
  });
  afterAll(() => setProvider(null));

  it("creates contact and bot ticket, stores the message and greets", async () => {
    const { connection, queue } = await scenario();
    const root = await withBot(connection, queue.id);
    await deliver(connection, textMessage({ from: "5511955554444", pushName: "Maria", text: "Oi" }));

    const contact = await Contact.findOne({ where: { number: "5511955554444" } });
    expect(contact!.name).toBe("Maria");
    const ticket = await Ticket.findOne({ where: { contactId: contact!.id } });
    expect(ticket).toMatchObject({ status: "bot", chatbotNodeId: root.id, unreadCount: 1 });
    const messages = await ticketMessages(ticket!.id);
    expect(messages.map((m) => [m.body, m.fromMe, m.isBot])).toEqual([
      ["Oi", false, false],
      ["Olá! Escolha:\n\n1 - Atendimento", true, true],
    ]);
  });

  it("routes the customer's choice to the queue", async () => {
    const { connection, queue } = await scenario();
    await withBot(connection, queue.id);
    await deliver(connection, textMessage({ id: "A1", text: "Oi" }));
    await deliver(connection, textMessage({ id: "A2", text: "1" }));
    const ticket = await Ticket.findOne();
    expect(ticket).toMatchObject({ status: "pending", queueId: queue.id });
  });

  it("ignores duplicate webhooks", async () => {
    const { connection } = await scenario();
    await deliver(connection, textMessage({ id: "DUP" }));
    await deliver(connection, textMessage({ id: "DUP" }));
    expect(await Message.count({ where: { providerMessageId: "DUP" } })).toBe(1);
  });

  it("puts the ticket in the default queue when the connection has no bot", async () => {
    const { connection, queue } = await scenario();
    await deliver(connection, textMessage());
    expect(await Ticket.findOne()).toMatchObject({ status: "pending", queueId: queue.id });
    expect(await Message.count({ where: { isBot: true } })).toBe(0);
  });

  it("opens a new ticket (through the bot again) after the previous one was closed", async () => {
    const { company, connection, queue, contact } = await scenario();
    await withBot(connection, queue.id);
    const old = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, status: "closed" });
    await deliver(connection, textMessage({ from: contact.number }));
    const tickets = await Ticket.findAll({ where: { contactId: contact.id }, order: [["id", "ASC"]] });
    expect(tickets.map((t) => [t.id === old.id, t.status])).toEqual([
      [true, "closed"],
      [false, "bot"],
    ]);
  });

  it("does not run the bot again on a pending ticket", async () => {
    const { company, connection, queue, contact } = await scenario();
    await withBot(connection, queue.id);
    const ticket = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, status: "pending", queueId: queue.id });
    await deliver(connection, textMessage({ from: contact.number, text: "alguém aí?" }));
    const messages = await ticketMessages(ticket.id);
    expect(messages.map((m) => m.body)).toEqual(["alguém aí?"]);
  });

  it("takes the ticket out of the bot when the company replies from the phone", async () => {
    const { company, connection, queue, contact } = await scenario();
    await withBot(connection, queue.id);
    const ticket = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, status: "bot" });
    await deliver(connection, textMessage({ from: contact.number, fromMe: true, text: "já te atendo" }));
    await ticket.reload();
    expect(ticket).toMatchObject({ status: "open", userId: null, chatbotNodeId: null });
    expect(await Message.count({ where: { isBot: true } })).toBe(0);
  });

  it("reconciles the echo of a message we sent instead of duplicating it", async () => {
    const { company, connection, contact } = await scenario();
    const ticket = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, status: "open" });
    const sent = await createOutgoingMessage(ticket, { body: "Olá, tudo bem?" });
    await deliver(connection, textMessage({ id: "ECHO1", from: contact.number, fromMe: true, text: "Olá, tudo bem?" }));
    const messages = await ticketMessages(ticket.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: sent.id, providerMessageId: "ECHO1", ack: "sent" });
  });

  it("ignores group messages", async () => {
    const { connection } = await scenario();
    await deliver(connection, upsert({ key: { remoteJid: "120363000000@g.us", fromMe: false, id: "G1" }, message: { conversation: "oi" } }));
    expect(await Ticket.count()).toBe(0);
  });

  it("downloads and stores media", async () => {
    const { company, connection } = await scenario();
    await deliver(connection, imageMessage({ caption: "comprovante" }));
    const message = await Message.findOne();
    expect(message).toMatchObject({ type: "image", body: "comprovante", mediaMime: "image/jpeg" });
    expect(message!.mediaUrl).toMatch(new RegExp(`^/media/${company.id}/`));
  });

  it("retries media download, then stores a placeholder on the final attempt", async () => {
    const { connection } = await scenario();
    fake.failNext("downloadMedia");
    await expect(deliver(connection, imageMessage({ caption: "" }))).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(await Message.count()).toBe(0);

    fake.failNext("downloadMedia");
    await deliver(connection, imageMessage({ caption: "" }), true);
    expect(await Message.findOne()).toMatchObject({ type: "image", body: "[mídia indisponível]", mediaUrl: null });
  });

  it("applies ack and connection events", async () => {
    const { company, connection, contact } = await scenario();
    const ticket = await createTicket({ companyId: company.id, contactId: contact.id, connectionId: connection.id, status: "open" });
    const message = await Message.create({
      companyId: company.id, ticketId: ticket.id, connectionId: connection.id,
      fromMe: true, body: "x", type: "text", ack: "sent", providerMessageId: "OUT1",
    });
    await deliver(connection, ackUpdate("OUT1", "READ", contact.number));
    expect((await message.reload()).ack).toBe("read");

    await deliver(connection, connectionUpdate("close"));
    expect((await connection.reload()).status).toBe("disconnected");
  });

  it("webhook rejects unknown tokens and enqueues events on the contact shard", async () => {
    const { connection } = await scenario();
    await request(app).post("/webhooks/evolution/nao-existe").send(textMessage()).expect(404);

    await request(app).post(`/webhooks/evolution/${connection.webhookToken}`).send(textMessage({ from: "5511944443333" })).expect(200);
    const [event] = parseEvolutionWebhook(textMessage({ from: "5511944443333" }));
    const shard = shardFor(routingKey(connection.id, event), env.INBOUND_SHARDS);
    expect(routingKey(connection.id, event)).toBe(`${connection.id}:5511944443333`);
    const jobs = await getQueue(QueueNames.inbound(shard)).getJobs(["waiting"]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data).toMatchObject({ connectionId: connection.id, event: { kind: "message", remoteNumber: "5511944443333" } });
  });

  it("processes messages of the same contact in order and with a single ticket", async () => {
    const { connection } = await scenario();
    const workers = Array.from({ length: env.INBOUND_SHARDS }, (_, i) =>
      createWorker(QueueNames.inbound(i), processInboundJob, { concurrency: 1 }),
    );
    try {
      const hook = `/webhooks/evolution/${connection.webhookToken}`;
      await request(app).post(hook).send(textMessage({ id: "O1", text: "primeira" })).expect(200);
      await request(app).post(hook).send(textMessage({ id: "O2", text: "segunda" })).expect(200);
      await request(app).post(hook).send(textMessage({ id: "O3", text: "terceira" })).expect(200);
      const messages = await waitFor(
        () => Message.findAll({ order: [["id", "ASC"]] }),
        (rows) => rows.length === 3,
      );
      expect(messages.map((m) => m.body)).toEqual(["primeira", "segunda", "terceira"]);
      expect(await Ticket.count()).toBe(1);
    } finally {
      await Promise.all(workers.map((w) => w.close()));
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest test/integration/inbound.test.ts`
Expected: FAIL com `Cannot find module '../../src/modules/inbound/inbound'`.

- [ ] **Step 3: Implementar**

`backend/src/modules/inbound/handleMessage.ts`:

```ts
import { Op, UniqueConstraintError } from "sequelize";
import { Connection, Contact, Message, MessageType, Ticket, TicketStatus } from "../../models";
import { cancelBotTimeout } from "../../queues/botTimeout";
import { logger } from "../../shared/logger";
import { hasBot, runBot } from "../chatbot/chatbot.service";
import { saveBase64, StoredMedia } from "../media/media.storage";
import { previewOf } from "../messages/messages.service";
import { emitMessage, emitTicket } from "../tickets/ticket.events";
import { logTicket } from "../tickets/tickets.service";
import { InboundMessage } from "../whatsapp/provider";
import { getProvider } from "../whatsapp/registry";

const MEDIA_TYPES: MessageType[] = ["image", "audio", "video", "document", "sticker"];
const ECHO_WINDOW_MS = 120_000;

async function upsertContact(companyId: number, ev: InboundMessage): Promise<Contact> {
  const pushName = !ev.fromMe && ev.pushName ? ev.pushName : null;
  const [contact, created] = await Contact.findOrCreate({
    where: { companyId, number: ev.remoteNumber },
    defaults: { companyId, number: ev.remoteNumber, name: pushName ?? ev.remoteNumber, isGroup: false },
  });
  if (!created && pushName && contact.name === contact.number) await contact.update({ name: pushName });
  return contact;
}

/** Mensagem que nós enviamos e voltou como fromMe antes de gravarmos o id do WhatsApp. */
async function matchPendingEcho(connectionId: number, contactId: number, ev: InboundMessage): Promise<boolean> {
  const candidate = await Message.findOne({
    where: {
      connectionId,
      fromMe: true,
      providerMessageId: null,
      ack: "pending",
      body: ev.body,
      createdAt: { [Op.gte]: new Date(Date.now() - ECHO_WINDOW_MS) },
    },
    include: [{ model: Ticket, where: { contactId }, attributes: [] }],
    order: [["id", "ASC"]],
  });
  if (!candidate) return false;
  await Message.update({ providerMessageId: ev.providerMessageId, ack: "sent" }, { where: { id: candidate.id } });
  await candidate.reload();
  emitMessage(candidate, "message:update");
  return true;
}

async function findOrCreateTicket(connection: Connection, contact: Contact, fromMe: boolean): Promise<Ticket> {
  const where = { contactId: contact.id, connectionId: connection.id, status: { [Op.ne]: "closed" } };
  const open = await Ticket.findOne({ where });
  if (open) return open;

  const status: TicketStatus = fromMe ? "open" : (await hasBot(connection.id)) ? "bot" : "pending";
  try {
    const ticket = await Ticket.create({
      companyId: connection.companyId,
      contactId: contact.id,
      connectionId: connection.id,
      status,
      queueId: status === "pending" ? connection.defaultQueueId : null,
    });
    await logTicket(ticket, "created");
    return ticket;
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      const existing = await Ticket.findOne({ where });
      if (existing) return existing;
    }
    throw err;
  }
}

async function fetchMedia(
  connection: Connection,
  ev: InboundMessage,
  opts: { finalAttempt: boolean },
): Promise<{ media: StoredMedia | null; body: string }> {
  if (!MEDIA_TYPES.includes(ev.type)) return { media: null, body: ev.body };
  try {
    const file = await getProvider().downloadMedia(connection.instanceName, ev.providerMessageId);
    const mime = file.mimetype || ev.media?.mimetype || "application/octet-stream";
    const media = await saveBase64(connection.companyId, file.base64, mime, ev.media?.fileName ?? null);
    return { media, body: ev.body };
  } catch (err) {
    if (!opts.finalAttempt) throw err;
    logger.warn({ err, connectionId: connection.id, providerMessageId: ev.providerMessageId }, "media download failed");
    return { media: null, body: ev.body || "[mídia indisponível]" };
  }
}

async function resolveQuoted(connectionId: number, providerMessageId?: string): Promise<number | null> {
  if (!providerMessageId) return null;
  const quoted = await Message.findOne({ where: { connectionId, providerMessageId }, attributes: ["id"] });
  return quoted?.id ?? null;
}

async function takeOverFromBot(ticket: Ticket): Promise<void> {
  await ticket.update({ status: "open", userId: null, chatbotNodeId: null, chatbotAttempts: 0 });
  await cancelBotTimeout(ticket.id);
  await logTicket(ticket, "accepted");
}

export async function handleInboundMessage(
  connection: Connection,
  ev: InboundMessage,
  opts: { finalAttempt: boolean },
): Promise<void> {
  if (ev.isGroup) return;
  if (await Message.count({ where: { connectionId: connection.id, providerMessageId: ev.providerMessageId } })) return;

  const contact = await upsertContact(connection.companyId, ev);
  if (ev.fromMe && (await matchPendingEcho(connection.id, contact.id, ev))) return;

  const ticket = await findOrCreateTicket(connection, contact, ev.fromMe);
  const { media, body } = await fetchMedia(connection, ev, opts);

  let message: Message;
  try {
    message = await Message.create({
      companyId: connection.companyId,
      ticketId: ticket.id,
      connectionId: connection.id,
      providerMessageId: ev.providerMessageId,
      fromMe: ev.fromMe,
      body,
      type: ev.type,
      mediaUrl: media?.url ?? null,
      mediaMime: media?.mime ?? null,
      mediaName: media?.name ?? null,
      ack: ev.fromMe ? "sent" : "delivered",
      quotedMessageId: await resolveQuoted(connection.id, ev.quotedProviderMessageId),
      isBot: false,
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) return;
    throw err;
  }

  await ticket.update({
    lastMessage: previewOf(message),
    lastMessageAt: new Date(),
    unreadCount: ev.fromMe ? ticket.unreadCount : ticket.unreadCount + 1,
  });
  emitMessage(message, "message:new");

  if (ev.fromMe && ticket.status === "bot") await takeOverFromBot(ticket);
  await emitTicket(ticket.id);

  if (!ev.fromMe && ticket.status === "bot") await runBot(ticket, ev.type === "text" ? ev.body : null);
}
```

`backend/src/modules/inbound/inbound.ts`:

```ts
import { Job } from "bullmq";
import { env } from "../../config/env";
import { Connection } from "../../models";
import { getQueue, QueueNames, shardFor } from "../../queues";
import { applyConnectionUpdate, applyQrCode } from "../connections/connections.service";
import { applyAck } from "../messages/messages.service";
import { InboundEvent } from "../whatsapp/provider";
import { handleInboundMessage } from "./handleMessage";

export interface InboundJob {
  connectionId: number;
  event: InboundEvent;
}

/** Eventos do mesmo contato (mensagens e acks) caem no mesmo shard e são processados em ordem. */
export function routingKey(connectionId: number, event: InboundEvent): string {
  if (event.kind === "message") return `${connectionId}:${event.remoteNumber}`;
  if (event.kind === "ack" && event.remoteNumber) return `${connectionId}:${event.remoteNumber}`;
  return `${connectionId}:_`;
}

export async function enqueueInbound(connectionId: number, event: InboundEvent): Promise<void> {
  const shard = shardFor(routingKey(connectionId, event), env.INBOUND_SHARDS);
  await getQueue(QueueNames.inbound(shard)).add(event.kind, { connectionId, event });
}

export async function handleInboundEvent(job: InboundJob, opts: { finalAttempt: boolean }): Promise<void> {
  const connection = await Connection.findByPk(job.connectionId);
  if (!connection) return;
  const { event } = job;
  switch (event.kind) {
    case "message":
      return handleInboundMessage(connection, event, opts);
    case "ack":
      return applyAck(connection.id, event.providerMessageId, event.ack);
    case "connection":
      return applyConnectionUpdate(connection, event.state, event.number);
    case "qrcode":
      return applyQrCode(connection, event.qrBase64);
  }
}

export async function processInboundJob(job: Job<InboundJob>): Promise<void> {
  await handleInboundEvent(job.data, { finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1) });
}
```

`backend/src/modules/inbound/webhook.routes.ts`:

```ts
import { Router } from "express";
import { Connection } from "../../models";
import { AppError } from "../../shared/errors/AppError";
import { getProvider } from "../whatsapp/registry";
import { enqueueInbound } from "./inbound";

const TOKEN_CACHE_TTL_MS = 60_000;
const tokenCache = new Map<string, { connectionId: number; expiresAt: number }>();

export function clearWebhookCache(): void {
  tokenCache.clear();
}

async function connectionIdForToken(token: string): Promise<number | null> {
  const hit = tokenCache.get(token);
  if (hit && hit.expiresAt > Date.now()) return hit.connectionId;
  const connection = await Connection.findOne({ where: { webhookToken: token }, attributes: ["id"] });
  if (!connection) return null;
  tokenCache.set(token, { connectionId: connection.id, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
  return connection.id;
}

export const webhookRoutes = Router();

webhookRoutes.post("/evolution/:token", async (req, res) => {
  const connectionId = await connectionIdForToken(req.params.token);
  if (!connectionId) throw new AppError("NOT_FOUND", 404, "Webhook desconhecido");
  for (const event of getProvider().parseWebhook(req.body)) await enqueueInbound(connectionId, event);
  res.json({ ok: true });
});
```

Em `backend/src/app.ts`, importe e monte a rota antes de `/api`:

```ts
import { webhookRoutes } from "./modules/inbound/webhook.routes";
// ...
  app.use("/webhooks", webhookRoutes);
  app.use("/api", apiRoutes);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest && npm run typecheck`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(inbound): webhook da Evolution, filas por contato, tickets e acionamento do bot"
```

---

### Task 15: Servidor, workers, painel de filas, seed e Docker

**Files:**
- Create: `backend/src/server.ts`, `backend/src/workers.ts`, `backend/src/bullBoard.ts`, `backend/src/database/seed.ts`
- Create: `backend/Dockerfile`, `backend/.dockerignore`, `docs/smoke-test.md`
- Modify: `docker-compose.yml`
- Test: `backend/test/integration/seed.test.ts`

**Interfaces:**
- Consumes: tudo das tasks anteriores (`processInboundJob`, `processOutboundJob`, `processBotTimeoutJob`, `processMaintenanceJob`, `canJoinTicket`, `initSocket`, `closeSocket`, `createApp`, `migrator`, `sequelize`, `getRedis`, `closeRedis`, `closeQueues`, `getQueue`, `allQueueNames`, `getProvider`).
- Produces:
  - `seed(): Promise<{ created: boolean }>` (cria empresa demo + admin somente se não existir nenhum usuário).
  - `startWorkers(): Worker[]`, `scheduleRecurringJobs(): Promise<void>`.
  - `mountBullBoard(app: Express): void` (em `/admin/queues`, com basic auth; só monta se `BULL_BOARD_USER` e `BULL_BOARD_PASS` existirem).
  - Processo `node dist/server.js`: roda migrations, seed, HTTP + Socket.io, workers e graceful shutdown.

- [ ] **Step 1: Escrever o teste que falha**

`backend/test/integration/seed.test.ts`:

```ts
import bcrypt from "bcryptjs";
import { env } from "../../src/config/env";
import { seed } from "../../src/database/seed";
import { Company, User } from "../../src/models";
import { resetDb } from "../helpers/db";
import { createCompany, createUser } from "../helpers/factories";

describe("seed", () => {
  beforeEach(resetDb);

  it("creates a demo company and an admin on an empty database", async () => {
    await expect(seed()).resolves.toEqual({ created: true });
    const admin = await User.findOne({ where: { email: env.SEED_ADMIN_EMAIL } });
    expect(admin).toMatchObject({ profile: "admin" });
    expect(await bcrypt.compare(env.SEED_ADMIN_PASSWORD, admin!.passwordHash)).toBe(true);
    expect(await Company.count()).toBe(1);
  });

  it("is idempotent", async () => {
    await seed();
    await expect(seed()).resolves.toEqual({ created: false });
    expect(await User.count()).toBe(1);
  });

  it("does nothing when users already exist", async () => {
    const company = await createCompany();
    await createUser(company.id);
    await expect(seed()).resolves.toEqual({ created: false });
    expect(await Company.count()).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest test/integration/seed.test.ts`
Expected: FAIL com `Cannot find module '../../src/database/seed'`.

- [ ] **Step 3: Implementar seed, workers, painel e servidor**

`backend/src/database/seed.ts`:

```ts
import bcrypt from "bcryptjs";
import { env } from "../config/env";
import { Company, User } from "../models";
import { sequelize } from "./sequelize";

/** Instalação nova: cria a empresa demo e o admin inicial. Não faz nada se já existir algum usuário. */
export async function seed(): Promise<{ created: boolean }> {
  if ((await User.count()) > 0) return { created: false };
  const company = await Company.create({ name: "Empresa Demo" });
  await User.create({
    companyId: company.id,
    name: "Administrador",
    email: env.SEED_ADMIN_EMAIL.toLowerCase(),
    profile: "admin",
    passwordHash: await bcrypt.hash(env.SEED_ADMIN_PASSWORD, 10),
  });
  return { created: true };
}

if (require.main === module) {
  seed()
    .then((r) => console.log(r.created ? "seed: admin criado" : "seed: já existem usuários, nada a fazer"))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => sequelize.close());
}
```

`backend/src/workers.ts`:

```ts
import { Worker } from "bullmq";
import { env } from "./config/env";
import { processBotTimeoutJob } from "./modules/chatbot/botTimeout.worker";
import { processMaintenanceJob } from "./modules/connections/maintenance";
import { processInboundJob } from "./modules/inbound/inbound";
import { processOutboundJob } from "./modules/messages/outbound";
import { createWorker, getQueue, QueueNames } from "./queues";
import { logger } from "./shared/logger";

export function startWorkers(): Worker[] {
  const workers: Worker[] = [];
  for (let i = 0; i < env.INBOUND_SHARDS; i++) {
    workers.push(createWorker(QueueNames.inbound(i), processInboundJob, { concurrency: 1 }));
  }
  for (let i = 0; i < env.OUTBOUND_SHARDS; i++) {
    workers.push(createWorker(QueueNames.outbound(i), processOutboundJob, { concurrency: 1 }));
  }
  workers.push(createWorker(QueueNames.botTimeout, processBotTimeoutJob, { concurrency: 5 }));
  workers.push(createWorker(QueueNames.maintenance, processMaintenanceJob, { concurrency: 1 }));

  for (const worker of workers) {
    worker.on("failed", (job, err) =>
      logger.warn({ queue: worker.name, jobId: job?.id, attemptsMade: job?.attemptsMade, err: err.message }, "job failed"),
    );
  }
  return workers;
}

export async function scheduleRecurringJobs(): Promise<void> {
  await getQueue(QueueNames.maintenance).upsertJobScheduler(
    "connection-health",
    { every: 60_000 },
    { name: "connection-health", opts: { attempts: 1, removeOnComplete: true, removeOnFail: 100 } },
  );
}
```

`backend/src/bullBoard.ts`:

```ts
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { Express } from "express";
import basicAuth from "express-basic-auth";
import { env } from "./config/env";
import { allQueueNames, getQueue } from "./queues";

export function mountBullBoard(app: Express): void {
  if (!env.BULL_BOARD_USER || !env.BULL_BOARD_PASS) return;
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");
  createBullBoard({
    queues: allQueueNames(env.INBOUND_SHARDS, env.OUTBOUND_SHARDS).map((name) => new BullMQAdapter(getQueue(name))),
    serverAdapter,
  });
  app.use(
    "/admin/queues",
    basicAuth({ users: { [env.BULL_BOARD_USER]: env.BULL_BOARD_PASS }, challenge: true }),
    serverAdapter.getRouter(),
  );
}
```

`backend/src/server.ts`:

```ts
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
```

- [ ] **Step 4: Rodar testes e build**

Run: `npx jest && npm run typecheck && npm run build`
Expected: todos os testes PASS; `dist/server.js` gerado.

- [ ] **Step 5: Docker do backend e compose completo**

`backend/.dockerignore`:

```
node_modules
dist
tmp
public/media
.env
.env.test
test
coverage
```

`backend/Dockerfile`:

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/public/media && chown -R node:node /app
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
```

Em `docker-compose.yml`, acrescente os serviços `evolution` e `backend` e os volumes novos:

```yaml
  evolution:
    image: evoapicloud/evolution-api:v2.3.0
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      SERVER_URL: http://localhost:8080
      AUTHENTICATION_API_KEY: ${EVOLUTION_API_KEY}
      DATABASE_ENABLED: "true"
      DATABASE_PROVIDER: postgresql
      DATABASE_CONNECTION_URI: postgresql://${DB_USER:-whatson}:${DB_PASS:-whatson}@postgres:5432/evolution?schema=public
      DATABASE_CONNECTION_CLIENT_NAME: whatson2
      DATABASE_SAVE_DATA_INSTANCE: "true"
      DATABASE_SAVE_DATA_NEW_MESSAGE: "true"
      DATABASE_SAVE_MESSAGE_UPDATE: "true"
      DATABASE_SAVE_DATA_CONTACTS: "false"
      DATABASE_SAVE_DATA_CHATS: "false"
      CACHE_REDIS_ENABLED: "true"
      CACHE_REDIS_URI: redis://redis:6379/6
      CACHE_REDIS_PREFIX_KEY: evolution
      CACHE_LOCAL_ENABLED: "false"
      LOG_LEVEL: ERROR,WARN,INFO
    volumes:
      - evolution_instances:/evolution/instances
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  backend:
    build: ./backend
    restart: unless-stopped
    env_file: .env
    environment:
      NODE_ENV: production
      PORT: 4000
      DB_HOST: postgres
      DB_PORT: 5432
      REDIS_URL: redis://redis:6379/0
      EVOLUTION_URL: http://evolution:8080
      BACKEND_PUBLIC_URL: http://backend:4000
      MEDIA_DIR: /app/public/media
    ports:
      - "4000:4000"
    volumes:
      - media_data:/app/public/media
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      evolution:
        condition: service_started
```

e na seção `volumes:` do final:

```yaml
  evolution_instances:
  media_data:
```

Antes de subir, confirme que a tag da Evolution existe:

Run: `docker pull evoapicloud/evolution-api:v2.3.0`
Expected: download concluído. Se a tag não existir, use a v2.x estável mais recente publicada em `evoapicloud/evolution-api` no Docker Hub e atualize o compose.

- [ ] **Step 6: Subir tudo e verificar**

Run (na raiz): `cp .env.example .env` (edite os segredos) e depois `docker compose up -d --build`
Expected: `postgres`, `redis`, `evolution` e `backend` em execução (`docker compose ps`).

Run: `curl -s http://localhost:4000/health`
Expected: `{"status":"ok","checks":{"database":"ok","redis":"ok","evolution":"ok"},...}`

Run: `curl -s -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@whatson.local\",\"password\":\"admin123\"}"`
Expected: JSON com `accessToken`, `refreshToken` e `user.profile = "admin"`.

- [ ] **Step 7: Roteiro de smoke test com a Evolution real**

`docs/smoke-test.md`:

````markdown
# Smoke test — WHATSON2 backend com Evolution API real

Pré-requisito: `docker compose up -d --build` rodando e um celular com WhatsApp para conectar.

1. **Login**: `POST /api/auth/login` com o admin do seed. Guarde o `accessToken` (`TOKEN`).
2. **Fila**: `POST /api/queues` `{ "name": "Suporte" }` → anote o `id` (`QUEUE`).
3. **Conexão**: `POST /api/connections` `{ "name": "Principal", "defaultQueueId": QUEUE }` → status `qrcode`.
4. **QR code**: `GET /api/connections/:id/qrcode` → abra o `qr` (data URL) no navegador e leia com o WhatsApp.
   Em até 1 minuto `GET /api/connections` deve mostrar `status: "connected"` e o `number`.
5. **Chatbot**:
   - `POST /api/connections/:id/chatbot/nodes` `{ "parentId": null, "message": "Olá! Escolha uma opção:" }` → `ROOT`.
   - `POST /api/connections/:id/chatbot/nodes` `{ "parentId": ROOT, "key": "1", "title": "Suporte", "action": "transfer_queue", "queueId": QUEUE }`.
6. **Entrada**: de outro celular, mande "oi" para o número conectado.
   Esperado: chega o menu; `GET /api/tickets?status=bot` (admin) mostra o ticket.
7. **Escolha**: responda "1". Esperado: mensagem de transferência; `GET /api/tickets?status=pending` mostra o ticket na fila.
8. **Atendimento**: `POST /api/tickets/:id/accept`, depois `POST /api/tickets/:ticketId/messages` `{ "body": "Oi, em que posso ajudar?" }`.
   Esperado: mensagem chega no celular; `ack` evolui para `sent` → `delivered` → `read`.
9. **Mídia**: do celular, envie uma foto, um áudio e um PDF. Esperado: as três aparecem em
   `GET /api/tickets/:ticketId/messages` com `mediaUrl` acessível em `http://localhost:4000{mediaUrl}`.
   Envie um arquivo pelo atendente: `POST /api/media` (multipart `file`) e depois `POST /api/tickets/:ticketId/messages` `{ "media": <resposta do upload> }`.
10. **Resiliência**: `docker compose restart backend` e, enquanto ele reinicia, mande 3 mensagens do celular.
    Esperado: as 3 aparecem uma única vez e na ordem certa depois que o backend volta.
11. **Finalizar**: `POST /api/tickets/:id/close`. Mande "oi" de novo → novo ticket passa pelo bot.
12. **Queda de conexão**: desconecte o aparelho em "Aparelhos conectados" no WhatsApp.
    Esperado: em até 1 minuto `GET /api/connections` mostra `disconnected`.
13. **Painel de filas**: abra `http://localhost:4000/admin/queues` (usuário/senha do `.env`) e confirme que não há jobs falhos.
````

- [ ] **Step 8: Commit**

```bash
git add backend docker-compose.yml docs/smoke-test.md
git commit -m "feat(server): bootstrap com workers, bull board, seed e docker compose completo"
```

---

## Próximo passo: Plano B (frontend)

Com este plano executado e o smoke test aprovado, escrever o **Plano B — Frontend do núcleo** (React + Vite + TS + Tailwind + shadcn/ui, identidade Clean SaaS da seção 8 da spec), consumindo os contratos definidos aqui:

- Auth: `/api/auth/*` (access token em memória, refresh token persistido).
- Socket.io: conectar com `auth.token`, esperar `ready`, emitir `ticket:join`/`ticket:leave`; ouvir `ticket:update`, `message:new`, `message:update`, `message:delete`, `connection:update`, `connection:qrcode`, `connection:alert`; ao reconectar, invalidar as queries de tickets e do chat aberto.
- Telas: Login, Atendimento (abas `pending`/`open`/`closed` + `bot` para supervisor), Contatos, Filas, Editor do chatbot com simulador (`/simulate`), Conexões (QR code), Usuários, Configurações da conexão.
