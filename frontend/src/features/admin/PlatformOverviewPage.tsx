import { Activity, Building2, CheckCircle2, Handshake, Inbox, MessageCircle, PlugZap, RefreshCw, Send, Users, UserCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { BarList, SplitBar } from "@/components/charts/BarList";
import { LineAreaChart } from "@/components/charts/LineAreaChart";
import { SERIES } from "@/components/charts/theme";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PresenceDot } from "@/components/ui/presence-dot";
import { ChartWithTable, Delta, EmptyNote, KpiCard, LiveTile, Panel, SkeletonBlock } from "@/features/dashboard/widgets";
import { formatDay, PeriodFilter, usePeriodFilter } from "@/features/dashboard/PeriodFilter";
import { errorMessage } from "@/lib/apiError";
import { cn } from "@/lib/cn";
import { nf, timeAgo } from "@/lib/duration";
import { useNow } from "@/lib/useNow";
import { usePlatformOverview, type PlatformOverview } from "./platformApi";

/** Visão geral da plataforma (super-admin): todas as empresas, parceiros e conexões num só lugar. */
export function PlatformOverviewPage() {
  const filter = usePeriodFilter("30d");
  const query = usePlatformOverview(filter.params);
  const data = query.data;
  const now = useNow();

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={Activity}
        title="Visão geral da plataforma"
        description={data ? `${formatDay(data.range.from)}${data.range.days > 1 ? ` – ${formatDay(data.range.to)}` : ""} · todas as empresas` : "Uso, crescimento e saúde das empresas"}
        actions={
          <Button variant="secondary" size="sm" onClick={() => query.refetch()} disabled={query.isFetching} aria-label="Atualizar dados">
            <RefreshCw className={cn("h-4 w-4", query.isFetching && "animate-spin")} aria-hidden />
            <span className="hidden sm:inline">Atualizar</span>
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 sm:p-6">
          <PeriodFilter filter={filter} hint="Compara com o período anterior de mesma duração · fuso America/Sao Paulo" />
          {query.isError && !data ? (
            <div role="alert" className="rounded-xl border border-danger/30 bg-red-50 p-6 text-center">
              <p className="font-semibold text-danger">Não foi possível carregar a visão geral</p>
              <p className="mt-1 text-sm text-ink-muted">{errorMessage(query.error)}</p>
              <Button className="mt-4" variant="secondary" onClick={() => query.refetch()}>Tentar de novo</Button>
            </div>
          ) : !data ? (
            <div className="space-y-5" aria-busy="true" aria-label="Carregando">
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <SkeletonBlock key={i} className="h-[68px] rounded-xl" />)}</div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <SkeletonBlock key={i} className="h-[132px] rounded-xl" />)}</div>
            </div>
          ) : (
            <Body data={data} now={now} />
          )}
        </div>
      </div>
    </div>
  );
}

