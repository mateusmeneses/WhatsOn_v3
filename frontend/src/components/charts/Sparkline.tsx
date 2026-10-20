/** Tendência minúscula para dentro dos cartões de KPI (sem eixos; o valor está no próprio cartão). */
export function Sparkline({ values, color, width = 96, height = 32 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2 || values.every((v) => v === 0)) return <div style={{ width, height }} aria-hidden />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pad = 3;
  const pts = values.map((v, i) => [pad + (i / (values.length - 1)) * (width - pad * 2), pad + (1 - (v - min) / span) * (height - pad * 2)] as const);
  const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1]!;
  return (
    <svg width={width} height={height} aria-hidden className="shrink-0 overflow-visible">
      <path d={`${d} L${width - pad},${height} L${pad},${height} Z`} fill={color} opacity={0.1} />
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={3} fill={color} stroke="#fff" strokeWidth={1.5} />
    </svg>
  );
}
