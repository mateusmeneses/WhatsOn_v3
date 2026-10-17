import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useUserOptions } from "@/features/users/useUserOptions";
import { useRealtimeEvent } from "@/realtime/RealtimeProvider";
import { useAuth } from "@/stores/auth";
import type { Ticket, TicketStatus } from "@/types/api";
import { applyTicketUpdate } from "./ticketCache";
import { fetchTicket, fetchTickets, ticketKeys } from "./ticketsApi";
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
  const canViewBot = self?.canViewBot ?? false;
  const canViewOtherQueues = self?.canViewOtherQueues ?? false;
  const canViewOthersOpen = self?.canViewOthersOpen ?? false;
  return useMemo(() => {
    if (!user) return null;
    if (user.profile === "agent" && !optionsLoaded) return null;
    return { userId: user.id, profile: user.profile, queueIds, canViewBot, canViewOtherQueues, canViewOthersOpen };
  }, [user, queueIds, optionsLoaded, canViewBot, canViewOtherQueues, canViewOthersOpen]);
}

export function useTicketList(status: TicketStatus, search: string) {
  return useInfiniteQuery({
    queryKey: ticketKeys.list(status, search),
    queryFn: ({ pageParam }) => fetchTickets(status, search, pageParam),
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

/** Montado no AppShell: mantém as listas de tickets em cache atualizadas em qualquer rota. */
export function TicketRealtime(): null {
  useTicketRealtime();
  return null;
}
