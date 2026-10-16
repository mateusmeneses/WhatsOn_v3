import { AlertCircle, Ban, Bot, Check, CheckCheck, Clock, FileText, MapPin, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { formatTime, mediaSrc } from "@/lib/format";
import type { Ack } from "@/types/api";
import { canDeleteMessage, canEditMessage, type ChatMessage } from "./messageCache";

const ACK_LABEL: Record<Ack, string> = {
  pending: "Enviando",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Falhou",
};

function AckIcon({ ack }: { ack: Ack }) {
  const props = { className: "h-3.5 w-3.5", "aria-label": ACK_LABEL[ack], role: "img" };
  if (ack === "pending") return <Clock {...props} />;
  if (ack === "sent") return <Check {...props} />;
  if (ack === "failed") return <AlertCircle {...props} className="h-3.5 w-3.5 text-red-200" />;
  return <CheckCheck {...props} className={cn("h-3.5 w-3.5", ack === "read" && "text-sky-200")} />;
}

function MediaContent({ message }: { message: ChatMessage }) {
  if (!message.mediaUrl) {
    if (message.type === "location") {
      return (
        <a
          className="inline-flex items-center gap-1 underline"
          href={`https://maps.google.com/?q=${encodeURIComponent(message.body)}`}
          target="_blank"
          rel="noreferrer"
        >
          <MapPin className="h-4 w-4" aria-hidden /> Ver localização
        </a>
      );
    }
    return null;
  }
  const src = mediaSrc(message.mediaUrl);
  switch (message.type) {
    case "image":
    case "sticker":
      return <img src={src} alt={message.mediaName ?? "Imagem"} className="max-h-72 rounded-lg object-contain" />;
    case "audio":
      return <audio controls src={src} className="max-w-full" />;
    case "video":
      return <video controls src={src} className="max-h-72 rounded-lg" />;
    default:
      return (
        <a href={src} download={message.mediaName ?? undefined} className="inline-flex items-center gap-2 underline">
          <FileText className="h-4 w-4" aria-hidden /> {message.mediaName ?? "Documento"}
        </a>
      );
  }
}

export interface MessageActions {
  onEdit: (message: ChatMessage, body: string) => Promise<unknown>;
  onDelete: (message: ChatMessage) => void;
}

function EditForm({ message, onSave, onCancel }: { message: ChatMessage; onSave: (body: string) => Promise<unknown>; onCancel: () => void }) {
  const [text, setText] = useState(message.body);
  const [saving, setSaving] = useState(false);
  const body = text.trim();
  const changed = Boolean(body) && body !== message.body;

  async function save() {
    if (!changed) return onCancel();
    setSaving(true);
    try {
      await onSave(body);
      onCancel();
    } catch {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <Textarea
        aria-label="Editar mensagem"
        autoFocus
        rows={2}
        value={text}
        disabled={saving}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void save();
          }
        }}
        className="min-w-60 resize-none bg-surface text-ink"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={saving} onClick={onCancel}>
          Cancelar
        </Button>
        <Button size="sm" variant="secondary" loading={saving} disabled={!changed} onClick={() => void save()}>
          Salvar
        </Button>
      </div>
    </div>
  );
}

export function MessageBubble({
  message,
  onRetry,
  actions,
}: {
  message: ChatMessage;
  onRetry: (message: ChatMessage) => void;
  actions?: MessageActions;
}) {
  const [editing, setEditing] = useState(false);
  const out = message.fromMe;
  const deleted = Boolean(message.deletedAt);
  const canEdit = Boolean(actions) && canEditMessage(message);
  const canDelete = Boolean(actions) && canDeleteMessage(message);
  const showBody = message.body && message.type !== "location" && !(message.type === "document" && message.body === message.mediaName);
  return (
    <div className={cn("group flex items-center gap-1", out ? "justify-end" : "justify-start")}>
      {(canEdit || canDelete) && !editing && (
        <div className="flex opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          {canEdit && (
            <button
              type="button"
              aria-label="Editar mensagem"
              className="rounded-md p-1 text-ink-muted hover:bg-primary-soft hover:text-ink"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-4 w-4" aria-hidden />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              aria-label="Apagar mensagem"
              className="rounded-md p-1 text-ink-muted hover:bg-primary-soft hover:text-danger"
              onClick={() => actions!.onDelete(message)}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      )}
      <div
        className={cn(
          "max-w-[75%] space-y-1 rounded-2xl px-3 py-2 text-sm shadow-sm",
          out ? "rounded-br-sm bg-primary text-white" : "rounded-bl-sm border border-border bg-surface text-ink",
        )}
      >
        {message.isBot && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold opacity-80">
            <Bot className="h-3 w-3" aria-hidden /> Bot
          </span>
        )}
        {deleted ? (
          <p className="inline-flex items-center gap-1 italic opacity-80">
            <Ban className="h-4 w-4" aria-hidden /> {out ? "Você apagou esta mensagem" : "Mensagem apagada"}
          </p>
        ) : editing && actions ? (
          <EditForm message={message} onSave={(body) => actions.onEdit(message, body)} onCancel={() => setEditing(false)} />
        ) : (
          <>
            <MediaContent message={message} />
            {showBody && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
          </>
        )}
        <div className={cn("flex items-center justify-end gap-1 text-[11px]", out ? "text-white/70" : "text-ink-muted")}>
          {message.editedAt && !deleted && <span>editada</span>}
          <span>{formatTime(message.createdAt)}</span>
          {out && !deleted && <AckIcon ack={message.ack} />}
        </div>
        {out && message.ack === "failed" && !deleted && (
          <div className="flex items-center justify-end gap-2 text-xs">
            <span className="font-semibold">Não enviada</span>
            <button type="button" className="underline" onClick={() => onRetry(message)}>
              Tentar novamente
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
