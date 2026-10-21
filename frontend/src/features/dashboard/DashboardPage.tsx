import {
  Activity,
  ArrowRightLeft,
  Bot,
  CheckCircle2,
  Clock3,
  Download,
  Gauge,
  Hourglass,
  Inbox,
  LayoutDashboard,
  MessageCircle,
  MessagesSquare,
  Plug,
  RefreshCw,
  Send,
  Timer,
  Trophy,
  UserCheck,
  Users,
  Zap,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { BarList, SplitBar } from "@/components/charts/BarList";
import { Heatmap } from "@/components/charts/Heatmap";
import { ChartLegend, LineAreaChart } from "@/components/charts/LineAreaChart";
import { Sparkline } from "@/components/charts/Sparkline";
import { StackedBars } from "@/components/charts/StackedBars";
import { SERIES } from "@/components/charts/theme";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PresenceDot } from "@/components/ui/presence-dot";
import { errorMessage } from "@/lib/apiError";
import { cn } from "@/lib/cn";
import { formatDuration, formatDurationShort, nf, secondsSince, timeAgo } from "@/lib/duration";
import { formatPhone, initials } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { useLiveInvalidate } from "@/realtime/useLiveInvalidate";
import { useAuth } from "@/stores/auth";
import { dashboardKeys, useDashboard, type DashboardAgent, type DashboardData } from "./dashboardApi";
import { downloadCsv } from "./exportCsv";
import { formatDay, PeriodFilter, usePeriodFilter } from "./PeriodFilter";
import { ChartWithTable, Delta, EmptyNote, KpiCard, LiveTile, Panel, SkeletonBlock } from "./widgets";

const PROFILE_LABEL: Record<string, string> = { admin: "Administrador", supervisor: "Supervisor", agent: "Atendente" };

const EVENT_LABEL: Record<string, { verb: string; tone: "primary" | "success" | "warning" | "neutral" | "danger" }> = {
  created: { verb: "Novo atendimento", tone: "primary" },
  accepted: { verb: "Aceito", tone: "success" },
  transferred: { verb: "Transferido", tone: "warning" },
  claimed: { verb: "Requerido", tone: "warning" },
  reopened: { verb: "Reaberto", tone: "primary" },
  closed: { verb: "Finalizado", tone: "neutral" },
  bot_timeout: { verb: "Bot encerrou por inatividade", tone: "danger" },
  inactivity: { verb: "Finalizado por inatividade", tone: "neutral" },
};

const MESSAGE_TYPE_LABEL: Record<string, string> = {
  text: "Texto",
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localização",
};

const CONNECTION_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" }> = {
  connected: { label: "Conectada", tone: "success" },
  qrcode: { label: "Aguardando QR code", tone: "warning" },
  disconnected: { label: "Desconectada", tone: "danger" },
};

export function DashboardPage() {
  const user = useAuth((s) => s.user)!;
  const filter = usePeriodFilter("7d");
  const query = useDashboard(filter.params);
  const data = query.data;
  // Entrada/saída de usuários e movimento nos chamados atualizam o painel na hora (no máximo a cada 4 s).
  useLiveInvalidate(dashboardKeys.all, ["presence:changed", "ticket:update"]);
  const now = useNow();

  const rangeLabel = data ? (data.range.days === 1 ? formatDay(data.range.from) : `${formatDay(data.range.from)} – ${formatDay(data.range.to)}`) : "";

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={LayoutDashboard}
        title="Dashboard"
        description={
          data
            ? `${rangeLabel} · ${PROFILE_LABEL[user.profile] ?? ""} · fuso ${data.range.timezone.replace("_", " ")}`
            : "Indicadores de atendimento, equipe e clientes"
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
              aria-label="Atualizar dados"
              title={data ? `Atualizado ${timeAgo(data.range.generatedAt, now)}` : "Atualizar"}
            >
              <RefreshCw className={cn("h-4 w-4", query.isFetching && "animate-spin")} aria-hidden />
              <span className="hidden sm:inline">{data ? `Atualizado ${timeAgo(data.range.generatedAt, now)}` : "Atualizar"}</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!data}
              onClick={() => {
                if (data) {
                  downloadCsv(data);
                  toast.success("Planilha exportada");
                }
              }}
            >
              <Download className="h-4 w-4" aria-hidden />
              Exportar CSV
            </Button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 sm:p-6">
          <PeriodFilter filter={filter} hint="Compara com o período anterior de mesma duração · atualiza sozinho a cada 30 s" />

          {query.isError && !data ? (
            <div role="alert" className="rounded-xl border border-danger/30 bg-red-50 p-6 text-center">
              <p className="font-semibold text-danger">Não foi possível carregar o dashboard</p>
              <p className="mt-1 text-sm text-ink-muted">{errorMessage(query.error)}</p>
              <Button className="mt-4" variant="secondary" onClick={() => query.refetch()}>
                Tentar de novo
              </Button>
            </div>
          ) : !data ? (
            <DashboardSkeleton />
          ) : (
            <DashboardBody data={data} now={now} />
          )}
        </div>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Carregando dashboard">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonBlock key={i} className="h-[68px] rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <SkeletonBlock key={i} className="h-[132px] rounded-xl" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <SkeletonBlock className="h-[320px] rounded-xl" />
        <SkeletonBlock className="h-[320px] rounded-xl" />
      </div>
    </div>
  );
}

