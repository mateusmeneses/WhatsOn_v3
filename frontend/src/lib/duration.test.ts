import { formatDuration, formatDurationShort, percentChange, timeAgo } from "./duration";

describe("duration helpers", () => {
  it("formats durations", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(42)).toBe("42 s");
    expect(formatDuration(75)).toBe("1 min 15 s");
    expect(formatDuration(900)).toBe("15 min");
    expect(formatDuration(3725)).toBe("1 h 2 min");
    expect(formatDuration(190_000)).toBe("2 d 4 h");
    expect(formatDurationShort(300)).toBe("5m");
    expect(formatDurationShort(7500)).toBe("2h 5m");
  });

  it("describes elapsed time", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    expect(timeAgo(null, now)).toBe("nunca");
    expect(timeAgo("2026-10-20T11:59:50Z", now)).toBe("agora");
    expect(timeAgo("2026-10-20T11:30:00Z", now)).toBe("há 30 min");
    expect(timeAgo("2026-10-20T07:00:00Z", now)).toBe("há 5 h");
  });

  it("computes percent change", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(null, 3)).toBeNull();
  });
});
