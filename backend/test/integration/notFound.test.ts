import request from "supertest";
import { createApp } from "../../src/app";

const app = createApp();

describe("unmatched routes", () => {
  it("answers JSON 404 for unknown /api routes", async () => {
    const res = await request(app).get("/api/nao-existe");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND", message: "Rota não encontrada" } });
  });

  it("answers JSON 404 for unknown /webhooks routes", async () => {
    const res = await request(app).post("/webhooks/nao/existe").send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
