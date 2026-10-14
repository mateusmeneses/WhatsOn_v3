import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { MessageBubble } from "./MessageBubble";
import type { ChatMessage } from "./messageCache";

export function MessageList({
  messages,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onRetry,
}: {
  messages: ChatMessage[];
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onRetry: (message: ChatMessage) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const last = messages.at(-1);
  const lastKey = last ? (last.tempId ?? last.id) : null;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastKey]);

  return (
    <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-background px-6 py-4" aria-live="polite">
      {hasOlder && (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" loading={loadingOlder} onClick={onLoadOlder}>
            Carregar mensagens anteriores
          </Button>
        </div>
      )}
      {messages.map((message) => (
        <MessageBubble key={message.tempId ?? message.id} message={message} onRetry={onRetry} />
      ))}
    </div>
  );
}