function DashboardBody({ data, now }: { data: DashboardData; now: number }) {
  const { live, kpis: k } = data;
  const oldestPending = live.oldestPendingSince ? secondsSince(live.oldestPendingSince, now) : null;
  const spark = (key: "created" | "closed" | "inbound" | "outbound") => data.timeline.map((t) => t[key]);
  const noTraffic = k.ticketsCreated.value === 0 && k.messagesIn.value === 0 && k.messagesOut.value === 0;

  return (
    <>
      {/* AGORA */}
      <section aria-label="Situação agora" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <LiveTile label="Online agora" value={live.onlineUsers} icon={Users} tone="bg-brand-green" to="/usuarios" hint={undefined} />
        <LiveTile to="/atendimento?aba=pending" label="Aguardando atendente" value={live.pending} icon={Hourglass} tone="bg-warning" alert={live.pending > 0 && (oldestPending ?? 0) > 600} hint={oldestPending !== null && live.pending > 0 ? `mais antigo: ${formatDurationShort(oldestPending)}` : undefined} />
        <LiveTile to="/atendimento?aba=open" label="Em atendimento" value={live.open} icon={MessagesSquare} tone="bg-primary" />
        <LiveTile to="/atendimento?aba=open" label="Cliente sem resposta" value={live.waitingReply} icon={Clock3} tone="bg-danger" alert={live.waitingReply > 0} />
        <LiveTile to="/atendimento?aba=bot" label="No bot" value={live.bot} icon={Bot} tone="bg-[#6250d6]" />
        <LiveTile to="/atendimento?aba=closed" label="Finalizados hoje" value={live.closedToday} icon={CheckCircle2} tone="bg-brand-navy" />
      </section>

      {noTraffic && (
        <p className="rounded-xl border border-dashed border-border bg-surface px-4 py-3 text-sm text-ink-muted">
          Ainda não há atendimentos neste período. Assim que as conversas chegarem, os indicadores aparecem aqui.
        </p>
      )}

      {/* KPIs */}
      <section aria-label="Indicadores do período" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Atendimentos criados"
          icon={Inbox}
          value={nf.format(k.ticketsCreated.value)}
          trend={<Sparkline values={spark("created")} color={SERIES.blue} />}
          delta={<Delta current={k.ticketsCreated.value} previous={k.ticketsCreated.previous} />}
        />
        <KpiCard
          label="Atendimentos finalizados"
          icon={CheckCircle2}
          tone="success"
          value={nf.format(k.ticketsClosed.value)}
          trend={<Sparkline values={spark("closed")} color={SERIES.green} />}
          delta={<Delta current={k.ticketsClosed.value} previous={k.ticketsClosed.previous} />}
          footer={k.ticketsCreated.value > 0 ? `${Math.round((k.ticketsClosed.value / k.ticketsCreated.value) * 100)}% dos criados` : undefined}
        />
        <KpiCard
          label="Tempo mediano de resposta"
          icon={Zap}
          tone="warning"
          value={formatDuration(k.medianResponse.value)}
          delta={<Delta current={k.medianResponse.value} previous={k.medianResponse.previous} lowerIsBetter />}
          footer={k.avgResponse.value !== null ? `média ${formatDuration(k.avgResponse.value)}` : "sem respostas no período"}
        />
        <KpiCard
          label={`Respostas em até ${Math.round(k.slaSeconds / 60)} min`}
          icon={Gauge}
          tone="success"
          value={k.responseWithinSla.value === null ? "—" : Math.round(k.responseWithinSla.value)}
          unit={k.responseWithinSla.value === null ? undefined : "%"}
          delta={<Delta current={k.responseWithinSla.value} previous={k.responseWithinSla.previous} />}
          footer={
            k.responseWithinSla.value !== null && (
              <span className="block h-1.5 w-20 overflow-hidden rounded-full bg-background" role="presentation">
                <span className="block h-full rounded-full bg-brand-green" style={{ width: `${k.responseWithinSla.value}%` }} />
              </span>
            )
          }
        />
        <KpiCard
          label="Espera até aceitar"
          icon={Hourglass}
          tone="warning"
          value={formatDuration(k.avgAcceptWait.value)}
          delta={<Delta current={k.avgAcceptWait.value} previous={k.avgAcceptWait.previous} lowerIsBetter />}
          footer="da fila até o atendente"
        />
        <KpiCard
          label="Tempo médio de resolução"
          icon={Timer}
          tone="violet"
          value={formatDuration(k.avgResolution.value)}
          delta={<Delta current={k.avgResolution.value} previous={k.avgResolution.previous} lowerIsBetter />}
          footer="da abertura à finalização"
        />
        <KpiCard
          label="Mensagens recebidas"
          icon={MessageCircle}
          value={nf.format(k.messagesIn.value)}
          trend={<Sparkline values={spark("inbound")} color={SERIES.blue} />}
          delta={<Delta current={k.messagesIn.value} previous={k.messagesIn.previous} />}
        />
        <KpiCard
          label="Mensagens enviadas"
          icon={Send}
          tone="success"
          value={nf.format(k.messagesOut.value)}
          trend={<Sparkline values={spark("outbound")} color={SERIES.green} />}
          delta={<Delta current={k.messagesOut.value} previous={k.messagesOut.previous} />}
          footer={`+ ${nf.format(k.messagesBot.value)} do bot`}
        />
      </section>

      {/* EVOLUÇÃO */}
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title="Atendimentos por dia"
          description="Quantos chamados chegaram e quantos foram finalizados"
          actions={
            <ChartLegend
              items={[
                { label: "Criados", color: SERIES.blue, total: k.ticketsCreated.value },
                { label: "Finalizados", color: SERIES.green, total: k.ticketsClosed.value },
              ]}
            />
          }
        >
          <ChartWithTable
            caption="Atendimentos criados e finalizados por dia"
            rows={data.timeline}
            columns={[
              { header: "Dia", cell: (r) => formatDay(r.date) },
              { header: "Criados", align: "right", cell: (r) => nf.format(r.created) },
              { header: "Finalizados", align: "right", cell: (r) => nf.format(r.closed) },
            ]}
            chart={
              <LineAreaChart
                label={`Atendimentos criados e finalizados por dia, de ${formatDay(data.range.from)} a ${formatDay(data.range.to)}`}
                data={data.timeline}
                series={[
                  { key: "created", label: "Criados", color: SERIES.blue },
                  { key: "closed", label: "Finalizados", color: SERIES.green },
                ]}
              />
            }
          />
        </Panel>
        <Panel
          title="Mensagens por dia"
          description="Volume de conversas: cliente, atendentes e bot"
          actions={
            <ChartLegend
              items={[
                { label: "Recebidas", color: SERIES.blue, total: k.messagesIn.value },
                { label: "Atendentes", color: SERIES.green, total: k.messagesOut.value },
                { label: "Bot", color: SERIES.violet, total: k.messagesBot.value },
              ]}
            />
          }
        >
          <ChartWithTable
            caption="Mensagens por dia: recebidas, enviadas por atendentes e pelo bot"
            rows={data.timeline}
            columns={[
              { header: "Dia", cell: (r) => formatDay(r.date) },
              { header: "Recebidas", align: "right", cell: (r) => nf.format(r.inbound) },
              { header: "Atendentes", align: "right", cell: (r) => nf.format(r.outbound) },
              { header: "Bot", align: "right", cell: (r) => nf.format(r.bot) },
            ]}
            chart={
              <StackedBars
                label={`Mensagens recebidas, enviadas por atendentes e pelo bot por dia, de ${formatDay(data.range.from)} a ${formatDay(data.range.to)}`}
                data={data.timeline}
                series={[
                  { key: "inbound", label: "Recebidas", color: SERIES.blue },
                  { key: "outbound", label: "Atendentes", color: SERIES.green },
                  { key: "bot", label: "Bot", color: SERIES.violet },
                ]}
              />
            }
          />
        </Panel>
      </div>

      {/* EQUIPE */}
      <TeamPanel agents={data.agents} now={now} />

      {/* TEMPOS */}
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title="Mensagens mais demoradas"
          description="Quanto o cliente esperou até a primeira resposta de um atendente (maiores no período)"
          bodyClassName="px-0 pb-2"
        >
          {data.slowestResponses.length === 0 ? (
            <EmptyNote>Nenhuma resposta de atendente no período.</EmptyNote>
          ) : (
            <ol className="divide-y divide-border">
              {data.slowestResponses.map((s, index) => (
                <li key={`${s.messageId}`}>
                  <Link to={`/atendimento/${s.ticketId}`} className="flex items-center gap-3 px-5 py-2.5 transition hover:bg-background">
                    <span className="w-5 text-center text-xs font-semibold tabular-nums text-ink-muted">{index + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{s.contactName}</span>
                      <span className="block truncate text-xs text-ink-muted">
                        {s.agentName ?? "Celular da empresa"}
                        {s.queueName ? ` · ${s.queueName}` : ""} · {new Date(s.askedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </span>
                    <Badge tone={s.seconds > k.slaSeconds * 6 ? "danger" : s.seconds > k.slaSeconds ? "warning" : "success"} className="tabular-nums">
                      {formatDuration(s.seconds)}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel
          title="Clientes aguardando resposta agora"
          description="Mensagens do cliente ainda sem retorno, da mais antiga para a mais recente"
          bodyClassName="px-0 pb-2"
          actions={live.waitingReply > 0 ? <Badge tone="danger">{live.waitingReply} no total</Badge> : undefined}
        >
          {data.waitingNow.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-green-50 text-success">
                <CheckCircle2 className="h-6 w-6" aria-hidden />
              </span>
              <p className="text-sm font-semibold text-ink">Tudo respondido</p>
              <p className="text-xs text-ink-muted">Nenhum cliente está esperando resposta neste momento.</p>
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
                        <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-ink-muted">
                          {w.queueColor && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: w.queueColor }} aria-hidden />}
                          {w.queueName ?? "Sem fila"} · {w.status === "pending" ? "aguardando atendente" : `com ${w.agentName ?? "celular"}`}
                        </span>
                      </span>
                      <Badge tone={waited > k.slaSeconds * 6 ? "danger" : waited > k.slaSeconds ? "warning" : "neutral"} className="tabular-nums">
                        {formatDuration(waited)}
                      </Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {/* DEMANDA */}
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="Quando os clientes escrevem" description="Mensagens recebidas por dia da semana e hora do dia">
          <Heatmap label="Mapa de calor de mensagens recebidas por dia da semana e hora" data={data.heatmap} />
        </Panel>
        <Panel title="Atendimentos por fila" description="Criados no período · cor da fila" >
          <BarList
            items={data.byQueue.map((q) => ({
              key: q.id ?? "none",
              label: q.name,
              value: q.created,
              color: q.color,
              hint: `${q.closed} final. · ${q.waiting} aguard.`,
            }))}
          />
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Clientes mais ativos" description="Quem mais trocou mensagens no período" bodyClassName="px-0 pb-2">
          {data.topContacts.length === 0 ? (
            <EmptyNote>Sem conversas no período.</EmptyNote>
          ) : (
            <ol className="divide-y divide-border">
              {data.topContacts.map((c, index) => {
                const total = c.inbound + c.outbound;
                const max = (data.topContacts[0]?.inbound ?? 0) + (data.topContacts[0]?.outbound ?? 0);
                return (
                  <li key={c.id} className="flex items-center gap-3 px-5 py-2.5">
                    <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold", index === 0 ? "bg-amber-100 text-warning" : "bg-background text-ink-muted")}>
                      {index === 0 ? <Trophy className="h-3.5 w-3.5" aria-hidden /> : index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-ink">{c.name}</span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{nf.format(total)} msgs</span>
                      </span>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-background" role="presentation">
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${max ? (total / max) * 100 : 0}%` }} />
                      </span>
                      <span className="mt-1 block truncate text-xs text-ink-muted">
                        {formatPhone(c.number)} · {c.tickets} {c.tickets === 1 ? "atendimento" : "atendimentos"} · {c.inbound} recebidas / {c.outbound} enviadas · {timeAgo(c.lastAt, now)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>

        <Panel title="Movimentação" description="O que aconteceu nos atendimentos" bodyClassName="space-y-4">
          <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[
              { label: "Aceitos", value: data.movement.accepted },
              { label: "Transferidos", value: data.movement.transferred },
              { label: "Requeridos", value: data.movement.claimed },
              { label: "Reabertos", value: data.movement.reopened },
              { label: "Finalizados", value: data.movement.closed },
              { label: "Bot inativo", value: data.movement.botTimeout },
            ].map((m) => (
              <div key={m.label} className="rounded-lg bg-background px-2 py-2 text-center">
                <dd className="text-lg font-bold tabular-nums text-ink">{nf.format(m.value)}</dd>
                <dt className="truncate text-[11px] text-ink-muted">{m.label}</dt>
              </div>
            ))}
          </dl>
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              <Activity className="h-3.5 w-3.5" aria-hidden />
              Últimas ocorrências
            </h3>
            {data.recentActivity.length === 0 ? (
              <EmptyNote>Nenhuma movimentação ainda.</EmptyNote>
            ) : (
              <ul className="space-y-1">
                {data.recentActivity.map((a) => {
                  const meta = EVENT_LABEL[a.event] ?? { verb: a.event, tone: "neutral" as const };
                  return (
                    <li key={a.id}>
                      <Link to={`/atendimento/${a.ticketId}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-background">
                        <Badge tone={meta.tone} className="shrink-0">{meta.verb}</Badge>
                        <span className="min-w-0 flex-1 truncate text-ink">
                          <span className="font-medium">{a.contactName}</span>
                          <span className="text-ink-muted">
                            {a.userName ? ` · ${a.userName}` : ""}
                            {a.toUserName ? ` → ${a.toUserName}` : a.event === "transferred" && a.queueName ? ` → ${a.queueName}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-ink-muted">{timeAgo(a.createdAt, now)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <Panel title="Bot de atendimento" description="Atendimentos que passaram pelo menu automático">
          <div className="space-y-4">
            <div className="flex items-end gap-6">
              <div>
                <p className="text-3xl font-bold tabular-nums text-ink">{nf.format(data.bot.handled)}</p>
                <p className="text-xs text-ink-muted">passaram pelo bot</p>
              </div>
              <div>
                <p className="text-3xl font-bold tabular-nums text-brand-green">
                  {data.bot.handled ? `${Math.round((data.bot.resolvedByBot / data.bot.handled) * 100)}%` : "—"}
                </p>
                <p className="text-xs text-ink-muted">resolvidos sem atendente</p>
              </div>
            </div>
            <SplitBar
              parts={[
                { label: "Resolvidos pelo bot", value: data.bot.resolvedByBot, color: SERIES.violet },
                { label: "Foram para atendente", value: Math.max(0, data.bot.handled - data.bot.resolvedByBot), color: SERIES.blue },
              ]}
            />
            <p className="flex items-center gap-2 text-xs text-ink-muted">
              <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />
              {nf.format(data.bot.timeouts)} encerrados por inatividade do cliente
            </p>
          </div>
        </Panel>

        <Panel title="Conexões WhatsApp" description="Números ligados ao sistema" bodyClassName="px-0 pb-2">
          {data.byConnection.length === 0 ? (
            <EmptyNote>Nenhuma conexão cadastrada.</EmptyNote>
          ) : (
            <ul className="divide-y divide-border">
              {data.byConnection.map((c) => {
                const status = CONNECTION_STATUS[c.status] ?? { label: c.status, tone: "warning" as const };
                return (
                  <li key={c.id} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                      <Plug className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{c.name}</span>
                      <span className="block truncate text-xs text-ink-muted">
                        {c.number ? formatPhone(c.number) : "sem número"} · {c.tickets} atend. · {nf.format(c.messagesIn)} recebidas
                      </span>
                    </span>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Tipos de mensagem" description="Composição do tráfego no período">
          <BarList
            items={data.messageTypes.map((t, i) => ({
              key: t.type,
              label: MESSAGE_TYPE_LABEL[t.type] ?? t.type,
              value: t.count,
              color: i === 0 ? SERIES.blue : "#6da7ec",
            }))}
          />
        </Panel>
      </div>
    </>
  );
}

type SortKey = "name" | "openNow" | "accepted" | "closed" | "messagesSent" | "avgResponse" | "avgAcceptWait";

function TeamPanel({ agents, now }: { agents: DashboardAgent[]; now: number }) {
  const [sort, setSort] = useState<{ key: SortKey | "default"; dir: 1 | -1 }>({ key: "default", dir: -1 });
  const online = agents.filter((a) => a.online).length;
  const rows = [...agents];
  if (sort.key !== "default") {
    const { key, dir } = sort;
    rows.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      // Sem amostra (null) vai sempre para o fim, independente da direção.
      if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
      return (typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number)) * dir;
    });
  }
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "name" || key === "avgResponse" || key === "avgAcceptWait" ? 1 : -1 }));
  const aria = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none");

  const Th = ({ k, children, className }: { k: SortKey; children: ReactNode; className?: string }) => (
    <th scope="col" aria-sort={aria(k)} className={cn("px-3 py-2 font-medium", className)}>
      <button type="button" onClick={() => toggle(k)} className="inline-flex items-center gap-1 hover:text-ink">
        {children}
        <span aria-hidden className={cn("text-[10px]", sort.key === k ? "text-primary" : "opacity-0")}>{sort.dir === 1 && sort.key === k ? "▲" : "▼"}</span>
      </button>
    </th>
  );

  return (
    <Panel
      title="Equipe e presença"
      description="Quem está conectado agora e a produtividade de cada atendente no período"
      bodyClassName="px-0 pb-0"
      actions={
        <Badge tone={online > 0 ? "success" : "neutral"}>
          <UserCheck className="h-3 w-3" aria-hidden />
          {online} de {agents.length} online
        </Badge>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-y border-border bg-background/70 text-xs text-ink-muted">
            <tr>
              <Th k="name" className="pl-5">Atendente</Th>
              <th scope="col" className="px-3 py-2 font-medium">Presença</th>
              <Th k="openNow" className="text-right">Em atend.</Th>
              <Th k="accepted" className="text-right">Aceitos</Th>
              <Th k="closed" className="text-right">Finalizados</Th>
              <Th k="messagesSent" className="text-right">Mensagens</Th>
              <Th k="avgResponse" className="text-right">Resp. média</Th>
              <Th k="avgAcceptWait" className="pr-5 text-right">Espera p/ aceitar</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((a) => (
              <tr key={a.id} className="transition hover:bg-background/60">
                <td className="py-2.5 pl-5 pr-3">
                  <span className="flex items-center gap-3">
                    <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                      {initials(a.name)}
                      <PresenceDot online={a.online} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-surface" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{a.name}</span>
                      <span className="block text-xs text-ink-muted">{PROFILE_LABEL[a.profile] ?? a.profile}</span>
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {a.online ? (
                    <span className="font-medium text-success">Online · conectado {timeAgo(a.connectedSince, now).replace("há ", "há ")}</span>
                  ) : (
                    <span className="text-ink-muted">{a.lastSeenAt ? `Visto ${timeAgo(a.lastSeenAt, now)}` : a.lastLoginAt ? `Login ${timeAgo(a.lastLoginAt, now)}` : "Nunca acessou"}</span>
                  )}
                  {a.lastLoginAt && <span className="block text-ink-muted">último login {timeAgo(a.lastLoginAt, now)}</span>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{a.openNow}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{a.accepted}</td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{a.closed}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{nf.format(a.messagesSent)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatDuration(a.avgResponse)}</td>
                <td className="py-2.5 pl-3 pr-5 text-right tabular-nums">{formatDuration(a.avgAcceptWait)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <EmptyNote>Nenhum usuário cadastrado.</EmptyNote>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
