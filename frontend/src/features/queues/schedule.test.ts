import { describeSchedule, isAlwaysOpen, setDayRanges, validateSchedule } from "./schedule";

describe("schedule helpers", () => {
  it("treats an empty schedule as always open", () => {
    expect(isAlwaysOpen({})).toBe(true);
    expect(isAlwaysOpen({ "1": ["08:00-18:00"] })).toBe(false);
    expect(describeSchedule({})).toBe("Sempre aberto");
  });

  it("sets the ranges of a day and keeps closed days as empty lists", () => {
    const withMonday = setDayRanges({}, "1", ["08:00-12:00"]);
    expect(withMonday).toEqual({ "1": ["08:00-12:00"] });
    const closed = setDayRanges(withMonday, "1", []);
    expect(closed).toEqual({ "1": [] });
    expect(isAlwaysOpen(closed)).toBe(false);
  });

  it("validates format, order and the 24:00 end", () => {
    expect(validateSchedule({ "1": ["08:00-12:00", "13:00-24:00"] })).toBeNull();
    expect(validateSchedule({ "1": ["8:00-12:00"] })).toBe("Segunda: use horários no formato HH:mm.");
    expect(validateSchedule({ "2": ["12:00-08:00"] })).toBe("Terça: o início deve ser antes do fim.");
    expect(validateSchedule({ "3": ["24:00-24:00"] })).toBe("Quarta: use horários no formato HH:mm.");
  });

  it("describes open days", () => {
    expect(describeSchedule({ "1": ["08:00-18:00"], "6": ["08:00-12:00"] })).toBe("Seg, Sáb");
  });
});
