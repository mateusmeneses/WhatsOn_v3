import { useState } from "react";
import { nf } from "@/lib/duration";
import { ChartTooltip, TooltipRow } from "./ChartTooltip";
import { AXIS, BLUE_RAMP, WEEKDAY_LABELS } from "./theme";
import { useChartWidth } from "./useChartSize";

const PAD = { left: 34, top: 4, bottom: 22 };
const GAP = 2;
/** Segunda a domingo (0 = domingo no banco). */
const ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Mapa de calor dia da semana × hora (mensagens recebidas): uma rampa azul, do claro ao escuro. */
export function Heatmap({ data, label }: { data: { weekday: number; hour: number; count: number }[]; label: string }) {
  const { ref, width } = useChartWidth();
  const [hover, setHover] = useState<{ weekday: number; hour: number } | null>(null);
  const grid = new Map(data.map((d) => [`${d.weekday}:${d.hour}`, d.count]));
  const max = Math.max(0, ...data.map((d) => d.count));
  const cell = Math.max(10, (width - PAD.left) / 24);
  const height = PAD.top + ORDER.length * cell + PAD.bottom;
  const level = (v: number) => (v <= 0 || max === 0 ? 0 : Math.min(BLUE_RAMP.length - 1, 1 + Math.floor((v / max) * (BLUE_RAMP.length - 2))));
  const hv = hover ? (grid.get(`${hover.weekday}:${hover.hour}`) ?? 0) : 0;

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={height} role="img" aria-label={label} className="block">
        {ORDER.map((wd, row) => (
          <g key={wd}>
            <text x={PAD.left - 8} y={PAD.top + row * cell + cell / 2 + 4} textAnchor="end" fontSize={11} fill={AXIS}>
              {WEEKDAY_LABELS[wd]}
            </text>
            {Array.from({ length: 24 }, (_, hour) => {
              const v = grid.get(`${wd}:${hour}`) ?? 0;
              return (
                <rect
                  key={hour}
                  x={PAD.left + hour * cell}
                  y={PAD.top + row * cell}
                  width={cell - GAP}
                  height={cell - GAP}
                  rx={3}
                  fill={BLUE_RAMP[level(v)]}
                  stroke={hover?.weekday === wd && hover.hour === hour ? "#0d366b" : "none"}
                  strokeWidth={1.5}
                  onMouseEnter={() => setHover({ weekday: wd, hour })}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
          </g>
        ))}
        {Array.from({ length: 24 }, (_, hour) =>
          hour % 3 === 0 ? (
            <text key={hour} x={PAD.left + hour * cell + (cell - GAP) / 2} y={height - 6} textAnchor="middle" fontSize={11} fill={AXIS}>
              {String(hour).padStart(2, "0")}h
            </text>
          ) : null,
        )}
      </svg>
      {hover && (
        <ChartTooltip
          x={PAD.left + hover.hour * cell + cell / 2}
          y={PAD.top + ORDER.indexOf(hover.weekday) * cell + cell}
          width={width}
          title={`${WEEKDAY_LABELS[hover.weekday]} às ${String(hover.hour).padStart(2, "0")}h`}
        >
          <TooltipRow label="Mensagens recebidas" value={nf.format(hv)} />
        </ChartTooltip>
      )}
      <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-ink-muted" aria-hidden>
        menos
        {BLUE_RAMP.map((c) => (
          <span key={c} className="h-2.5 w-4 rounded-sm" style={{ backgroundColor: c }} />
        ))}
        mais
      </div>
    </div>
  );
}
