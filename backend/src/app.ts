import "express-async-errors";
import "./database/sequelize";
import path from "node:path";
import cors from "cors";
import express, { Express } from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { isInlineMediaFile } from "./modules/media/media.storage";
import { webhookRoutes } from "./modules/inbound/webhook.routes";
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
  app.use(
    "/media",
    express.static(path.resolve(env.MEDIA_DIR), {
      index: false,
      setHeaders: (res, filePath) => {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", "sandbox");
        if (!isInlineMediaFile(filePath)) res.setHeader("Content-Disposition", "attachment");
      },
    }),
  );
  app.use("/webhooks", webhookRoutes);
  app.use("/api", apiRoutes);

  options.beforeErrorHandler?.(app);
  app.use(["/api", "/webhooks"], (_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Rota não encontrada" } });
  });
  app.use(errorHandler);
  return app;
}
