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
import type { Profile, UserView } from "@/types/api";
import { createUser, PROFILE_LABEL, updateUser, userKeys, type UserInput } from "./usersApi";

export function UserDialog({ user, onClose }: { user?: UserView; onClose: () => void }) {
  const queryClient = useQueryClient();
  const queues = useQueues();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [profile, setProfile] = useState<Profile>(user?.profile ?? "agent");
  const [queueIds, setQueueIds] = useState<number[]>(user?.queueIds ?? []);

  const passwordError =
    (!user && password.length < 6) || (user && password.length > 0 && password.length < 6)
      ? "A senha precisa ter pelo menos 6 caracteres."
      : null;
  const valid = name.trim() && email.trim() && !passwordError;

  const mutation = useMutation({
    mutationFn: () => {
      const input: UserInput = {
        name: name.trim(),
        email: email.trim(),
        ...(password ? { password } : {}),
        profile,
        queueIds,
      };
      return user ? updateUser(user.id, input) : createUser(input);
    },
    onSuccess: () => {
      toast.success(user ? "Usuário atualizado" : "Usuário criado");
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
      onClose();
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
            <Label htmlFor="user-password">Senha</Label>
            <Input
              id="user-password"
              type="password"
              autoComplete="new-password"
              placeholder={user ? "Deixe em branco para manter" : ""}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {password && passwordError && <p className="mt-1 text-xs text-danger">{passwordError}</p>}
          </div>
          <div>
            <Label htmlFor="user-profile">Perfil</Label>
            <Select id="user-profile" value={profile} onChange={(e) => setProfile(e.target.value as Profile)}>
              {(Object.keys(PROFILE_LABEL) as Profile[]).map((p) => (
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
