import { Mic, Paperclip, PenLine, Send, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/apiError";
import type { StoredMedia } from "@/types/api";
import { uploadMedia } from "./messagesApi";
import { cn } from "@/lib/cn";
import { audioRecordingSupported, useAudioRecorder } from "./useAudioRecorder";

function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function Composer({
  onSend,
  signature,
}: {
  onSend: (body: string, media: StoredMedia | null) => void;
  /** Só para administradores: liga/desliga a assinatura "*Nome:*" nas mensagens. */
  signature?: { enabled: boolean; onToggle: () => void };
}) {
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pasted, setPasted] = useState<{ file: File; url: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorder = useAudioRecorder();

  useEffect(() => () => {
    if (pasted) URL.revokeObjectURL(pasted.url);
  }, [pasted]);

  function submit(media: StoredMedia | null = null) {
    const body = text.trim();
    if (!body && !media) return;
    onSend(body, media);
    setText("");
  }

  /** Imagem ou vídeo colado (Ctrl+V): fica em pré-visualização; o texto digitado vira a legenda. */
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const file = Array.from(event.clipboardData.files).find((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (!file) return;
    event.preventDefault();
    setPasted({ file, url: URL.createObjectURL(file) });
  }

  async function sendPasted() {
    if (!pasted) return;
    const { file } = pasted;
    setUploading(true);
    try {
      const media = await uploadMedia(file);
      onSend(text.trim(), media);
      setText("");
      setPasted(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  function send() {
    if (pasted) void sendPasted();
    else submit();
  }

  async function upload(file: File, send: (media: StoredMedia) => void) {
    setUploading(true);
    try {
      send(await uploadMedia(file));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await upload(file, (media) => submit(media));
  }

  async function startRecording() {
    try {
      await recorder.start();
    } catch {
      toast.error("Não foi possível acessar o microfone. Verifique a permissão do navegador.");
    }
  }

  async function sendRecording() {
    const file = await recorder.stop();
    if (file) await upload(file, (media) => onSend("", media));
  }

  if (recorder.recording) {
    return (
      <div className="flex items-center gap-2 border-t border-border bg-surface p-3">
        <Button type="button" variant="ghost" size="icon" aria-label="Descartar áudio" onClick={recorder.cancel}>
          <Trash2 className="h-5 w-5 text-danger" aria-hidden />
        </Button>
        <div className="flex flex-1 items-center gap-2 text-sm text-ink" role="status">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" aria-hidden />
          Gravando áudio… <span className="tabular-nums">{formatDuration(recorder.seconds)}</span>
        </div>
        <Button type="button" size="icon" aria-label="Enviar áudio" onClick={() => void sendRecording()}>
          <Send className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    );
  }

  const showMic = !text.trim() && !pasted && audioRecordingSupported();

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        send();
      }}
      className="flex flex-wrap items-end gap-2 border-t border-border bg-surface p-3"
    >
      {pasted && (
        <div className="relative w-full">
          {pasted.file.type.startsWith("video/") ? (
            <video src={pasted.url} controls className="max-h-48 rounded-lg" data-testid="paste-preview" />
          ) : (
            <img src={pasted.url} alt="Pré-visualização" className="max-h-48 rounded-lg object-contain" data-testid="paste-preview" />
          )}
          <button
            type="button"
            aria-label="Remover anexo"
            disabled={uploading}
            className="absolute left-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
            onClick={() => setPasted(null)}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
      <input ref={fileRef} type="file" className="hidden" onChange={onFile} data-testid="file-input" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Anexar arquivo"
        loading={uploading}
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
      >
        {!uploading && <Paperclip className="h-5 w-5" aria-hidden />}
      </Button>
      {signature && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Assinar mensagens"
          aria-pressed={signature.enabled}
          title={signature.enabled ? "Mensagens saem assinadas com seu nome" : "Mensagens saem sem assinatura"}
          onClick={signature.onToggle}
        >
          <PenLine className={cn("h-5 w-5", signature.enabled ? "text-primary" : "text-ink-muted")} aria-hidden />
        </Button>
      )}
      <Textarea
        aria-label="Mensagem"
        disabled={uploading}
        rows={1}
        value={text}
        placeholder="Digite uma mensagem…"
        onChange={(e) => setText(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        className="max-h-40 min-h-10 flex-1 resize-none"
      />
      {showMic ? (
        <Button type="button" size="icon" aria-label="Gravar áudio" disabled={uploading} onClick={() => void startRecording()}>
          <Mic className="h-4 w-4" aria-hidden />
        </Button>
      ) : (
        <Button type="submit" size="icon" aria-label="Enviar" disabled={uploading || (!text.trim() && !pasted)}>
          <Send className="h-4 w-4" aria-hidden />
        </Button>
      )}
    </form>
  );
}
