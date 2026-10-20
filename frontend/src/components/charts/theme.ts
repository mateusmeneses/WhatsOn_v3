/**
 * Paleta dos gráficos, derivada das cores do logo WhatsOn e validada (CVD/contraste) com o validador da skill dataviz.
 * Slot 1 = azul (entrada / criados), 2 = verde (saída / finalizados), 3 = violeta (bot). Ordem fixa, nunca ciclada.
 */
export const SERIES = {
  blue: "#0a6ad6",
  green: "#0e9f45",
  violet: "#6250d6",
  amber: "#d97706",
  gray: "#94a3b8",
} as const;

/** Rampa sequencial de um só tom (azul da marca), do mais claro ao mais escuro. */
export const BLUE_RAMP = ["#e7f0fc", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"] as const;

export const AXIS = "#8a97ad";
export const GRID = "#e8edf5";
export const SURFACE = "#ffffff";

/** Arredonda o máximo para um valor "redondo" (1, 2, 5 × 10ⁿ) e devolve os ticks do eixo. */
export function niceTicks(max: number, count = 4): { max: number; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) return { max: count, ticks: Array.from({ length: count + 1 }, (_, i) => i) };
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const frac = raw / pow;
  const step = (frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10) * pow;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return { max: top, ticks };
}

const WEEKDAYS = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];

/** "2026-10-14" → "14/10" */
export function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** "2026-10-14" → "qua., 14/10" (calculado em UTC para não depender do fuso do navegador). */
export function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${shortDate(iso)}`;
}

export const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
