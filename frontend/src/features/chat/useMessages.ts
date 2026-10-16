import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/lib/apiError";
import { useRealtimeEvent } from "@/realtime/RealtimeProvider";
import type { Message, Page, StoredMedia, Ticket } from "@/types/api";
import { useLocalMessages } from "./localMessages";
import { removeMessage, upsertMessage, type ChatMessage, type MessagePages } from "./messageCache";
import { deleteMessage, editMessage, fetchMessages, messageKeys, resendMessage, sendMessage } from "./messagesApi";

export function useMessages(ticketId: number) {
  return useInfiniteQuery<Page<ChatMessage>, Error, MessagePages, ReturnType<typeof messageKeys.ticket>, number | undefined>({
    queryKey: messageKeys.ticket(ticketId),
    queryFn: ({ pageParam }) => fetchMessages(ticketId, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.items[0]?.id : undefined),
  });
}

function useUpdateMessages(ticketId: number) {
  const queryClient = useQueryClient();
  return (update: (data: MessagePages) => MessagePages) =>
    queryClient.setQueryData<MessagePages>(messageKeys.ticket(ticketId), (data) => (data ? update(data) : data));
}

export function useMessageRealtime(ticketId: number): void {
  const update = useUpdateMessages(ticketId);
  const upsert = (message: Message) => {
    if (message.ticketId === ticketId) update((data) => upsertMessage(data, message));
  };
  useRealtimeEvent<Message>("message:new", upsert);
  useRealtimeEvent<Message>("message:update", upsert);
  useRealtimeEvent<{ id: number; ticketId: number }>("message:delete", (payload) => {
    if (payload.ticketId === ticketId) update((data) => removeMessage(data, (m) => m.id === payload.id));
  });
}

export interface SendVariables {
  temp: ChatMessage;
  body: string;
  media: StoredMedia | null;
}

export function useSendMessage(ticket: Ticket) {
  const update = useUpdateMessages(ticket.id);
  const local = useLocalMessages.getState;
  return useMutation({
    mutationFn: ({ body, media }: SendVariables) =>
      sendMessage(ticket.id, { ...(body ? { body } : {}), ...(media ? { media } : {}) }),
    onMutate: ({ temp }) => local().add(ticket.id, temp),
    onSuccess: (message, { temp }) => {
      local().remove(ticket.id, temp.tempId!);
      update((data) => upsertMessage(removeMessage(data, (m) => m.tempId === temp.tempId), message));
    },
    onError: (err, { temp }) => {
      local().update(ticket.id, temp.tempId!, { ack: "failed", localFailed: true });
      toast.error(errorMessage(err));
    },
  });
}

export function useResendMessage(ticketId: number) {
  const update = useUpdateMessages(ticketId);
  return useMutation({
    mutationFn: (id: number) => resendMessage(id),
    onSuccess: (message) => update((data) => upsertMessage(data, message)),
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useEditMessage(ticketId: number) {
  const update = useUpdateMessages(ticketId);
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) => editMessage(id, body),
    onSuccess: (message) => update((data) => upsertMessage(data, message)),
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useDeleteMessage(ticketId: number) {
  const update = useUpdateMessages(ticketId);
  return useMutation({
    mutationFn: (id: number) => deleteMessage(id),
    onSuccess: (message) => update((data) => upsertMessage(data, message)),
    onError: (err) => toast.error(errorMessage(err)),
  });
}
