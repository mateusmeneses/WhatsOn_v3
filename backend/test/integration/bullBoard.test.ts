import request from "supertest";
import { createApp } from "../../src/app";
import { mountBullBoard } from "../../src/bullBoard";
import { env } from "../../src/config/env";
import { closeQueues } from "../../src/queues";

describe("bull board", () => {
  afterAll(closeQueues);

  it("requires basic auth and serves the board without CSP when enabled", async () => {
    env.BULL_BOARD_USER = "bb";
    env.BULL_BOARD_PASS = "bbpass";
    const app = createApp({ beforeErrorHandler: mountBullBoard });
    await request(app).get("/admin/queues").expect(401);
    const res = await request(app).get("/admin/queues").auth("bb", "bbpass").expect(200);
    expect(res.headers["content-security-policy"]).toBeUndefined();
  });

  it("is not mounted without credentials", async () => {
    env.BULL_BOARD_USER = undefined;
    env.BULL_BOARD_PASS = undefined;
    const app = createApp({ beforeErrorHandler: mountBullBoard });
    await request(app).get("/admin/queues").expect(404);
  });
});
