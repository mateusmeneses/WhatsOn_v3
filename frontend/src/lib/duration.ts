/** 75 → "1 min 15 s", 3725 → "1 h 2 min", 190000 → "2 d 4 h". Sem amostra: "—". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rest = s % 60;
    return m < 10 && rest ? `${m} min ${rest} s` : `${m} min`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    const restM = m % 60;
    return restM ? `${h} h ${restM} min` : `${h} h`;
  }
  const d = Math.floor(h / 24);
  const restH = h % 24;
  return restH ? `${d} d ${restH} h` : `${d} d`;
}

/** Versão curta para espaços apertados: "4m", "2h 5m", "1d". */
export function formatDurationShort(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** Segundos decorridos desde um instante ISO. */
export function secondsSince(iso: string, now = Date.now()): number {
  return Math.max(0, (now - new Date(iso).getTime()) / 1000);
}

/** "agora", "há 5 min", "há 3 h", "há 2 d". */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "nunca";
  const s = secondsSince(iso, now);
  if (s < 45) return "agora";
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

export const nf = new Intl.NumberFormat("pt-BR");

/** Variação percentual contra o período anterior; null quando não há base de comparação. */
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}
