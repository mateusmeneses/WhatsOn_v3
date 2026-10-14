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
    expect(res.body.url).toMatch(new RegExp(`^/media/${company.id}/[a-f0-9-]+\.pdf$`));
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
