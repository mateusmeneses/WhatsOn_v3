import { useEffect } from "react";
import { Spinner } from "@/components/ui/spinner";
import { markTicketRead } from "@/features/tickets/ticketsApi";
import { useApplyTicket, useTicket } from "@/features/tickets/useTickets";
import { errorMessage } from "@/lib/apiError";
import { useTicketRoom } from "@/realtime/RealtimeProvider";
import { useAuth } from "@/stores/auth";
import type { PublicUser, StoredMedia, Ticket } from "@/types/api";
import { ChatHeader } from "./ChatHeader";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { createTempMessage, flattenMessages, type ChatMessage } from "./messageCache";
import { useMessageRealtime, useMessages, useResendMessage, useSendMessage } from "./useMessages";

function readOnlyHint(ticket: Ticket, user: PublicUser): string {
  if (ticket.status === "pending") return "Aceite o atendimento para responder.";
  if (ticket.status === "bot") return "O chatbot está conduzindo esta conversa.";
  if (ticket.status === "closed") return "Atendimento finalizado.";
  return ticket.userId === user.id ? "" : "Este atendimento está com outro atendente.";
}

export function ChatPanel({ ticketId }: { ticketId: number }) {
  const ticketQuery = useTicket(ticketId);
  useTicketRoom(ticketId);
  useMessageRealtime(ticketId);

  if (ticketQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  if (ticketQuery.isError || !ticketQuery.data) {
    return <p className="p-6 text-sm text-danger">{errorMessage(ticketQuery.error, "Atendimento não encontrado.")}</p>;
  }
  return <ChatView ticket={ticketQuery.data} />;
}

function ChatView({ ticket }: { ticket: Ticket }) {
  const user = useAuth((s) => s.user)!;
  const applyTicket = useApplyTicket();
  const messagesQuery = useMessages(ticket.id);
  const send = useSendMessage(ticket);
  const resend = useResendMessage(ticket.id);
  const messages = flattenMessages(messagesQuery.data);
  const canReply = ticket.status === "open" && (user.profile !== "agent" || ticket.userId === user.id);

  useEffect(() => {
    if (ticket.unreadCount > 0) {
      markTicketRead(ticket.id).then(applyTicket, () => undefined);
    }
  }, [ticket.id, ticket.unreadCount, applyTicket]);

  function onSend(body: string, media: StoredMedia | null) {
    send.mutate({ temp: createTempMessage(ticket, body, media, user.id), body, media });
  }

  function onRetry(message: ChatMessage) {
    if (message.localFailed && message.tempId) {
      const media = message.mediaUrl
        ? { url: message.mediaUrl, mime: message.mediaMime ?? "application/octet-stream", name: message.mediaName }
        : null;
      send.mutate({ temp: { ...message, ack: "pending", localFailed: false }, body: message.body, media });
    } else {
      resend.mutate(message.id);
    }
  }

  const hint = readOnlyHint(ticket, user);

  return (
    <div className="flex h-full flex-col">
      <ChatHeader ticket={ticket} />
      {messagesQuery.isLoading ? (
        <div className="flex flex-1 items-center justify-center bg-background">
          <Spinner />
        </div>
      ) : (
        <MessageList
          messages={messages}
          hasOlder={Boolean(messagesQuery.hasNextPage)}
          loadingOlder={messagesQuery.isFetchingNextPage}
          onLoadOlder={() => void messagesQuery.fetchNextPage()}
          onRetry={onRetry}
        />
      )}
      {canReply ? (
        <Composer onSend={onSend} />
      ) : (
        <div className="border-t border-border bg-surface p-4 text-center text-sm text-ink-muted">{hint}</div>
      )}
    </div>
  );
}
