import type { ReactNode } from "react";

/** Tooltip posicionado dentro do contêiner `relative` do gráfico; vira para a esquerda perto da borda direita. */
export function ChartTooltip({ x, y, width, title, children }: { x: number; y: number; width: number; title: string; children: ReactNode }) {
  const flip = x > width * 0.6;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 min-w-[9rem] rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-pop"
      style={{ left: flip ? undefined : x + 12, right: flip ? width - x + 12 : undefined, top: Math.max(0, y - 8) }}
    >
      <p className="mb-1 font-semibold text-ink">{title}</p>
      <div className="space-y-0.5 text-ink-muted">{children}</div>
    </div>
  );
}

export function TooltipRow({ color, label, value }: { color?: string; label: string; value: ReactNode }) {
  return (
    <p className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5">
        {color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />}
        {label}
      </span>
      <span className="font-semibold tabular-nums text-ink">{value}</span>
    </p>
  );
}
