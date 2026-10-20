import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";
import { percentChange } from "@/lib/duration";

/** Painel com título, descrição e ações; base de todos os blocos do dashboard. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl border border-border bg-surface shadow-card", className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
        </div>
        {actions}
      </header>
      <div className={cn("min-h-0 flex-1 px-5 pb-5 pt-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Variação contra o período anterior. `lowerIsBetter` inverte a cor (tempos de resposta, espera). */
export function Delta({
  current,
  previous,
  lowerIsBetter = false,
  className,
}: {
  current: number | null;
  previous: number | null;
  lowerIsBetter?: boolean;
  className?: string;
}) {
  const change = percentChange(current, previous);
  if (change === null) {
    return <span className={cn("text-xs text-ink-muted", className)}>sem base de comparação</span>;
  }
  const rounded = Math.round(change);
  const flat = rounded === 0;
  const good = lowerIsBetter ? change < 0 : change > 0;
  const Icon = flat ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
        flat ? "bg-background text-ink-muted" : good ? "bg-green-50 text-success" : "bg-red-50 text-danger",
        className,
      )}
      title="Comparado ao período anterior de mesma duração"
    >
      <Icon className="h-3 w-3" aria-hidden />
      {flat ? "estável" : `${Math.abs(rounded)}%`}
      <span className="sr-only">{flat ? "" : change > 0 ? " a mais" : " a menos"} que o período anterior</span>
    </span>
  );
}

export function KpiCard({
  label,
  value,
  unit,
  icon: Icon,
  tone = "primary",
  footer,
  trend,
  delta,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  icon: LucideIcon;
  tone?: "primary" | "success" | "warning" | "violet";
  footer?: ReactNode;
  trend?: ReactNode;
  delta?: ReactNode;
}) {
  const tones = {
    primary: "bg-primary-soft text-primary",
    success: "bg-green-50 text-success",
    warning: "bg-amber-50 text-warning",
    violet: "bg-[#eeebfb] text-[#6250d6]",
  } as const;
  return (
    <article className="flex flex-col justify-between rounded-xl border border-border bg-surface p-4 shadow-card transition hover:shadow-lift">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", tones[tone])}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <p className="text-3xl font-bold tabular-nums leading-none tracking-tight text-ink">
          {value}
          {unit && <span className="ml-1 text-base font-medium text-ink-muted">{unit}</span>}
        </p>
        {trend}
      </div>
      <div className="mt-3 flex min-h-[1.5rem] flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
        {delta}
        {footer}
      </div>
    </article>
  );
}

/** Contador "ao vivo" no topo: leva para a fila de atendimento correspondente. */
export function LiveTile({
  label,
  value,
  icon: Icon,
  tone,
  hint,
  to = "/atendimento",
  alert = false,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone: string;
  hint?: string;
  to?: string;
  alert?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "group flex items-center gap-3 rounded-xl border bg-surface px-4 py-3 shadow-card transition hover:-translate-y-0.5 hover:shadow-lift",
        alert ? "border-warning/50" : "border-border",
      )}
    >
      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white", tone)}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold tabular-nums leading-none text-ink">{value}</span>
        <span className="mt-1 block text-xs leading-tight text-ink-muted">{label}</span>
        {hint && <span className="block truncate text-[11px] font-medium text-warning">{hint}</span>}
      </span>
    </Link>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-ink-muted">{children}</p>;
}

export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}
