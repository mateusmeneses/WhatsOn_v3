import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { Express, NextFunction, Request, Response } from "express";
import basicAuth from "express-basic-auth";
import { env } from "./config/env";
import { logger } from "./shared/logger";
import { allQueueNames, getQueue } from "./queues";

export function mountBullBoard(app: Express): void {
  if (!env.BULL_BOARD_USER || !env.BULL_BOARD_PASS) {
    logger.info("Bull Board desativado: defina BULL_BOARD_USER e BULL_BOARD_PASS");
    return;
  }
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");
  createBullBoard({
    queues: allQueueNames(env.INBOUND_SHARDS, env.OUTBOUND_SHARDS).map((name) => new BullMQAdapter(getQueue(name))),
    serverAdapter,
  });
  app.use(
    "/admin/queues",
    basicAuth({ users: { [env.BULL_BOARD_USER]: env.BULL_BOARD_PASS }, challenge: true }),
    (_req: Request, res: Response, next: NextFunction) => {
      // o painel usa scripts/estilos inline que o CSP do helmet bloquearia
      res.removeHeader("Content-Security-Policy");
      next();
    },
    serverAdapter.getRouter(),
  );
}
