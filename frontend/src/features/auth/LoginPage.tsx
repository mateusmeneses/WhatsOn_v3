import { AlertCircle, ArrowRight, Eye, EyeOff, Lock, Mail, type LucideIcon } from "lucide-react";
import { useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import logoFullDark from "@/assets/brand/logo-full-dark.webp";
import logoFull from "@/assets/brand/logo-full.webp";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/apiError";
import { cn } from "@/lib/cn";
import { useAuth } from "@/stores/auth";
import { useAppVersion } from "@/features/version/useAppVersion";
import { login } from "./authApi";

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

export function LoginPage() {
  const user = useAuth((s) => s.user);
  const setSession = useAuth((s) => s.setSession);
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const from = (location.state as { from?: string } | null)?.from ?? "/atendimento";
  if (user) return <Navigate to={from} replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      setSession(await login(email.trim(), password));
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setAttempt((n) => n + 1);
    } finally {
      setLoading(false);
    }
  }

  function trackCapsLock(event: KeyboardEvent<HTMLInputElement>) {
    setCapsLock(event.getModifierState?.("CapsLock") ?? false);
  }

  return (
    <main className="relative flex min-h-full bg-background lg:grid lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel />

      <section className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-10 sm:px-8">
        {/* Glow suave atrás do formulário (visível sobretudo no mobile, onde o painel da marca some) */}
        <div aria-hidden className="pointer-events-none absolute inset-0 lg:hidden">
          <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-brand-blue/20 blur-3xl motion-safe:animate-drift" />
          <div
            className="absolute -bottom-28 -right-20 h-72 w-72 rounded-full bg-brand-green/20 blur-3xl motion-safe:animate-drift"
            style={delay(-9000)}
          />
        </div>

        <div className="relative w-full max-w-[400px]">
          <img
            src={logoFull}
            alt="WhatsOn — Gerenciador de Atendimento"
            width={720}
            height={507}
            className="mx-auto mb-6 h-auto w-48 motion-safe:animate-fade-up sm:w-56 lg:hidden"
          />

          <div
            className={cn(
              "rounded-3xl border border-border/80 bg-surface/90 p-6 shadow-[0_20px_60px_-25px_rgba(30,27,58,0.35)] backdrop-blur",
              "sm:p-8 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none",
              "motion-safe:animate-fade-up",
            )}
            style={delay(80)}
          >
            <header className="mb-7">
              <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[1.75rem]">Bem-vindo de volta</h1>
              <p className="mt-1.5 text-sm text-ink-muted">Entre com seu e-mail e senha para continuar.</p>
            </header>

            <form onSubmit={onSubmit} className="space-y-5" noValidate aria-busy={loading}>
              <Field id="email" label="E-mail" icon={Mail} style={delay(160)}>
                <input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  placeholder="voce@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  aria-invalid={!!error || undefined}
                  className={inputClass}
                />
              </Field>

              <Field
                id="password"
                label="Senha"
                icon={Lock}
                style={delay(220)}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    aria-pressed={showPassword}
                    className="grid h-9 w-9 place-items-center rounded-lg text-ink-muted transition hover:bg-brand-blue/10 hover:text-brand-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
                  >
                    {showPassword ? <EyeOff className="h-[18px] w-[18px]" aria-hidden /> : <Eye className="h-[18px] w-[18px]" aria-hidden />}
                  </button>
                }
                hint={
                  capsLock ? (
                    <p className="mt-1.5 text-xs font-medium text-warning motion-safe:animate-fade-up">Caps Lock está ativado</p>
                  ) : null
                }
              >
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={trackCapsLock}
                  onKeyDown={trackCapsLock}
                  onBlur={() => setCapsLock(false)}
                  required
                  aria-invalid={!!error || undefined}
                  className={cn(inputClass, "pr-12")}
                />
              </Field>

              {/* Altura animada via grid-rows para a mensagem de erro entrar/sair sem "pulo" */}
              <div
                className={cn(
                  "grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out",
                  error ? "grid-rows-[1fr] opacity-100" : "!mt-0 grid-rows-[0fr] opacity-0",
                )}
              >
                <div className="overflow-hidden">
                  {error && (
                    <p
                      key={attempt}
                      role="alert"
                      className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 motion-safe:animate-shake"
                    >
                      <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden />
                      <span>{error}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="motion-safe:animate-fade-up" style={delay(280)}>
                <button
                  type="submit"
                  disabled={!email || !password || loading}
                  className={cn(
                    "group relative inline-flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl",
                    "bg-gradient-to-r from-brand-blue to-brand-navy text-[15px] font-semibold text-white",
                    "shadow-[0_10px_30px_-10px_rgba(10,106,214,0.7)] transition duration-200 ease-out",
                    "hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-12px_rgba(10,106,214,0.85)] active:translate-y-0 active:scale-[0.99]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                    "disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none",
                  )}
                >
                  {/* Brilho que atravessa o botão no hover */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-white/20 opacity-0 transition-all duration-700 ease-out group-hover:left-[120%] group-hover:opacity-100"
                  />
                  {loading ? (
                    <>
                      <Spinner className="h-[18px] w-[18px] text-white" />
                      Entrando…
                    </>
                  ) : (
                    <>
                      Entrar
                      <ArrowRight
                        className="h-[18px] w-[18px] transition-transform duration-200 group-hover:translate-x-1"
                        aria-hidden
                      />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          <p className="mt-8 text-center text-xs text-ink-muted motion-safe:animate-fade-up lg:text-left" style={delay(360)}>
            © {new Date().getFullYear()} WhatsOn · Gerenciador de Atendimento
          </p>
          <LoginVersion />
        </div>
      </section>
    </main>
  );
}

const inputClass =
  "peer h-12 w-full rounded-xl border border-border bg-surface pl-11 pr-3.5 text-[15px] text-ink shadow-sm " +
  "placeholder:text-ink-muted transition duration-200 " +
  "hover:border-brand-blue/40 focus:border-brand-blue focus:outline-none focus:ring-4 focus:ring-brand-blue/15 " +
  "aria-[invalid]:border-red-300 aria-[invalid]:focus:ring-red-500/15";

function Field({
  id,
  label,
  icon: Icon,
  trailing,
  hint,
  style,
  children,
}: {
  id: string;
  label: string;
  icon: LucideIcon;
  trailing?: ReactNode;
  hint?: ReactNode;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className="motion-safe:animate-fade-up" style={style}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        {children}
        <Icon
          aria-hidden
          className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-muted transition-colors duration-200 peer-focus:text-brand-blue"
        />
        {trailing && <div className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</div>}
      </div>
      {hint}
    </div>
  );
}

function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-brand-night text-white lg:flex lg:flex-col lg:justify-between lg:p-10 xl:px-16 xl:py-12">
      {/* Fundo: manchas de cor em movimento lento + grade de pontos */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-brand-blue/45 blur-[100px] motion-safe:animate-drift" />
        <div
          className="absolute -bottom-40 right-[-6rem] h-[30rem] w-[30rem] rounded-full bg-brand-green/30 blur-[110px] motion-safe:animate-drift"
          style={delay(-6000)}
        />
        <div
          className="absolute left-1/3 top-1/2 h-72 w-72 rounded-full bg-cyan-400/20 blur-[90px] motion-safe:animate-drift"
          style={delay(-12000)}
        />
        <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
      </div>

      <img
        src={logoFullDark}
        alt="WhatsOn — Gerenciador de Atendimento"
        width={720}
        height={507}
        className="relative h-auto w-44 motion-safe:animate-fade-up xl:w-48"
      />

      <div className="relative my-6 max-w-lg">
        <h2
          className="text-4xl font-bold leading-[1.1] tracking-tight motion-safe:animate-fade-up 2xl:text-5xl"
          style={delay(120)}
        >
          Todas as conversas da sua empresa,{" "}
          <span className="bg-gradient-to-r from-sky-300 via-cyan-200 to-emerald-300 bg-clip-text text-transparent">
            em um só lugar.
          </span>
        </h2>
        <p className="mt-5 max-w-md text-base text-white/75 motion-safe:animate-fade-up" style={delay(200)}>
          Filas, equipes e chatbots trabalhando juntos para responder seus clientes mais rápido.
        </p>

        <ChatPreview />
      </div>

      <ul className="relative flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/70 motion-safe:animate-fade-up" style={delay(520)}>
        {["Filas e equipes", "Chatbot integrado", "Tempo real"].map((item) => (
          <li key={item} className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.6)]" />
            {item}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function ChatPreview() {
  return (
    <div aria-hidden className="mt-8 space-y-3 [@media(max-height:640px)]:hidden">
      <div className="motion-safe:animate-fade-up" style={delay(300)}>
        <div className="w-fit max-w-[80%] rounded-2xl rounded-bl-md bg-white/10 px-4 py-2.5 text-sm text-white/90 ring-1 ring-white/10 backdrop-blur motion-safe:animate-float">
          Oi! Meu pedido já foi enviado? 📦
        </div>
      </div>
      <div className="flex justify-end motion-safe:animate-fade-up" style={delay(400)}>
        <div
          className="w-fit max-w-[80%] rounded-2xl rounded-br-md bg-gradient-to-r from-[#0b8a3c] to-[#056b2f] px-4 py-2.5 text-sm text-white shadow-lg shadow-brand-green/30 motion-safe:animate-float"
          style={delay(-2000)}
        >
          Já sim! Chega amanhã até as 18h. 🚀
        </div>
      </div>
      <div className="motion-safe:animate-fade-up [@media(max-height:860px)]:hidden" style={delay(480)}>
        <div
          className="flex w-fit items-center gap-1 rounded-2xl rounded-bl-md bg-white/10 px-4 py-3 ring-1 ring-white/10 backdrop-blur motion-safe:animate-float"
          style={delay(-4000)}
        >
          {[0, 150, 300].map((d) => (
            <span key={d} className="h-1.5 w-1.5 motion-safe:animate-bounce rounded-full bg-white/70" style={delay(d)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function LoginVersion() {
  const { data } = useAppVersion();
  if (!data) return null;
  return (
    <p className="mt-1 text-center text-[11px] text-ink-muted lg:text-left">
      Versão {data.version}
      {data.buildTime && <> · Build: {data.buildTime}</>}
    </p>
  );
}
