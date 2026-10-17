import request from "supertest";
import { createApp } from "../../src/app";

describe("GET /api/version", () => {
  it("answers the build version without login", async () => {
    const res = await request(createApp()).get("/api/version");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: expect.any(String), buildTime: expect.any(String) });
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });
});
