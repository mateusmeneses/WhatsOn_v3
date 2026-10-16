import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { markTicketRead } from "@/features/tickets/ticketsApi";
import { useApplyTicket, useTicket } from "@/features/tickets/useTickets";
import { errorMessage } from "@/lib/apiError";
import { useTicketRoom } from "@/realtime/RealtimeProvider";
import { useAuth } from "@/stores/auth";
import type { PublicUser, StoredMedia, Ticket } from "@/types/api";
import { TicketActions } from "@/features/tickets/TicketActions";
import { ChatHeader } from "./ChatHeader";
import { Composer } from "./Composer";
import { useTicketLocalMessages } from "./localMessages";
import type { MessageActions } from "./MessageBubble";
import { MessageList } from "./MessageList";
import { createTempMessage, flattenMessages, type ChatMessage } from "./messageCache";
import {
  useDeleteMessage,
  useEditMessage,
  useMessageRealtime,
  useMessages,
  useResendMessage,
  useSendMessage,
} from "./useMessages";

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
  const edit = useEditMessage(ticket.id);
  const remove = useDeleteMessage(ticket.id);
  const localMessages = useTicketLocalMessages(ticket.id);
  const messages = useMemo(() => {
    const server = flattenMessages(messagesQuery.data);
    const ids = new Set(server.map((m) => m.id));
    return [...server, ...localMessages.filter((m) => !ids.has(m.id))];
  }, [messagesQuery.data, localMessages]);
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

  const actions: MessageActions | undefined = canReply
    ? {
        onEdit: (message, body) => edit.mutateAsync({ id: message.id, body }),
        onDelete: (message) => {
          if (window.confirm("Apagar esta mensagem para todos?")) remove.mutate(message.id);
        },
      }
    : undefined;

  const hint = readOnlyHint(ticket, user);

  return (
    <div className="flex h-full flex-col">
      <ChatHeader ticket={ticket} actions={<TicketActions ticket={ticket} />} />
      {messagesQuery.isLoading && messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center bg-background">
          <Spinner />
        </div>
      ) : messagesQuery.isError && messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-background p-6 text-center">
          <p className="text-sm text-danger">{errorMessage(messagesQuery.error)}</p>
          <Button variant="secondary" size="sm" loading={messagesQuery.isFetching} onClick={() => void messagesQuery.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <MessageList
          messages={messages}
          hasOlder={Boolean(messagesQuery.hasNextPage)}
          loadingOlder={messagesQuery.isFetchingNextPage}
          onLoadOlder={() => void messagesQuery.fetchNextPage()}
          onRetry={onRetry}
          actions={actions}
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
