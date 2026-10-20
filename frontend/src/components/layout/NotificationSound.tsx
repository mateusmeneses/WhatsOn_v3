import { useEffect, useRef } from "react";
import { useTicketSummary } from "@/features/tickets/useTickets";
import { playChime, useSoundEnabled } from "@/lib/notifySound";

/** Toca um aviso quando sobe o número de aguardando ou de mensagens não lidas (se o usuário ligou o som). */
export function NotificationSound(): null {
  const enabled = useSoundEnabled();
  const summary = useTicketSummary();
  const previous = useRef<{ pending: number; unread: number } | null>(null);

  useEffect(() => {
    if (!summary) return;
    const before = previous.current;
    previous.current = { pending: summary.pending, unread: summary.unread };
    if (enabled && before && (summary.pending > before.pending || summary.unread > before.unread)) playChime();
  }, [summary, enabled]);

  return null;
}
