import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { PresenceDot } from "@/components/ui/presence-dot";
import { Spinner } from "@/components/ui/spinner";
import { useQueues } from "@/features/queues/useQueues";
import { errorMessage } from "@/lib/apiError";
import { timeAgo } from "@/lib/duration";
import { formatPhone } from "@/lib/format";
import { useLiveInvalidate } from "@/realtime/useLiveInvalidate";
import { useAuth } from "@/stores/auth";
import type { UserView } from "@/types/api";
import { AccessResultDialog } from "./AccessResultDialog";
import { UserDialog } from "./UserDialog";
import { deleteUser, fetchUsers, PROFILE_LABEL, resetUserAccess, userKeys, type UserWithAccess } from "./usersApi";

export function UsersPage() {
  const me = useAuth((s) => s.user)!;
  const confirm = useConfirm();
  const isAdmin = me.profile === "admin";
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: [...userKeys.all, "list"], queryFn: fetchUsers });
  const queues = useQueues();
  useLiveInvalidate(userKeys.all, ["presence:changed"], 500);
  const [dialog, setDialog] = useState<{ user?: UserView } | null>(null);
  const [accessResult, setAccessResult] = useState<UserWithAccess | null>(null);

  const reset = useMutation({
    mutationFn: (id: number) => resetUserAccess(id),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
      if (result.access.sent) toast.success("Acesso enviado por WhatsApp");
      else setAccessResult(result);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteUser(id),
    onSuccess: () => {
      toast.success("Usuário excluído");
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const queueName = (id: number) => queues.data?.find((q) => q.id === id)?.name;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Usuários"
        description="Atendentes, supervisores e administradores da empresa."
        actions={
          isAdmin && (
            <Button onClick={() => setDialog({})}>
              <Plus className="h-4 w-4" aria-hidden /> Novo usuário
            </Button>
          )
        }
      />
      <div className="p-6">
        <Card className="p-0">
          {users.isLoading ? (
            <div className="flex justify-center p-8">
              <Spinner />
            </div>
          ) : users.isError ? (
            <p className="p-6 text-sm text-danger">{errorMessage(users.error)}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-ink-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Nome</th>
                  <th className="px-5 py-3 font-medium">Presença</th>
                  <th className="px-5 py-3 font-medium">E-mail</th>
                  <th className="px-5 py-3 font-medium">WhatsApp</th>
                  <th className="px-5 py-3 font-medium">Perfil</th>
                  <th className="px-5 py-3 font-medium">Filas</th>
                  {isAdmin && <th className="px-5 py-3"><span className="sr-only">Ações</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.data!.map((user) => (
                  <tr key={user.id}>
                    <td className="px-5 py-3 font-medium">{user.name}</td>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-2 text-xs">
                        <PresenceDot online={Boolean(user.online)} />
                        {user.online ? (
                          <span className="font-medium text-success">Online</span>
                        ) : (
                          <span className="text-ink-muted">{user.lastSeenAt ? `Visto ${timeAgo(user.lastSeenAt)}` : "Nunca acessou"}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-ink-muted">{user.email}</td>
                    <td className="px-5 py-3 text-ink-muted">{user.phone ? formatPhone(user.phone) : "—"}</td>
                    <td className="px-5 py-3">
                      <Badge tone={user.profile === "agent" ? "neutral" : "primary"}>{PROFILE_LABEL[user.profile]}</Badge>
                    </td>
                    <td className="px-5 py-3">
                      <span className="flex flex-wrap gap-1">
                        {user.queueIds.map((id) => (
                          <Badge key={id}>{queueName(id) ?? `Fila ${id}`}</Badge>
                        ))}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-5 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Enviar acesso para ${user.name}`}
                          title="Enviar acesso: gera senha temporária e envia por WhatsApp"
                          onClick={async () => {
                            const ok = await confirm({
                              title: "Enviar acesso",
                              description: `Uma nova senha temporária será gerada para ${user.name} e enviada por WhatsApp. As sessões atuais serão encerradas.`,
                              confirmLabel: "Enviar",
                            });
                            if (ok) reset.mutate(user.id);
                          }}
                        >
                          <KeyRound className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={`Editar ${user.name}`} onClick={() => setDialog({ user })}>
                          <Pencil className="h-4 w-4" aria-hidden />
                        </Button>
                        {user.id !== me.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Excluir ${user.name}`}
                            onClick={async () => {
                              if (await confirm({ title: "Excluir usuário", description: `Excluir o usuário ${user.name}?`, confirmLabel: "Excluir", danger: true }))
                                remove.mutate(user.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
      {dialog && <UserDialog user={dialog.user} onClose={() => setDialog(null)} onAccessNotSent={setAccessResult} />}
      {accessResult && <AccessResultDialog user={accessResult} onClose={() => setAccessResult(null)} />}
    </div>
  );
}
