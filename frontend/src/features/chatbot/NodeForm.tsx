import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Paperclip, X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { uploadMedia } from "@/features/chat/messagesApi";
import { useQueues } from "@/features/queues/useQueues";
import { useUserOptions } from "@/features/users/useUserOptions";
import { errorMessage } from "@/lib/apiError";
import type { BotAction, ChatbotNode, StoredMedia } from "@/types/api";
import { chatbotKeys, createNode, updateNode } from "./chatbotApi";
import { ACTION_LABELS } from "./tree";

export type NodeFormTarget = { mode: "edit"; node: ChatbotNode } | { mode: "create"; parent: ChatbotNode; suggestedKey: string };

export function NodeForm({
  connectionId,
  target,
  siblings,
  onDone,
}: {
  connectionId: number;
  target: NodeFormTarget;
  siblings: ChatbotNode[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const queues = useQueues();
  const users = useUserOptions();
  const editing = target.mode === "edit" ? target.node : null;
  const isRoot = editing?.parentId === null;
  const fileRef = useRef<HTMLInputElement>(null);

  const [key, setKey] = useState(editing?.key ?? (target.mode === "create" ? target.suggestedKey : ""));
  const [title, setTitle] = useState(editing?.title ?? "");
  const [action, setAction] = useState<BotAction>(editing?.action ?? "reply");
  const [message, setMessage] = useState(editing?.message ?? "");
  const [media, setMedia] = useState<StoredMedia | null>(
    editing?.mediaUrl ? { url: editing.mediaUrl, mime: editing.mediaMime ?? "application/octet-stream", name: editing.mediaName } : null,
  );
  const [queueId, setQueueId] = useState(editing?.queueId ? String(editing.queueId) : "");
  const [userId, setUserId] = useState(editing?.userId ? String(editing.userId) : "");
  const [uploading, setUploading] = useState(false);

  const keyTaken = siblings.some((s) => s.key === key && s.id !== editing?.id);
  const problem = isRoot
    ? null
    : !/^[1-9]\d?$/.test(key)
      ? "O número deve ir de 1 a 99."
      : keyTaken
        ? "Já existe uma opção com este número neste menu."
        : !title.trim()
          ? "Informe o título da opção."
          : action === "transfer_queue" && !queueId
            ? "Selecione a fila de destino."
            : action === "transfer_agent" && !userId
              ? "Selecione o atendente."
              : null;

  const mutation = useMutation({
    mutationFn: () => {
      if (isRoot) return updateNode(editing!.id, { message });
      const input = {
        key,
        title: title.trim(),
        action,
        message,
        mediaUrl: action === "reply" ? (media?.url ?? null) : null,
        mediaMime: action === "reply" ? (media?.mime ?? null) : null,
        mediaName: action === "reply" ? (media?.name ?? null) : null,
        queueId: action === "transfer_queue" || action === "transfer_agent" ? (queueId ? Number(queueId) : null) : null,
        userId: action === "transfer_agent" ? Number(userId) : null,
      };
      return editing ? updateNode(editing.id, input) : createNode(connectionId, { parentId: target.mode === "create" ? target.parent.id : null, ...input });
    },
    onSuccess: () => {
      toast.success("Chatbot atualizado");
      void queryClient.invalidateQueries({ queryKey: chatbotKeys.nodes(connectionId) });
      onDone();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  async function onFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      setMedia(await uploadMedia(file));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      aria-label="Opção do chatbot"
      className="space-y-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <h2 className="font-semibold">
        {isRoot ? "Mensagem de boas-vindas" : editing ? `Editar "${editing.title}"` : `Nova opção em "${target.mode === "create" ? target.parent.title : ""}"`}
      </h2>
      {!isRoot && (
        <>
          <div className="grid grid-cols-[96px_1fr] gap-3">
            <div>
              <Label htmlFor="node-key">Número</Label>
              <Input id="node-key" inputMode="numeric" value={key} onChange={(e) => setKey(e.target.value.trim())} />
            </div>
            <div>
              <Label htmlFor="node-title">Título</Label>
              <Input id="node-title" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="node-action">Ação</Label>
            <Select id="node-action" value={action} onChange={(e) => setAction(e.target.value as BotAction)}>
              {(Object.keys(ACTION_LABELS) as BotAction[]).map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABELS[a]}
                </option>
              ))}
            </Select>
          </div>
        </>
      )}
      <div>
        <Label htmlFor="node-message">{isRoot ? "Texto de boas-vindas" : "Mensagem"}</Label>
        <Textarea id="node-message" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
        <p className="mt-1 text-xs text-ink-muted">
          {isRoot || action === "submenu"
            ? "As opções do menu são listadas automaticamente abaixo deste texto."
            : action === "reply"
              ? "Enviada ao cliente; em seguida o menu atual é repetido."
              : "Opcional. Se vazio, usa a mensagem padrão da conexão."}
        </p>
      </div>
      {!isRoot && action === "reply" && (
        <div>
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          {media ? (
            <p className="flex items-center gap-2 text-sm">
              <Paperclip className="h-4 w-4" aria-hidden /> {media.name ?? "Arquivo anexado"}
              <button type="button" aria-label="Remover anexo" onClick={() => setMedia(null)}>
                <X className="h-4 w-4" aria-hidden />
              </button>
            </p>
          ) : (
            <Button variant="secondary" size="sm" loading={uploading} onClick={() => fileRef.current?.click()}>
              <Paperclip className="h-4 w-4" aria-hidden /> Anexar arquivo
            </Button>
          )}
        </div>
      )}
      {!isRoot && (action === "transfer_queue" || action === "transfer_agent") && (
        <div>
          <Label htmlFor="node-queue">Fila</Label>
          <Select id="node-queue" value={queueId} onChange={(e) => setQueueId(e.target.value)}>
            <option value="">{action === "transfer_agent" ? "Manter a fila atual" : "Selecione…"}</option>
            {queues.data?.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      {!isRoot && action === "transfer_agent" && (
        <div>
          <Label htmlFor="node-user">Atendente</Label>
          <Select id="node-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Selecione…</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      {problem && <p className="text-sm text-danger">{problem}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" loading={mutation.isPending} disabled={Boolean(problem) || uploading}>
          Salvar
        </Button>
      </div>
    </form>
  );
}
