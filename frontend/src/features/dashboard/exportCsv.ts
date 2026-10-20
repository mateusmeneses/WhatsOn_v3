import { formatDuration } from "@/lib/duration";
import type { DashboardData } from "./dashboardApi";

const cell = (v: string | number | null | undefined) => {
  const text = v === null || v === undefined ? "" : String(v);
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Planilha única, separada por ponto e vírgula (abre direto no Excel pt-BR), com um bloco por assunto. */
export function dashboardToCsv(d: DashboardData): string {
  const lines: (string | number | null)[][] = [];
  const block = (title: string, header: string[], rows: (string | number | null)[][]) => {
    lines.push([title], header, ...rows, []);
  };
  const k = d.kpis;
  block("Resumo do período", ["Indicador", "Período", "Período anterior"], [
    ["Atendimentos criados", k.ticketsCreated.value, k.ticketsCreated.previous],
    ["Atendimentos finalizados", k.ticketsClosed.value, k.ticketsClosed.previous],
    ["Mensagens recebidas", k.messagesIn.value, k.messagesIn.previous],
    ["Mensagens enviadas (atendentes)", k.messagesOut.value, k.messagesOut.previous],
    ["Mensagens do bot", k.messagesBot.value, k.messagesBot.previous],
    ["Tempo mediano de resposta", formatDuration(k.medianResponse.value), formatDuration(k.medianResponse.previous)],
    ["Tempo médio de resposta", formatDuration(k.avgResponse.value), formatDuration(k.avgResponse.previous)],
    ["Espera até aceitar", formatDuration(k.avgAcceptWait.value), formatDuration(k.avgAcceptWait.previous)],
    ["Tempo médio de resolução", formatDuration(k.avgResolution.value), formatDuration(k.avgResolution.previous)],
  ]);
  block("Por dia", ["Data", "Criados", "Finalizados", "Recebidas", "Enviadas", "Bot"], d.timeline.map((t) => [t.date, t.created, t.closed, t.inbound, t.outbound, t.bot]));
  block(
    "Equipe",
    ["Atendente", "Perfil", "Online", "Em atendimento", "Aceitos", "Finalizados", "Mensagens enviadas", "Resposta média", "Espera até aceitar"],
    d.agents.map((a) => [a.name, a.profile, a.online ? "sim" : "não", a.openNow, a.accepted, a.closed, a.messagesSent, formatDuration(a.avgResponse), formatDuration(a.avgAcceptWait)]),
  );
  block("Filas", ["Fila", "Criados", "Finalizados", "Aguardando agora", "Resolução média"], d.byQueue.map((q) => [q.name, q.created, q.closed, q.waiting, formatDuration(q.avgResolution)]));
  block("Clientes mais ativos", ["Cliente", "Número", "Atendimentos", "Recebidas", "Enviadas"], d.topContacts.map((c) => [c.name, c.number, c.tickets, c.inbound, c.outbound]));
  block("Respostas mais demoradas", ["Cliente", "Atendente", "Fila", "Cliente escreveu em", "Respondido em", "Demora"], d.slowestResponses.map((s) => [s.contactName, s.agentName, s.queueName, s.askedAt, s.answeredAt, formatDuration(s.seconds)]));
  return `﻿${lines.map((row) => row.map(cell).join(";")).join("\r\n")}`;
}

export function downloadCsv(data: DashboardData): void {
  const blob = new Blob([dashboardToCsv(data)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `whatson-dashboard-${data.range.from}_${data.range.to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
