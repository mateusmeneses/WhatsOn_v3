import type { ReactNode } from "react";
import { nf } from "@/lib/duration";

export interface BarItem {
  key: string | number;
  label: string;
  value: number;
  color: string;
  hint?: ReactNode;
}

/** Barras horizontais com rótulo à esquerda e valor à direita (comparação de magnitude entre categorias). */
export function BarList({ items, empty = "Sem dados no período" }: { items: BarItem[]; empty?: string }) {
  const max = Math.max(0, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="py-6 text-center text-sm text-ink-muted">{empty}</p>;
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} aria-hidden />
              <span className="truncate font-medium text-ink">{item.label}</span>
            </span>
            <span className="shrink-0 tabular-nums text-ink">
              <span className="font-semibold">{nf.format(item.value)}</span>
              {item.hint && <span className="ml-2 text-xs text-ink-muted">{item.hint}</span>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-background" role="presentation">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${max ? Math.max(2, (item.value / max) * 100) : 0}%`, backgroundColor: item.color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Uma proporção dividida em partes (ex.: bot × atendente) numa barra única com respiro entre segmentos. */
export function SplitBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(", ")}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, backgroundColor: p.color }} />
          ))}
        {total === 0 && <div className="w-full bg-background" />}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />
            {p.label}
            <span className="font-semibold tabular-nums text-ink">{nf.format(p.value)}</span>
            {total > 0 && <span>({Math.round((p.value / total) * 100)}%)</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
