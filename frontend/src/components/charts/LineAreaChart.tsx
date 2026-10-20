import { useState } from "react";
import { nf } from "@/lib/duration";
import { ChartTooltip, TooltipRow } from "./ChartTooltip";
import { AXIS, GRID, longDate, niceTicks, shortDate, SURFACE } from "./theme";
import { useChartWidth } from "./useChartSize";

export interface LineSeries {
  key: string;
  label: string;
  color: string;
}

interface Props {
  data: ({ date: string } & Record<string, number | string>)[];
  series: LineSeries[];
  height?: number;
  label: string;
}

const PAD = { left: 36, right: 14, top: 14, bottom: 26 };

/** Linhas de 2 px com área suave, crosshair + tooltip e rótulo direto no último ponto. */
export function LineAreaChart({ data, series, height = 240, label }: Props) {
  const { ref, width } = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const max = Math.max(0, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
  const { max: top, ticks } = niceTicks(max);
  const n = data.length;
  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(innerW / 56))));

  const path = (key: string) => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(Number(d[key]) || 0).toFixed(1)}`).join(" ");
  const area = (key: string) => `${path(key)} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;

  function onMove(event: React.MouseEvent<SVGRectElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    setHover(n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((px / rect.width) * (n - 1)))));
  }

  const point = hover === null ? null : data[hover];
  const last = data[n - 1];

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={AXIS}>
              {nf.format(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) =>
          i % every === 0 ? (
            <text key={d.date} x={x(i)} y={height - 6} textAnchor="middle" fontSize={11} fill={AXIS}>
              {shortDate(d.date)}
            </text>
          ) : null,
        )}
        {series.map((s) => (
          <g key={s.key}>
            <defs>
              <linearGradient id={`area-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.18} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            {n > 1 && <path d={area(s.key)} fill={`url(#area-${s.key})`} />}
            {n > 1 ? (
              <path d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ) : null}
            {last && (n === 1 || hover === null) && (
              <circle cx={x(n - 1)} cy={y(Number(last[s.key]) || 0)} r={4} fill={s.color} stroke={SURFACE} strokeWidth={2} />
            )}
          </g>
        ))}
        {hover !== null && point && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke={AXIS} strokeWidth={1} strokeDasharray="3 3" />
            {series.map((s) => (
              <circle key={s.key} cx={x(hover)} cy={y(Number(point[s.key]) || 0)} r={4.5} fill={s.color} stroke={SURFACE} strokeWidth={2} />
            ))}
          </g>
        )}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={innerW}
          height={innerH}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hover !== null && point && (
        <ChartTooltip x={x(hover)} y={PAD.top + 8} width={width} title={longDate(point.date)}>
          {series.map((s) => (
            <TooltipRow key={s.key} color={s.color} label={s.label} value={nf.format(Number(point[s.key]) || 0)} />
          ))}
        </ChartTooltip>
      )}
    </div>
  );
}

export function ChartLegend({ items }: { items: { label: string; color: string; total?: number }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} aria-hidden />
          <span>{item.label}</span>
          {item.total !== undefined && <span className="font-semibold tabular-nums text-ink">{nf.format(item.total)}</span>}
        </li>
      ))}
    </ul>
  );
}
