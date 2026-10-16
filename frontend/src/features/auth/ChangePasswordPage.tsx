import { KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import logoMark from "@/assets/brand/logo-mark.webp";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/apiError";
import { useAuth } from "@/stores/auth";
import { changePassword, logout } from "./authApi";

const MIN_LENGTH = 6;

/** Primeiro acesso (ou senha redefinida pelo admin): obriga a cadastrar uma senha própria. */
export function ChangePasswordPage() {
  const user = useAuth((s) => s.user);
  const setSession = useAuth((s) => s.setSession);
  const clear = useAuth((s) => s.clear);
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword) return <Navigate to="/atendimento" replace />;

  const problem =
    next.length > 0 && next.length < MIN_LENGTH
      ? `A nova senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`
      : confirmation.length > 0 && confirmation !== next
        ? "As senhas não conferem."
        : null;
  const valid = current.length > 0 && next.length >= MIN_LENGTH && confirmation === next;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setError(null);
    setSaving(true);
    try {
      setSession(await changePassword(current, next));
      toast.success("Senha cadastrada");
      navigate("/atendimento", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  async function onLogout() {
    await logout();
    clear();
    navigate("/login", { replace: true });
  }

  return (
    <main className="flex min-h-full items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md p-6 sm:p-8">
        <img src={logoMark} alt="" className="mb-4 h-12 w-12" />
        <h1 className="flex items-center gap-2 text-xl font-bold text-ink">
          <KeyRound className="h-5 w-5 text-primary" aria-hidden /> Crie sua nova senha
        </h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          Olá, {user.name}! Você entrou com uma senha temporária. Cadastre uma senha só sua para continuar.
        </p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <Label htmlFor="current-password">Senha temporária</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="new-password">Nova senha</Label>
            <Input id="new-password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="confirm-password">Confirme a nova senha</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </div>
          {(problem || error) && (
            <p role="alert" className="text-sm text-danger">
              {error ?? problem}
            </p>
          )}
          <Button type="submit" className="w-full" loading={saving} disabled={!valid}>
            Salvar nova senha
          </Button>
          <button type="button" className="w-full text-center text-sm text-ink-muted underline" onClick={() => void onLogout()}>
            Sair
          </button>
        </form>
      </Card>
    </main>
  );
}
