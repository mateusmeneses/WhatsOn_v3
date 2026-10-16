import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, QrCode, Smartphone, Star, Trash2, Unplug } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/apiError";
import { formatPhone } from "@/lib/format";
import type { Connection, ConnectionStatus } from "@/types/api";
import { ConnectionDialog } from "./ConnectionDialog";
import { connectionKeys, deleteConnection, disconnectConnection, STATUS_LABEL } from "./connectionsApi";
import { useConnectionRealtime, useConnections } from "./useConnections";
import { QrCodeDialog } from "./QrCodeDialog";

const STATUS_TONE: Record<ConnectionStatus, "success" | "warning" | "neutral"> = {
  connected: "success",
  qrcode: "warning",
  disconnected: "neutral",
};

export function ConnectionsPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const connections = useConnections();
  useConnectionRealtime();
  const [editing, setEditing] = useState<{ connection?: Connection } | null>(null);
  const [qrFor, setQrFor] = useState<Connection | null>(null);
  const closeQr = useCallback(() => setQrFor(null), []);

  const onError = (err: unknown) => toast.error(errorMessage(err));
  const refresh = () => void queryClient.invalidateQueries({ queryKey: connectionKeys.all });
  const disconnect = useMutation({ mutationFn: (id: number) => disconnectConnection(id), onSuccess: refresh, onError });
  const remove = useMutation({
    mutationFn: (id: number) => deleteConnection(id),
    onSuccess: () => {
      toast.success("Conexão excluída");
      refresh();
    },
    onError,
  });

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Conexões"
        description="Números de WhatsApp conectados à empresa."
        actions={
          <Button onClick={() => setEditing({})}>
            <Plus className="h-4 w-4" aria-hidden /> Nova conexão
          </Button>
        }
      />
      <div className="p-6">
        {connections.isLoading ? (
          <Spinner />
        ) : connections.isError ? (
          <p className="text-sm text-danger">{errorMessage(connections.error)}</p>
        ) : connections.data!.length === 0 ? (
          <EmptyState icon={Smartphone} title="Nenhuma conexão" description="Crie uma conexão e leia o QR code com o WhatsApp." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {connections.data!.map((c) => (
              <Card key={c.id}>
                <article className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-1.5 font-semibold">
                        {c.name}
                        {c.isDefault && <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-label="Conexão padrão" />}
                      </p>
                      <p className="text-sm text-ink-muted">{c.number ? formatPhone(c.number) : "Sem número"}</p>
                    </div>
                    <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {c.status === "connected" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`Desconectar ${c.name}`}
                        onClick={async () => {
                          if (
                            await confirm({
                              title: "Desconectar conexão",
                              description: `Desconectar ${c.name}? O número deixará de receber mensagens.`,
                              confirmLabel: "Desconectar",
                              danger: true,
                            })
                          ) {
                            disconnect.mutate(c.id);
                          }
                        }}
                      >
                        <Unplug className="h-4 w-4" aria-hidden /> Desconectar
                      </Button>
                    ) : (
                      <Button size="sm" aria-label={`Conectar ${c.name}`} onClick={() => setQrFor(c)}>
                        <QrCode className="h-4 w-4" aria-hidden /> Conectar
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" aria-label={`Editar ${c.name}`} onClick={() => setEditing({ connection: c })}>
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Excluir ${c.name}`}
                      onClick={async () => {
                        if (await confirm({ title: "Excluir conexão", description: `Excluir a conexão ${c.name}?`, confirmLabel: "Excluir", danger: true }))
                          remove.mutate(c.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </article>
              </Card>
            ))}
          </div>
        )}
      </div>
      {editing && (
        <ConnectionDialog connection={editing.connection} onClose={() => setEditing(null)} onCreated={setQrFor} />
      )}
      {qrFor && <QrCodeDialog connection={qrFor} onClose={closeQr} />}
    </div>
  );
}
