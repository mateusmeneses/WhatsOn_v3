export interface TtlCache {
  /** Devolve o resultado em cache (ou a carga em andamento) enquanto não vencer; senão carrega de novo. */
  get<T>(key: string, load: () => Promise<T>): Promise<T>;
  clear(): void;
}

/**
 * Cache em memória com validade curta e deduplicação: várias pessoas abrindo o mesmo painel ao mesmo tempo
 * (ou o auto-refresh de várias abas) disparam uma única consulta pesada. Falhas não ficam guardadas.
 */
export function createTtlCache({ ttlMs, maxEntries = 500, enabled = true, now = Date.now }: { ttlMs: number; maxEntries?: number; enabled?: boolean; now?: () => number }): TtlCache {
  const entries = new Map<string, { expires: number; value: Promise<unknown> }>();
  return {
    get<T>(key: string, load: () => Promise<T>): Promise<T> {
      if (!enabled) return load();
      const hit = entries.get(key);
      if (hit && hit.expires > now()) return hit.value as Promise<T>;
      const value = load();
      entries.set(key, { expires: now() + ttlMs, value });
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      if (entries.size > maxEntries) {
        for (const [k, e] of entries) {
          if (e.expires <= now() || entries.size > maxEntries) entries.delete(k);
          if (entries.size <= maxEntries) break;
        }
      }
      return value;
    },
    clear: () => entries.clear(),
  };
}
