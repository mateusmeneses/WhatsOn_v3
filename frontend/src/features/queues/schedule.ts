import type { WeekDay, WeekSchedule } from "@/types/api";

export const DAYS: { key: WeekDay; label: string; short: string }[] = [
  { key: "1", label: "Segunda", short: "Seg" },
  { key: "2", label: "Terça", short: "Ter" },
  { key: "3", label: "Quarta", short: "Qua" },
  { key: "4", label: "Quinta", short: "Qui" },
  { key: "5", label: "Sexta", short: "Sex" },
  { key: "6", label: "Sábado", short: "Sáb" },
  { key: "0", label: "Domingo", short: "Dom" },
];

const RANGE = /^([01]\d|2[0-3]):[0-5]\d-(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

export function isAlwaysOpen(schedule: WeekSchedule): boolean {
  return Object.keys(schedule).length === 0;
}

/** Lista vazia = dia fechado (a chave continua no objeto, então a fila deixa de ser "sempre aberta"). */
export function setDayRanges(schedule: WeekSchedule, day: WeekDay, ranges: string[]): WeekSchedule {
  return { ...schedule, [day]: ranges };
}

export function validateSchedule(schedule: WeekSchedule): string | null {
  for (const { key, label } of DAYS) {
    for (const range of schedule[key] ?? []) {
      if (!RANGE.test(range)) return `${label}: use horários no formato HH:mm.`;
      const [start, end] = range.split("-");
      if (start! >= end!) return `${label}: o início deve ser antes do fim.`;
    }
  }
  return null;
}

export function describeSchedule(schedule: WeekSchedule): string {
  if (isAlwaysOpen(schedule)) return "Sempre aberto";
  return DAYS.filter((d) => (schedule[d.key] ?? []).length > 0)
    .map((d) => d.short)
    .join(", ");
}
