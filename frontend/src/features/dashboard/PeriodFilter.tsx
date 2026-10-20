import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import type { DashboardParams, DashboardPeriod } from "./dashboardApi";

const PERIODS: { value: DashboardPeriod; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
  { value: "custom", label: "Período" },
];

const todayLocal = () => new Date().toLocaleDateString("en-CA");

export interface PeriodFilterState {
  period: DashboardPeriod;
  setPeriod(period: DashboardPeriod): void;
  from: string;
  to: string;
  setFrom(value: string): void;
  setTo(value: string): void;
  apply(): void;
  /** Parâmetros prontos para a API (no modo "Período", só valem depois de Aplicar). */
  params: DashboardParams;
}

export function usePeriodFilter(initial: DashboardPeriod = "7d"): PeriodFilterState {
  const [period, setPeriod] = useState<DashboardPeriod>(initial);
  const [from, setFrom] = useState(todayLocal);
  const [to, setTo] = useState(todayLocal);
  const [applied, setApplied] = useState({ from: todayLocal(), to: todayLocal() });
  return {
    period,
    setPeriod,
    from,
    to,
    setFrom,
    setTo,
    apply: () => {
      if (from && to) setApplied({ from, to });
    },
    params: period === "custom" ? { period, ...applied } : { period },
  };
}

/** Seletor de período (atalhos + datas livres) usado por todos os painéis de indicadores. */
export function PeriodFilter({ filter, hint }: { filter: PeriodFilterState; hint?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Tabs value={filter.period} onChange={filter.setPeriod} items={PERIODS} className="min-w-0 max-w-full [&_button]:!px-3 [&_button]:!text-sm" />
      {filter.period === "custom" && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            filter.apply();
          }}
        >
          <label className="sr-only" htmlFor="period-from">Data inicial</label>
          <Input id="period-from" type="date" className="h-9 w-auto" max={filter.to || undefined} value={filter.from} onChange={(e) => filter.setFrom(e.target.value)} />
          <span className="text-sm text-ink-muted">até</span>
          <label className="sr-only" htmlFor="period-to">Data final</label>
          <Input id="period-to" type="date" className="h-9 w-auto" min={filter.from || undefined} value={filter.to} onChange={(e) => filter.setTo(e.target.value)} />
          <Button type="submit" size="sm">Aplicar</Button>
        </form>
      )}
      {hint && <p className="ml-auto hidden text-xs text-ink-muted md:block">{hint}</p>}
    </div>
  );
}

export const formatDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
