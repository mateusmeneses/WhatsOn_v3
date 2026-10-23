import { WeekDay, WeekSchedule } from "../../models";

const WEEKDAYS: Record<string, WeekDay> = { Sun: "0", Mon: "1", Tue: "2", Wed: "3", Thu: "4", Fri: "5", Sat: "6" };

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

function localParts(now: Date, timeZone: string): { day: WeekDay; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: WEEKDAYS[get("weekday")], minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Schedule vazio = sempre aberto. Intervalos são [início, fim); fim "24:00" = 1440 minutos. */
export function isOpen(schedule: WeekSchedule | null | undefined, now: Date, timeZone: string): boolean {
  if (!schedule || Object.keys(schedule).length === 0) return true;
  const { day, minutes } = localParts(now, timeZone);
  return (schedule[day] ?? []).some((range) => {
    const [start, end] = range.split("-");
    return minutes >= toMinutes(start) && minutes < toMinutes(end);
  });
}

const MAX_DAYS = 400;

/**
 * Minutos de expediente entre `from` e `to` (schedule vazio = todos os minutos). Anda dia a dia no fuso da empresa;
 * resolução de minuto, mesma do isOpen.
 */
export function businessMinutesBetween(
  schedule: WeekSchedule | null | undefined,
  from: Date,
  to: Date,
  timeZone: string,
): number {
  let remaining = Math.floor((to.getTime() - from.getTime()) / 60_000);
  if (remaining <= 0) return 0;
  if (!schedule || Object.keys(schedule).length === 0) return remaining;
  const start = localParts(from, timeZone);
  let day = Number(start.day);
  let minute = start.minutes;
  let total = 0;
  for (let i = 0; remaining > 0 && i < MAX_DAYS; i += 1) {
    const span = Math.min(remaining, 1440 - minute);
    for (const range of schedule[String(day) as WeekDay] ?? []) {
      const [rangeStart, rangeEnd] = range.split("-").map(toMinutes);
      total += Math.max(0, Math.min(rangeEnd, minute + span) - Math.max(rangeStart, minute));
    }
    remaining -= span;
    minute = 0;
    day = (day + 1) % 7;
  }
  return total;
}
