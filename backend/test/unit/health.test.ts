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
