import { getQueue, QueueNames, shardFor } from "../../src/queues";
import { botTimeoutJobId, cancelBotTimeout, scheduleBotTimeout } from "../../src/queues/botTimeout";
import { resetRedis } from "../helpers/redis";

describe("shardFor", () => {
  it("is deterministic and within range", () => {
    for (const key of ["1:5511999990000", "2:5511888880000", "x"]) {
      const shard = shardFor(key, 8);
      expect(shard).toBe(shardFor(key, 8));
      expect(shard).toBeGreaterThanOrEqual(0);
      expect(shard).toBeLessThan(8);
    }
  });

  it("spreads different keys over more than one shard", () => {
    const shards = new Set(Array.from({ length: 50 }, (_, i) => shardFor(`1:55119${i}`, 8)));
    expect(shards.size).toBeGreaterThan(1);
  });
});

describe("bot timeout scheduling", () => {
  beforeEach(resetRedis);

  it("keeps a single delayed job per ticket and cancels it", async () => {
    const queue = getQueue(QueueNames.botTimeout);
    await scheduleBotTimeout(42, 30);
    await scheduleBotTimeout(42, 30);
    const delayed = await queue.getJobs(["delayed"]);
    expect(delayed.map((j) => j.id)).toEqual([botTimeoutJobId(42)]);
    expect(delayed[0].data).toEqual({ ticketId: 42 });

    await cancelBotTimeout(42);
    expect(await queue.getJobs(["delayed"])).toHaveLength(0);
  });
});
