import { createTtlCache } from "../../src/shared/ttlCache";

describe("ttlCache", () => {
  it("runs one load for concurrent and repeated calls until it expires", async () => {
    let clock = 0;
    const cache = createTtlCache({ ttlMs: 1000, now: () => clock });
    let calls = 0;
    const load = jest.fn(async () => ({ n: ++calls }));
    const [a, b] = await Promise.all([cache.get("k", load), cache.get("k", load)]);
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
    clock = 999;
    await cache.get("k", load);
    expect(load).toHaveBeenCalledTimes(1);
    clock = 1001;
    expect((await cache.get("k", load)).n).toBe(2);
    await cache.get("other", load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("does not keep failures and can be disabled", async () => {
    const cache = createTtlCache({ ttlMs: 1000 });
    const load = jest.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue("ok");
    await expect(cache.get("k", load)).rejects.toThrow("boom");
    await expect(cache.get("k", load)).resolves.toBe("ok");
    const off = createTtlCache({ ttlMs: 1000, enabled: false });
    const again = jest.fn(async () => 1);
    await off.get("k", again);
    await off.get("k", again);
    expect(again).toHaveBeenCalledTimes(2);
  });

  it("keeps the number of entries bounded", async () => {
    const cache = createTtlCache({ ttlMs: 1000, maxEntries: 3 });
    const load = jest.fn(async () => 1);
    for (const k of ["a", "b", "c", "d", "e"]) await cache.get(k, load);
    await cache.get("e", load); // mais recente continua em cache
    expect(load).toHaveBeenCalledTimes(5);
    await cache.get("a", load); // a mais antiga foi descartada
    expect(load).toHaveBeenCalledTimes(6);
  });
});
