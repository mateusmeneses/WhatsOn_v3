import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useUserOptions } from "@/features/users/useUserOptions";
import { useRealtimeEvent } from "@/realtime/RealtimeProvider";
import { useAuth } from "@/stores/auth";
import type { Ticket, TicketStatus } from "@/types/api";
import { applyTicketUpdate } from "./ticketCache";
import { useLiveInvalidate } from "@/realtime/useLiveInvalidate";
import { fetchTicket, fetchTicketSummary, fetchTickets, ticketKeys } from "./ticketsApi";
import type { Viewer } from "./visibility";

const NO_QUEUES: number[] = [];

/**
 * Quem está vendo as listas. Para atendentes depende das filas e permissões vindas de /users/options:
 * até elas carregarem retorna null (sem filas não dá para saber se um ticket pendente é visível).
 */
export function useViewer(): Viewer | null {
  const user = useAuth((s) => s.user);
  const { data } = useUserOptions();
  const optionsLoaded = data !== undefined;
  const self = user ? data?.find((u) => u.id === user.id) : undefined;
  const queueIds = self?.queueIds || NO_QUEUES;
  // Admin sempre pode requerer; quem pode requerer vê todos os atendimentos (espelha o backend).
  const canClaimTickets = user?.profile === "admin" || (self?.canClaimTickets ?? false);
  const canViewBot = canClaimTickets || (self?.canViewBot ?? false);
  const canViewOtherQueues = canClaimTickets || (self?.canViewOtherQueues ?? false);
  const canViewOthersOpen = canClaimTickets || (self?.canViewOthersOpen ?? false);
  return useMemo(() => {
    if (!user) return null;
    if (user.profile === "agent" && !optionsLoaded) return null;
    return { userId: user.id, profile: user.profile, queueIds, canViewBot, canViewOtherQueues, canViewOthersOpen, canClaimTickets };
  }, [user, queueIds, optionsLoaded, canViewBot, canViewOtherQueues, canViewOthersOpen, canClaimTickets]);
}

export function useTicketList(status: TicketStatus, search: string, mine = false) {
  return useInfiniteQuery({
    queryKey: ticketKeys.list(status, search, mine),
    queryFn: ({ pageParam }) => (mine ? fetchTickets(status, search, pageParam, true) : fetchTickets(status, search, pageParam)),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length + 1 : undefined),
  });
}

export function useTicket(id: number | null) {
  return useQuery({
    queryKey: ticketKeys.detail(id ?? 0),
    queryFn: () => fetchTicket(id!),
    enabled: id !== null,
  });
}

export function useApplyTicket(): (ticket: Ticket) => void {
  const queryClient = useQueryClient();
  const viewer = useViewer();
  return useCallback(
    (ticket: Ticket) => {
      if (viewer) applyTicketUpdate(queryClient, ticket, viewer);
      else queryClient.setQueryData(ticketKeys.detail(ticket.id), ticket);
    },
    [queryClient, viewer],
  );
}

export function useTicketRealtime(): void {
  const applyTicket = useApplyTicket();
  useRealtimeEvent<Ticket>("ticket:update", applyTicket);
}

/** Contadores do menu e do título da aba (aguardando, meus, não lidas); atualizam com os eventos de ticket. */
export function useTicketSummary() {
  const query = useQuery({ queryKey: ticketKeys.summary, queryFn: fetchTicketSummary, refetchInterval: 60_000, staleTime: 15_000 });
  useLiveInvalidate(ticketKeys.summary, ["ticket:update"], 1500);
  return query.data;
}

/** Montado no AppShell: mantém as listas de tickets em cache atualizadas em qualquer rota. */
export function TicketRealtime(): null {
  useTicketRealtime();
  useTicketClaimedNotice();
  return null;
}

export interface TicketClaimedNotice {
  ticketId: number;
  contactName: string | null;
  by: { id: number; name: string };
  note: string | null;
}

/** Aviso para o técnico que teve um atendimento requerido por outro, com o recado interno. */
export function useTicketClaimedNotice(): void {
  useRealtimeEvent<TicketClaimedNotice>("ticket:claimed", (n) => {
    const who = n.contactName ? `O atendimento de ${n.contactName}` : "Um atendimento seu";
    toast.warning(`${who} foi requerido por ${n.by.name}`, {
      description: n.note ? `Recado: ${n.note}` : undefined,
      duration: 20_000,
    });
  });
}
