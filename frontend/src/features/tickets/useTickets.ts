import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useUserOptions } from "@/features/users/usersApi";
import { useRealtimeEvent } from "@/realtime/RealtimeProvider";
import { useAuth } from "@/stores/auth";
import type { Ticket, TicketStatus } from "@/types/api";
import { applyTicketUpdate } from "./ticketCache";
import { fetchTicket, fetchTickets, ticketKeys } from "./ticketsApi";
import type { Viewer } from "./visibility";

const NO_QUEUES: number[] = [];

export function useViewer(): Viewer | null {
  const user = useAuth((s) => s.user);
  const { data } = useUserOptions();
  const queueIds = (user && data?.find((u) => u.id === user.id)?.queueIds) || NO_QUEUES;
  return useMemo(
    () => (user ? { userId: user.id, profile: user.profile, queueIds } : null),
    [user, queueIds],
  );
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
