import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useConnections } from "@/features/connections/useConnections";
import { errorMessage } from "@/lib/apiError";
import { chatbotKeys, createNode, deleteNode, fetchNodes, reorderChildren } from "./chatbotApi";
import { NodeForm, type NodeFormTarget } from "./NodeForm";
import { NodeTree } from "./NodeTree";
import { Simulator } from "./Simulator";
import { buildTree, nextFreeKey } from "./tree";

const WELCOME = "Olá! Escolha uma opção:";

export function ChatbotPage() {
  const queryClient = useQueryClient();
  const connections = useConnections();
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [target, setTarget] = useState<NodeFormTarget | null>(null);

  useEffect(() => {
    if (connectionId === null && connections.data?.length) setConnectionId(connections.data[0]!.id);
  }, [connections.data, connectionId]);

  const nodes = useQuery({
    queryKey: chatbotKeys.nodes(connectionId ?? 0),
    queryFn: () => fetchNodes(connectionId!),
    enabled: connectionId !== null,
  });
  const tree = nodes.data ? buildTree(nodes.data) : null;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: chatbotKeys.nodes(connectionId ?? 0) });
  const onError = (err: unknown) => toast.error(errorMessage(err));

  const createRoot = useMutation({
    mutationFn: () => createNode(connectionId!, { parentId: null, message: WELCOME }),
    onSuccess: refresh,
    onError,
  });
  const reorder = useMutation({
    mutationFn: ({ parentId, ids }: { parentId: number; ids: number[] }) => reorderChildren(parentId, ids),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteNode(id),
    onSuccess: () => {
      setTarget(null);
      refresh();
    },
    onError,
  });

  const all = nodes.data ?? [];
  const childrenOf = (id: number) => all.filter((n) => n.parentId === id);
  const siblings =
    target?.mode === "create"
      ? childrenOf(target.parent.id)
      : target?.mode === "edit" && target.node.parentId !== null
        ? childrenOf(target.node.parentId)
        : [];

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Chatbot"
        description="Menu numérico que recebe o cliente e o encaminha para a fila certa."
        actions={
          <div className="w-56">
            <Label htmlFor="bot-connection" className="sr-only">
              Conexão
            </Label>
            <Select
              id="bot-connection"
              value={connectionId ?? ""}
              onChange={(e) => {
                setConnectionId(Number(e.target.value));
                setTarget(null);
              }}
            >
              {connections.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        }
      />
      <div className="p-6">
        {connections.isLoading || nodes.isLoading || (connectionId === null && Boolean(connections.data?.length)) ? (
          <Spinner />
        ) : connections.data?.length === 0 ? (
          <EmptyState icon={Bot} title="Nenhuma conexão" description="Crie uma conexão em Conexões para configurar o chatbot." />
        ) : nodes.isError ? (
          <p className="text-sm text-danger">{errorMessage(nodes.error)}</p>
        ) : !tree ? (
          <EmptyState
            icon={Bot}
            title="Este chatbot ainda não foi configurado"
            description="Sem chatbot, os clientes vão direto para a fila padrão da conexão."
            action={
              <Button loading={createRoot.isPending} onClick={() => createRoot.mutate()}>
                Criar mensagem de boas-vindas
              </Button>
            }
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            <div className="space-y-6">
              <Card>
                <NodeTree
                  tree={tree}
                  handlers={{
                    selectedId: target?.mode === "edit" ? target.node.id : null,
                    onSelect: (id) => setTarget({ mode: "edit", node: all.find((n) => n.id === id)! }),
                    onAddChild: (parentId) =>
                      setTarget({
                        mode: "create",
                        parent: all.find((n) => n.id === parentId)!,
                        suggestedKey: nextFreeKey(childrenOf(parentId)),
                      }),
                    onDelete: (id, title) => {
                      if (window.confirm(`Excluir "${title}" e todas as opções dentro dela?`)) remove.mutate(id);
                    },
                    onReorder: (parentId, ids) => reorder.mutate({ parentId, ids }),
                  }}
                />
              </Card>
              {target && connectionId !== null && (
                <Card>
                  <NodeForm
                    key={target.mode === "edit" ? `edit-${target.node.id}` : `new-${target.parent.id}`}
                    connectionId={connectionId}
                    target={target}
                    siblings={siblings}
                    onDone={() => setTarget(null)}
                  />
                </Card>
              )}
            </div>
            {connectionId !== null && <Simulator key={connectionId} connectionId={connectionId} />}
          </div>
        )}
      </div>
    </div>
  );
}
