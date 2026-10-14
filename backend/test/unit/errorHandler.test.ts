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
