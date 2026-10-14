import "express-async-errors";
import "./database/sequelize";
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
