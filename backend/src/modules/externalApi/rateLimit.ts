import { NextFunction, Request, RequestHandler, Response } from "express";
import { AppError } from "../../shared/errors/AppError";
import { logger } from "../../shared/logger";
import { getRedis } from "../../shared/redis";

/** Janela fixa por conexão (token) no Redis, para valer entre instâncias do backend. */
export function rateLimitByConnection(limit: number, windowSeconds = 60): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const connection = req.apiConnection;
    if (!connection) return next();
    const now = Math.floor(Date.now() / 1000);
    const key = `extapi:rl:${connection.id}:${Math.floor(now / windowSeconds)}`;
    let count: number;
    try {
      const redis = getRedis();
      count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSeconds);
    } catch (err) {
      // Redis fora do ar não derruba a API: segue sem limite e registra.
      logger.warn({ err: (err as Error).message, connectionId: connection.id }, "rate limit unavailable");
      return next();
    }
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(limit - count, 0)));
    if (count > limit) {
      res.setHeader("Retry-After", String(windowSeconds - (now % windowSeconds)));
      throw new AppError("RATE_LIMITED", 429, "Limite de requisições excedido; tente novamente em instantes");
    }
    next();
  };
}
