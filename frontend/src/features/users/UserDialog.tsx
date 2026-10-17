import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useQueues } from "@/features/queues/useQueues";
import { errorMessage } from "@/lib/apiError";
import type { CompanyProfile, TicketAccess, UserView } from "@/types/api";
import {
  createUser,
  PROFILE_LABEL,
  TICKET_ACCESS_LABEL,
  updateUser,
  userKeys,
  type UserInput,
  type UserWithAccess,
} from "./usersApi";

export function UserDialog({
  user,
  onClose,
  onAccessNotSent,
}: {
  user?: UserView;
  onClose: () => void;
  /** Novo usuário cujo acesso não chegou por WhatsApp: a senha temporária precisa ser mostrada. */
  onAccessNotSent?: (created: UserWithAccess) => void;
}) {
  const queryClient = useQueryClient();
  const queues = useQueues();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [password, setPassword] = useState("");
  const [profile, setProfile] = useState<CompanyProfile>(user?.profile ?? "agent");
  const [queueIds, setQueueIds] = useState<number[]>(user?.queueIds ?? []);
  const [sendAccess, setSendAccess] = useState(false);
  const [access, setAccess] = useState<TicketAccess>({
    canViewBot: user?.canViewBot ?? false,
    canViewOtherQueues: user?.canViewOtherQueues ?? false,
    canViewOthersOpen: user?.canViewOthersOpen ?? false,
  });

  const passwordError = password.length > 0 && password.length < 6 ? "A senha precisa ter pelo menos 6 caracteres." : null;
  const valid = name.trim() && email.trim() && !passwordError;

  const mutation = useMutation({
    mutationFn: () => {
      const input: UserInput = {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        ...(user && password ? { password } : {}),
        profile,
        queueIds,
        ...access,
      };
      return user ? updateUser(user.id, input) : createUser({ ...input, sendAccess });
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
      const created = user ? null : (saved as UserWithAccess);
      if (!created) toast.success("Usuário atualizado");
      else if (created.access?.sent) toast.success("Usuário criado. Acesso enviado por WhatsApp.");
      else if (!sendAccess) toast.success("Usuário criado. Envie o acesso pela lista quando quiser.");
      else toast.success("Usuário criado");
      onClose();
      if (created?.access?.temporaryPassword) onAccessNotSent?.(created);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const toggleQueue = (id: number) =>
    setQueueIds((ids) => (ids.includes(id) ? ids.filter((q) => q !== id) : [...ids, id]));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={user ? "Editar usuário" : "Novo usuário"}>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div>
            <Label htmlFor="user-name">Nome</Label>
            <Input id="user-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="user-email">E-mail</Label>
            <Input id="user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="user-phone">WhatsApp</Label>
            <Input
              id="user-phone"
              type="tel"
              inputMode="tel"
              placeholder="(11) 98888-7777"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            {!user && (
              <>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--color-primary)]"
                    checked={sendAccess}
                    onChange={(e) => setSendAccess(e.target.checked)}
                  />
                  Enviar acesso por WhatsApp agora
                </label>
                <p className="mt-1 text-xs text-ink-muted">
                  Desmarcado, o acesso (link, usuário e senha temporária) fica para o botão "Enviar acesso" na lista.
                </p>
              </>
            )}
          </div>
          {user && (
            <div>
              <Label htmlFor="user-password">Nova senha</Label>
              <Input
                id="user-password"
                type="password"
                autoComplete="new-password"
                placeholder="Deixe em branco para manter"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {passwordError && <p className="mt-1 text-xs text-danger">{passwordError}</p>}
            </div>
          )}
          <div>
            <Label htmlFor="user-profile">Perfil</Label>
            <Select id="user-profile" value={profile} onChange={(e) => setProfile(e.target.value as CompanyProfile)}>
              {(Object.keys(PROFILE_LABEL) as CompanyProfile[]).map((p) => (
                <option key={p} value={p}>
                  {PROFILE_LABEL[p]}
                </option>
              ))}
            </Select>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Filas</legend>
            <div className="grid grid-cols-2 gap-2">
              {queues.data?.map((queue) => (
                <label key={queue.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--color-primary)]"
                    checked={queueIds.includes(queue.id)}
                    onChange={() => toggleQueue(queue.id)}
                  />
                  {queue.name}
                </label>
              ))}
            </div>
          </fieldset>
          {profile === "agent" && (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Permissões de atendimento</legend>
              <div className="space-y-2">
                {(Object.keys(TICKET_ACCESS_LABEL) as (keyof TicketAccess)[]).map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--color-primary)]"
                      checked={access[key]}
                      onChange={(e) => setAccess((a) => ({ ...a, [key]: e.target.checked }))}
                    />
                    {TICKET_ACCESS_LABEL[key]}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                Além das filas marcadas acima. Supervisores e administradores já veem tudo.
              </p>
            </fieldset>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={!valid}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
