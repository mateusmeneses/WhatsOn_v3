import { isOpen } from "../../src/modules/queues/schedule";

const TZ = "America/Sao_Paulo";
// 2026-10-12 é uma segunda-feira (dia "1"). São Paulo = UTC-3.
const mondayAt = (utcHour: number, minute = 0) =>
  new Date(Date.UTC(2026, 9, 12, utcHour, minute));

describe("isOpen", () => {
  it("treats an empty schedule as always open", () => {
    expect(isOpen({}, mondayAt(3), TZ)).toBe(true);
    expect(isOpen(null, mondayAt(3), TZ)).toBe(true);
  });

  it("is open inside a range in the company time zone", () => {
    // 13:00 UTC = 10:00 em São Paulo
    expect(isOpen({ "1": ["08:00-12:00"] }, mondayAt(13), TZ)).toBe(true);
  });

  it("is closed outside every range", () => {
    // 16:00 UTC = 13:00 em São Paulo
    expect(isOpen({ "1": ["08:00-12:00"] }, mondayAt(16), TZ)).toBe(false);
  });

  it("supports several ranges per day and treats the end as exclusive", () => {
    const schedule = { "1": ["08:00-12:00", "13:00-18:00"] };
    expect(isOpen(schedule, mondayAt(17), TZ)).toBe(true); // 14:00
    expect(isOpen(schedule, mondayAt(15), TZ)).toBe(false); // 12:00
  });

  it("is closed on days without ranges when the schedule is not empty", () => {
    expect(isOpen({ "2": ["08:00-18:00"] }, mondayAt(13), TZ)).toBe(false);
  });

  it("uses the local weekday, not the UTC weekday", () => {
    // 2026-10-13 02:00 UTC = segunda 23:00 em São Paulo
    const lateMonday = new Date(Date.UTC(2026, 9, 13, 2, 0));
    expect(isOpen({ "1": ["22:00-23:59"] }, lateMonday, TZ)).toBe(true);
    expect(isOpen({ "2": ["00:00-23:59"] }, lateMonday, TZ)).toBe(false);
  });

  it("accepts 24:00 as the end of the day", () => {
    // 02:59 UTC de terça = 23:59 de segunda em São Paulo
    expect(isOpen({ "1": ["18:00-24:00"] }, mondayAt(26, 59), TZ)).toBe(true);
    // 03:00 UTC de terça = 00:00 de terça em São Paulo
    expect(isOpen({ "1": ["18:00-24:00"] }, mondayAt(27), TZ)).toBe(false);
  });
});
