import { useEffect, useState } from "react";

/** Relógio que reavalia a cada `everyMs` (para "há X min" e esperas ao vivo). */
export function useNow(everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}
