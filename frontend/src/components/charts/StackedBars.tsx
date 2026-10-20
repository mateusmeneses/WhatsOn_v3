import { useState } from "react";
import { nf } from "@/lib/duration";
import { ChartTooltip, TooltipRow } from "./ChartTooltip";
import { AXIS, GRID, longDate, niceTicks, shortDate, SURFACE } from "./theme";
import type { LineSeries } from "./LineAreaChart";
import { useChartWidth } from "./useChartSize";

interface Props {
  data: ({ date: string } & Record<string, number | string>)[];
  series: LineSeries[];
  height?: number;
  label: string;
}

const PAD = { left: 36, right: 8, top: 14, bottom: 26 };

/** Colunas empilhadas por dia, com respiro de 2 px entre segmentos e topo arredondado. */
export function StackedBars({ data, series, height = 240, label }: Props) {
  const { ref, width } = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const n = Math.max(1, data.length);
  const totals = data.map((d) => series.reduce((sum, s) => sum + (Number(d[s.key]) || 0), 0));
  const { max: top, ticks } = niceTicks(Math.max(0, ...totals));
  const slot = innerW / n;
  const bw = Math.max(3, Math.min(34, slot * 0.64));
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(innerW / 56))));

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
        {data.map((d, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          let acc = 0;
          const present = series.filter((s) => (Number(d[s.key]) || 0) > 0);
          return (
            <g key={d.date} opacity={hover === null || hover === i ? 1 : 0.55}>
              {present.map((s, k) => {
                const value = Number(d[s.key]) || 0;
                const y1 = y(acc + value);
                const y0 = y(acc);
                acc += value;
                const h = Math.max(1, y0 - y1 - (k > 0 ? 2 : 0));
                const isTop = k === present.length - 1;
                const r = Math.min(4, bw / 2, h);
                const px = cx - bw / 2;
                const yy = y1;
                const dPath = isTop
                  ? `M${px},${yy + h} V${yy + r} Q${px},${yy} ${px + r},${yy} H${px + bw - r} Q${px + bw},${yy} ${px + bw},${yy + r} V${yy + h} Z`
                  : `M${px},${yy} H${px + bw} V${yy + h} H${px} Z`;
                return <path key={s.key} d={dPath} fill={s.color} stroke={SURFACE} strokeWidth={0} />;
              })}
              {i % every === 0 && (
                <text x={cx} y={height - 6} textAnchor="middle" fontSize={11} fill={AXIS}>
                  {shortDate(d.date)}
                </text>
              )}
              <rect
                x={PAD.left + slot * i}
                y={PAD.top}
                width={slot}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <ChartTooltip x={PAD.left + slot * hover + slot / 2} y={PAD.top + 8} width={width} title={longDate(data[hover]!.date)}>
          {series.map((s) => (
            <TooltipRow key={s.key} color={s.color} label={s.label} value={nf.format(Number(data[hover]![s.key]) || 0)} />
          ))}
          <TooltipRow label="Total" value={nf.format(totals[hover] ?? 0)} />
        </ChartTooltip>
      )}
    </div>
  );
}