function Body({ data, now }: { data: PlatformOverview; now: number }) {
  const { totals: t, kpis: k } = data;
  const connTotal = t.connections.connected + t.connections.qrcode + t.connections.disconnected;
  return (
    <>
      <section aria-label="Situação da plataforma" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <LiveTile to="/empresas" label="Empresas ativas" value={t.activeCompanies} icon={Building2} tone="bg-primary" />
        <LiveTile to="/empresas" label="Empresas bloqueadas" value={t.blockedCompanies} icon={Building2} tone="bg-danger" alert={t.blockedCompanies > 0} />
        <LiveTile to="/empresas" label="Usuários cadastrados" value={t.users} icon={Users} tone="bg-brand-navy" />
        <LiveTile to="/empresas" label="Online agora" value={t.onlineUsers} icon={UserCheck} tone="bg-brand-green" />
        <LiveTile to="/empresas" label={`Conexões ativas de ${connTotal}`} value={t.connections.connected} icon={PlugZap} tone="bg-[#6250d6]" alert={t.connections.disconnected > 0} />
        <LiveTile to="/parceiros" label="Parceiros ativos" value={t.partners} icon={Handshake} tone="bg-warning" />
      </section>

      <section aria-label="Indicadores do período" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="Novas empresas" icon={Building2} value={nf.format(k.newCompanies.value)} delta={<Delta current={k.newCompanies.value} previous={k.newCompanies.previous} />} />
        <KpiCard label="Empresas com movimento" icon={Activity} tone="success" value={nf.format(k.activeCompaniesWithTraffic.value)} delta={<Delta current={k.activeCompaniesWithTraffic.value} previous={k.activeCompaniesWithTraffic.previous} />} footer={`de ${t.activeCompanies} ativas`} />
        <KpiCard label="Atendimentos criados" icon={Inbox} value={nf.format(k.ticketsCreated.value)} delta={<Delta current={k.ticketsCreated.value} previous={k.ticketsCreated.previous} />} />
        <KpiCard label="Atendimentos finalizados" icon={CheckCircle2} tone="success" value={nf.format(k.ticketsClosed.value)} delta={<Delta current={k.ticketsClosed.value} previous={k.ticketsClosed.previous} />} />
        <KpiCard label="Mensagens recebidas" icon={MessageCircle} value={nf.format(k.messagesIn.value)} delta={<Delta current={k.messagesIn.value} previous={k.messagesIn.previous} />} />
        <KpiCard label="Mensagens enviadas" icon={Send} tone="success" value={nf.format(k.messagesOut.value)} delta={<Delta current={k.messagesOut.value} previous={k.messagesOut.previous} />} footer="atendentes, bot e API" />
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Atendimentos por dia" description="Todas as empresas somadas">
          <ChartWithTable
            caption="Atendimentos criados por dia na plataforma"
            rows={data.timeline}
            columns={[{ header: "Dia", cell: (r) => formatDay(r.date) }, { header: "Atendimentos", align: "right", cell: (r) => nf.format(r.tickets) }]}
            chart={<LineAreaChart label="Atendimentos criados por dia na plataforma" data={data.timeline} series={[{ key: "tickets", label: "Atendimentos", color: SERIES.blue }]} />}
          />
        </Panel>
        <Panel title="Mensagens por dia" description="Recebidas e enviadas, todas as empresas">
          <ChartWithTable
            caption="Mensagens por dia na plataforma"
            rows={data.timeline}
            columns={[{ header: "Dia", cell: (r) => formatDay(r.date) }, { header: "Mensagens", align: "right", cell: (r) => nf.format(r.messages) }]}
            chart={<LineAreaChart label="Mensagens por dia na plataforma" data={data.timeline} series={[{ key: "messages", label: "Mensagens", color: SERIES.green }]} />}
          />
        </Panel>
      </div>

      <Panel title="Empresas" description="Ordenadas pelo volume de mensagens no período" bodyClassName="px-0 pb-0" actions={<Link to="/empresas" className="text-xs font-medium text-primary hover:underline">Gerenciar empresas</Link>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-y border-border bg-background/70 text-xs text-ink-muted">
              <tr>
                <th scope="col" className="py-2 pl-5 pr-3 font-medium">Empresa</th>
                <th scope="col" className="px-3 py-2 font-medium">Parceiro</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Usuários</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Conexões</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Atendimentos</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Mensagens</th>
                <th scope="col" className="py-2 pl-3 pr-5 font-medium">Última atividade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.companies.map((c) => {
                const idle = c.status === "active" && c.messages === 0;
                return (
                  <tr key={c.id} className="transition hover:bg-background/60">
                    <td className="py-2.5 pl-5 pr-3">
                      <span className="flex items-center gap-2">
                        <span className="font-medium text-ink">{c.name}</span>
                        {c.status === "blocked" && <Badge tone="danger">Bloqueada</Badge>}
                        {idle && <Badge tone="warning">Sem movimento</Badge>}
                      </span>
                      <span className="text-xs text-ink-muted">cliente desde {formatDay(c.createdAt.slice(0, 10))}</span>
                    </td>
                    <td className="px-3 py-2.5 text-ink-muted">{c.partner ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <span className="inline-flex items-center gap-1.5"><PresenceDot online={c.onlineUsers > 0} />{c.onlineUsers}/{c.users}</span>
                    </td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", c.connections > 0 && c.connectionsConnected < c.connections && "font-semibold text-warning")}>
                      {c.connectionsConnected}/{c.connections}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{nf.format(c.tickets)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{nf.format(c.messages)}</td>
                    <td className="py-2.5 pl-3 pr-5 text-ink-muted">{c.lastActivityAt ? timeAgo(c.lastActivityAt, now) : "sem mensagens"}</td>
                  </tr>
                );
              })}
              {data.companies.length === 0 && (
                <tr><td colSpan={7}><EmptyNote>Nenhuma empresa cadastrada.</EmptyNote></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Saúde das conexões" description="Números de WhatsApp de todas as empresas">
          <SplitBar
            parts={[
              { label: "Conectadas", value: t.connections.connected, color: SERIES.green },
              { label: "Aguardando QR code", value: t.connections.qrcode, color: SERIES.amber },
              { label: "Desconectadas", value: t.connections.disconnected, color: "#dc2626" },
            ]}
          />
        </Panel>
        <Panel title="Parceiros" description="Empresas trazidas e atendimentos no período">
          <BarList
            empty="Nenhum parceiro cadastrado"
            items={data.partners.map((p) => ({
              key: p.id,
              label: p.name,
              value: p.tickets,
              color: p.status === "active" ? SERIES.violet : SERIES.gray,
              hint: `${p.companies} ${p.companies === 1 ? "empresa" : "empresas"}${p.lastUsedAt ? ` · usado ${timeAgo(p.lastUsedAt, now)}` : ""}`,
            }))}
          />
        </Panel>
      </div>
    </>
  );
}
