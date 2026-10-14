import { useMutation } from "@tanstack/react-query";
import { RotateCcw, Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQueues } from "@/features/queues/useQueues";
import { useUserOptions } from "@/features/users/useUserOptions";
import { errorMessage } from "@/lib/apiError";
import { cn } from "@/lib/cn";
import type { BotEffect, BotState } from "@/types/api";
import { simulate } from "./chatbotApi";

interface Entry {
  from: "customer" | "bot" | "system";
  text: string;
}

const INITIAL: BotState = { nodeId: null, attempts: 0 };

export function Simulator({ connectionId }: { connectionId: number }) {
  const queues = useQueues();
  const users = useUserOptions();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [state, setState] = useState<BotState>(INITIAL);
  const [finished, setFinished] = useState(false);
  const [input, setInput] = useState("");

  const describe = (effect: BotEffect): Entry => {
    switch (effect.type) {
      case "send_text":
        return { from: "bot", text: effect.text };
      case "send_media":
        return { from: "bot", text: `📎 ${effect.media.name ?? "arquivo"}${effect.caption ? `\n${effect.caption}` : ""}` };
      case "transfer": {
        if (effect.userId !== null) {
          const user = users.data?.find((u) => u.id === effect.userId);
          return { from: "system", text: `Transferido para o atendente ${user?.name ?? effect.userId}` };
        }
        const queue = queues.data?.find((q) => q.id === effect.queueId);
        return { from: "system", text: queue ? `Transferido para a fila ${queue.name}` : "Transferido para a fila padrão" };
      }
      case "close":
        return { from: "system", text: "Conversa encerrada" };
    }
  };

  const mutation = useMutation({
    mutationFn: (text: string) => simulate(connectionId, state, text),
    onSuccess: (result) => {
      setEntries((list) => [...list, ...result.effects.map(describe)]);
      setState(result.state);
      setFinished(result.finished);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || finished) return;
    setEntries((list) => [...list, { from: "customer", text }]);
    setInput("");
    mutation.mutate(text);
  }

  function reset() {
    setEntries([]);
    setState(INITIAL);
    setFinished(false);
  }

  return (
    <section aria-label="Simulador" className="flex h-[480px] flex-col rounded-xl border border-border bg-surface">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="font-semibold">Simulador</p>
          <p className="text-xs text-ink-muted">Teste o menu sem enviar nada pelo WhatsApp.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={reset}>
          <RotateCcw className="h-4 w-4" aria-hidden /> Reiniciar
        </Button>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto bg-background p-4">
        {entries.length === 0 && <p className="text-center text-sm text-ink-muted">Envie qualquer mensagem para começar.</p>}
        {entries.map((entry, index) =>
          entry.from === "system" ? (
            <p key={index} className="text-center text-xs font-medium text-ink-muted">
              {entry.text}
            </p>
          ) : (
            <div key={index} className={cn("flex", entry.from === "customer" ? "justify-start" : "justify-end")}>
              <p
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm",
                  entry.from === "customer" ? "border border-border bg-surface" : "bg-primary text-white",
                )}
              >
                {entry.text}
              </p>
            </div>
          ),
        )}
      </div>
      <form onSubmit={onSubmit} className="flex gap-2 border-t border-border p-3">
        <Input
          aria-label="Mensagem do cliente"
          placeholder={finished ? "Conversa finalizada — reinicie para testar de novo" : "Digite como se fosse o cliente"}
          value={input}
          disabled={finished}
          onChange={(e) => setInput(e.target.value)}
        />
        <Button type="submit" size="icon" aria-label="Enviar" disabled={finished || !input.trim()} loading={mutation.isPending}>
          <Send className="h-4 w-4" aria-hidden />
        </Button>
      </form>
    </section>
  );
}
