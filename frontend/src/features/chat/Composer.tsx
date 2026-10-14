import { Paperclip, Send } from "lucide-react";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/apiError";
import type { StoredMedia } from "@/types/api";
import { uploadMedia } from "./messagesApi";

export function Composer({ onSend }: { onSend: (body: string, media: StoredMedia | null) => void }) {
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function submit(media: StoredMedia | null = null) {
    const body = text.trim();
    if (!body && !media) return;
    onSend(body, media);
    setText("");
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      submit(await uploadMedia(file));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-end gap-2 border-t border-border bg-surface p-3"
    >
      <input ref={fileRef} type="file" className="hidden" onChange={onFile} data-testid="file-input" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Anexar arquivo"
        loading={uploading}
        onClick={() => fileRef.current?.click()}
      >
        {!uploading && <Paperclip className="h-5 w-5" aria-hidden />}
      </Button>
      <Textarea
        aria-label="Mensagem"
        rows={1}
        value={text}
        placeholder="Digite uma mensagem…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        className="max-h-40 min-h-10 flex-1 resize-none"
      />
      <Button type="submit" size="icon" aria-label="Enviar" disabled={!text.trim()}>
        <Send className="h-4 w-4" aria-hidden />
      </Button>
    </form>
  );
}
