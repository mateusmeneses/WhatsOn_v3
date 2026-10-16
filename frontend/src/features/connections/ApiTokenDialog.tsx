import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/apiError";
import type { Connection } from "@/types/api";
import { connectionKeys, fetchApiToken, regenerateApiToken } from "./connectionsApi";

/** Token da API externa (/api/v1) da conexão: usado por outros sistemas (ex.: ERP) para enviar mensagens. */
export function ApiTokenDialog({ connection, onClose }: { connection: Connection; onClose: () => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const queryKey = ["connections", connection.id, "api-token"];
  const tokenQuery = useQuery({ queryKey, queryFn: () => fetchApiToken(connection.id), gcTime: 0 });
  const regenerate = useMutation({
    mutationFn: () => regenerateApiToken(connection.id),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      void queryClient.invalidateQueries({ queryKey: connectionKeys.all, exact: true });
      toast.success("Token gerado");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const token = tokenQuery.data?.apiToken ?? null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`API de ${connection.name}`}
        description="Use este token no cabeçalho Authorization: Bearer <token> para conectar o número e enviar mensagens por outros sistemas."
      >
        {tokenQuery.isLoading ? (
          <Spinner />
        ) : tokenQuery.isError ? (
          <p className="text-sm text-danger">{errorMessage(tokenQuery.error)}</p>
        ) : token ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-3">
            <code className="min-w-0 flex-1 break-all font-mono text-xs" data-testid="api-token">
              {token}
            </code>
            <button
              type="button"
              aria-label="Copiar token"
              className="rounded p-1 text-ink-muted hover:bg-primary-soft"
              onClick={() => {
                void navigator.clipboard?.writeText(token).then(() => toast.success("Token copiado"), () => undefined);
              }}
            >
              <Copy className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">Esta conexão ainda não tem token de API.</p>
        )}
        <p className="mt-3 text-xs text-ink-muted">Guarde o token em segurança: quem o tiver pode enviar mensagens por este número.</p>
        <DialogFooter>
          <Button
            variant="secondary"
            disabled={regenerate.isPending || tokenQuery.isLoading}
            onClick={async () => {
              if (
                token &&
                !(await confirm({
                  title: "Regenerar token",
                  description: "O token atual deixará de funcionar imediatamente nos sistemas que o usam. Continuar?",
                  confirmLabel: "Regenerar",
                  danger: true,
                }))
              ) {
                return;
              }
              regenerate.mutate();
            }}
          >
            {token ? <RefreshCw className="h-4 w-4" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
            {token ? "Regenerar token" : "Gerar token"}
          </Button>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
