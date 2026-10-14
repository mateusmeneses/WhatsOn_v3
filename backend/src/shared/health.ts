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
