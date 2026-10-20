import { CheckCircle2, Clock3, Gauge, Hourglass, Inbox, MessagesSquare, RefreshCw, Send, Timer, TrendingDown, TrendingUp, UserRound, Users, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { BarList } from "@/components/charts/BarList";
import { ChartLegend, LineAreaChart } from "@/components/charts/LineAreaChart";
import { StackedBars } from "@/components/charts/StackedBars";
import { SERIES } from "@/components/charts/theme";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/apiError";
import { cn } from "@/lib/cn";
import { formatDuration, nf, secondsSince, timeAgo } from "@/lib/duration";
import { initials } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { useLiveInvalidate } from "@/realtime/useLiveInvalidate";
import { useAuth } from "@/stores/auth";
import { performanceKeys, useMyPerformance, type MyPerformance } from "./dashboardApi";
import { formatDay, PeriodFilter, usePeriodFilter } from "./PeriodFilter";
import { Delta, EmptyNote, KpiCard, LiveTile, Panel, SkeletonBlock } from "./widgets";

/** Painel pessoal: cada usuário vê só o próprio desempenho, comparado ao período anterior e à média da equipe. */
export function MyPerformancePage() {
  const user = useAuth((s) => s.user)!;
  const filter = usePeriodFilter("7d");
  const query = useMyPerformance(filter.params);
  const data = query.data;
  useLiveInvalidate(performanceKeys.all, ["ticket:update"]);
  const now = useNow();

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={UserRound}
        title="Meu desempenho"
        description={data ? `${user.name} · ${formatDay(data.range.from)}${data.range.days > 1 ? ` – ${formatDay(data.range.to)}` : ""}` : "Seus atendimentos, tempos de resposta e metas"}
        actions={
          <Button variant="secondary" size="sm" onClick={() => query.refetch()} disabled={query.isFetching} aria-label="Atualizar dados">
            <RefreshCw className={cn("h-4 w-4", query.isFetching && "animate-spin")} aria-hidden />
            <span className="hidden sm:inline">Atualizar</span>
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1300px] space-y-5 p-4 sm:p-6">
          <PeriodFilter filter={filter} hint="Compara com o período anterior de mesma duração" />
          {query.isError && !data ? (
            <div role="alert" className="rounded-xl border border-danger/30 bg-red-50 p-6 text-center">
              <p className="font-semibold text-danger">Não foi possível carregar seus números</p>
              <p className="mt-1 text-sm text-ink-muted">{errorMessage(query.error)}</p>
              <Button className="mt-4" variant="secondary" onClick={() => query.refetch()}>Tentar de novo</Button>
            </div>
          ) : !data ? (
            <div className="space-y-5" aria-busy="true" aria-label="Carregando">
              <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-[68px] rounded-xl" />)}</div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <SkeletonBlock key={i} className="h-[132px] rounded-xl" />)}</div>
            </div>
          ) : (
            <Body data={data} now={now} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Frase curta comparando a resposta do usuário com a da equipe. */
function teamInsight(data: MyPerformance): { text: string; good: boolean } | null {
  const mine = data.kpis.medianResponse.value;
  const team = data.team.medianResponse;
  if (mine === null || team === null || team === 0) return null;
  const diff = ((team - mine) / team) * 100;
  if (Math.abs(diff) < 5) return { text: "Seu tempo de resposta está em linha com o da equipe.", good: true };
  return diff > 0
    ? { text: `Você responde ${Math.round(diff)}% mais rápido que a mediana da equipe. Continue assim!`, good: true }
    : { text: `Sua resposta está ${Math.round(-diff)}% mais lenta que a mediana da equipe. Priorizar os clientes que esperam mais ajuda.`, good: false };
}

function Body({ data, now }: { data: MyPerformance; now: number }) {
  const { kpis: k, live } = data;
  const insight = teamInsight(data);
  const spark = data.timeline;
  return (
    <>
      <section aria-label="Situação agora" className="grid gap-3 sm:grid-cols-3">
        <LiveTile to="/atendimento?aba=open" label="Em atendimento comigo" value={live.openNow} icon={MessagesSquare} tone="bg-primary" />
        <LiveTile to="/atendimento?aba=open" label="Cliente sem resposta" value={live.waitingReply} icon={Clock3} tone="bg-danger" alert={live.waitingReply > 0} />
        <LiveTile label="Direcionados a mim" value={live.pendingForMe} icon={Inbox} tone="bg-warning" />
      </section>

      {insight && (
        <p className={cn("flex items-center gap-2 rounded-xl border px-4 py-3 text-sm", insight.good ? "border-success/30 bg-green-50 text-ink" : "border-warning/40 bg-amber-50 text-ink")}>
          {insight.good ? <TrendingUp className="h-4 w-4 shrink-0 text-success" aria-hidden /> : <TrendingDown className="h-4 w-4 shrink-0 text-warning" aria-hidden />}
          {insight.text}
        </p>
      )}

      <section aria-label="Meus indicadores" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Finalizados por mim" icon={CheckCircle2} tone="success" value={nf.format(k.ticketsClosed.value)} delta={<Delta current={k.ticketsClosed.value} previous={k.ticketsClosed.previous} />} footer={data.team.avgClosedPerAgent !== null ? `equipe: ${data.team.avgClosedPerAgent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por atendente` : undefined} />
        <KpiCard label="Atendimentos aceitos" icon={Inbox} value={nf.format(k.ticketsAccepted.value)} delta={<Delta current={k.ticketsAccepted.value} previous={k.ticketsAccepted.previous} />} />
        <KpiCard label="Mensagens enviadas" icon={Send} value={nf.format(k.messagesSent.value)} delta={<Delta current={k.messagesSent.value} previous={k.messagesSent.previous} />} />
        <KpiCard label="Tempo mediano de resposta" icon={Zap} tone="warning" value={formatDuration(k.medianResponse.value)} delta={<Delta current={k.medianResponse.value} previous={k.medianResponse.previous} lowerIsBetter />} footer={data.team.medianResponse !== null ? `equipe: ${formatDuration(data.team.medianResponse)}` : undefined} />
        <KpiCard
          label={`Respostas em até ${Math.round(k.slaSeconds / 60)} min`}
          icon={Gauge}
          tone="success"
          value={k.responseWithinSla.value === null ? "—" : Math.round(k.responseWithinSla.value)}
          unit={k.responseWithinSla.value === null ? undefined : "%"}
          delta={<Delta current={k.responseWithinSla.value} previous={k.responseWithinSla.previous} />}
        />
        <KpiCard label="Espera até aceitar" icon={Hourglass} tone="warning" value={formatDuration(k.avgAcceptWait.value)} delta={<Delta current={k.avgAcceptWait.value} previous={k.avgAcceptWait.previous} lowerIsBetter />} footer="da fila até você" />
        <KpiCard label="Tempo médio de resolução" icon={Timer} tone="violet" value={formatDuration(k.avgResolution.value)} delta={<Delta current={k.avgResolution.value} previous={k.avgResolution.previous} lowerIsBetter />} footer="dos que você finalizou" />
        <KpiCard label="Resposta média" icon={Users} value={formatDuration(k.avgResponse.value)} delta={<Delta current={k.avgResponse.value} previous={k.avgResponse.previous} lowerIsBetter />} footer="média (a mediana é mais justa)" />
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title="Aceitos e finalizados por dia"
          actions={<ChartLegend items={[{ label: "Aceitos", color: SERIES.blue, total: k.ticketsAccepted.value }, { label: "Finalizados", color: SERIES.green, total: k.ticketsClosed.value }]} />}
        >
          <LineAreaChart
            label="Atendimentos aceitos e finalizados por você, por dia"
            data={spark}
            series={[{ key: "accepted", label: "Aceitos", color: SERIES.blue }, { key: "closed", label: "Finalizados", color: SERIES.green }]}
          />
        </Panel>
        <Panel title="Mensagens enviadas por dia" actions={<ChartLegend items={[{ label: "Enviadas", color: SERIES.green, total: k.messagesSent.value }]} />}>
          <StackedBars label="Mensagens que você enviou, por dia" data={spark} series={[{ key: "messages", label: "Enviadas", color: SERIES.green }]} />
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Meus clientes aguardando resposta" description="Do que espera há mais tempo" bodyClassName="px-0 pb-2">
          {data.waitingNow.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-green-50 text-success"><CheckCircle2 className="h-6 w-6" aria-hidden /></span>
              <p className="text-sm font-semibold text-ink">Tudo respondido</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {data.waitingNow.map((w) => {
                const waited = secondsSince(w.since, now);
                return (
                  <li key={w.ticketId}>
                    <Link to={`/atendimento/${w.ticketId}`} className="flex items-center gap-3 px-5 py-2.5 transition hover:bg-background">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{initials(w.contactName)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{w.contactName}</span>
                        <span className="block truncate text-xs text-ink-muted">{w.queueName ?? "Sem fila"} · espera desde {timeAgo(w.since, now).replace("há ", "")}</span>
                      </span>
                      <Badge tone={waited > k.slaSeconds * 6 ? "danger" : waited > k.slaSeconds ? "warning" : "neutral"} className="tabular-nums">{formatDuration(waited)}</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Minhas respostas mais demoradas" description="Para você saber onde dá para ganhar tempo" bodyClassName="px-0 pb-2">
          {data.slowestResponses.length === 0 ? (
            <EmptyNote>Você ainda não respondeu clientes neste período.</EmptyNote>
          ) : (
            <ol className="divide-y divide-border">
              {data.slowestResponses.map((s, i) => (
                <li key={s.messageId}>
                  <Link to={`/atendimento/${s.ticketId}`} className="flex items-center gap-3 px-5 py-2.5 transition hover:bg-background">
                    <span className="w-5 text-center text-xs font-semibold tabular-nums text-ink-muted">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{s.contactName}</span>
                      <span className="block truncate text-xs text-ink-muted">{s.queueName ?? "Sem fila"} · {new Date(s.askedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                    </span>
                    <Badge tone={s.seconds > k.slaSeconds * 6 ? "danger" : s.seconds > k.slaSeconds ? "warning" : "success"} className="tabular-nums">{formatDuration(s.seconds)}</Badge>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <Panel title="Finalizados por fila" description="Onde você mais atendeu no período">
        <BarList items={data.byQueue.map((q) => ({ key: q.id ?? "none", label: q.name, value: q.closed, color: q.color }))} />
      </Panel>
    </>
  );
}
