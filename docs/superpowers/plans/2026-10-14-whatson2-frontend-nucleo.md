# WHATSON2 Frontend do Núcleo (Plano B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o frontend do subprojeto 1 do WHATSON2 (login, atendimento em tempo real com chat, contatos, filas com expediente, usuários, conexões com QR code, editor do chatbot com simulador e configurações) na identidade visual "Clean SaaS", consumindo o backend já pronto.

**Architecture:** SPA React + Vite + TypeScript em `frontend/`, organizada por feature (`src/features/*`), com estado de servidor no React Query, sessão no Zustand, cliente HTTP axios com renovação automática de token e Socket.io atualizando o cache do React Query. Componentes de UI próprios no estilo shadcn (Tailwind + Radix Dialog). Em produção, Nginx serve o build e faz proxy de `/api`, `/media` e `/socket.io` para o backend.

**Tech Stack:** React 18, Vite 5, TypeScript 5, Tailwind CSS 3, @radix-ui/react-dialog, @tanstack/react-query 5, Zustand 4, react-router-dom 6, axios 1, socket.io-client 4, sonner, lucide-react, @dnd-kit, @fontsource/inter; Vitest 2 + Testing Library + jsdom + axios-mock-adapter; Nginx 1.27.

**Spec:** `docs/superpowers/specs/2026-10-13-whatson2-nucleo-design.md` (seções 3, 5, 6 e 8). Contratos do backend: `docs/realtime-contract.md` e o código em `backend/src/modules/*/*.routes.ts`.

## Global Constraints

- Identidade "Clean SaaS" (spec §8), tokens exatos: `primary #6d5dfc`, `primary-soft #efedff`, `sidebar #1e1b3a`, `background #f7f7fb`, `surface #ffffff`, `border #ececf3`, `text #1e1b3a`; fonte Inter (servida localmente via `@fontsource/inter`, sem CDN).
- Tokens definidos como CSS variables em `:root` e mapeados no tema do Tailwind (classes `bg-primary`, `bg-primary-soft`, `bg-sidebar`, `bg-background`, `bg-surface`, `border-border`, `text-ink`, `text-ink-muted`).
- Layout: barra lateral escura estreita com ícones, coluna da lista de tickets e área do chat; bolhas de entrada brancas com borda, de saída em `primary` com texto branco.
- Responsivo até tablet (≥ 768 px). Mobile fora do escopo. Tema escuro não é implementado.
- Todo texto de interface em pt-BR; identificadores de código em inglês.
- A API responde erros como `{ "error": { "code", "message" } }`, com `message` já em pt-BR: a UI mostra essa mensagem (toast ou texto inline).
- URLs relativas: a API fica em `/api`, a mídia em `/media/...` e o socket em `/socket.io` no mesmo host (proxy do Vite em dev e do Nginx em produção). `VITE_API_URL` opcional (padrão vazio).
- Access token só em memória (Zustand); refresh token em `localStorage` na chave `whatson.refreshToken`.
- Perfis: `admin`, `supervisor`, `agent`. Rotas e botões respeitam o perfil (o backend continua sendo a autoridade).
- Status de ticket: `bot`, `pending`, `open`, `closed`. Ack: `pending`, `sent`, `delivered`, `read`, `failed`.
- Testes: `npm test` (Vitest, jsdom). `socket.io-client` é sempre mockado nos testes (nenhuma conexão real).

## Review Focus

1. Access token expira no meio do uso → a próxima requisição recebe 401, o cliente renova uma única vez (mesmo com várias requisições simultâneas) e repete a requisição sem o usuário perceber; se a renovação falhar, volta para o login (teste na Task 2).
2. Socket reconecta depois de uma queda → a lista de tickets e o chat aberto são recarregados e a sala do ticket aberto é reingressada, porque eventos perdidos não são reenviados (teste na Task 4).
3. Ticket transferido para fora do atendente enquanto ele está com a lista aberta → o ticket some da aba dele pelo `ticket:update`, sem recarregar a página (teste na Task 5).
4. Mensagem enviada pelo atendente chega pelo socket (`message:new`) antes da resposta do POST → aparece uma única vez no chat, sem duplicar a bolha otimista (teste na Task 6).
5. Envio falha por falta de rede → a bolha fica marcada "Não enviada" com ação de tentar de novo, e o texto digitado não se perde (teste na Task 6).

## File Structure

```
frontend/
  package.json, tsconfig.json, vite.config.ts, index.html, tailwind.config.ts, postcss.config.js
  Dockerfile, nginx.conf, .dockerignore                     # Task 14
  src/
    main.tsx                      # providers + BrowserRouter + Toaster
    App.tsx                       # bootstrap da sessão + AppRoutes
    app/routes.tsx                # AppRoutes (todas as rotas)
    index.css                     # tokens + Tailwind
    types/api.ts                  # tipos espelhando a API
    lib/cn.ts, api.ts, apiError.ts, queryClient.ts, format.ts, useDebounced.ts
    stores/auth.ts                # sessão (Zustand) + refresh token storage
    realtime/socket.ts, RealtimeProvider.tsx
    components/ui/                # button, input, textarea, label, select, badge, card, spinner, empty-state, dialog, tabs
    components/layout/            # AppShell, Sidebar, ProtectedRoute, PageHeader
    features/
      auth/        authApi.ts, LoginPage.tsx, useBootstrapSession.ts
      users/       usersApi.ts, UsersPage.tsx, UserDialog.tsx
      queues/      queuesApi.ts, schedule.ts, ScheduleEditor.tsx, QueueDialog.tsx, QueuesPage.tsx
      tickets/     ticketsApi.ts, visibility.ts, ticketCache.ts, useTickets.ts, TicketsPage.tsx, TicketList.tsx,
                   TicketListItem.tsx, TicketActions.tsx, TransferDialog.tsx
      chat/        messagesApi.ts, messageCache.ts, useMessages.ts, ChatPanel.tsx, ChatHeader.tsx, MessageList.tsx,
                   MessageBubble.tsx, Composer.tsx
      contacts/    contactsApi.ts, ContactsPage.tsx
      connections/ connectionsApi.ts, ConnectionsPage.tsx, ConnectionDialog.tsx, QrCodeDialog.tsx, ConnectionAlerts.tsx
      chatbot/     chatbotApi.ts, tree.ts, ChatbotPage.tsx, NodeTree.tsx, NodeForm.tsx, Simulator.tsx
      settings/    companyApi.ts, SettingsPage.tsx
    test/setup.ts, utils.tsx, fakeSocket.ts
docker-compose.yml   # serviço frontend (Task 14)
```

Testes ficam ao lado do código (`*.test.ts(x)`).

---

### Task 1: Scaffold do frontend, tokens visuais e componentes de UI

**Files:**
- Create: `frontend/package.json` (via npm), `frontend/tsconfig.json`, `frontend/vite.config.ts`, `frontend/index.html`, `frontend/tailwind.config.ts`, `frontend/postcss.config.js`
- Create: `frontend/src/index.css`, `frontend/src/lib/cn.ts`, `frontend/src/test/setup.ts`
- Create: `frontend/src/components/ui/{button,input,textarea,label,select,badge,card,spinner,empty-state,dialog,tabs}.tsx`
- Test: `frontend/src/components/ui/ui.test.tsx`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `cn(...inputs: ClassValue[]): string`.
  - `Button` (`variant?: "primary" | "secondary" | "ghost" | "danger"`, `size?: "sm" | "md" | "icon"`, `loading?: boolean` + atributos de `<button>`).
  - `Input`, `Textarea`, `Select` (forwardRef, atributos nativos), `Label`, `Card`, `Spinner` (`data-testid="spinner"`), `EmptyState({ icon, title, description?, action?, className? })`.
  - `Badge({ tone?: "neutral" | "primary" | "success" | "warning" | "danger" })`.
  - `Dialog` (= Radix Root, `open`/`onOpenChange`), `DialogContent({ title, description?, children, className? })`, `DialogFooter`.
  - `Tabs<T extends string>({ value: T, onChange(v: T), items: { value: T; label: string; count?: number }[] })` com `role="tablist"`/`role="tab"`.

- [ ] **Step 1: Criar o projeto e instalar dependências**

Run (na raiz do repo):

```bash
mkdir frontend
cd frontend
npm init -y
npm pkg set name=whatson2-frontend version=0.1.0 private=true --json
npm pkg set type=module
npm pkg set scripts.dev="vite" scripts.build="tsc --noEmit && vite build" scripts.preview="vite preview" scripts.test="vitest run" scripts.typecheck="tsc --noEmit"
npm i react@18 react-dom@18 react-router-dom@6 @tanstack/react-query@5 zustand@4 axios@1 socket.io-client@4 lucide-react clsx tailwind-merge@2 @radix-ui/react-dialog@1 sonner@1 @dnd-kit/core@6 @dnd-kit/sortable@8 @dnd-kit/utilities@3 @fontsource/inter@5
npm i -D typescript@5 vite@5 @vitejs/plugin-react@4 @types/react@18 @types/react-dom@18 @types/node@22 tailwindcss@3 postcss@8 autoprefixer@10 vitest@2 jsdom@25 @testing-library/react@16 @testing-library/dom@10 @testing-library/user-event@14 @testing-library/jest-dom@6 axios-mock-adapter@2
```

Expected: instalação sem erros. (`npm pkg set private=true --json` grava booleano.)

- [ ] **Step 2: Configuração**

`frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom", "node"]
  },
  "include": ["src", "vite.config.ts", "tailwind.config.ts"]
}
```

`frontend/vite.config.ts`:

```ts
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
      "/media": "http://localhost:4000",
      "/socket.io": { target: "http://localhost:4000", ws: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
```

`frontend/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WHATSON</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`frontend/tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "var(--color-primary)", soft: "var(--color-primary-soft)" },
        sidebar: "var(--color-sidebar)",
        background: "var(--color-background)",
        surface: "var(--color-surface)",
        border: "var(--color-border)",
        ink: { DEFAULT: "var(--color-ink)", muted: "var(--color-ink-muted)" },
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        danger: "var(--color-danger)",
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
```

`frontend/postcss.config.js`:

```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

`frontend/src/index.css`:

```css
@import "@fontsource/inter/400.css";
@import "@fontsource/inter/500.css";
@import "@fontsource/inter/600.css";
@import "@fontsource/inter/700.css";

@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --color-primary: #6d5dfc;
  --color-primary-soft: #efedff;
  --color-sidebar: #1e1b3a;
  --color-background: #f7f7fb;
  --color-surface: #ffffff;
  --color-border: #ececf3;
  --color-ink: #1e1b3a;
  --color-ink-muted: #6b6884;
  --color-success: #16a34a;
  --color-warning: #d97706;
  --color-danger: #dc2626;
}

html,
body,
#root {
  height: 100%;
}

body {
  @apply bg-background font-sans text-ink antialiased;
}
```

`frontend/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: Escrever o teste que falha**

`frontend/src/components/ui/ui.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Badge } from "./badge";
import { Button } from "./button";
import { Dialog, DialogContent } from "./dialog";
import { EmptyState } from "./empty-state";
import { Tabs } from "./tabs";
import { Inbox } from "lucide-react";

describe("ui primitives", () => {
  it("disables the button and shows a spinner while loading", () => {
    render(<Button loading>Salvar</Button>);
    expect(screen.getByRole("button", { name: /salvar/i })).toBeDisabled();
    expect(screen.getByTestId("spinner")).toBeInTheDocument();
  });

  it("renders dialog content with an accessible title when open", () => {
    render(
      <Dialog open onOpenChange={() => undefined}>
        <DialogContent title="Nova fila" description="Preencha os dados">
          conteúdo
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Nova fila" })).toBeInTheDocument();
    expect(screen.getByText("conteúdo")).toBeInTheDocument();
  });

  it("marks the selected tab and reports clicks", async () => {
    const onChange = vi.fn();
    render(
      <Tabs
        value="a"
        onChange={onChange}
        items={[
          { value: "a", label: "A" },
          { value: "b", label: "B", count: 3 },
        ]}
      />,
    );
    expect(screen.getByRole("tab", { name: "A" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: /B/ }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("applies the tone to badges", () => {
    render(<Badge tone="success">Conectado</Badge>);
    expect(screen.getByText("Conectado").className).toContain("text-success");
  });

  it("renders empty states with title and description", () => {
    render(<EmptyState icon={Inbox} title="Nada aqui" description="Tudo em dia" />);
    expect(screen.getByText("Nada aqui")).toBeInTheDocument();
    expect(screen.getByText("Tudo em dia")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run (em `frontend/`): `npx vitest run src/components/ui`
Expected: FAIL com `Failed to resolve import "./badge"`.

- [ ] **Step 5: Implementar**

`frontend/src/lib/cn.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

`frontend/src/components/ui/spinner.tsx`:

```tsx
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 data-testid="spinner" aria-hidden className={cn("h-5 w-5 animate-spin text-primary", className)} />;
}
```

`frontend/src/components/ui/button.tsx`:

```tsx
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-white hover:brightness-95",
  secondary: "border border-border bg-surface text-ink hover:bg-background",
  ghost: "text-ink hover:bg-primary-soft",
  danger: "bg-danger text-white hover:brightness-95",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  icon: "h-9 w-9",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading = false, disabled, children, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Spinner className={cn("h-4 w-4", variant === "primary" || variant === "danger" ? "text-white" : "")} />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
```

`frontend/src/components/ui/input.tsx`:

```tsx
import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const fieldClass =
  "w-full rounded-lg border border-border bg-surface px-3 text-sm text-ink placeholder:text-ink-muted " +
  "focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-soft disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldClass, "h-10", className)} {...props} />
));
Input.displayName = "Input";
```

`frontend/src/components/ui/textarea.tsx`:

```tsx
import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { fieldClass } from "./input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(fieldClass, "py-2", className)} {...props} />,
);
Textarea.displayName = "Textarea";
```

`frontend/src/components/ui/select.tsx`:

```tsx
import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { fieldClass } from "./input";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn(fieldClass, "h-10", className)} {...props} />,
);
Select.displayName = "Select";
```

`frontend/src/components/ui/label.tsx`:

```tsx
import type { LabelHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-sm font-medium text-ink", className)} {...props} />;
}
```

`frontend/src/components/ui/card.tsx`:

```tsx
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-border bg-surface p-5", className)} {...props} />;
}
```

`frontend/src/components/ui/badge.tsx`:

```tsx
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger";

const tones: Record<Tone, string> = {
  neutral: "bg-background text-ink-muted",
  primary: "bg-primary-soft text-primary",
  success: "bg-green-50 text-success",
  warning: "bg-amber-50 text-warning",
  danger: "bg-red-50 text-danger",
};

export function Badge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", tones[tone], className)}
      {...props}
    />
  );
}
```

`frontend/src/components/ui/empty-state.tsx`:

```tsx
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 p-8 text-center", className)}>
      <div className="rounded-full bg-primary-soft p-3 text-primary">
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <div>
        <p className="font-semibold text-ink">{title}</p>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
```

`frontend/src/components/ui/dialog.tsx`:

```tsx
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Dialog = DialogPrimitive.Root;

export function DialogContent({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2",
          "overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl focus:outline-none",
          className,
        )}
        {...(description ? {} : { "aria-describedby": undefined })}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <DialogPrimitive.Title className="text-lg font-semibold text-ink">{title}</DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="mt-1 text-sm text-ink-muted">{description}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close className="rounded-md p-1 text-ink-muted hover:bg-background" aria-label="Fechar">
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex justify-end gap-2">{children}</div>;
}
```

`frontend/src/components/ui/tabs.tsx`:

```tsx
import { cn } from "@/lib/cn";

export interface TabItem<T extends string> {
  value: T;
  label: string;
  count?: number;
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  items: TabItem<T>[];
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("flex gap-1 rounded-lg bg-background p-1", className)}>
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(item.value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-ink-muted transition",
              selected && "bg-surface text-ink shadow-sm",
            )}
          >
            {item.label}
            {item.count ? <span className="rounded-full bg-primary px-1.5 text-xs text-white">{item.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: 5 testes PASS; `tsc` sem erros.

- [ ] **Step 7: Commit**

```bash
git add frontend
git commit -m "chore(frontend): scaffold Vite + Tailwind com tokens Clean SaaS e componentes de UI"
```

---

### Task 2: Tipos da API, cliente HTTP com renovação de token e sessão

**Files:**
- Create: `frontend/src/types/api.ts`, `frontend/src/stores/auth.ts`, `frontend/src/lib/api.ts`, `frontend/src/lib/apiError.ts`, `frontend/src/lib/queryClient.ts`, `frontend/src/lib/format.ts`, `frontend/src/lib/useDebounced.ts`
- Modify: `frontend/src/test/setup.ts` (rede desativada nos testes)
- Test: `frontend/src/lib/api.test.ts`, `frontend/src/lib/format.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - Tipos em `@/types/api`: `Profile`, `TicketStatus`, `Ack`, `MessageType`, `ConnectionStatus`, `BotAction`, `WeekDay`, `WeekSchedule`, `PublicUser`, `AuthResponse`, `UserView`, `UserOption`, `Queue`, `Contact`, `Ticket`, `Message`, `Page<T>`, `Connection`, `ChatbotNode`, `StoredMedia`, `Company`, `BotState`, `BotEffect`, `StepResult`, `ApiErrorBody`.
  - `useAuth` (Zustand): `{ accessToken: string | null; user: PublicUser | null; setSession(r: AuthResponse): void; setAccessToken(t: string): void; clear(): void }`.
  - `refreshTokenStorage = { get(): string | null; set(t: string): void; clear(): void }` (chave `whatson.refreshToken`).
  - `API_URL: string`, `api: AxiosInstance` (baseURL `${API_URL}/api`, injeta Bearer, renova em 401), `refreshAccessToken(): Promise<string | null>`.
  - `errorMessage(err: unknown, fallback?: string): string`, `errorCode(err: unknown): string | undefined`.
  - `createQueryClient(): QueryClient`.
  - `formatTime(iso)`, `formatPhone(number)`, `initials(name)`, `mediaSrc(url)`.
  - `useDebounced<T>(value: T, delayMs?: number): T`.

- [ ] **Step 1: Escrever os testes que falham**

`frontend/src/lib/api.test.ts`:

```ts
import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import type { PublicUser } from "@/types/api";
import { refreshTokenStorage, useAuth } from "@/stores/auth";
import { api } from "./api";
import { errorCode, errorMessage } from "./apiError";

const user: PublicUser = { id: 1, companyId: 1, name: "Ana", email: "ana@test.local", profile: "admin" };
let apiMock: MockAdapter;
let rawMock: MockAdapter;

beforeEach(() => {
  apiMock = new MockAdapter(api);
  rawMock = new MockAdapter(axios);
  useAuth.getState().clear();
});

afterEach(() => {
  apiMock.restore();
  rawMock.restore();
});

describe("api client", () => {
  it("sends the access token as a bearer header", async () => {
    useAuth.setState({ accessToken: "abc", user });
    apiMock.onGet("/queues").reply((config) => [200, { auth: config.headers?.Authorization }]);
    const { data } = await api.get("/queues");
    expect(data.auth).toBe("Bearer abc");
  });

  it("refreshes once for concurrent 401s and retries the requests", async () => {
    useAuth.setState({ accessToken: "old", user });
    refreshTokenStorage.set("r1");
    apiMock
      .onGet("/tickets")
      .reply((config) => (config.headers?.Authorization === "Bearer new" ? [200, { ok: true }] : [401, {}]));
    rawMock.onPost("/api/auth/refresh").reply(200, { accessToken: "new", refreshToken: "r2", user });

    const [a, b] = await Promise.all([api.get("/tickets"), api.get("/tickets")]);

    expect(a.data).toEqual({ ok: true });
    expect(b.data).toEqual({ ok: true });
    expect(rawMock.history.post).toHaveLength(1);
    expect(refreshTokenStorage.get()).toBe("r2");
    expect(useAuth.getState().accessToken).toBe("new");
  });

  it("clears the session when the refresh fails", async () => {
    useAuth.setState({ accessToken: "old", user });
    refreshTokenStorage.set("r1");
    apiMock.onGet("/tickets").reply(401, {});
    rawMock.onPost("/api/auth/refresh").reply(401, { error: { code: "INVALID_REFRESH", message: "Sessão expirada" } });

    await expect(api.get("/tickets")).rejects.toBeDefined();
    expect(useAuth.getState().user).toBeNull();
    expect(refreshTokenStorage.get()).toBeNull();
  });

  it("does not try to refresh failed auth calls", async () => {
    apiMock.onPost("/auth/login").reply(401, { error: { code: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos" } });
    await expect(api.post("/auth/login", {})).rejects.toBeDefined();
    expect(rawMock.history.post).toHaveLength(0);
  });
});

describe("errorMessage", () => {
  it("uses the API message and code", async () => {
    apiMock.onGet("/x").reply(409, { error: { code: "TICKET_ALREADY_ACCEPTED", message: "Já foi aceito" } });
    const err = await api.get("/x").catch((e: unknown) => e);
    expect(errorMessage(err)).toBe("Já foi aceito");
    expect(errorCode(err)).toBe("TICKET_ALREADY_ACCEPTED");
  });

  it("explains network failures and falls back otherwise", async () => {
    apiMock.onGet("/y").networkError();
    const err = await api.get("/y").catch((e: unknown) => e);
    expect(errorMessage(err)).toBe("Sem conexão com o servidor. Verifique sua internet.");
    expect(errorMessage(new Error("boom"))).toBe("Algo deu errado. Tente novamente.");
  });
});
```

`frontend/src/lib/format.test.ts`:

```ts
import { formatPhone, initials } from "./format";

describe("format helpers", () => {
  it("formats Brazilian mobile and landline numbers", () => {
    expect(formatPhone("5511988887777")).toBe("+55 (11) 98888-7777");
    expect(formatPhone("551133334444")).toBe("+55 (11) 3333-4444");
    expect(formatPhone("123456789012345")).toBe("123456789012345");
  });

  it("builds initials", () => {
    expect(initials("Maria Souza Lima")).toBe("MS");
    expect(initials("  ")).toBe("?");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib`
Expected: FAIL com `Failed to resolve import "@/stores/auth"`.

- [ ] **Step 3: Implementar**

`frontend/src/types/api.ts`:

```ts
export type Profile = "admin" | "supervisor" | "agent";
export type TicketStatus = "bot" | "pending" | "open" | "closed";
export type Ack = "pending" | "sent" | "delivered" | "read" | "failed";
export type MessageType = "text" | "image" | "audio" | "video" | "document" | "sticker" | "location";
export type ConnectionStatus = "disconnected" | "qrcode" | "connected";
export type BotAction = "submenu" | "reply" | "transfer_queue" | "transfer_agent" | "close";
export type WeekDay = "0" | "1" | "2" | "3" | "4" | "5" | "6";
export type WeekSchedule = Partial<Record<WeekDay, string[]>>;

export interface PublicUser {
  id: number;
  companyId: number;
  name: string;
  email: string;
  profile: Profile;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

export interface UserView extends PublicUser {
  queueIds: number[];
}

export interface UserOption {
  id: number;
  name: string;
  queueIds: number[];
}

export interface Queue {
  id: number;
  companyId: number;
  name: string;
  color: string;
  schedule: WeekSchedule;
}

export interface Contact {
  id: number;
  companyId: number;
  name: string;
  number: string;
  profilePicUrl: string | null;
  isGroup: boolean;
}

export interface Ticket {
  id: number;
  companyId: number;
  contactId: number;
  connectionId: number;
  queueId: number | null;
  userId: number | null;
  status: TicketStatus;
  chatbotNodeId: number | null;
  chatbotAttempts: number;
  lastMessage: string;
  lastMessageAt: string | null;
  unreadCount: number;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  contact?: Contact;
  queue?: Queue | null;
  user?: { id: number; name: string } | null;
}

export interface Message {
  id: number;
  companyId: number;
  ticketId: number;
  connectionId: number;
  providerMessageId: string | null;
  fromMe: boolean;
  body: string;
  type: MessageType;
  mediaUrl: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  ack: Ack;
  quotedMessageId: number | null;
  sentByUserId: number | null;
  isBot: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  hasMore: boolean;
}

export interface Connection {
  id: number;
  companyId: number;
  name: string;
  instanceName: string;
  status: ConnectionStatus;
  number: string | null;
  isDefault: boolean;
  defaultQueueId: number | null;
  outOfHoursMessage: string;
  closingMessage: string;
  transferMessage: string;
  botTimeoutMinutes: number;
}

export interface ChatbotNode {
  id: number;
  companyId: number;
  connectionId: number;
  parentId: number | null;
  order: number;
  key: string;
  title: string;
  action: BotAction;
  message: string;
  mediaUrl: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  queueId: number | null;
  userId: number | null;
}

export interface StoredMedia {
  url: string;
  mime: string;
  name: string | null;
}

export interface Company {
  id: number;
  name: string;
  status: string;
  timezone: string;
}

export interface BotState {
  nodeId: number | null;
  attempts: number;
}

export type BotEffect =
  | { type: "send_text"; text: string }
  | { type: "send_media"; media: StoredMedia; caption: string }
  | { type: "transfer"; queueId: number | null; userId: number | null }
  | { type: "close" };

export interface StepResult {
  effects: BotEffect[];
  state: BotState;
  finished: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
```

`frontend/src/stores/auth.ts`:

```ts
import { create } from "zustand";
import type { AuthResponse, PublicUser } from "@/types/api";

const REFRESH_KEY = "whatson.refreshToken";

export const refreshTokenStorage = {
  get(): string | null {
    try {
      return localStorage.getItem(REFRESH_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      localStorage.setItem(REFRESH_KEY, token);
    } catch {
      // armazenamento indisponível: a sessão dura até fechar a aba
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(REFRESH_KEY);
    } catch {
      // ignorado
    }
  },
};

interface AuthState {
  accessToken: string | null;
  user: PublicUser | null;
  setSession(response: AuthResponse): void;
  setAccessToken(token: string): void;
  clear(): void;
}

export const useAuth = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setSession: (response) => {
    refreshTokenStorage.set(response.refreshToken);
    set({ accessToken: response.accessToken, user: response.user });
  },
  setAccessToken: (token) => set({ accessToken: token }),
  clear: () => {
    refreshTokenStorage.clear();
    set({ accessToken: null, user: null });
  },
}));
```

`frontend/src/lib/api.ts`:

```ts
import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { refreshTokenStorage, useAuth } from "@/stores/auth";
import type { AuthResponse } from "@/types/api";

export const API_URL: string = import.meta.env.VITE_API_URL ?? "";

export const api = axios.create({ baseURL: `${API_URL}/api` });

api.interceptors.request.use((config) => {
  const token = useAuth.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

/** Renova o access token usando o refresh token salvo. Chamadas simultâneas compartilham a mesma renovação. */
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = (async () => {
      const refreshToken = refreshTokenStorage.get();
      if (!refreshToken) return null;
      try {
        const { data } = await axios.post<AuthResponse>(`${API_URL}/api/auth/refresh`, { refreshToken });
        useAuth.getState().setSession(data);
        return data.accessToken;
      } catch {
        useAuth.getState().clear();
        return null;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const isAuthCall = original?.url?.startsWith("/auth/") ?? false;
    if (error.response?.status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true;
      const token = await refreshAccessToken();
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);
```

`frontend/src/lib/apiError.ts`:

```ts
import axios from "axios";
import type { ApiErrorBody } from "@/types/api";

export function errorCode(err: unknown): string | undefined {
  if (!axios.isAxiosError(err)) return undefined;
  return (err.response?.data as ApiErrorBody | undefined)?.error?.code;
}

export function errorMessage(err: unknown, fallback = "Algo deu errado. Tente novamente."): string {
  if (axios.isAxiosError(err)) {
    const message = (err.response?.data as ApiErrorBody | undefined)?.error?.message;
    if (message) return message;
    if (!err.response) return "Sem conexão com o servidor. Verifique sua internet.";
  }
  return fallback;
}
```

`frontend/src/lib/queryClient.ts`:

```ts
import { QueryClient } from "@tanstack/react-query";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}
```

`frontend/src/lib/format.ts`:

```ts
import { API_URL } from "./api";

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function formatPhone(number: string): string {
  const digits = number.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length === 13) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.startsWith("55") && digits.length === 12) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return number;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}

export function mediaSrc(url: string): string {
  return `${API_URL}${url}`;
}
```

`frontend/src/lib/useDebounced.ts`:

```ts
import { useEffect, useState } from "react";

export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
```

`frontend/src/test/setup.ts` (substituir) — nenhuma requisição HTTP real sai dos testes; quem precisa de respostas usa `axios-mock-adapter` ou mocka o módulo de API:

```ts
import "@testing-library/jest-dom/vitest";
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { api } from "@/lib/api";

const offline = (config: InternalAxiosRequestConfig) =>
  Promise.reject(new AxiosError("Rede desativada nos testes", "ERR_NETWORK", config));
api.defaults.adapter = offline;
axios.defaults.adapter = offline;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat(frontend): tipos da API, cliente HTTP com renovação de token e sessão"
```

---

### Task 3: Rotas, layout com barra lateral e login

**Files:**
- Create: `frontend/src/features/auth/{authApi.ts,useBootstrapSession.ts,LoginPage.tsx}`
- Create: `frontend/src/components/layout/{ProtectedRoute.tsx,Sidebar.tsx,AppShell.tsx,PageHeader.tsx}`
- Create: `frontend/src/features/tickets/TicketsPage.tsx` (versão inicial; substituída na Task 8)
- Create: `frontend/src/app/routes.tsx`, `frontend/src/App.tsx`, `frontend/src/main.tsx`
- Create: `frontend/src/test/utils.tsx`
- Test: `frontend/src/features/auth/LoginPage.test.tsx`, `frontend/src/components/layout/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `api`, `useAuth`, `refreshTokenStorage`, `refreshAccessToken`, `errorMessage`, `createQueryClient`, UI (Task 1–2).
- Produces:
  - `login(email: string, password: string): Promise<AuthResponse>`, `logout(): Promise<void>`.
  - `useBootstrapSession(): boolean` (true quando a sessão salva foi restaurada ou não havia sessão).
  - `ProtectedRoute({ children })` (redireciona para `/login`), `RequireProfile({ profiles: Profile[]; children })` (redireciona para `/atendimento`).
  - `NAV_ITEMS: { to: string; label: string; icon: LucideIcon; profiles: Profile[] }[]`, `navItemsFor(profile: Profile)`.
  - `AppShell` (layout com `<Outlet />`), `PageHeader({ title, description?, actions? })`.
  - `AppRoutes` em `src/app/routes.tsx`: `/login`, `/` → `/atendimento`, `/atendimento` e `/atendimento/:ticketId` (TicketsPage). Tasks seguintes acrescentam rotas aqui.
  - Helpers de teste em `src/test/utils.tsx`: `createTestQueryClient()`, `setTestUser(partial?): PublicUser`, `renderWithProviders(ui, { route?, queryClient?, socket? })` (o parâmetro `socket` passa a funcionar na Task 4).

- [ ] **Step 1: Escrever os testes que falham**

`frontend/src/test/utils.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { useAuth } from "@/stores/auth";
import type { PublicUser } from "@/types/api";

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
}

export function setTestUser(partial: Partial<PublicUser> = {}): PublicUser {
  const user: PublicUser = {
    id: 1,
    companyId: 1,
    name: "Ana Atendente",
    email: "ana@test.local",
    profile: "agent",
    ...partial,
  };
  useAuth.setState({ accessToken: "test-token", user });
  return user;
}

export function renderWithProviders(
  ui: ReactElement,
  { route = "/", queryClient = createTestQueryClient() }: { route?: string; queryClient?: QueryClient } = {},
) {
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}
```

`frontend/src/features/auth/LoginPage.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { AppRoutes } from "@/app/routes";
import { useAuth } from "@/stores/auth";
import { renderWithProviders } from "@/test/utils";
import { login } from "./authApi";

vi.mock("./authApi", () => ({ login: vi.fn(), logout: vi.fn() }));

const user = { id: 7, companyId: 1, name: "Bruno", email: "bruno@test.local", profile: "admin" as const };

function apiError(status: number, code: string, message: string) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError("fail", "ERR", config, null, {
    status,
    statusText: "",
    headers: {},
    config,
    data: { error: { code, message } },
  });
}

describe("LoginPage", () => {
  beforeEach(() => useAuth.getState().clear());

  it("logs in and opens the attendance screen", async () => {
    vi.mocked(login).mockResolvedValue({ accessToken: "a", refreshToken: "r", user });
    renderWithProviders(<AppRoutes />, { route: "/login" });

    await userEvent.type(screen.getByLabelText("E-mail"), "bruno@test.local");
    await userEvent.type(screen.getByLabelText("Senha"), "senha123");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByRole("heading", { name: "Atendimentos" })).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith("bruno@test.local", "senha123");
    expect(useAuth.getState().user?.id).toBe(7);
  });

  it("shows the API error on invalid credentials", async () => {
    vi.mocked(login).mockRejectedValue(apiError(401, "INVALID_CREDENTIALS", "E-mail ou senha inválidos"));
    renderWithProviders(<AppRoutes />, { route: "/login" });

    await userEvent.type(screen.getByLabelText("E-mail"), "x@test.local");
    await userEvent.type(screen.getByLabelText("Senha"), "errada");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("E-mail ou senha inválidos");
  });

  it("redirects anonymous visitors to the login page", () => {
    renderWithProviders(<AppRoutes />, { route: "/atendimento" });
    expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument();
  });
});
```

`frontend/src/components/layout/Sidebar.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { AppRoutes } from "@/app/routes";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { navItemsFor } from "./Sidebar";

describe("Sidebar", () => {
  it("shows only the agent's pages to agents", () => {
    setTestUser({ profile: "agent" });
    renderWithProviders(<AppRoutes />, { route: "/atendimento" });
    expect(screen.getByRole("link", { name: "Atendimento" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contatos" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Conexões" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Usuários" })).not.toBeInTheDocument();
  });

  it("gives admins every page and supervisors the user list", () => {
    expect(navItemsFor("admin").map((i) => i.label)).toEqual([
      "Atendimento",
      "Contatos",
      "Filas",
      "Usuários",
      "Conexões",
      "Chatbot",
      "Configurações",
    ]);
    expect(navItemsFor("supervisor").map((i) => i.label)).toEqual(["Atendimento", "Contatos", "Usuários"]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/auth src/components/layout`
Expected: FAIL com `Failed to resolve import "@/app/routes"`.

- [ ] **Step 3: Implementar**

`frontend/src/features/auth/authApi.ts`:

```ts
import { api } from "@/lib/api";
import type { AuthResponse } from "@/types/api";

export async function login(email: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>("/auth/login", { email, password });
  return data;
}

export async function logout(): Promise<void> {
  await api.post("/auth/logout").catch(() => undefined);
}
```

`frontend/src/features/auth/useBootstrapSession.ts`:

```ts
import { useEffect, useState } from "react";
import { refreshAccessToken } from "@/lib/api";
import { refreshTokenStorage, useAuth } from "@/stores/auth";

/** Restaura a sessão a partir do refresh token salvo antes de renderizar as rotas. */
export function useBootstrapSession(): boolean {
  const [ready, setReady] = useState(() => Boolean(useAuth.getState().accessToken) || !refreshTokenStorage.get());
  useEffect(() => {
    if (ready) return;
    void refreshAccessToken().finally(() => setReady(true));
  }, [ready]);
  return ready;
}
```

`frontend/src/features/auth/LoginPage.tsx`:

```tsx
import { MessagesSquare } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/apiError";
import { useAuth } from "@/stores/auth";
import { login } from "./authApi";

export function LoginPage() {
  const user = useAuth((s) => s.user);
  const setSession = useAuth((s) => s.setSession);
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-8 flex items-center gap-3">
          <div className="rounded-xl bg-primary p-2.5 text-white">
            <MessagesSquare className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <p className="text-xl font-bold tracking-tight">WHATSON</p>
            <p className="text-sm text-ink-muted">Atendimento multicanal</p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" loading={loading} disabled={!email || !password}>
            Entrar
          </Button>
        </form>
      </Card>
    </main>
  );
}
```

`frontend/src/components/layout/ProtectedRoute.tsx`:

```tsx
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/stores/auth";
import type { Profile } from "@/types/api";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user);
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function RequireProfile({ profiles, children }: { profiles: Profile[]; children: ReactNode }) {
  const user = useAuth((s) => s.user);
  if (!user || !profiles.includes(user.profile)) return <Navigate to="/atendimento" replace />;
  return <>{children}</>;
}
```

`frontend/src/components/layout/Sidebar.tsx`:

```tsx
import { useQueryClient } from "@tanstack/react-query";
import {
  BookUser,
  Bot,
  Layers,
  LogOut,
  MessagesSquare,
  Settings,
  Smartphone,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { logout } from "@/features/auth/authApi";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";
import { useAuth } from "@/stores/auth";
import type { Profile } from "@/types/api";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  profiles: Profile[];
}

const ALL: Profile[] = ["admin", "supervisor", "agent"];

export const NAV_ITEMS: NavItem[] = [
  { to: "/atendimento", label: "Atendimento", icon: MessagesSquare, profiles: ALL },
  { to: "/contatos", label: "Contatos", icon: BookUser, profiles: ALL },
  { to: "/filas", label: "Filas", icon: Layers, profiles: ["admin"] },
  { to: "/usuarios", label: "Usuários", icon: UserCog, profiles: ["admin", "supervisor"] },
  { to: "/conexoes", label: "Conexões", icon: Smartphone, profiles: ["admin"] },
  { to: "/chatbot", label: "Chatbot", icon: Bot, profiles: ["admin"] },
  { to: "/configuracoes", label: "Configurações", icon: Settings, profiles: ["admin"] },
];

export function navItemsFor(profile: Profile): NavItem[] {
  return NAV_ITEMS.filter((item) => item.profiles.includes(profile));
}

export function Sidebar() {
  const user = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clear);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  if (!user) return null;

  async function onLogout() {
    await logout();
    clear();
    queryClient.clear();
    navigate("/login", { replace: true });
  }

  return (
    <nav aria-label="Navegação principal" className="flex w-16 shrink-0 flex-col items-center gap-2 bg-sidebar py-4">
      <div className="mb-4 rounded-xl bg-primary p-2 text-white">
        <MessagesSquare className="h-5 w-5" aria-hidden />
      </div>
      {navItemsFor(user.profile).map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          title={label}
          aria-label={label}
          className={({ isActive }) =>
            cn(
              "rounded-lg p-2.5 text-white/60 transition hover:bg-white/10 hover:text-white",
              isActive && "bg-primary text-white hover:bg-primary",
            )
          }
        >
          <Icon className="h-5 w-5" aria-hidden />
        </NavLink>
      ))}
      <div className="mt-auto flex flex-col items-center gap-2">
        <span
          title={user.name}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white"
        >
          {initials(user.name)}
        </span>
        <button
          type="button"
          onClick={onLogout}
          title="Sair"
          aria-label="Sair"
          className="rounded-lg p-2.5 text-white/60 hover:bg-white/10 hover:text-white"
        >
          <LogOut className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </nav>
  );
}
```

`frontend/src/components/layout/AppShell.tsx`:

```tsx
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  return (
    <div className="flex h-full min-w-[768px]">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
```

`frontend/src/components/layout/PageHeader.tsx`:

```tsx
import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-border bg-surface px-6 py-5">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </header>
  );
}
```

`frontend/src/features/tickets/TicketsPage.tsx` (versão inicial, substituída na Task 8):

```tsx
export function TicketsPage() {
  return <h1 className="p-6 text-lg font-semibold">Atendimentos</h1>;
}
```

`frontend/src/app/routes.tsx`:

```tsx
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { LoginPage } from "@/features/auth/LoginPage";
import { TicketsPage } from "@/features/tickets/TicketsPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/atendimento" replace />} />
        <Route path="atendimento" element={<TicketsPage />} />
        <Route path="atendimento/:ticketId" element={<TicketsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/atendimento" replace />} />
    </Routes>
  );
}
```

`frontend/src/App.tsx`:

```tsx
import { Spinner } from "@/components/ui/spinner";
import { AppRoutes } from "@/app/routes";
import { useBootstrapSession } from "@/features/auth/useBootstrapSession";

export function App() {
  const ready = useBootstrapSession();
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  return <AppRoutes />;
}
```

`frontend/src/main.tsx`:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { App } from "./App";
import { createQueryClient } from "./lib/queryClient";
import "./index.css";

const queryClient = createQueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat(frontend): login, rotas protegidas e barra lateral por perfil"
```

---

### Task 4: Tempo real (Socket.io)

**Files:**
- Create: `frontend/src/realtime/socket.ts`, `frontend/src/realtime/RealtimeProvider.tsx`, `frontend/src/test/fakeSocket.ts`
- Modify: `frontend/src/test/setup.ts`, `frontend/src/test/utils.tsx`, `frontend/src/components/layout/AppShell.tsx`
- Test: `frontend/src/realtime/RealtimeProvider.test.tsx`

**Interfaces:**
- Consumes: `API_URL`, `useAuth`, `refreshAccessToken`.
- Produces:
  - `createSocket(token: string): Socket`.
  - `RealtimeContext` (`{ socket: Socket | null; epoch: number }`; `epoch` incrementa a cada `ready`), `RealtimeProvider({ children })`.
  - `useSocket(): Socket | null`, `useRealtimeEvent<T>(event: string, handler: (payload: T) => void): void`, `useTicketRoom(ticketId: number | null): void`.
  - Comportamento: no 2º `ready` em diante (reconexão), invalida todas as queries; erro de conexão `UNAUTHENTICATED` dispara `refreshAccessToken()`.
  - Teste: `FakeSocket` com `on`, `off`, `emit` (registra em `emitted`; ack `true` para `ticket:join`), `disconnect`, `serverEmit(event, payload?)`; `socket.io-client` mockado globalmente em `setup.ts` (`io` retorna um novo `FakeSocket`); `renderWithProviders(ui, { socket })` envolve o ui em `RealtimeContext.Provider`.

- [ ] **Step 1: Infra de teste**

`frontend/src/test/fakeSocket.ts`:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => void;

export class FakeSocket {
  handlers = new Map<string, Set<Handler>>();
  emitted: Array<{ event: string; args: unknown[] }> = [];
  disconnected = false;

  on(event: string, handler: Handler): this {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return this;
  }

  off(event: string, handler: Handler): this {
    this.handlers.get(event)?.delete(handler);
    return this;
  }

  emit(event: string, ...args: unknown[]): this {
    this.emitted.push({ event, args });
    const ack = args[args.length - 1];
    if (event === "ticket:join" && typeof ack === "function") (ack as (ok: boolean) => void)(true);
    return this;
  }

  disconnect(): this {
    this.disconnected = true;
    return this;
  }

  serverEmit(event: string, payload?: unknown): void {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }
}
```

`frontend/src/test/setup.ts` (substituir):

```ts
import "@testing-library/jest-dom/vitest";
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { api } from "@/lib/api";

const offline = (config: InternalAxiosRequestConfig) =>
  Promise.reject(new AxiosError("Rede desativada nos testes", "ERR_NETWORK", config));
api.defaults.adapter = offline;
axios.defaults.adapter = offline;

vi.mock("socket.io-client", async () => {
  const { FakeSocket } = await import("./fakeSocket");
  return { io: vi.fn(() => new FakeSocket()) };
});
```

Em `frontend/src/test/utils.tsx`, troque `renderWithProviders` por:

```tsx
export function renderWithProviders(
  ui: ReactElement,
  {
    route = "/",
    queryClient = createTestQueryClient(),
    socket,
  }: { route?: string; queryClient?: QueryClient; socket?: FakeSocket } = {},
) {
  const content = socket ? (
    <RealtimeContext.Provider value={{ socket: socket as unknown as Socket, epoch: 1 }}>{ui}</RealtimeContext.Provider>
  ) : (
    ui
  );
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>{content}</MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}
```

e acrescente os imports:

```tsx
import type { Socket } from "socket.io-client";
import { RealtimeContext } from "@/realtime/RealtimeProvider";
import type { FakeSocket } from "./fakeSocket";
```

- [ ] **Step 2: Escrever o teste que falha**

`frontend/src/realtime/RealtimeProvider.test.tsx`:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { io } from "socket.io-client";
import { useState } from "react";
import { refreshAccessToken } from "@/lib/api";
import type { FakeSocket } from "@/test/fakeSocket";
import { createTestQueryClient, setTestUser } from "@/test/utils";
import { RealtimeProvider, useRealtimeEvent, useTicketRoom } from "./RealtimeProvider";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  refreshAccessToken: vi.fn().mockResolvedValue(null),
}));

function lastSocket(): FakeSocket {
  return vi.mocked(io).mock.results.at(-1)!.value as FakeSocket;
}

function Probe({ ticketId }: { ticketId: number | null }) {
  const [last, setLast] = useState("nenhum");
  useRealtimeEvent<{ text: string }>("demo:event", (p) => setLast(p.text));
  useTicketRoom(ticketId);
  return <p>último: {last}</p>;
}

function renderProvider(ticketId: number | null = null) {
  setTestUser();
  const queryClient = createTestQueryClient();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider>
        <Probe ticketId={ticketId} />
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient, socket: lastSocket() };
}

describe("RealtimeProvider", () => {
  it("connects with the access token", () => {
    renderProvider();
    expect(io).toHaveBeenLastCalledWith(undefined, expect.objectContaining({ auth: { token: "test-token" } }));
  });

  it("delivers server events to subscribers after ready", () => {
    const { socket } = renderProvider();
    act(() => socket.serverEmit("ready"));
    act(() => socket.serverEmit("demo:event", { text: "olá" }));
    expect(screen.getByText("último: olá")).toBeInTheDocument();
  });

  it("refetches everything when the socket becomes ready again after a reconnect", () => {
    const { socket, queryClient } = renderProvider();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    act(() => socket.serverEmit("ready"));
    expect(spy).not.toHaveBeenCalled();
    act(() => socket.serverEmit("ready"));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("joins the ticket room on ready, rejoins after reconnect and leaves on unmount", () => {
    const { socket, unmount } = renderProvider(42);
    act(() => socket.serverEmit("ready"));
    act(() => socket.serverEmit("ready"));
    const joins = socket.emitted.filter((e) => e.event === "ticket:join");
    expect(joins).toHaveLength(2);
    expect(joins[0]?.args[0]).toBe(42);
    unmount();
    expect(socket.emitted.some((e) => e.event === "ticket:leave" && e.args[0] === 42)).toBe(true);
    expect(socket.disconnected).toBe(true);
  });

  it("renews the token when the server rejects the connection", async () => {
    const { socket } = renderProvider();
    await act(async () => socket.serverEmit("connect_error", new Error("UNAUTHENTICATED")));
    expect(refreshAccessToken).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/realtime`
Expected: FAIL com `Failed to resolve import "./RealtimeProvider"`.

- [ ] **Step 4: Implementar**

`frontend/src/realtime/socket.ts`:

```ts
import { io, type Socket } from "socket.io-client";
import { API_URL } from "@/lib/api";

export function createSocket(token: string): Socket {
  return io(API_URL || undefined, { auth: { token }, transports: ["websocket"] });
}
```

`frontend/src/realtime/RealtimeProvider.tsx`:

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Socket } from "socket.io-client";
import { refreshAccessToken } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { createSocket } from "./socket";

interface RealtimeValue {
  socket: Socket | null;
  epoch: number;
}

export const RealtimeContext = createContext<RealtimeValue>({ socket: null, epoch: 0 });

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [value, setValue] = useState<RealtimeValue>({ socket: null, epoch: 0 });
  const hadReady = useRef(false);

  useEffect(() => {
    if (!token) return;
    const socket = createSocket(token);

    socket.on("ready", () => {
      if (hadReady.current) void queryClient.invalidateQueries();
      hadReady.current = true;
      setValue((prev) => ({ socket, epoch: prev.epoch + 1 }));
    });

    socket.on("connect_error", (err: Error) => {
      if (err.message === "UNAUTHENTICATED") void refreshAccessToken();
    });

    return () => {
      socket.disconnect();
      setValue({ socket: null, epoch: 0 });
    };
  }, [token, queryClient]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useSocket(): Socket | null {
  return useContext(RealtimeContext).socket;
}

export function useRealtimeEvent<T>(event: string, handler: (payload: T) => void): void {
  const socket = useSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!socket) return;
    const listener = (payload: T) => handlerRef.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [socket, event]);
}

/** Entra na sala do ticket (e reentra a cada reconexão) para receber eventos de mensagem. */
export function useTicketRoom(ticketId: number | null): void {
  const { socket, epoch } = useContext(RealtimeContext);
  useEffect(() => {
    if (!socket || ticketId === null) return;
    socket.emit("ticket:join", ticketId, () => undefined);
    return () => {
      socket.emit("ticket:leave", ticketId);
    };
  }, [socket, epoch, ticketId]);
}
```

`frontend/src/components/layout/AppShell.tsx` (substituir):

```tsx
import { Outlet } from "react-router-dom";
import { RealtimeProvider } from "@/realtime/RealtimeProvider";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  return (
    <RealtimeProvider>
      <div className="flex h-full min-w-[768px]">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </RealtimeProvider>
  );
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: todos PASS (incluindo os testes da Task 3, agora com o socket mockado).

- [ ] **Step 6: Commit**

```bash
git add frontend
git commit -m "feat(frontend): provider de tempo real com reconexão e salas de ticket"
```

---

### Task 5: Dados de tickets — API, visibilidade e cache em tempo real

**Files:**
- Create: `frontend/src/features/users/usersApi.ts` (só as opções de usuário; a Task 11 completa)
- Create: `frontend/src/features/tickets/{ticketsApi.ts,visibility.ts,ticketCache.ts,useTickets.ts}`
- Create: `frontend/src/test/factories.ts`
- Test: `frontend/src/features/tickets/visibility.test.ts`, `frontend/src/features/tickets/ticketCache.test.ts`, `frontend/src/features/tickets/useTickets.test.tsx`

**Interfaces:**
- Consumes: `api`, `useAuth`, `useRealtimeEvent`, tipos `Ticket`, `TicketStatus`, `Page`, `UserOption`, `Profile`.
- Produces:
  - `userKeys = { all: ["users"], options: ["users", "options"] }`, `fetchUserOptions(): Promise<UserOption[]>`, `useUserOptions()`.
  - `ticketKeys = { lists: ["tickets","list"], list(status, search), detail(id) }`; `fetchTickets(status, search, page): Promise<Page<Ticket>>`, `fetchTicket(id)`, `acceptTicket(id)`, `transferTicket(id, { queueId?, userId? })`, `closeTicket(id)`, `markTicketRead(id)` (todos `Promise<Ticket>` exceto `fetchTickets`).
  - `interface Viewer { userId: number; profile: Profile; queueIds: number[] }`; `ticketVisibleIn(ticket, status, viewer): boolean`; `matchesSearch(ticket, search): boolean`.
  - `type TicketPages = InfiniteData<Page<Ticket>, number>`; `upsertTicket(data, ticket, belongs): TicketPages`; `applyTicketUpdate(queryClient, ticket, viewer): void`.
  - `useViewer(): Viewer | null`, `useTicketList(status, search)` (infinite query), `useTicket(id: number | null)`, `useTicketRealtime()` (aplica `ticket:update`), `useApplyTicket(): (ticket: Ticket) => void`.
  - Teste: `makeTicket(partial?)` e `makeContact(partial?)` em `src/test/factories.ts`.

Regras de visibilidade (espelham o backend após a revisão final): supervisor/admin veem todos os tickets do status; agente vê `pending` atribuído a ele ou sem atendente em uma das suas filas ou sem fila; `open`/`closed` só os dele; `bot` nunca.

- [ ] **Step 1: Escrever os testes que falham**

`frontend/src/test/factories.ts`:

```ts
import type { Contact, Ticket } from "@/types/api";

export function makeContact(partial: Partial<Contact> = {}): Contact {
  return { id: 1, companyId: 1, name: "Maria Souza", number: "5511988887777", profilePicUrl: null, isGroup: false, ...partial };
}

export function makeTicket(partial: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    companyId: 1,
    contactId: 1,
    connectionId: 1,
    queueId: 10,
    userId: null,
    status: "pending",
    chatbotNodeId: null,
    chatbotAttempts: 0,
    lastMessage: "Oi",
    lastMessageAt: "2026-10-14T10:00:00.000Z",
    unreadCount: 0,
    closedAt: null,
    createdAt: "2026-10-14T09:00:00.000Z",
    updatedAt: "2026-10-14T10:00:00.000Z",
    contact: makeContact(),
    queue: { id: 10, companyId: 1, name: "Suporte", color: "#6d5dfc", schedule: {} },
    user: null,
    ...partial,
  };
}
```

`frontend/src/features/tickets/visibility.test.ts`:

```ts
import { makeContact, makeTicket } from "@/test/factories";
import { matchesSearch, ticketVisibleIn, type Viewer } from "./visibility";

const agent: Viewer = { userId: 1, profile: "agent", queueIds: [10] };
const supervisor: Viewer = { userId: 2, profile: "supervisor", queueIds: [] };

describe("ticketVisibleIn", () => {
  it("shows agents pending tickets of their queues, without queue, or assigned to them", () => {
    expect(ticketVisibleIn(makeTicket({ queueId: 10 }), "pending", agent)).toBe(true);
    expect(ticketVisibleIn(makeTicket({ queueId: null }), "pending", agent)).toBe(true);
    expect(ticketVisibleIn(makeTicket({ queueId: 20, userId: 1 }), "pending", agent)).toBe(true);
    expect(ticketVisibleIn(makeTicket({ queueId: 20 }), "pending", agent)).toBe(false);
    expect(ticketVisibleIn(makeTicket({ queueId: 10, userId: 5 }), "pending", agent)).toBe(false);
  });

  it("shows agents only their own open and closed tickets and never bot tickets", () => {
    expect(ticketVisibleIn(makeTicket({ status: "open", userId: 1 }), "open", agent)).toBe(true);
    expect(ticketVisibleIn(makeTicket({ status: "open", userId: 9 }), "open", agent)).toBe(false);
    expect(ticketVisibleIn(makeTicket({ status: "closed", userId: 1 }), "closed", agent)).toBe(true);
    expect(ticketVisibleIn(makeTicket({ status: "bot" }), "bot", agent)).toBe(false);
  });

  it("shows supervisors everything, but only in the matching status tab", () => {
    expect(ticketVisibleIn(makeTicket({ status: "bot" }), "bot", supervisor)).toBe(true);
    expect(ticketVisibleIn(makeTicket({ status: "open", userId: 9 }), "open", supervisor)).toBe(true);
    expect(ticketVisibleIn(makeTicket({ status: "open" }), "pending", supervisor)).toBe(false);
  });
});

describe("matchesSearch", () => {
  it("matches the contact name case-insensitively or the number", () => {
    const ticket = makeTicket({ contact: makeContact({ name: "Maria Souza", number: "5511988887777" }) });
    expect(matchesSearch(ticket, "")).toBe(true);
    expect(matchesSearch(ticket, "maria")).toBe(true);
    expect(matchesSearch(ticket, "98888")).toBe(true);
    expect(matchesSearch(ticket, "joão")).toBe(false);
  });
});
```

`frontend/src/features/tickets/ticketCache.test.ts`:

```ts
import { makeTicket } from "@/test/factories";
import { createTestQueryClient } from "@/test/utils";
import { ticketKeys } from "./ticketsApi";
import { applyTicketUpdate, upsertTicket, type TicketPages } from "./ticketCache";

const pages = (...ids: Array<{ id: number; at: string }>): TicketPages => ({
  pages: [{ items: ids.map(({ id, at }) => makeTicket({ id, lastMessageAt: at })), hasMore: false }],
  pageParams: [1],
});

describe("upsertTicket", () => {
  it("moves an updated ticket to the top by last message time", () => {
    const data = pages({ id: 1, at: "2026-10-14T10:00:00Z" }, { id: 2, at: "2026-10-14T09:00:00Z" });
    const result = upsertTicket(data, makeTicket({ id: 2, lastMessageAt: "2026-10-14T11:00:00Z" }), true);
    expect(result.pages[0]!.items.map((t) => t.id)).toEqual([2, 1]);
  });

  it("removes a ticket that no longer belongs to the list", () => {
    const data = pages({ id: 1, at: "2026-10-14T10:00:00Z" }, { id: 2, at: "2026-10-14T09:00:00Z" });
    const result = upsertTicket(data, makeTicket({ id: 1 }), false);
    expect(result.pages[0]!.items.map((t) => t.id)).toEqual([2]);
  });
});

describe("applyTicketUpdate", () => {
  const viewer = { userId: 1, profile: "agent" as const, queueIds: [10] };

  it("moves a ticket from the pending tab to the open tab when the agent accepts it", () => {
    const qc = createTestQueryClient();
    qc.setQueryData(ticketKeys.list("pending", ""), pages({ id: 1, at: "2026-10-14T10:00:00Z" }));
    qc.setQueryData(ticketKeys.list("open", ""), { pages: [{ items: [], hasMore: false }], pageParams: [1] });

    applyTicketUpdate(qc, makeTicket({ id: 1, status: "open", userId: 1 }), viewer);

    expect(qc.getQueryData<TicketPages>(ticketKeys.list("pending", ""))!.pages[0]!.items).toHaveLength(0);
    expect(qc.getQueryData<TicketPages>(ticketKeys.list("open", ""))!.pages[0]!.items.map((t) => t.id)).toEqual([1]);
    expect(qc.getQueryData(ticketKeys.detail(1))).toMatchObject({ status: "open" });
  });

  it("removes the ticket from the agent's open tab when it is transferred to someone else", () => {
    const qc = createTestQueryClient();
    qc.setQueryData(
      ticketKeys.list("open", ""),
      { pages: [{ items: [makeTicket({ id: 3, status: "open", userId: 1 })], hasMore: false }], pageParams: [1] },
    );
    applyTicketUpdate(qc, makeTicket({ id: 3, status: "pending", userId: 9, queueId: 20 }), viewer);
    expect(qc.getQueryData<TicketPages>(ticketKeys.list("open", ""))!.pages[0]!.items).toHaveLength(0);
  });

  it("respects the search term of each cached list", () => {
    const qc = createTestQueryClient();
    qc.setQueryData(ticketKeys.list("pending", "joão"), { pages: [{ items: [], hasMore: false }], pageParams: [1] });
    applyTicketUpdate(qc, makeTicket({ id: 4 }), viewer);
    expect(qc.getQueryData<TicketPages>(ticketKeys.list("pending", "joão"))!.pages[0]!.items).toHaveLength(0);
  });
});
```

`frontend/src/features/tickets/useTickets.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Socket } from "socket.io-client";
import { RealtimeContext } from "@/realtime/RealtimeProvider";
import { FakeSocket } from "@/test/fakeSocket";
import { makeTicket } from "@/test/factories";
import { createTestQueryClient, setTestUser } from "@/test/utils";
import { fetchUserOptions } from "@/features/users/usersApi";
import { ticketKeys } from "./ticketsApi";
import type { TicketPages } from "./ticketCache";
import { useTicketRealtime, useViewer } from "./useTickets";

vi.mock("@/features/users/usersApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/users/usersApi")>()),
  fetchUserOptions: vi.fn(),
}));

describe("useTicketRealtime", () => {
  it("applies ticket:update events to the cached lists using the agent's queues", async () => {
    setTestUser({ id: 1, profile: "agent" });
    vi.mocked(fetchUserOptions).mockResolvedValue([{ id: 1, name: "Ana", queueIds: [10] }]);
    const qc = createTestQueryClient();
    qc.setQueryData(ticketKeys.list("pending", ""), { pages: [{ items: [], hasMore: false }], pageParams: [1] });
    const socket = new FakeSocket();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>
        <RealtimeContext.Provider value={{ socket: socket as unknown as Socket, epoch: 1 }}>{children}</RealtimeContext.Provider>
      </QueryClientProvider>
    );

    const { result } = renderHook(
      () => {
        useTicketRealtime();
        return useViewer();
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current?.queueIds).toEqual([10]));

    act(() => socket.serverEmit("ticket:update", makeTicket({ id: 5, queueId: 10 })));

    const items = qc.getQueryData<TicketPages>(ticketKeys.list("pending", ""))!.pages[0]!.items;
    expect(items.map((t) => t.id)).toEqual([5]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/tickets`
Expected: FAIL com `Failed to resolve import "./visibility"`.

- [ ] **Step 3: Implementar**

`frontend/src/features/users/usersApi.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { UserOption } from "@/types/api";

export const userKeys = {
  all: ["users"] as const,
  options: ["users", "options"] as const,
};

export async function fetchUserOptions(): Promise<UserOption[]> {
  const { data } = await api.get<UserOption[]>("/users/options");
  return data;
}

export function useUserOptions() {
  return useQuery({ queryKey: userKeys.options, queryFn: fetchUserOptions, staleTime: 60_000 });
}
```

`frontend/src/features/tickets/ticketsApi.ts`:

```ts
import { api } from "@/lib/api";
import type { Page, Ticket, TicketStatus } from "@/types/api";

export const ticketKeys = {
  lists: ["tickets", "list"] as const,
  list: (status: TicketStatus, search: string) => ["tickets", "list", status, search] as const,
  detail: (id: number) => ["tickets", "detail", id] as const,
};

export async function fetchTickets(status: TicketStatus, search: string, page: number): Promise<Page<Ticket>> {
  const { data } = await api.get<Page<Ticket>>("/tickets", { params: { status, page, ...(search ? { search } : {}) } });
  return data;
}

export async function fetchTicket(id: number): Promise<Ticket> {
  const { data } = await api.get<Ticket>(`/tickets/${id}`);
  return data;
}

export async function acceptTicket(id: number): Promise<Ticket> {
  const { data } = await api.post<Ticket>(`/tickets/${id}/accept`);
  return data;
}

export async function transferTicket(id: number, body: { queueId?: number; userId?: number }): Promise<Ticket> {
  const { data } = await api.post<Ticket>(`/tickets/${id}/transfer`, body);
  return data;
}

export async function closeTicket(id: number): Promise<Ticket> {
  const { data } = await api.post<Ticket>(`/tickets/${id}/close`);
  return data;
}

export async function markTicketRead(id: number): Promise<Ticket> {
  const { data } = await api.post<Ticket>(`/tickets/${id}/read`);
  return data;
}
```

`frontend/src/features/tickets/visibility.ts`:

```ts
import type { Profile, Ticket, TicketStatus } from "@/types/api";

export interface Viewer {
  userId: number;
  profile: Profile;
  queueIds: number[];
}

/** Espelha a regra de visibilidade do backend para decidir em qual aba um ticket atualizado aparece. */
export function ticketVisibleIn(ticket: Ticket, status: TicketStatus, viewer: Viewer): boolean {
  if (ticket.status !== status) return false;
  if (viewer.profile !== "agent") return true;
  if (status === "bot") return false;
  if (ticket.userId === viewer.userId) return true;
  return (
    status === "pending" &&
    ticket.userId === null &&
    (ticket.queueId === null || viewer.queueIds.includes(ticket.queueId))
  );
}

export function matchesSearch(ticket: Ticket, search: string): boolean {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  const contact = ticket.contact;
  return Boolean(contact) && (contact!.name.toLowerCase().includes(term) || contact!.number.includes(term));
}
```

`frontend/src/features/tickets/ticketCache.ts`:

```ts
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { Page, Ticket, TicketStatus } from "@/types/api";
import { ticketKeys } from "./ticketsApi";
import { matchesSearch, ticketVisibleIn, type Viewer } from "./visibility";

export type TicketPages = InfiniteData<Page<Ticket>, number>;

const lastActivity = (t: Ticket) => (t.lastMessageAt ? Date.parse(t.lastMessageAt) : 0);

export function upsertTicket(data: TicketPages, ticket: Ticket, belongs: boolean): TicketPages {
  const pages = data.pages.map((page) => ({ ...page, items: page.items.filter((t) => t.id !== ticket.id) }));
  if (belongs && pages.length > 0) {
    const first = pages[0]!;
    const items = [...first.items, ticket].sort((a, b) => lastActivity(b) - lastActivity(a) || b.id - a.id);
    pages[0] = { ...first, items };
  }
  return { ...data, pages };
}

export function applyTicketUpdate(queryClient: QueryClient, ticket: Ticket, viewer: Viewer): void {
  for (const [key, data] of queryClient.getQueriesData<TicketPages>({ queryKey: ticketKeys.lists })) {
    if (!data) continue;
    const [, , status, search] = key as unknown as [string, string, TicketStatus, string];
    const belongs = ticketVisibleIn(ticket, status, viewer) && matchesSearch(ticket, search);
    queryClient.setQueryData<TicketPages>(key, upsertTicket(data, ticket, belongs));
  }
  queryClient.setQueryData(ticketKeys.detail(ticket.id), ticket);
}
```

`frontend/src/features/tickets/useTickets.ts`:

```ts
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useUserOptions } from "@/features/users/usersApi";
import { useRealtimeEvent } from "@/realtime/RealtimeProvider";
import { useAuth } from "@/stores/auth";
import type { Ticket, TicketStatus } from "@/types/api";
import { applyTicketUpdate } from "./ticketCache";
import { fetchTicket, fetchTickets, ticketKeys } from "./ticketsApi";
import type { Viewer } from "./visibility";

const NO_QUEUES: number[] = [];

export function useViewer(): Viewer | null {
  const user = useAuth((s) => s.user);
  const { data } = useUserOptions();
  const queueIds = (user && data?.find((u) => u.id === user.id)?.queueIds) || NO_QUEUES;
  return useMemo(
    () => (user ? { userId: user.id, profile: user.profile, queueIds } : null),
    [user, queueIds],
  );
}

export function useTicketList(status: TicketStatus, search: string) {
  return useInfiniteQuery({
    queryKey: ticketKeys.list(status, search),
    queryFn: ({ pageParam }) => fetchTickets(status, search, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length + 1 : undefined),
  });
}

export function useTicket(id: number | null) {
  return useQuery({
    queryKey: ticketKeys.detail(id ?? 0),
    queryFn: () => fetchTicket(id!),
    enabled: id !== null,
  });
}

export function useApplyTicket(): (ticket: Ticket) => void {
  const queryClient = useQueryClient();
  const viewer = useViewer();
  return useCallback(
    (ticket: Ticket) => {
      if (viewer) applyTicketUpdate(queryClient, ticket, viewer);
      else queryClient.setQueryData(ticketKeys.detail(ticket.id), ticket);
    },
    [queryClient, viewer],
  );
}

export function useTicketRealtime(): void {
  const applyTicket = useApplyTicket();
  useRealtimeEvent<Ticket>("ticket:update", applyTicket);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat(frontend): dados de tickets com visibilidade por perfil e cache em tempo real"
```

---

### Task 6: Chat — mensagens, envio otimista, mídia e falhas

**Files:**
- Create: `frontend/src/features/chat/{messagesApi.ts,messageCache.ts,useMessages.ts,ChatPanel.tsx,ChatHeader.tsx,MessageList.tsx,MessageBubble.tsx,Composer.tsx}`
- Modify: `frontend/src/test/factories.ts` (acrescentar `makeMessage`)
- Test: `frontend/src/features/chat/messageCache.test.ts`, `frontend/src/features/chat/ChatPanel.test.tsx`

**Interfaces:**
- Consumes: `api`, `mediaSrc`, `formatTime`, `formatPhone`, `initials`, `errorMessage`, `useAuth`, `useTicket`, `useApplyTicket`, `markTicketRead`, `useTicketRoom`, `useRealtimeEvent`, UI.
- Produces:
  - `messageKeys.ticket(ticketId)`; `fetchMessages(ticketId, before?): Promise<Page<Message>>`; `sendMessage(ticketId, { body?, media? }): Promise<Message>`; `resendMessage(id): Promise<Message>`; `uploadMedia(file: File): Promise<StoredMedia>`.
  - `type ChatMessage = Message & { tempId?: string; localFailed?: boolean }`; `type MessagePages = InfiniteData<Page<ChatMessage>, number | undefined>`; `flattenMessages(data?)`, `upsertMessage(data, msg)`, `removeMessage(data, predicate)`, `createTempMessage(ticket, body, media, userId)`, `mediaTypeFromMime(mime)`.
  - `useMessages(ticketId)`, `useMessageRealtime(ticketId)`, `useSendMessage(ticket)` (variáveis `{ temp: ChatMessage; body: string; media: StoredMedia | null }`), `useResendMessage(ticketId)`.
  - `ChatPanel({ ticketId })`, `ChatHeader({ ticket, actions? })`, `MessageList(...)`, `MessageBubble({ message, onRetry })`, `Composer({ onSend(body, media) })`.
  - Texto quando não pode responder: `pending` → "Aceite o atendimento para responder."; `bot` → "O chatbot está conduzindo esta conversa."; `closed` → "Atendimento finalizado."; aberto com outra pessoa → "Este atendimento está com outro atendente.".
  - Rótulos de ack (aria-label): `pending` "Enviando", `sent` "Enviada", `delivered` "Entregue", `read` "Lida", `failed` "Falhou"; falha mostra "Não enviada" + botão "Tentar novamente".

- [ ] **Step 1: Escrever os testes que falham**

Acrescente em `frontend/src/test/factories.ts`:

```ts
import type { Message } from "@/types/api";

export function makeMessage(partial: Partial<Message> = {}): Message {
  return {
    id: 100,
    companyId: 1,
    ticketId: 1,
    connectionId: 1,
    providerMessageId: "P100",
    fromMe: false,
    body: "Oi",
    type: "text",
    mediaUrl: null,
    mediaMime: null,
    mediaName: null,
    ack: "delivered",
    quotedMessageId: null,
    sentByUserId: null,
    isBot: false,
    createdAt: "2026-10-14T10:00:00.000Z",
    updatedAt: "2026-10-14T10:00:00.000Z",
    ...partial,
  };
}
```

(Junte o `import type { Message }` ao import de tipos já existente no topo do arquivo.)

`frontend/src/features/chat/messageCache.test.ts`:

```ts
import { makeMessage, makeTicket } from "@/test/factories";
import { createTempMessage, flattenMessages, removeMessage, upsertMessage, type MessagePages } from "./messageCache";

const data = (...pages: ReturnType<typeof makeMessage>[][]): MessagePages => ({
  pages: pages.map((items) => ({ items, hasMore: false })),
  pageParams: pages.map(() => undefined),
});

describe("messageCache", () => {
  it("flattens pages from oldest to newest", () => {
    const cache = data([makeMessage({ id: 3 }), makeMessage({ id: 4 })], [makeMessage({ id: 1 }), makeMessage({ id: 2 })]);
    expect(flattenMessages(cache).map((m) => m.id)).toEqual([1, 2, 3, 4]);
  });

  it("appends new messages to the newest page and replaces existing ones by id", () => {
    let cache = data([makeMessage({ id: 1 })]);
    cache = upsertMessage(cache, makeMessage({ id: 2, body: "novo" }));
    cache = upsertMessage(cache, makeMessage({ id: 1, ack: "read" }));
    expect(flattenMessages(cache).map((m) => [m.id, m.ack])).toEqual([
      [1, "read"],
      [2, "delivered"],
    ]);
  });

  it("keeps a single bubble when the socket delivers the real message before the POST resolves", () => {
    const temp = createTempMessage(makeTicket(), "Olá", null, 1);
    let cache = upsertMessage(data([]), temp);
    const real = makeMessage({ id: 200, fromMe: true, body: "Olá", ack: "pending" });
    cache = upsertMessage(cache, real); // chegou pelo socket
    cache = upsertMessage(removeMessage(cache, (m) => m.tempId === temp.tempId), real); // POST resolveu
    expect(flattenMessages(cache).filter((m) => m.body === "Olá")).toHaveLength(1);
  });

  it("creates temporary messages with negative ids and the media type", () => {
    const temp = createTempMessage(makeTicket(), "", { url: "/media/1/a.png", mime: "image/png", name: "a.png" }, 1);
    expect(temp.id).toBeLessThan(0);
    expect(temp).toMatchObject({ fromMe: true, ack: "pending", type: "image", mediaUrl: "/media/1/a.png" });
  });
});
```

`frontend/src/features/chat/ChatPanel.test.tsx`:

```tsx
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { fetchTicket, markTicketRead } from "@/features/tickets/ticketsApi";
import { fetchUserOptions } from "@/features/users/usersApi";
import { FakeSocket } from "@/test/fakeSocket";
import { makeMessage, makeTicket } from "@/test/factories";
import { renderWithProviders, setTestUser } from "@/test/utils";
import type { Message } from "@/types/api";
import { ChatPanel } from "./ChatPanel";
import { fetchMessages, sendMessage } from "./messagesApi";

vi.mock("@/features/tickets/ticketsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/tickets/ticketsApi")>()),
  fetchTicket: vi.fn(),
  markTicketRead: vi.fn(),
}));
vi.mock("@/features/users/usersApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/users/usersApi")>()),
  fetchUserOptions: vi.fn(),
}));
vi.mock("./messagesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./messagesApi")>()),
  fetchMessages: vi.fn(),
  sendMessage: vi.fn(),
  resendMessage: vi.fn(),
  uploadMedia: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function networkError() {
  return new AxiosError("Network Error", "ERR_NETWORK", { headers: new AxiosHeaders() });
}

function setup(ticketPartial = {}) {
  setTestUser({ id: 1, profile: "agent" });
  vi.mocked(fetchUserOptions).mockResolvedValue([{ id: 1, name: "Ana", queueIds: [10] }]);
  vi.mocked(fetchTicket).mockResolvedValue(makeTicket({ status: "open", userId: 1, ...ticketPartial }));
  vi.mocked(markTicketRead).mockResolvedValue(makeTicket({ status: "open", userId: 1 }));
  vi.mocked(fetchMessages).mockResolvedValue({ items: [makeMessage({ id: 1, body: "Bom dia" })], hasMore: false });
  const socket = new FakeSocket();
  renderWithProviders(<ChatPanel ticketId={1} />, { socket });
  return { socket };
}

describe("ChatPanel", () => {
  it("shows the conversation and joins the ticket room", async () => {
    const { socket } = setup();
    expect(await screen.findByText("Bom dia")).toBeInTheDocument();
    expect(screen.getByText("Maria Souza")).toBeInTheDocument();
    expect(socket.emitted.some((e) => e.event === "ticket:join" && e.args[0] === 1)).toBe(true);
  });

  it("shows the message right away and keeps a single bubble when the server confirms", async () => {
    const { socket } = setup();
    await screen.findByText("Bom dia");
    const pending = deferred<Message>();
    vi.mocked(sendMessage).mockReturnValue(pending.promise);

    await userEvent.type(screen.getByLabelText("Mensagem"), "Olá, tudo bem?{Enter}");
    expect(screen.getByText("Olá, tudo bem?")).toBeInTheDocument();
    expect(screen.getByLabelText("Enviando")).toBeInTheDocument();
    expect(screen.getByLabelText("Mensagem")).toHaveValue("");

    const real = makeMessage({ id: 50, fromMe: true, body: "Olá, tudo bem?", ack: "sent", sentByUserId: 1 });
    act(() => socket.serverEmit("message:new", real));
    await act(async () => pending.resolve(real));

    await waitFor(() => expect(screen.getAllByText("Olá, tudo bem?")).toHaveLength(1));
    expect(screen.getByLabelText("Enviada")).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledWith(1, { body: "Olá, tudo bem?" });
  });

  it("marks a failed send and lets the agent retry it", async () => {
    setup();
    await screen.findByText("Bom dia");
    vi.mocked(sendMessage).mockRejectedValueOnce(networkError());

    await userEvent.type(screen.getByLabelText("Mensagem"), "Teste{Enter}");
    expect(await screen.findByText("Não enviada")).toBeInTheDocument();

    vi.mocked(sendMessage).mockResolvedValueOnce(makeMessage({ id: 60, fromMe: true, body: "Teste", ack: "sent" }));
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

    await waitFor(() => expect(screen.queryByText("Não enviada")).not.toBeInTheDocument());
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText("Teste")).toHaveLength(1);
  });

  it("appends messages from the customer that arrive through the socket", async () => {
    const { socket } = setup();
    await screen.findByText("Bom dia");
    act(() => socket.serverEmit("message:new", makeMessage({ id: 2, body: "Preciso de ajuda" })));
    expect(await screen.findByText("Preciso de ajuda")).toBeInTheDocument();
  });

  it("hides the composer until the ticket is accepted", async () => {
    setup({ status: "pending", userId: null });
    expect(await screen.findByText("Aceite o atendimento para responder.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Mensagem")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/chat`
Expected: FAIL com `Failed to resolve import "./messageCache"`.

- [ ] **Step 3: Implementar**

`frontend/src/features/chat/messagesApi.ts`:

```ts
import { api } from "@/lib/api";
import type { Message, Page, StoredMedia } from "@/types/api";

export const messageKeys = {
  ticket: (ticketId: number) => ["messages", ticketId] as const,
};

export async function fetchMessages(ticketId: number, before?: number): Promise<Page<Message>> {
  const { data } = await api.get<Page<Message>>(`/tickets/${ticketId}/messages`, {
    params: { limit: 50, ...(before ? { before } : {}) },
  });
  return data;
}

export async function sendMessage(ticketId: number, body: { body?: string; media?: StoredMedia }): Promise<Message> {
  const { data } = await api.post<Message>(`/tickets/${ticketId}/messages`, body);
  return data;
}

export async function resendMessage(id: number): Promise<Message> {
  const { data } = await api.post<Message>(`/messages/${id}/resend`);
  return data;
}

export async function uploadMedia(file: File): Promise<StoredMedia> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<StoredMedia>("/media", form);
  return data;
}
```

`frontend/src/features/chat/messageCache.ts`:

```ts
import type { InfiniteData } from "@tanstack/react-query";
import type { Message, MessageType, Page, StoredMedia, Ticket } from "@/types/api";

export type ChatMessage = Message & { tempId?: string; localFailed?: boolean };
export type MessagePages = InfiniteData<Page<ChatMessage>, number | undefined>;

/** A página 0 tem as mensagens mais novas; cada página vem em ordem cronológica. */
export function flattenMessages(data?: MessagePages): ChatMessage[] {
  if (!data) return [];
  return [...data.pages].reverse().flatMap((page) => page.items);
}

const sameMessage = (a: ChatMessage, b: ChatMessage) =>
  a.id === b.id || (b.tempId !== undefined && a.tempId === b.tempId);

export function upsertMessage(data: MessagePages, message: ChatMessage): MessagePages {
  let found = false;
  const pages = data.pages.map((page) => ({
    ...page,
    items: page.items.map((item) => {
      if (!sameMessage(item, message)) return item;
      found = true;
      return { ...item, ...message };
    }),
  }));
  if (!found) {
    const first = pages[0] ?? { items: [], hasMore: false };
    pages[0] = { ...first, items: [...first.items, message] };
  }
  return { ...data, pages, pageParams: data.pageParams.length ? data.pageParams : [undefined] };
}

export function removeMessage(data: MessagePages, predicate: (message: ChatMessage) => boolean): MessagePages {
  return { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.filter((m) => !predicate(m)) })) };
}

export function mediaTypeFromMime(mime: string): MessageType {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

let tempSequence = 0;

export function createTempMessage(ticket: Ticket, body: string, media: StoredMedia | null, userId: number): ChatMessage {
  tempSequence += 1;
  const now = new Date().toISOString();
  return {
    id: -tempSequence,
    tempId: `tmp-${Date.now()}-${tempSequence}`,
    companyId: ticket.companyId,
    ticketId: ticket.id,
    connectionId: ticket.connectionId,
    providerMessageId: null,
    fromMe: true,
    body,
    type: media ? mediaTypeFromMime(media.mime) : "text",
    mediaUrl: media?.url ?? null,
    mediaMime: media?.mime ?? null,
    mediaName: media?.name ?? null,
    ack: "pending",
    quotedMessageId: null,
    sentByUserId: userId,
    isBot: false,
    createdAt: now,
    updatedAt: now,
  };
}
```

`frontend/src/features/chat/useMessages.ts`:

```ts
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/lib/apiError";
import { useRealtimeEvent } from "@/realtime/RealtimeProvider";
import type { Message, StoredMedia, Ticket } from "@/types/api";
import { removeMessage, upsertMessage, type ChatMessage, type MessagePages } from "./messageCache";
import { fetchMessages, messageKeys, resendMessage, sendMessage } from "./messagesApi";

export function useMessages(ticketId: number) {
  return useInfiniteQuery({
    queryKey: messageKeys.ticket(ticketId),
    queryFn: ({ pageParam }) => fetchMessages(ticketId, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.items[0]?.id : undefined),
  });
}

function useUpdateMessages(ticketId: number) {
  const queryClient = useQueryClient();
  return (update: (data: MessagePages) => MessagePages) =>
    queryClient.setQueryData<MessagePages>(messageKeys.ticket(ticketId), (data) => (data ? update(data) : data));
}

export function useMessageRealtime(ticketId: number): void {
  const update = useUpdateMessages(ticketId);
  const upsert = (message: Message) => {
    if (message.ticketId === ticketId) update((data) => upsertMessage(data, message));
  };
  useRealtimeEvent<Message>("message:new", upsert);
  useRealtimeEvent<Message>("message:update", upsert);
  useRealtimeEvent<{ id: number; ticketId: number }>("message:delete", (payload) => {
    if (payload.ticketId === ticketId) update((data) => removeMessage(data, (m) => m.id === payload.id));
  });
}

export interface SendVariables {
  temp: ChatMessage;
  body: string;
  media: StoredMedia | null;
}

export function useSendMessage(ticket: Ticket) {
  const update = useUpdateMessages(ticket.id);
  return useMutation({
    mutationFn: ({ body, media }: SendVariables) =>
      sendMessage(ticket.id, { ...(body ? { body } : {}), ...(media ? { media } : {}) }),
    onMutate: ({ temp }) => update((data) => upsertMessage(data, temp)),
    onSuccess: (message, { temp }) =>
      update((data) => upsertMessage(removeMessage(data, (m) => m.tempId === temp.tempId), message)),
    onError: (err, { temp }) => {
      update((data) => upsertMessage(data, { ...temp, ack: "failed", localFailed: true }));
      toast.error(errorMessage(err));
    },
  });
}

export function useResendMessage(ticketId: number) {
  const update = useUpdateMessages(ticketId);
  return useMutation({
    mutationFn: (id: number) => resendMessage(id),
    onSuccess: (message) => update((data) => upsertMessage(data, message)),
    onError: (err) => toast.error(errorMessage(err)),
  });
}
```

`frontend/src/features/chat/MessageBubble.tsx`:

```tsx
import { AlertCircle, Bot, Check, CheckCheck, Clock, FileText, MapPin } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatTime, mediaSrc } from "@/lib/format";
import type { Ack } from "@/types/api";
import type { ChatMessage } from "./messageCache";

const ACK_LABEL: Record<Ack, string> = {
  pending: "Enviando",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Falhou",
};

function AckIcon({ ack }: { ack: Ack }) {
  const props = { className: "h-3.5 w-3.5", "aria-label": ACK_LABEL[ack], role: "img" };
  if (ack === "pending") return <Clock {...props} />;
  if (ack === "sent") return <Check {...props} />;
  if (ack === "failed") return <AlertCircle {...props} className="h-3.5 w-3.5 text-red-200" />;
  return <CheckCheck {...props} className={cn("h-3.5 w-3.5", ack === "read" && "text-sky-200")} />;
}

function MediaContent({ message }: { message: ChatMessage }) {
  if (!message.mediaUrl) {
    if (message.type === "location") {
      return (
        <a
          className="inline-flex items-center gap-1 underline"
          href={`https://maps.google.com/?q=${encodeURIComponent(message.body)}`}
          target="_blank"
          rel="noreferrer"
        >
          <MapPin className="h-4 w-4" aria-hidden /> Ver localização
        </a>
      );
    }
    return null;
  }
  const src = mediaSrc(message.mediaUrl);
  switch (message.type) {
    case "image":
    case "sticker":
      return <img src={src} alt={message.mediaName ?? "Imagem"} className="max-h-72 rounded-lg object-contain" />;
    case "audio":
      return <audio controls src={src} className="max-w-full" />;
    case "video":
      return <video controls src={src} className="max-h-72 rounded-lg" />;
    default:
      return (
        <a href={src} download={message.mediaName ?? undefined} className="inline-flex items-center gap-2 underline">
          <FileText className="h-4 w-4" aria-hidden /> {message.mediaName ?? "Documento"}
        </a>
      );
  }
}

export function MessageBubble({ message, onRetry }: { message: ChatMessage; onRetry: (message: ChatMessage) => void }) {
  const out = message.fromMe;
  const showBody = message.body && message.type !== "location" && !(message.type === "document" && message.body === message.mediaName);
  return (
    <div className={cn("flex", out ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] space-y-1 rounded-2xl px-3 py-2 text-sm shadow-sm",
          out ? "rounded-br-sm bg-primary text-white" : "rounded-bl-sm border border-border bg-surface text-ink",
        )}
      >
        {message.isBot && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold opacity-80">
            <Bot className="h-3 w-3" aria-hidden /> Bot
          </span>
        )}
        <MediaContent message={message} />
        {showBody && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
        <div className={cn("flex items-center justify-end gap-1 text-[11px]", out ? "text-white/70" : "text-ink-muted")}>
          <span>{formatTime(message.createdAt)}</span>
          {out && <AckIcon ack={message.ack} />}
        </div>
        {out && message.ack === "failed" && (
          <div className="flex items-center justify-end gap-2 text-xs">
            <span className="font-semibold">Não enviada</span>
            <button type="button" className="underline" onClick={() => onRetry(message)}>
              Tentar novamente
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

`frontend/src/features/chat/MessageList.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { MessageBubble } from "./MessageBubble";
import type { ChatMessage } from "./messageCache";

export function MessageList({
  messages,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onRetry,
}: {
  messages: ChatMessage[];
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onRetry: (message: ChatMessage) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const last = messages.at(-1);
  const lastKey = last ? (last.tempId ?? last.id) : null;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastKey]);

  return (
    <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-background px-6 py-4" aria-live="polite">
      {hasOlder && (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" loading={loadingOlder} onClick={onLoadOlder}>
            Carregar mensagens anteriores
          </Button>
        </div>
      )}
      {messages.map((message) => (
        <MessageBubble key={message.tempId ?? message.id} message={message} onRetry={onRetry} />
      ))}
    </div>
  );
}
```

`frontend/src/features/chat/Composer.tsx`:

```tsx
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
```

`frontend/src/features/chat/ChatHeader.tsx`:

```tsx
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { formatPhone, initials } from "@/lib/format";
import type { Ticket, TicketStatus } from "@/types/api";

const STATUS: Record<TicketStatus, { label: string; tone: "neutral" | "primary" | "success" | "warning" }> = {
  bot: { label: "No bot", tone: "neutral" },
  pending: { label: "Aguardando", tone: "warning" },
  open: { label: "Em atendimento", tone: "success" },
  closed: { label: "Finalizado", tone: "neutral" },
};

export function ChatHeader({ ticket, actions }: { ticket: Ticket; actions?: ReactNode }) {
  const contact = ticket.contact;
  const status = STATUS[ticket.status];
  return (
    <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
          {initials(contact?.name ?? "?")}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{contact?.name ?? "Contato"}</p>
          <p className="text-xs text-ink-muted">
            {contact ? formatPhone(contact.number) : ""}
            {ticket.user ? ` · ${ticket.user.name}` : ""}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
        {ticket.queue && (
          <Badge tone="primary" style={{ backgroundColor: `${ticket.queue.color}1a`, color: ticket.queue.color }}>
            {ticket.queue.name}
          </Badge>
        )}
      </div>
      {actions}
    </header>
  );
}
```

`frontend/src/features/chat/ChatPanel.tsx`:

```tsx
import { useEffect } from "react";
import { Spinner } from "@/components/ui/spinner";
import { markTicketRead } from "@/features/tickets/ticketsApi";
import { useApplyTicket, useTicket } from "@/features/tickets/useTickets";
import { errorMessage } from "@/lib/apiError";
import { useTicketRoom } from "@/realtime/RealtimeProvider";
import { useAuth } from "@/stores/auth";
import type { PublicUser, StoredMedia, Ticket } from "@/types/api";
import { ChatHeader } from "./ChatHeader";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { createTempMessage, flattenMessages, type ChatMessage } from "./messageCache";
import { useMessageRealtime, useMessages, useResendMessage, useSendMessage } from "./useMessages";

function readOnlyHint(ticket: Ticket, user: PublicUser): string {
  if (ticket.status === "pending") return "Aceite o atendimento para responder.";
  if (ticket.status === "bot") return "O chatbot está conduzindo esta conversa.";
  if (ticket.status === "closed") return "Atendimento finalizado.";
  return ticket.userId === user.id ? "" : "Este atendimento está com outro atendente.";
}

export function ChatPanel({ ticketId }: { ticketId: number }) {
  const ticketQuery = useTicket(ticketId);
  useTicketRoom(ticketId);
  useMessageRealtime(ticketId);

  if (ticketQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  if (ticketQuery.isError || !ticketQuery.data) {
    return <p className="p-6 text-sm text-danger">{errorMessage(ticketQuery.error, "Atendimento não encontrado.")}</p>;
  }
  return <ChatView ticket={ticketQuery.data} />;
}

function ChatView({ ticket }: { ticket: Ticket }) {
  const user = useAuth((s) => s.user)!;
  const applyTicket = useApplyTicket();
  const messagesQuery = useMessages(ticket.id);
  const send = useSendMessage(ticket);
  const resend = useResendMessage(ticket.id);
  const messages = flattenMessages(messagesQuery.data);
  const canReply = ticket.status === "open" && (user.profile !== "agent" || ticket.userId === user.id);

  useEffect(() => {
    if (ticket.unreadCount > 0) {
      markTicketRead(ticket.id).then(applyTicket, () => undefined);
    }
  }, [ticket.id, ticket.unreadCount, applyTicket]);

  function onSend(body: string, media: StoredMedia | null) {
    send.mutate({ temp: createTempMessage(ticket, body, media, user.id), body, media });
  }

  function onRetry(message: ChatMessage) {
    if (message.localFailed && message.tempId) {
      const media = message.mediaUrl
        ? { url: message.mediaUrl, mime: message.mediaMime ?? "application/octet-stream", name: message.mediaName }
        : null;
      send.mutate({ temp: { ...message, ack: "pending", localFailed: false }, body: message.body, media });
    } else {
      resend.mutate(message.id);
    }
  }

  const hint = readOnlyHint(ticket, user);

  return (
    <div className="flex h-full flex-col">
      <ChatHeader ticket={ticket} />
      {messagesQuery.isLoading ? (
        <div className="flex flex-1 items-center justify-center bg-background">
          <Spinner />
        </div>
      ) : (
        <MessageList
          messages={messages}
          hasOlder={Boolean(messagesQuery.hasNextPage)}
          loadingOlder={messagesQuery.isFetchingNextPage}
          onLoadOlder={() => void messagesQuery.fetchNextPage()}
          onRetry={onRetry}
        />
      )}
      {canReply ? (
        <Composer onSend={onSend} />
      ) : (
        <div className="border-t border-border bg-surface p-4 text-center text-sm text-ink-muted">{hint}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat(frontend): chat com envio otimista, mídia, acks e reenvio"
```

---

### Task 7: Ações do ticket — aceitar, transferir e finalizar

**Files:**
- Create: `frontend/src/features/queues/queuesApi.ts` (só leitura; a Task 10 completa)
- Create: `frontend/src/features/tickets/{TicketActions.tsx,TransferDialog.tsx}`
- Modify: `frontend/src/features/chat/ChatPanel.tsx` (passar `actions` ao `ChatHeader`)
- Test: `frontend/src/features/tickets/TicketActions.test.tsx`

**Interfaces:**
- Consumes: `acceptTicket`, `transferTicket`, `closeTicket`, `useApplyTicket`, `useViewer`, `ticketVisibleIn`, `useUserOptions`, `errorMessage`, UI.
- Produces:
  - `queueKeys = { all: ["queues"] }`, `fetchQueues(): Promise<Queue[]>`, `useQueues()`.
  - `TicketActions({ ticket })`: "Aceitar" (status `pending`); "Transferir" e "Finalizar" (status ≠ `closed` e usuário é supervisor/admin ou o atendente do ticket). Finalizar pede confirmação (`window.confirm("Finalizar este atendimento?")`). Depois de transferir, se o ticket deixou de ser visível para o usuário, volta para `/atendimento`.
  - `TransferDialog({ ticket, open, onOpenChange, onTransferred(ticket) })` com abas "Para uma fila" / "Para um atendente".

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/features/tickets/TicketActions.test.tsx`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { toast } from "sonner";
import { fetchQueues } from "@/features/queues/queuesApi";
import { fetchUserOptions } from "@/features/users/usersApi";
import { makeTicket } from "@/test/factories";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { TicketActions } from "./TicketActions";
import { acceptTicket, closeTicket, transferTicket } from "./ticketsApi";

vi.mock("./ticketsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ticketsApi")>()),
  acceptTicket: vi.fn(),
  closeTicket: vi.fn(),
  transferTicket: vi.fn(),
}));
vi.mock("@/features/queues/queuesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/queues/queuesApi")>()),
  fetchQueues: vi.fn(),
}));
vi.mock("@/features/users/usersApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/users/usersApi")>()),
  fetchUserOptions: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function conflict(message: string) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError("conflict", "ERR", config, null, {
    status: 409,
    statusText: "",
    headers: {},
    config,
    data: { error: { code: "TICKET_ALREADY_ACCEPTED", message } },
  });
}

beforeEach(() => {
  vi.mocked(fetchQueues).mockResolvedValue([
    { id: 10, companyId: 1, name: "Suporte", color: "#6d5dfc", schedule: {} },
    { id: 20, companyId: 1, name: "Financeiro", color: "#16a34a", schedule: {} },
  ]);
  vi.mocked(fetchUserOptions).mockResolvedValue([
    { id: 1, name: "Ana", queueIds: [10] },
    { id: 2, name: "Bruno", queueIds: [20] },
  ]);
});

describe("TicketActions", () => {
  it("accepts a pending ticket", async () => {
    setTestUser({ id: 1, profile: "agent" });
    vi.mocked(acceptTicket).mockResolvedValue(makeTicket({ status: "open", userId: 1 }));
    renderWithProviders(<TicketActions ticket={makeTicket({ status: "pending" })} />);
    await userEvent.click(screen.getByRole("button", { name: /aceitar/i }));
    await waitFor(() => expect(acceptTicket).toHaveBeenCalledWith(1));
    expect(toast.success).toHaveBeenCalledWith("Atendimento aceito");
  });

  it("explains when someone else accepted first", async () => {
    setTestUser({ id: 1, profile: "agent" });
    vi.mocked(acceptTicket).mockRejectedValue(conflict("Este atendimento já foi aceito por Bruno"));
    renderWithProviders(<TicketActions ticket={makeTicket({ status: "pending" })} />);
    await userEvent.click(screen.getByRole("button", { name: /aceitar/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Este atendimento já foi aceito por Bruno"));
  });

  it("transfers an owned ticket to another queue", async () => {
    setTestUser({ id: 1, profile: "agent" });
    vi.mocked(transferTicket).mockResolvedValue(makeTicket({ status: "pending", queueId: 20, userId: null }));
    renderWithProviders(<TicketActions ticket={makeTicket({ status: "open", userId: 1 })} />);

    await userEvent.click(screen.getByRole("button", { name: /transferir/i }));
    const dialog = await screen.findByRole("dialog", { name: "Transferir atendimento" });
    await within(dialog).findByRole("option", { name: "Financeiro" });
    await userEvent.selectOptions(within(dialog).getByLabelText("Fila"), "20");
    await userEvent.click(within(dialog).getByRole("button", { name: "Transferir" }));

    await waitFor(() => expect(transferTicket).toHaveBeenCalledWith(1, { queueId: 20 }));
  });

  it("transfers to a specific agent", async () => {
    setTestUser({ id: 1, profile: "supervisor" });
    vi.mocked(transferTicket).mockResolvedValue(makeTicket({ status: "pending", userId: 2 }));
    renderWithProviders(<TicketActions ticket={makeTicket({ status: "open", userId: 1 })} />);

    await userEvent.click(screen.getByRole("button", { name: /transferir/i }));
    const dialog = await screen.findByRole("dialog", { name: "Transferir atendimento" });
    await userEvent.click(within(dialog).getByRole("tab", { name: "Para um atendente" }));
    await within(dialog).findByRole("option", { name: "Bruno" });
    await userEvent.selectOptions(within(dialog).getByLabelText("Atendente"), "2");
    await userEvent.click(within(dialog).getByRole("button", { name: "Transferir" }));

    await waitFor(() => expect(transferTicket).toHaveBeenCalledWith(1, { userId: 2 }));
  });

  it("asks for confirmation before closing", async () => {
    setTestUser({ id: 1, profile: "agent" });
    vi.mocked(closeTicket).mockResolvedValue(makeTicket({ status: "closed", userId: 1 }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWithProviders(<TicketActions ticket={makeTicket({ status: "open", userId: 1 })} />);

    await userEvent.click(screen.getByRole("button", { name: /finalizar/i }));
    expect(closeTicket).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /finalizar/i }));
    await waitFor(() => expect(closeTicket).toHaveBeenCalledWith(1));
    confirm.mockRestore();
  });

  it("offers no actions to an agent looking at someone else's ticket", () => {
    setTestUser({ id: 1, profile: "agent" });
    renderWithProviders(<TicketActions ticket={makeTicket({ status: "open", userId: 9 })} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/tickets/TicketActions.test.tsx`
Expected: FAIL com `Failed to resolve import "@/features/queues/queuesApi"`.

- [ ] **Step 3: Implementar**

`frontend/src/features/queues/queuesApi.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Queue } from "@/types/api";

export const queueKeys = { all: ["queues"] as const };

export async function fetchQueues(): Promise<Queue[]> {
  const { data } = await api.get<Queue[]>("/queues");
  return data;
}

export function useQueues() {
  return useQuery({ queryKey: queueKeys.all, queryFn: fetchQueues, staleTime: 60_000 });
}
```

`frontend/src/features/tickets/TransferDialog.tsx`:

```tsx
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { useQueues } from "@/features/queues/queuesApi";
import { useUserOptions } from "@/features/users/usersApi";
import { errorMessage } from "@/lib/apiError";
import { useAuth } from "@/stores/auth";
import type { Ticket } from "@/types/api";
import { transferTicket } from "./ticketsApi";

type Mode = "queue" | "user";

export function TransferDialog({
  ticket,
  open,
  onOpenChange,
  onTransferred,
}: {
  ticket: Ticket;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTransferred: (ticket: Ticket) => void;
}) {
  const me = useAuth((s) => s.user)!;
  const [mode, setMode] = useState<Mode>("queue");
  const [queueId, setQueueId] = useState("");
  const [userId, setUserId] = useState("");
  const queues = useQueues();
  const users = useUserOptions();

  const mutation = useMutation({
    mutationFn: () =>
      transferTicket(ticket.id, mode === "queue" ? { queueId: Number(queueId) } : { userId: Number(userId) }),
    onSuccess: (updated) => {
      toast.success("Atendimento transferido");
      onOpenChange(false);
      onTransferred(updated);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const ready = mode === "queue" ? queueId !== "" : userId !== "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Transferir atendimento" description="Escolha para onde este atendimento deve ir.">
        <Tabs<Mode>
          value={mode}
          onChange={setMode}
          items={[
            { value: "queue", label: "Para uma fila" },
            { value: "user", label: "Para um atendente" },
          ]}
        />
        <div className="mt-4">
          {mode === "queue" ? (
            <>
              <Label htmlFor="transfer-queue">Fila</Label>
              <Select id="transfer-queue" value={queueId} onChange={(e) => setQueueId(e.target.value)}>
                <option value="">Selecione…</option>
                {queues.data
                  ?.filter((q) => q.id !== ticket.queueId)
                  .map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name}
                    </option>
                  ))}
              </Select>
            </>
          ) : (
            <>
              <Label htmlFor="transfer-user">Atendente</Label>
              <Select id="transfer-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Selecione…</option>
                {users.data
                  ?.filter((u) => u.id !== me.id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </Select>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!ready} loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Transferir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`frontend/src/features/tickets/TicketActions.tsx`:

```tsx
import { useMutation } from "@tanstack/react-query";
import { ArrowRightLeft, Check, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/apiError";
import { useAuth } from "@/stores/auth";
import type { Ticket } from "@/types/api";
import { TransferDialog } from "./TransferDialog";
import { acceptTicket, closeTicket } from "./ticketsApi";
import { useApplyTicket, useViewer } from "./useTickets";
import { ticketVisibleIn } from "./visibility";

export function TicketActions({ ticket }: { ticket: Ticket }) {
  const user = useAuth((s) => s.user)!;
  const applyTicket = useApplyTicket();
  const viewer = useViewer();
  const navigate = useNavigate();
  const [transferOpen, setTransferOpen] = useState(false);

  const onError = (err: unknown) => toast.error(errorMessage(err));
  const accept = useMutation({
    mutationFn: () => acceptTicket(ticket.id),
    onSuccess: (updated) => {
      applyTicket(updated);
      toast.success("Atendimento aceito");
    },
    onError,
  });
  const close = useMutation({
    mutationFn: () => closeTicket(ticket.id),
    onSuccess: (updated) => {
      applyTicket(updated);
      toast.success("Atendimento finalizado");
    },
    onError,
  });

  const canHandle = ticket.status !== "closed" && (user.profile !== "agent" || ticket.userId === user.id);

  function onTransferred(updated: Ticket) {
    applyTicket(updated);
    if (viewer && !ticketVisibleIn(updated, updated.status, viewer)) navigate("/atendimento");
  }

  return (
    <div className="flex shrink-0 gap-2">
      {ticket.status === "pending" && (
        <Button size="sm" loading={accept.isPending} onClick={() => accept.mutate()}>
          <Check className="h-4 w-4" aria-hidden /> Aceitar
        </Button>
      )}
      {canHandle && (
        <>
          <Button size="sm" variant="secondary" onClick={() => setTransferOpen(true)}>
            <ArrowRightLeft className="h-4 w-4" aria-hidden /> Transferir
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={close.isPending}
            onClick={() => {
              if (window.confirm("Finalizar este atendimento?")) close.mutate();
            }}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Finalizar
          </Button>
          {transferOpen && (
            <TransferDialog ticket={ticket} open={transferOpen} onOpenChange={setTransferOpen} onTransferred={onTransferred} />
          )}
        </>
      )}
    </div>
  );
}
```

Em `frontend/src/features/chat/ChatPanel.tsx`, importe `TicketActions` e troque `<ChatHeader ticket={ticket} />` por:

```tsx
import { TicketActions } from "@/features/tickets/TicketActions";
// ...
      <ChatHeader ticket={ticket} actions={<TicketActions ticket={ticket} />} />
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: todos PASS (o `ChatPanel.test.tsx` continua passando: a ação "Aceitar" aparece no ticket pendente e o diálogo de transferência só é montado quando aberto).

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat(frontend): aceitar, transferir e finalizar atendimentos"
```

---

### Task 8: Tela de atendimento — abas, busca e lista em tempo real

**Files:**
- Create: `frontend/src/features/tickets/{TicketList.tsx,TicketListItem.tsx}`
- Modify: `frontend/src/features/tickets/TicketsPage.tsx` (substituir a versão inicial)
- Test: `frontend/src/features/tickets/TicketsPage.test.tsx`

**Interfaces:**
- Consumes: `useTicketList`, `useTicketRealtime`, `useDebounced`, `ChatPanel`, `formatTime`, `initials`, UI.
- Produces:
  - `TicketsPage` em `/atendimento` e `/atendimento/:ticketId`: coluna de lista (título "Atendimentos", abas "Aguardando" / "Atendendo" / "Finalizados" e, para supervisor/admin, "No bot"; busca "Buscar por nome ou número") e área do chat.
  - `TicketList({ status, search, selectedId })` (lista com `aria-label="Lista de atendimentos"`, botão "Carregar mais"), `TicketListItem({ ticket, selected })` (link para `/atendimento/:id`).

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/features/tickets/TicketsPage.test.tsx`:

```tsx
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppRoutes } from "@/app/routes";
import { fetchUserOptions } from "@/features/users/usersApi";
import { FakeSocket } from "@/test/fakeSocket";
import { makeContact, makeTicket } from "@/test/factories";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { fetchTickets } from "./ticketsApi";
import { TicketsPage } from "./TicketsPage";

vi.mock("./ticketsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ticketsApi")>()),
  fetchTickets: vi.fn(),
}));
vi.mock("@/features/users/usersApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/users/usersApi")>()),
  fetchUserOptions: vi.fn(),
}));
vi.mock("@/features/chat/ChatPanel", () => ({
  ChatPanel: ({ ticketId }: { ticketId: number }) => <div>chat do ticket {ticketId}</div>,
}));

const maria = makeTicket({ id: 1, contact: makeContact({ id: 1, name: "Maria Souza" }) });
const joao = makeTicket({ id: 2, contact: makeContact({ id: 2, name: "João Lima", number: "5521977776666" }) });

beforeEach(() => {
  vi.mocked(fetchUserOptions).mockResolvedValue([{ id: 1, name: "Ana", queueIds: [10] }]);
  vi.mocked(fetchTickets).mockImplementation(async (status) =>
    status === "pending" ? { items: [maria, joao], hasMore: false } : { items: [], hasMore: false },
  );
});

describe("TicketsPage", () => {
  it("lists pending tickets and hides the bot tab from agents", async () => {
    setTestUser({ id: 1, profile: "agent" });
    renderWithProviders(<TicketsPage />, { socket: new FakeSocket() });
    const list = await screen.findByRole("list", { name: "Lista de atendimentos" });
    expect(within(list).getByText("Maria Souza")).toBeInTheDocument();
    expect(within(list).getByText("João Lima")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "No bot" })).not.toBeInTheDocument();
    expect(screen.getByText("Selecione um atendimento")).toBeInTheDocument();
  });

  it("shows the bot tab to supervisors and loads the selected tab", async () => {
    setTestUser({ id: 2, profile: "supervisor" });
    renderWithProviders(<TicketsPage />, { socket: new FakeSocket() });
    await userEvent.click(screen.getByRole("tab", { name: "No bot" }));
    await waitFor(() => expect(fetchTickets).toHaveBeenCalledWith("bot", "", 1));
  });

  it("searches by name with debounce", async () => {
    setTestUser({ id: 1, profile: "agent" });
    renderWithProviders(<TicketsPage />, { socket: new FakeSocket() });
    await screen.findByText("Maria Souza");
    await userEvent.type(screen.getByPlaceholderText("Buscar por nome ou número"), "maria");
    await waitFor(() => expect(fetchTickets).toHaveBeenCalledWith("pending", "maria", 1));
  });

  it("removes a ticket from the pending tab when another agent accepts it", async () => {
    setTestUser({ id: 1, profile: "agent" });
    const socket = new FakeSocket();
    renderWithProviders(<TicketsPage />, { socket });
    await screen.findByText("Maria Souza");
    await waitFor(() => expect(fetchUserOptions).toHaveBeenCalled());

    act(() => socket.serverEmit("ticket:update", { ...maria, status: "open", userId: 9 }));

    await waitFor(() => expect(screen.queryByText("Maria Souza")).not.toBeInTheDocument());
    expect(screen.getByText("João Lima")).toBeInTheDocument();
  });

  it("opens the chat of the selected ticket", async () => {
    setTestUser({ id: 1, profile: "agent" });
    renderWithProviders(<AppRoutes />, { route: "/atendimento" });
    await userEvent.click(await screen.findByRole("link", { name: /Maria Souza/ }));
    expect(await screen.findByText("chat do ticket 1")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/tickets/TicketsPage.test.tsx`
Expected: FAIL (a versão inicial da página não tem lista nem abas).

- [ ] **Step 3: Implementar**

`frontend/src/features/tickets/TicketListItem.tsx`:

```tsx
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";
import { formatTime, initials } from "@/lib/format";
import type { Ticket } from "@/types/api";

export function TicketListItem({ ticket, selected }: { ticket: Ticket; selected: boolean }) {
  const name = ticket.contact?.name ?? "Contato";
  return (
    <li>
      <Link
        to={`/atendimento/${ticket.id}`}
        className={cn(
          "flex gap-3 border-l-[3px] border-transparent px-4 py-3 transition hover:bg-background",
          selected && "border-primary bg-primary-soft hover:bg-primary-soft",
        )}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
          {initials(name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate font-semibold">{name}</span>
            <span className="shrink-0 text-xs text-ink-muted">{formatTime(ticket.lastMessageAt)}</span>
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-2">
            <span className="truncate text-sm text-ink-muted">{ticket.lastMessage || "Sem mensagens"}</span>
            {ticket.unreadCount > 0 && (
              <span className="shrink-0 rounded-full bg-primary px-1.5 text-xs font-semibold text-white">
                {ticket.unreadCount}
              </span>
            )}
          </span>
          {ticket.queue && (
            <span className="mt-1 inline-flex items-center gap-1 text-xs text-ink-muted">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ticket.queue.color }} aria-hidden />
              {ticket.queue.name}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}
```

`frontend/src/features/tickets/TicketList.tsx`:

```tsx
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/apiError";
import type { TicketStatus } from "@/types/api";
import { TicketListItem } from "./TicketListItem";
import { useTicketList } from "./useTickets";

export function TicketList({ status, search, selectedId }: { status: TicketStatus; search: string; selectedId: number | null }) {
  const query = useTicketList(status, search);
  const tickets = query.data?.pages.flatMap((page) => page.items) ?? [];

  if (query.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (query.isError) return <p className="p-4 text-sm text-danger">{errorMessage(query.error)}</p>;
  if (tickets.length === 0) {
    return (
      <EmptyState
        className="flex-1"
        icon={Inbox}
        title="Nenhum atendimento"
        description="Quando houver conversas nesta aba, elas aparecem aqui."
      />
    );
  }
  return (
    <ul aria-label="Lista de atendimentos" className="flex-1 divide-y divide-border overflow-y-auto">
      {tickets.map((ticket) => (
        <TicketListItem key={ticket.id} ticket={ticket} selected={ticket.id === selectedId} />
      ))}
      {query.hasNextPage && (
        <li className="p-3">
          <Button
            variant="ghost"
            className="w-full"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Carregar mais
          </Button>
        </li>
      )}
    </ul>
  );
}
```

`frontend/src/features/tickets/TicketsPage.tsx` (substituir):

```tsx
import { MessagesSquare, Search } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { useDebounced } from "@/lib/useDebounced";
import { useAuth } from "@/stores/auth";
import type { TicketStatus } from "@/types/api";
import { TicketList } from "./TicketList";
import { useTicketRealtime } from "./useTickets";

export function TicketsPage() {
  const user = useAuth((s) => s.user)!;
  const { ticketId } = useParams();
  const selectedId = ticketId ? Number(ticketId) : null;
  const [status, setStatus] = useState<TicketStatus>("pending");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search.trim());
  useTicketRealtime();

  const tabs: TabItem<TicketStatus>[] = [
    { value: "pending", label: "Aguardando" },
    { value: "open", label: "Atendendo" },
    { value: "closed", label: "Finalizados" },
    ...(user.profile !== "agent" ? [{ value: "bot" as const, label: "No bot" }] : []),
  ];

  return (
    <div className="flex h-full">
      <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-surface lg:w-96">
        <div className="space-y-3 border-b border-border p-4">
          <h1 className="text-lg font-semibold">Atendimentos</h1>
          <Tabs value={status} onChange={setStatus} items={tabs} />
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
            <Input
              className="pl-9"
              placeholder="Buscar por nome ou número"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <TicketList status={status} search={debouncedSearch} selectedId={selectedId} />
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        {selectedId ? (
          <ChatPanel key={selectedId} ticketId={selectedId} />
        ) : (
          <EmptyState
            className="h-full"
            icon={MessagesSquare}
            title="Selecione um atendimento"
            description="Escolha uma conversa na lista para começar."
          />
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: todos PASS (o teste de login da Task 3 continua achando o título "Atendimentos").

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat(frontend): tela de atendimento com abas, busca e lista em tempo real"
```

---

### Task 9: Contatos

**Files:**
- Create: `frontend/src/features/contacts/{contactsApi.ts,ContactsPage.tsx}`
- Modify: `frontend/src/app/routes.tsx` (rota `/contatos`)
- Test: `frontend/src/features/contacts/ContactsPage.test.tsx`

**Interfaces:**
- Consumes: `api`, `useDebounced`, `formatPhone`, `initials`, `errorMessage`, `PageHeader`, UI.
- Produces:
  - `contactKeys = { all: ["contacts"], list(search, page) }`, `fetchContacts(search, page): Promise<Page<Contact>>`, `updateContact(id, { name }): Promise<Contact>`.
  - `ContactsPage` em `/contatos` (todos os perfis): busca "Buscar por nome ou número", tabela (Nome, Número, ação "Editar"), paginação "Anterior"/"Próxima", diálogo "Editar contato".

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/features/contacts/ContactsPage.test.tsx`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeContact } from "@/test/factories";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { ContactsPage } from "./ContactsPage";
import { fetchContacts, updateContact } from "./contactsApi";

vi.mock("./contactsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./contactsApi")>()),
  fetchContacts: vi.fn(),
  updateContact: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("ContactsPage", () => {
  beforeEach(() => setTestUser());

  it("lists, searches and paginates contacts", async () => {
    vi.mocked(fetchContacts).mockImplementation(async (_search, page) =>
      page === 1
        ? { items: [makeContact({ id: 1, name: "Maria Souza" })], hasMore: true }
        : { items: [makeContact({ id: 2, name: "João Lima" })], hasMore: false },
    );
    renderWithProviders(<ContactsPage />);

    expect(await screen.findByText("Maria Souza")).toBeInTheDocument();
    expect(screen.getByText("+55 (11) 98888-7777")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(await screen.findByText("João Lima")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Próxima" })).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText("Buscar por nome ou número"), "maria");
    await waitFor(() => expect(fetchContacts).toHaveBeenCalledWith("maria", 1));
  });

  it("renames a contact", async () => {
    vi.mocked(fetchContacts).mockResolvedValue({ items: [makeContact({ id: 1, name: "Maria" })], hasMore: false });
    vi.mocked(updateContact).mockResolvedValue(makeContact({ id: 1, name: "Maria VIP" }));
    renderWithProviders(<ContactsPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Editar Maria" }));
    const dialog = screen.getByRole("dialog", { name: "Editar contato" });
    const input = within(dialog).getByLabelText("Nome");
    await userEvent.clear(input);
    await userEvent.type(input, "Maria VIP");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(updateContact).toHaveBeenCalledWith(1, { name: "Maria VIP" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/contacts`
Expected: FAIL com `Failed to resolve import "./ContactsPage"`.

- [ ] **Step 3: Implementar**

`frontend/src/features/contacts/contactsApi.ts`:

```ts
import { api } from "@/lib/api";
import type { Contact, Page } from "@/types/api";

export const contactKeys = {
  all: ["contacts"] as const,
  list: (search: string, page: number) => ["contacts", "list", search, page] as const,
};

export async function fetchContacts(search: string, page: number): Promise<Page<Contact>> {
  const { data } = await api.get<Page<Contact>>("/contacts", { params: { page, ...(search ? { search } : {}) } });
  return data;
}

export async function updateContact(id: number, body: { name: string }): Promise<Contact> {
  const { data } = await api.put<Contact>(`/contacts/${id}`, body);
  return data;
}
```

`frontend/src/features/contacts/ContactsPage.tsx`:

```tsx
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookUser, Search } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/apiError";
import { formatPhone, initials } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";
import type { Contact } from "@/types/api";
import { contactKeys, fetchContacts, updateContact } from "./contactsApi";

export function ContactsPage() {
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search.trim());
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Contact | null>(null);

  useEffect(() => setPage(1), [debounced]);

  const query = useQuery({
    queryKey: contactKeys.list(debounced, page),
    queryFn: () => fetchContacts(debounced, page),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader title="Contatos" description="Pessoas que já falaram com a empresa pelo WhatsApp." />
      <div className="space-y-4 p-6">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <Input
            className="pl-9"
            placeholder="Buscar por nome ou número"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Card className="p-0">
          {query.isLoading ? (
            <div className="flex justify-center p-8">
              <Spinner />
            </div>
          ) : query.isError ? (
            <p className="p-6 text-sm text-danger">{errorMessage(query.error)}</p>
          ) : query.data!.items.length === 0 ? (
            <EmptyState icon={BookUser} title="Nenhum contato encontrado" />
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-ink-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Nome</th>
                  <th className="px-5 py-3 font-medium">Número</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {query.data!.items.map((contact) => (
                  <tr key={contact.id}>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                          {initials(contact.name)}
                        </span>
                        {contact.name}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-ink-muted">{formatPhone(contact.number)}</td>
                    <td className="px-5 py-3 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Editar ${contact.name}`}
                        onClick={() => setEditing(contact)}
                      >
                        Editar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm text-ink-muted">Página {page}</span>
          <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!query.data?.hasMore}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      </div>
      {editing && <EditContactDialog contact={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditContactDialog({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(contact.name);
  const mutation = useMutation({
    mutationFn: () => updateContact(contact.id, { name: name.trim() }),
    onSuccess: () => {
      toast.success("Contato atualizado");
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="Editar contato">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <Label htmlFor="contact-name">Nome</Label>
          <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={!name.trim()}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

Em `frontend/src/app/routes.tsx`, importe `ContactsPage` e acrescente dentro do bloco protegido:

```tsx
import { ContactsPage } from "@/features/contacts/ContactsPage";
// ...
        <Route path="contatos" element={<ContactsPage />} />
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat(frontend): página de contatos com busca, paginação e edição"
```

---

### Task 10: Filas e editor de horário de expediente

**Files:**
- Create: `frontend/src/features/queues/{schedule.ts,ScheduleEditor.tsx,QueueDialog.tsx,QueuesPage.tsx}`
- Modify: `frontend/src/features/queues/queuesApi.ts` (acrescentar escrita), `frontend/src/app/routes.tsx` (rota `/filas`, só admin)
- Test: `frontend/src/features/queues/schedule.test.ts`, `frontend/src/features/queues/QueuesPage.test.tsx`

**Interfaces:**
- Consumes: `fetchQueues`, `queueKeys`, `useQueues` (Task 7), `RequireProfile`, `PageHeader`, UI.
- Produces:
  - `createQueue({ name, color, schedule }): Promise<Queue>`, `updateQueue(id, input): Promise<Queue>`, `deleteQueue(id): Promise<void>`.
  - `DAYS: { key: WeekDay; label: string }[]` (segunda a domingo), `isAlwaysOpen(schedule)`, `setDayRanges(schedule, day, ranges)`, `validateSchedule(schedule): string | null` (formato `HH:mm-HH:mm`, fim pode ser `24:00`, início antes do fim), `describeSchedule(schedule): string`.
  - `ScheduleEditor({ value: WeekSchedule, onChange })`: interruptor "Sempre aberto"; por dia, caixa "Aberto" + faixas com campos de hora "Início"/"Fim" e botões "Adicionar horário"/"Remover horário".
  - `QueueDialog({ queue?: Queue; onClose })`, `QueuesPage` em `/filas`.

- [ ] **Step 1: Escrever os testes que falham**

`frontend/src/features/queues/schedule.test.ts`:

```ts
import { describeSchedule, isAlwaysOpen, setDayRanges, validateSchedule } from "./schedule";

describe("schedule helpers", () => {
  it("treats an empty schedule as always open", () => {
    expect(isAlwaysOpen({})).toBe(true);
    expect(isAlwaysOpen({ "1": ["08:00-18:00"] })).toBe(false);
    expect(describeSchedule({})).toBe("Sempre aberto");
  });

  it("sets the ranges of a day and keeps closed days as empty lists", () => {
    const withMonday = setDayRanges({}, "1", ["08:00-12:00"]);
    expect(withMonday).toEqual({ "1": ["08:00-12:00"] });
    const closed = setDayRanges(withMonday, "1", []);
    expect(closed).toEqual({ "1": [] });
    expect(isAlwaysOpen(closed)).toBe(false);
  });

  it("validates format, order and the 24:00 end", () => {
    expect(validateSchedule({ "1": ["08:00-12:00", "13:00-24:00"] })).toBeNull();
    expect(validateSchedule({ "1": ["8:00-12:00"] })).toBe("Segunda: use horários no formato HH:mm.");
    expect(validateSchedule({ "2": ["12:00-08:00"] })).toBe("Terça: o início deve ser antes do fim.");
    expect(validateSchedule({ "3": ["24:00-24:00"] })).toBe("Quarta: use horários no formato HH:mm.");
  });

  it("describes open days", () => {
    expect(describeSchedule({ "1": ["08:00-18:00"], "6": ["08:00-12:00"] })).toBe("Seg, Sáb");
  });
});
```

`frontend/src/features/queues/QueuesPage.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppRoutes } from "@/app/routes";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { QueuesPage } from "./QueuesPage";
import { createQueue, deleteQueue, fetchQueues } from "./queuesApi";

vi.mock("./queuesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./queuesApi")>()),
  fetchQueues: vi.fn(),
  createQueue: vi.fn(),
  updateQueue: vi.fn(),
  deleteQueue: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.mocked(fetchQueues).mockResolvedValue([
    { id: 10, companyId: 1, name: "Suporte", color: "#6d5dfc", schedule: { "1": ["08:00-18:00"] } },
  ]);
});

describe("QueuesPage", () => {
  it("lists queues with their schedule summary", async () => {
    setTestUser({ profile: "admin" });
    renderWithProviders(<QueuesPage />);
    expect(await screen.findByText("Suporte")).toBeInTheDocument();
    expect(screen.getByText("Seg")).toBeInTheDocument();
  });

  it("creates a queue with a custom weekly schedule", async () => {
    setTestUser({ profile: "admin" });
    vi.mocked(createQueue).mockResolvedValue({ id: 11, companyId: 1, name: "Financeiro", color: "#6d5dfc", schedule: {} });
    renderWithProviders(<QueuesPage />);
    await screen.findByText("Suporte");

    await userEvent.click(screen.getByRole("button", { name: "Nova fila" }));
    const dialog = screen.getByRole("dialog", { name: "Nova fila" });
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Financeiro");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Sempre aberto" }));
    fireEvent.change(within(dialog).getByLabelText("Segunda fim 1"), { target: { value: "12:00" } });
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Sexta aberto" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(createQueue).toHaveBeenCalledWith({
        name: "Financeiro",
        color: "#6d5dfc",
        schedule: {
          "0": [],
          "1": ["08:00-12:00"],
          "2": ["08:00-18:00"],
          "3": ["08:00-18:00"],
          "4": ["08:00-18:00"],
          "5": [],
          "6": [],
        },
      }),
    );
  });

  it("blocks saving an inverted range", async () => {
    setTestUser({ profile: "admin" });
    renderWithProviders(<QueuesPage />);
    await screen.findByText("Suporte");
    await userEvent.click(screen.getByRole("button", { name: "Editar Suporte" }));
    const dialog = screen.getByRole("dialog", { name: "Editar fila" });
    fireEvent.change(within(dialog).getByLabelText("Segunda fim 1"), { target: { value: "07:00" } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Segunda: o início deve ser antes do fim.");
    expect(within(dialog).getByRole("button", { name: "Salvar" })).toBeDisabled();
  });

  it("deletes a queue after confirmation", async () => {
    setTestUser({ profile: "admin" });
    vi.mocked(deleteQueue).mockResolvedValue();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<QueuesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Excluir Suporte" }));
    await waitFor(() => expect(deleteQueue).toHaveBeenCalledWith(10));
  });

  it("is only reachable by admins", async () => {
    setTestUser({ profile: "agent" });
    renderWithProviders(<AppRoutes />, { route: "/filas" });
    expect(await screen.findByRole("heading", { name: "Atendimentos" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/queues`
Expected: FAIL com `Failed to resolve import "./schedule"`.

- [ ] **Step 3: Implementar**

Acrescente em `frontend/src/features/queues/queuesApi.ts`:

```ts
import type { WeekSchedule } from "@/types/api";

export interface QueueInput {
  name: string;
  color: string;
  schedule: WeekSchedule;
}

export async function createQueue(input: QueueInput): Promise<Queue> {
  const { data } = await api.post<Queue>("/queues", input);
  return data;
}

export async function updateQueue(id: number, input: QueueInput): Promise<Queue> {
  const { data } = await api.put<Queue>(`/queues/${id}`, input);
  return data;
}

export async function deleteQueue(id: number): Promise<void> {
  await api.delete(`/queues/${id}`);
}
```

(Junte o `import type { WeekSchedule }` ao import de tipos existente.)

`frontend/src/features/queues/schedule.ts`:

```ts
import type { WeekDay, WeekSchedule } from "@/types/api";

export const DAYS: { key: WeekDay; label: string; short: string }[] = [
  { key: "1", label: "Segunda", short: "Seg" },
  { key: "2", label: "Terça", short: "Ter" },
  { key: "3", label: "Quarta", short: "Qua" },
  { key: "4", label: "Quinta", short: "Qui" },
  { key: "5", label: "Sexta", short: "Sex" },
  { key: "6", label: "Sábado", short: "Sáb" },
  { key: "0", label: "Domingo", short: "Dom" },
];

const RANGE = /^([01]\d|2[0-3]):[0-5]\d-(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

export function isAlwaysOpen(schedule: WeekSchedule): boolean {
  return Object.keys(schedule).length === 0;
}

/** Lista vazia = dia fechado (a chave continua no objeto, então a fila deixa de ser "sempre aberta"). */
export function setDayRanges(schedule: WeekSchedule, day: WeekDay, ranges: string[]): WeekSchedule {
  return { ...schedule, [day]: ranges };
}

export function validateSchedule(schedule: WeekSchedule): string | null {
  for (const { key, label } of DAYS) {
    for (const range of schedule[key] ?? []) {
      if (!RANGE.test(range)) return `${label}: use horários no formato HH:mm.`;
      const [start, end] = range.split("-");
      if (start! >= end!) return `${label}: o início deve ser antes do fim.`;
    }
  }
  return null;
}

export function describeSchedule(schedule: WeekSchedule): string {
  if (isAlwaysOpen(schedule)) return "Sempre aberto";
  return DAYS.filter((d) => (schedule[d.key] ?? []).length > 0)
    .map((d) => d.short)
    .join(", ");
}
```

`frontend/src/features/queues/ScheduleEditor.tsx`:

```tsx
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WeekSchedule } from "@/types/api";
import { DAYS, isAlwaysOpen, setDayRanges } from "./schedule";

const DEFAULT_RANGE = "08:00-18:00";

export function ScheduleEditor({ value, onChange }: { value: WeekSchedule; onChange: (value: WeekSchedule) => void }) {
  const alwaysOpen = isAlwaysOpen(value);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--color-primary)]"
          checked={alwaysOpen}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? {}
                : { "0": [], "1": [DEFAULT_RANGE], "2": [DEFAULT_RANGE], "3": [DEFAULT_RANGE], "4": [DEFAULT_RANGE], "5": [DEFAULT_RANGE], "6": [] },
            )
          }
        />
        Sempre aberto
      </label>
      {!alwaysOpen && (
        <div className="divide-y divide-border rounded-lg border border-border">
          {DAYS.map(({ key, label }) => {
            const ranges = value[key] ?? [];
            const open = ranges.length > 0;
            return (
              <div key={key} className="flex items-start gap-3 px-3 py-2">
                <label className="flex w-32 items-center gap-2 pt-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`${label} aberto`}
                    className="h-4 w-4 accent-[var(--color-primary)]"
                    checked={open}
                    onChange={(e) => onChange(setDayRanges(value, key, e.target.checked ? [DEFAULT_RANGE] : []))}
                  />
                  {label}
                </label>
                <div className="flex-1 space-y-2">
                  {!open && <p className="pt-2 text-sm text-ink-muted">Fechado</p>}
                  {ranges.map((range, index) => {
                    const [start = "", end = ""] = range.split("-");
                    const update = (s: string, e: string) => {
                      const copy = [...ranges];
                      copy[index] = `${s}-${e}`;
                      onChange({ ...value, [key]: copy });
                    };
                    return (
                      <div key={index} className="flex items-center gap-2">
                        <Input
                          type="time"
                          aria-label={`${label} início ${index + 1}`}
                          className="w-32"
                          value={start}
                          onChange={(e) => update(e.target.value, end)}
                        />
                        <span className="text-ink-muted">às</span>
                        <Input
                          type="time"
                          aria-label={`${label} fim ${index + 1}`}
                          className="w-32"
                          value={end === "24:00" ? "23:59" : end}
                          onChange={(e) => update(start, e.target.value === "23:59" ? "24:00" : e.target.value)}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remover horário"
                          onClick={() => onChange(setDayRanges(value, key, ranges.filter((_, i) => i !== index)))}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    );
                  })}
                  {open && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onChange(setDayRanges(value, key, [...ranges, "13:00-18:00"]))}
                    >
                      <Plus className="h-4 w-4" aria-hidden /> Adicionar horário
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

Observações sobre o editor: ao sair de "Sempre aberto", o editor começa com segunda a sexta das 08:00 às 18:00 e sábado/domingo fechados; dia fechado é enviado como lista vazia (`[]`), que o backend trata como fechado. O campo "fim" exibe `23:59` quando o valor é `24:00` e grava `24:00` quando o usuário escolhe `23:59`, para permitir expediente até a meia-noite.

`frontend/src/features/queues/QueueDialog.tsx`:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/apiError";
import type { Queue, WeekSchedule } from "@/types/api";
import { createQueue, queueKeys, updateQueue } from "./queuesApi";
import { ScheduleEditor } from "./ScheduleEditor";
import { validateSchedule } from "./schedule";

export function QueueDialog({ queue, onClose }: { queue?: Queue; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(queue?.name ?? "");
  const [color, setColor] = useState(queue?.color ?? "#6d5dfc");
  const [schedule, setSchedule] = useState<WeekSchedule>(queue?.schedule ?? {});
  const scheduleError = validateSchedule(schedule);

  const mutation = useMutation({
    mutationFn: () => {
      const input = { name: name.trim(), color, schedule };
      return queue ? updateQueue(queue.id, input) : createQueue(input);
    },
    onSuccess: () => {
      toast.success(queue ? "Fila atualizada" : "Fila criada");
      void queryClient.invalidateQueries({ queryKey: queueKeys.all });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={queue ? "Editar fila" : "Nova fila"} className="max-w-2xl">
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="flex gap-4">
            <div className="flex-1">
              <Label htmlFor="queue-name">Nome</Label>
              <Input id="queue-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            </div>
            <div>
              <Label htmlFor="queue-color">Cor</Label>
              <Input
                id="queue-color"
                type="color"
                className="w-16 p-1"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium">Horário de expediente</p>
            <ScheduleEditor value={schedule} onChange={setSchedule} />
            {scheduleError && (
              <p role="alert" className="mt-2 text-sm text-danger">
                {scheduleError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={!name.trim() || Boolean(scheduleError)}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`frontend/src/features/queues/QueuesPage.tsx`:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/apiError";
import type { Queue } from "@/types/api";
import { QueueDialog } from "./QueueDialog";
import { deleteQueue, queueKeys, useQueues } from "./queuesApi";
import { describeSchedule } from "./schedule";

export function QueuesPage() {
  const queryClient = useQueryClient();
  const queues = useQueues();
  const [dialog, setDialog] = useState<{ queue?: Queue } | null>(null);

  const remove = useMutation({
    mutationFn: (id: number) => deleteQueue(id),
    onSuccess: () => {
      toast.success("Fila excluída");
      void queryClient.invalidateQueries({ queryKey: queueKeys.all });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Filas"
        description="Setores que recebem os atendimentos, com horário de expediente."
        actions={
          <Button onClick={() => setDialog({})}>
            <Plus className="h-4 w-4" aria-hidden /> Nova fila
          </Button>
        }
      />
      <div className="p-6">
        {queues.isLoading ? (
          <Spinner />
        ) : queues.isError ? (
          <p className="text-sm text-danger">{errorMessage(queues.error)}</p>
        ) : queues.data!.length === 0 ? (
          <EmptyState icon={Layers} title="Nenhuma fila cadastrada" description="Crie a primeira fila para organizar os atendimentos." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {queues.data!.map((queue) => (
              <Card key={queue.id} className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-3 w-3 rounded-full" style={{ backgroundColor: queue.color }} aria-hidden />
                  <div>
                    <p className="font-semibold">{queue.name}</p>
                    <p className="text-sm text-ink-muted">{describeSchedule(queue.schedule)}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Editar ${queue.name}`} onClick={() => setDialog({ queue })}>
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Excluir ${queue.name}`}
                    onClick={() => {
                      if (window.confirm(`Excluir a fila "${queue.name}"?`)) remove.mutate(queue.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
      {dialog && <QueueDialog queue={dialog.queue} onClose={() => setDialog(null)} />}
    </div>
  );
}
```

Em `frontend/src/app/routes.tsx`:

```tsx
import { RequireProfile } from "@/components/layout/ProtectedRoute";
import { QueuesPage } from "@/features/queues/QueuesPage";
// ...
        <Route
          path="filas"
          element={
            <RequireProfile profiles={["admin"]}>
              <QueuesPage />
            </RequireProfile>
          }
        />
```

(Junte `RequireProfile` ao import existente de `ProtectedRoute`.)

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat(frontend): filas com editor de horário de expediente"
```

---

### Task 11: Usuários

**Files:**
- Create: `frontend/src/features/users/{UserDialog.tsx,UsersPage.tsx}`
- Modify: `frontend/src/features/users/usersApi.ts` (acrescentar CRUD), `frontend/src/app/routes.tsx` (rota `/usuarios`, admin e supervisor)
- Test: `frontend/src/features/users/UsersPage.test.tsx`

**Interfaces:**
- Consumes: `useQueues`, `PageHeader`, `RequireProfile`, UI.
- Produces:
  - `fetchUsers(): Promise<UserView[]>`, `createUser(input): Promise<UserView>`, `updateUser(id, input): Promise<UserView>`, `deleteUser(id): Promise<void>`; `interface UserInput { name; email; password?; profile; queueIds }`.
  - `UsersPage` em `/usuarios`: tabela (Nome, E-mail, Perfil, Filas). Admin vê "Novo usuário", "Editar {nome}", "Excluir {nome}"; supervisor só consulta.
  - `UserDialog({ user?: UserView; onClose })`: campos Nome, E-mail, Senha (obrigatória ao criar, mínimo 6; opcional ao editar), Perfil (`admin` "Administrador", `supervisor` "Supervisor", `agent` "Atendente") e caixas por fila.

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/features/users/UsersPage.test.tsx`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fetchQueues } from "@/features/queues/queuesApi";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { UsersPage } from "./UsersPage";
import { createUser, fetchUsers, updateUser } from "./usersApi";

vi.mock("./usersApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./usersApi")>()),
  fetchUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
}));
vi.mock("@/features/queues/queuesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/queues/queuesApi")>()),
  fetchQueues: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.mocked(fetchQueues).mockResolvedValue([
    { id: 10, companyId: 1, name: "Suporte", color: "#6d5dfc", schedule: {} },
    { id: 20, companyId: 1, name: "Financeiro", color: "#16a34a", schedule: {} },
  ]);
  vi.mocked(fetchUsers).mockResolvedValue([
    { id: 1, companyId: 1, name: "Ana Admin", email: "ana@test.local", profile: "admin", queueIds: [] },
    { id: 2, companyId: 1, name: "Bruno", email: "bruno@test.local", profile: "agent", queueIds: [10] },
  ]);
});

describe("UsersPage", () => {
  it("lists users with profile and queues", async () => {
    setTestUser({ id: 1, profile: "admin" });
    renderWithProviders(<UsersPage />);
    const row = (await screen.findByText("Bruno")).closest("tr")!;
    expect(within(row).getByText("Atendente")).toBeInTheDocument();
    expect(await within(row).findByText("Suporte")).toBeInTheDocument();
  });

  it("creates an agent linked to a queue", async () => {
    setTestUser({ id: 1, profile: "admin" });
    vi.mocked(createUser).mockResolvedValue({
      id: 3, companyId: 1, name: "Carla", email: "carla@test.local", profile: "agent", queueIds: [20],
    });
    renderWithProviders(<UsersPage />);
    await screen.findByText("Bruno");

    await userEvent.click(screen.getByRole("button", { name: "Novo usuário" }));
    const dialog = screen.getByRole("dialog", { name: "Novo usuário" });
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Carla");
    await userEvent.type(within(dialog).getByLabelText("E-mail"), "carla@test.local");
    await userEvent.type(within(dialog).getByLabelText("Senha"), "senha123");
    await userEvent.click(await within(dialog).findByRole("checkbox", { name: "Financeiro" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(createUser).toHaveBeenCalledWith({
        name: "Carla",
        email: "carla@test.local",
        password: "senha123",
        profile: "agent",
        queueIds: [20],
      }),
    );
  });

  it("edits without sending an empty password", async () => {
    setTestUser({ id: 1, profile: "admin" });
    vi.mocked(updateUser).mockResolvedValue({
      id: 2, companyId: 1, name: "Bruno Lima", email: "bruno@test.local", profile: "agent", queueIds: [10],
    });
    renderWithProviders(<UsersPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Editar Bruno" }));
    const dialog = screen.getByRole("dialog", { name: "Editar usuário" });
    const name = within(dialog).getByLabelText("Nome");
    await userEvent.clear(name);
    await userEvent.type(name, "Bruno Lima");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith(2, {
        name: "Bruno Lima",
        email: "bruno@test.local",
        profile: "agent",
        queueIds: [10],
      }),
    );
  });

  it("lets supervisors only read the list", async () => {
    setTestUser({ id: 5, profile: "supervisor" });
    renderWithProviders(<UsersPage />);
    await screen.findByText("Bruno");
    expect(screen.queryByRole("button", { name: "Novo usuário" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar Bruno" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/users`
Expected: FAIL com `Failed to resolve import "./UsersPage"`.

- [ ] **Step 3: Implementar**

Acrescente em `frontend/src/features/users/usersApi.ts`:

```ts
import type { Profile, UserView } from "@/types/api";

export interface UserInput {
  name: string;
  email: string;
  password?: string;
  profile: Profile;
  queueIds: number[];
}

export const PROFILE_LABEL: Record<Profile, string> = {
  admin: "Administrador",
  supervisor: "Supervisor",
  agent: "Atendente",
};

export async function fetchUsers(): Promise<UserView[]> {
  const { data } = await api.get<UserView[]>("/users");
  return data;
}

export async function createUser(input: UserInput): Promise<UserView> {
  const { data } = await api.post<UserView>("/users", input);
  return data;
}

export async function updateUser(id: number, input: UserInput): Promise<UserView> {
  const { data } = await api.put<UserView>(`/users/${id}`, input);
  return data;
}

export async function deleteUser(id: number): Promise<void> {
  await api.delete(`/users/${id}`);
}
```

(Junte os imports de tipos ao import existente.)

`frontend/src/features/users/UserDialog.tsx`:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useQueues } from "@/features/queues/queuesApi";
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
```

`frontend/src/features/users/UsersPage.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useQueues } from "@/features/queues/queuesApi";
import { errorMessage } from "@/lib/apiError";
import { useAuth } from "@/stores/auth";
import type { UserView } from "@/types/api";
import { UserDialog } from "./UserDialog";
import { deleteUser, fetchUsers, PROFILE_LABEL, userKeys } from "./usersApi";

export function UsersPage() {
  const me = useAuth((s) => s.user)!;
  const isAdmin = me.profile === "admin";
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: [...userKeys.all, "list"], queryFn: fetchUsers });
  const queues = useQueues();
  const [dialog, setDialog] = useState<{ user?: UserView } | null>(null);

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
                  <th className="px-5 py-3 font-medium">E-mail</th>
                  <th className="px-5 py-3 font-medium">Perfil</th>
                  <th className="px-5 py-3 font-medium">Filas</th>
                  {isAdmin && <th className="px-5 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.data!.map((user) => (
                  <tr key={user.id}>
                    <td className="px-5 py-3 font-medium">{user.name}</td>
                    <td className="px-5 py-3 text-ink-muted">{user.email}</td>
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
                        <Button variant="ghost" size="icon" aria-label={`Editar ${user.name}`} onClick={() => setDialog({ user })}>
                          <Pencil className="h-4 w-4" aria-hidden />
                        </Button>
                        {user.id !== me.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Excluir ${user.name}`}
                            onClick={() => {
                              if (window.confirm(`Excluir o usuário ${user.name}?`)) remove.mutate(user.id);
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
      {dialog && <UserDialog user={dialog.user} onClose={() => setDialog(null)} />}
    </div>
  );
}
```

Em `frontend/src/app/routes.tsx`:

```tsx
import { UsersPage } from "@/features/users/UsersPage";
// ...
        <Route
          path="usuarios"
          element={
            <RequireProfile profiles={["admin", "supervisor"]}>
              <UsersPage />
            </RequireProfile>
          }
        />
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat(frontend): gestão de usuários com perfis e filas"
```

---

### Task 12: Conexões WhatsApp — QR code, status ao vivo e alertas

**Files:**
- Create: `frontend/src/features/connections/{connectionsApi.ts,ConnectionDialog.tsx,QrCodeDialog.tsx,ConnectionsPage.tsx,ConnectionAlerts.tsx}`
- Modify: `frontend/src/components/layout/AppShell.tsx` (renderizar `ConnectionAlerts`), `frontend/src/app/routes.tsx` (rota `/conexoes`, só admin)
- Test: `frontend/src/features/connections/ConnectionsPage.test.tsx`

**Interfaces:**
- Consumes: `api`, `useRealtimeEvent`, `useQueues`, `PageHeader`, `RequireProfile`, UI.
- Produces:
  - `connectionKeys = { all: ["connections"] }`; `interface ConnectionInput { name; isDefault?; defaultQueueId?; outOfHoursMessage?; closingMessage?; transferMessage?; botTimeoutMinutes? }`.
  - `fetchConnections(): Promise<Connection[]>`, `createConnection(input)`, `updateConnection(id, input)`, `deleteConnection(id): Promise<void>`, `fetchQrCode(id): Promise<{ qr: string | null }>`, `disconnectConnection(id): Promise<Connection>`.
  - `useConnections()`, `useConnectionRealtime()` (aplica `connection:update` no cache).
  - `STATUS_LABEL`: `connected` "Conectado", `qrcode` "Aguardando QR code", `disconnected` "Desconectado".
  - `ConnectionsPage` em `/conexoes`; `ConnectionDialog({ connection?, onClose, onCreated? })`; `QrCodeDialog({ connection, onClose })` (atualiza com `connection:qrcode`, fecha com toast "WhatsApp conectado" quando o status vira `connected`); `ConnectionAlerts` (toast de erro em `connection:alert`).

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/features/connections/ConnectionsPage.test.tsx`:

```tsx
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Socket } from "socket.io-client";
import { toast } from "sonner";
import { fetchQueues } from "@/features/queues/queuesApi";
import { RealtimeContext } from "@/realtime/RealtimeProvider";
import { FakeSocket } from "@/test/fakeSocket";
import { renderWithProviders, setTestUser } from "@/test/utils";
import type { Connection } from "@/types/api";
import { ConnectionAlerts } from "./ConnectionAlerts";
import { ConnectionsPage } from "./ConnectionsPage";
import { createConnection, disconnectConnection, fetchConnections, fetchQrCode } from "./connectionsApi";

vi.mock("./connectionsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./connectionsApi")>()),
  fetchConnections: vi.fn(),
  createConnection: vi.fn(),
  updateConnection: vi.fn(),
  deleteConnection: vi.fn(),
  fetchQrCode: vi.fn(),
  disconnectConnection: vi.fn(),
}));
vi.mock("@/features/queues/queuesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/queues/queuesApi")>()),
  fetchQueues: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const conn = (partial: Partial<Connection>): Connection => ({
  id: 1,
  companyId: 1,
  name: "Principal",
  instanceName: "wo_1_abc",
  status: "connected",
  number: "5511999990000",
  isDefault: true,
  defaultQueueId: 10,
  outOfHoursMessage: "Fora do horário",
  closingMessage: "",
  transferMessage: "Aguarde",
  botTimeoutMinutes: 30,
  ...partial,
});

beforeEach(() => {
  setTestUser({ profile: "admin" });
  vi.mocked(fetchQueues).mockResolvedValue([{ id: 10, companyId: 1, name: "Suporte", color: "#6d5dfc", schedule: {} }]);
  vi.mocked(fetchConnections).mockResolvedValue([
    conn({ id: 1, name: "Principal", status: "connected" }),
    conn({ id: 2, name: "Vendas", status: "disconnected", isDefault: false, number: null }),
  ]);
});

describe("ConnectionsPage", () => {
  it("lists connections with their status", async () => {
    renderWithProviders(<ConnectionsPage />, { socket: new FakeSocket() });
    const principal = (await screen.findByText("Principal")).closest("article")!;
    expect(within(principal).getByText("Conectado")).toBeInTheDocument();
    const vendas = screen.getByText("Vendas").closest("article")!;
    expect(within(vendas).getByText("Desconectado")).toBeInTheDocument();
  });

  it("creates a connection and shows its QR code, closing when WhatsApp connects", async () => {
    const socket = new FakeSocket();
    const created = conn({ id: 3, name: "Comercial", status: "qrcode", isDefault: false, number: null });
    vi.mocked(createConnection).mockResolvedValue(created);
    vi.mocked(fetchQrCode).mockResolvedValue({ qr: "data:image/png;base64,QR1" });
    renderWithProviders(<ConnectionsPage />, { socket });
    await screen.findByText("Principal");

    await userEvent.click(screen.getByRole("button", { name: "Nova conexão" }));
    const dialog = screen.getByRole("dialog", { name: "Nova conexão" });
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Comercial");
    vi.mocked(fetchConnections).mockResolvedValue([conn({ id: 1 }), created]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(createConnection).toHaveBeenCalledWith(expect.objectContaining({ name: "Comercial" })));
    const qrDialog = await screen.findByRole("dialog", { name: "Conectar Comercial" });
    expect(await within(qrDialog).findByAltText("QR code do WhatsApp")).toHaveAttribute("src", "data:image/png;base64,QR1");

    act(() => socket.serverEmit("connection:qrcode", { connectionId: 3, qr: "data:image/png;base64,QR2" }));
    expect(within(qrDialog).getByAltText("QR code do WhatsApp")).toHaveAttribute("src", "data:image/png;base64,QR2");

    act(() => socket.serverEmit("connection:update", { ...created, status: "connected", number: "5511911112222" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conectar Comercial" })).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith("WhatsApp conectado");
  });

  it("disconnects after confirmation", async () => {
    vi.mocked(disconnectConnection).mockResolvedValue(conn({ status: "disconnected" }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<ConnectionsPage />, { socket: new FakeSocket() });
    await userEvent.click(await screen.findByRole("button", { name: "Desconectar Principal" }));
    await waitFor(() => expect(disconnectConnection).toHaveBeenCalledWith(1));
  });
});

describe("ConnectionAlerts", () => {
  it("warns when a connection drops", () => {
    const socket = new FakeSocket();
    render(
      <RealtimeContext.Provider value={{ socket: socket as unknown as Socket, epoch: 1 }}>
        <ConnectionAlerts />
      </RealtimeContext.Provider>,
    );
    act(() => socket.serverEmit("connection:alert", { connectionId: 1, name: "Principal" }));
    expect(toast.error).toHaveBeenCalledWith('A conexão "Principal" caiu. Gere um novo QR code para reconectar.');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/connections`
Expected: FAIL com `Failed to resolve import "./ConnectionAlerts"`.

- [ ] **Step 3: Implementar**

`frontend/src/features/connections/connectionsApi.ts`:

```ts
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useRealtimeEvent } from "@/realtime/RealtimeProvider";
import type { Connection, ConnectionStatus } from "@/types/api";

export const connectionKeys = { all: ["connections"] as const };

export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "Conectado",
  qrcode: "Aguardando QR code",
  disconnected: "Desconectado",
};

export const DEFAULT_TRANSFER_MESSAGE = "Aguarde, em instantes um atendente irá falar com você.";
export const DEFAULT_OUT_OF_HOURS_MESSAGE =
  "Nosso horário de atendimento encerrou. Sua mensagem foi registrada e responderemos assim que possível.";

export interface ConnectionInput {
  name: string;
  isDefault?: boolean;
  defaultQueueId?: number | null;
  outOfHoursMessage?: string;
  closingMessage?: string;
  transferMessage?: string;
  botTimeoutMinutes?: number;
}

export async function fetchConnections(): Promise<Connection[]> {
  const { data } = await api.get<Connection[]>("/connections");
  return data;
}

export async function createConnection(input: ConnectionInput): Promise<Connection> {
  const { data } = await api.post<Connection>("/connections", input);
  return data;
}

export async function updateConnection(id: number, input: ConnectionInput): Promise<Connection> {
  const { data } = await api.put<Connection>(`/connections/${id}`, input);
  return data;
}

export async function deleteConnection(id: number): Promise<void> {
  await api.delete(`/connections/${id}`);
}

export async function fetchQrCode(id: number): Promise<{ qr: string | null }> {
  const { data } = await api.get<{ qr: string | null }>(`/connections/${id}/qrcode`);
  return data;
}

export async function disconnectConnection(id: number): Promise<Connection> {
  const { data } = await api.post<Connection>(`/connections/${id}/disconnect`);
  return data;
}

export function useConnections() {
  return useQuery({ queryKey: connectionKeys.all, queryFn: fetchConnections });
}

export function useConnectionRealtime(): void {
  const queryClient = useQueryClient();
  useRealtimeEvent<Connection>("connection:update", (updated) => {
    queryClient.setQueryData<Connection[]>(connectionKeys.all, (list) =>
      list?.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
    );
  });
}
```

`frontend/src/features/connections/ConnectionAlerts.tsx`:

```tsx
import { toast } from "sonner";
import { useRealtimeEvent } from "@/realtime/RealtimeProvider";

export function ConnectionAlerts() {
  useRealtimeEvent<{ connectionId: number; name: string }>("connection:alert", ({ name }) => {
    toast.error(`A conexão "${name}" caiu. Gere um novo QR code para reconectar.`);
  });
  return null;
}
```

`frontend/src/features/connections/QrCodeDialog.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/apiError";
import { useRealtimeEvent } from "@/realtime/RealtimeProvider";
import type { Connection } from "@/types/api";
import { fetchQrCode, useConnections } from "./connectionsApi";

export function QrCodeDialog({ connection, onClose }: { connection: Connection; onClose: () => void }) {
  const qrQuery = useQuery({
    queryKey: ["connections", connection.id, "qrcode"],
    queryFn: () => fetchQrCode(connection.id),
    gcTime: 0,
  });
  const [liveQr, setLiveQr] = useState<string | null>(null);
  const connections = useConnections();
  const current = connections.data?.find((c) => c.id === connection.id);

  useRealtimeEvent<{ connectionId: number; qr: string }>("connection:qrcode", (payload) => {
    if (payload.connectionId === connection.id) setLiveQr(payload.qr);
  });

  useEffect(() => {
    if (current?.status === "connected") {
      toast.success("WhatsApp conectado");
      onClose();
    }
  }, [current?.status, onClose]);

  const qr = liveQr ?? qrQuery.data?.qr ?? null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`Conectar ${connection.name}`}
        description="No celular, abra o WhatsApp > Aparelhos conectados > Conectar um aparelho e aponte a câmera para o código."
      >
        <div className="flex min-h-64 items-center justify-center">
          {qrQuery.isError ? (
            <p className="text-sm text-danger">{errorMessage(qrQuery.error)}</p>
          ) : qr ? (
            <img src={qr} alt="QR code do WhatsApp" className="h-64 w-64 rounded-lg border border-border" />
          ) : (
            <Spinner className="h-8 w-8" />
          )}
        </div>
        <p className="mt-2 text-center text-xs text-ink-muted">O código é renovado automaticamente.</p>
      </DialogContent>
    </Dialog>
  );
}
```

`frontend/src/features/connections/ConnectionDialog.tsx`:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useQueues } from "@/features/queues/queuesApi";
import { errorMessage } from "@/lib/apiError";
import type { Connection } from "@/types/api";
import {
  connectionKeys,
  createConnection,
  DEFAULT_OUT_OF_HOURS_MESSAGE,
  DEFAULT_TRANSFER_MESSAGE,
  updateConnection,
  type ConnectionInput,
} from "./connectionsApi";

export function ConnectionDialog({
  connection,
  onClose,
  onCreated,
}: {
  connection?: Connection;
  onClose: () => void;
  onCreated?: (connection: Connection) => void;
}) {
  const queryClient = useQueryClient();
  const queues = useQueues();
  const [name, setName] = useState(connection?.name ?? "");
  const [defaultQueueId, setDefaultQueueId] = useState(connection?.defaultQueueId ? String(connection.defaultQueueId) : "");
  const [isDefault, setIsDefault] = useState(connection?.isDefault ?? false);
  const [transferMessage, setTransferMessage] = useState(connection?.transferMessage ?? DEFAULT_TRANSFER_MESSAGE);
  const [outOfHoursMessage, setOutOfHoursMessage] = useState(connection?.outOfHoursMessage ?? DEFAULT_OUT_OF_HOURS_MESSAGE);
  const [closingMessage, setClosingMessage] = useState(connection?.closingMessage ?? "");
  const [botTimeoutMinutes, setBotTimeoutMinutes] = useState(String(connection?.botTimeoutMinutes ?? 30));

  const timeout = Number(botTimeoutMinutes);
  const valid = name.trim() !== "" && Number.isInteger(timeout) && timeout >= 1 && timeout <= 1440;

  const mutation = useMutation({
    mutationFn: () => {
      const input: ConnectionInput = {
        name: name.trim(),
        isDefault,
        defaultQueueId: defaultQueueId ? Number(defaultQueueId) : null,
        transferMessage,
        outOfHoursMessage,
        closingMessage,
        botTimeoutMinutes: timeout,
      };
      return connection ? updateConnection(connection.id, input) : createConnection(input);
    },
    onSuccess: (saved) => {
      toast.success(connection ? "Conexão atualizada" : "Conexão criada");
      void queryClient.invalidateQueries({ queryKey: connectionKeys.all });
      onClose();
      if (!connection) onCreated?.(saved);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={connection ? "Editar conexão" : "Nova conexão"} className="max-w-xl">
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div>
            <Label htmlFor="conn-name">Nome</Label>
            <Input id="conn-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="conn-queue">Fila padrão</Label>
              <Select id="conn-queue" value={defaultQueueId} onChange={(e) => setDefaultQueueId(e.target.value)}>
                <option value="">Nenhuma</option>
                {queues.data?.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="conn-timeout">Tempo limite do bot (minutos)</Label>
              <Input
                id="conn-timeout"
                type="number"
                min={1}
                max={1440}
                value={botTimeoutMinutes}
                onChange={(e) => setBotTimeoutMinutes(e.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-primary)]"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            Conexão padrão da empresa
          </label>
          <div>
            <Label htmlFor="conn-transfer">Mensagem de transferência</Label>
            <Textarea id="conn-transfer" rows={2} value={transferMessage} onChange={(e) => setTransferMessage(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="conn-hours">Mensagem fora do expediente</Label>
            <Textarea id="conn-hours" rows={2} value={outOfHoursMessage} onChange={(e) => setOutOfHoursMessage(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="conn-closing">Mensagem de encerramento</Label>
            <Textarea
              id="conn-closing"
              rows={2}
              placeholder="Opcional — enviada ao finalizar o atendimento"
              value={closingMessage}
              onChange={(e) => setClosingMessage(e.target.value)}
            />
          </div>
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
```

`frontend/src/features/connections/ConnectionsPage.tsx`:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, QrCode, Smartphone, Star, Trash2, Unplug } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/apiError";
import { formatPhone } from "@/lib/format";
import type { Connection, ConnectionStatus } from "@/types/api";
import { ConnectionDialog } from "./ConnectionDialog";
import {
  connectionKeys,
  deleteConnection,
  disconnectConnection,
  STATUS_LABEL,
  useConnectionRealtime,
  useConnections,
} from "./connectionsApi";
import { QrCodeDialog } from "./QrCodeDialog";

const STATUS_TONE: Record<ConnectionStatus, "success" | "warning" | "neutral"> = {
  connected: "success",
  qrcode: "warning",
  disconnected: "neutral",
};

export function ConnectionsPage() {
  const queryClient = useQueryClient();
  const connections = useConnections();
  useConnectionRealtime();
  const [editing, setEditing] = useState<{ connection?: Connection } | null>(null);
  const [qrFor, setQrFor] = useState<Connection | null>(null);
  const closeQr = useCallback(() => setQrFor(null), []);

  const onError = (err: unknown) => toast.error(errorMessage(err));
  const refresh = () => void queryClient.invalidateQueries({ queryKey: connectionKeys.all });
  const disconnect = useMutation({ mutationFn: disconnectConnection, onSuccess: refresh, onError });
  const remove = useMutation({
    mutationFn: deleteConnection,
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
                        onClick={() => {
                          if (window.confirm(`Desconectar ${c.name}? O número deixará de receber mensagens.`)) {
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
                      onClick={() => {
                        if (window.confirm(`Excluir a conexão ${c.name}?`)) remove.mutate(c.id);
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
```

`frontend/src/components/layout/AppShell.tsx` (substituir):

```tsx
import { Outlet } from "react-router-dom";
import { ConnectionAlerts } from "@/features/connections/ConnectionAlerts";
import { RealtimeProvider } from "@/realtime/RealtimeProvider";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  return (
    <RealtimeProvider>
      <ConnectionAlerts />
      <div className="flex h-full min-w-[768px]">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </RealtimeProvider>
  );
}
```

Em `frontend/src/app/routes.tsx`:

```tsx
import { ConnectionsPage } from "@/features/connections/ConnectionsPage";
// ...
        <Route
          path="conexoes"
          element={
            <RequireProfile profiles={["admin"]}>
              <ConnectionsPage />
            </RequireProfile>
          }
        />
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat(frontend): conexões com QR code, status ao vivo e alerta de queda"
```

---

### Task 13: Editor do chatbot e simulador

**Files:**
- Create: `frontend/src/features/chatbot/{chatbotApi.ts,tree.ts,NodeTree.tsx,NodeForm.tsx,Simulator.tsx,ChatbotPage.tsx}`
- Modify: `frontend/src/app/routes.tsx` (rota `/chatbot`, só admin)
- Test: `frontend/src/features/chatbot/tree.test.ts`, `frontend/src/features/chatbot/ChatbotPage.test.tsx`

**Interfaces:**
- Consumes: `useConnections`, `useQueues`, `useUserOptions`, `uploadMedia`, `PageHeader`, `RequireProfile`, UI, `@dnd-kit/*`.
- Produces:
  - `chatbotKeys.nodes(connectionId)`; `interface NodeInput { parentId?; key?; title?; action?; message?; mediaUrl?; mediaMime?; mediaName?; queueId?; userId? }`.
  - `fetchNodes(connectionId): Promise<ChatbotNode[]>`, `createNode(connectionId, input)`, `updateNode(id, input)`, `deleteNode(id): Promise<void>`, `reorderChildren(parentId, ids): Promise<ChatbotNode[]>`, `simulate(connectionId, state, input): Promise<StepResult>`.
  - `interface TreeNode { node: ChatbotNode; children: TreeNode[] }`; `buildTree(nodes): TreeNode | null`; `moveId(ids, activeId, overId)`; `moveByOffset(ids, id, offset: -1 | 1)`; `nextFreeKey(siblings): string`; `canHaveChildren(node)`; `ACTION_LABELS`.
  - `ChatbotPage` em `/chatbot`: seletor "Conexão"; sem raiz → "Criar mensagem de boas-vindas" (cria raiz com mensagem "Olá! Escolha uma opção:"); árvore com "Adicionar opção", "Mover para cima/baixo", "Excluir {título}", arrastar para reordenar; formulário do nó; simulador.
  - `Simulator({ connectionId })`: campo "Mensagem do cliente", botão "Enviar" e "Reiniciar"; mostra bolhas do bot e avisos "Transferido para a fila X" / "Transferido para o atendente Y" / "Conversa encerrada".

- [ ] **Step 1: Escrever os testes que falham**

`frontend/src/features/chatbot/tree.test.ts`:

```ts
import type { ChatbotNode } from "@/types/api";
import { buildTree, canHaveChildren, moveByOffset, moveId, nextFreeKey } from "./tree";

const node = (partial: Partial<ChatbotNode> & Pick<ChatbotNode, "id">): ChatbotNode => ({
  companyId: 1,
  connectionId: 1,
  parentId: null,
  order: 0,
  key: "",
  title: "",
  action: "submenu",
  message: "",
  mediaUrl: null,
  mediaMime: null,
  mediaName: null,
  queueId: null,
  userId: null,
  ...partial,
});

describe("chatbot tree helpers", () => {
  it("builds the tree ordering children by order", () => {
    const tree = buildTree([
      node({ id: 3, parentId: 1, order: 2, key: "2", title: "B", action: "close" }),
      node({ id: 1 }),
      node({ id: 2, parentId: 1, order: 1, key: "1", title: "A", action: "submenu" }),
      node({ id: 4, parentId: 2, order: 1, key: "1", title: "A1", action: "reply" }),
    ]);
    expect(tree!.node.id).toBe(1);
    expect(tree!.children.map((c) => c.node.id)).toEqual([2, 3]);
    expect(tree!.children[0]!.children.map((c) => c.node.id)).toEqual([4]);
    expect(buildTree([])).toBeNull();
  });

  it("moves ids", () => {
    expect(moveId([1, 2, 3], 1, 3)).toEqual([2, 3, 1]);
    expect(moveByOffset([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(moveByOffset([1, 2, 3], 3, 1)).toEqual([1, 2, 3]);
  });

  it("suggests the next free key and knows who can have children", () => {
    expect(nextFreeKey([node({ id: 2, key: "1" }), node({ id: 3, key: "3" })])).toBe("2");
    expect(canHaveChildren(node({ id: 1 }))).toBe(true);
    expect(canHaveChildren(node({ id: 2, parentId: 1, action: "reply" }))).toBe(false);
  });
});
```

`frontend/src/features/chatbot/ChatbotPage.test.tsx`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fetchConnections } from "@/features/connections/connectionsApi";
import { fetchQueues } from "@/features/queues/queuesApi";
import { fetchUserOptions } from "@/features/users/usersApi";
import { FakeSocket } from "@/test/fakeSocket";
import { renderWithProviders, setTestUser } from "@/test/utils";
import type { ChatbotNode, Connection } from "@/types/api";
import { createNode, fetchNodes, reorderChildren, simulate } from "./chatbotApi";
import { ChatbotPage } from "./ChatbotPage";

vi.mock("./chatbotApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./chatbotApi")>()),
  fetchNodes: vi.fn(),
  createNode: vi.fn(),
  updateNode: vi.fn(),
  deleteNode: vi.fn(),
  reorderChildren: vi.fn(),
  simulate: vi.fn(),
}));
vi.mock("@/features/connections/connectionsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/connections/connectionsApi")>()),
  fetchConnections: vi.fn(),
}));
vi.mock("@/features/queues/queuesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/queues/queuesApi")>()),
  fetchQueues: vi.fn(),
}));
vi.mock("@/features/users/usersApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/users/usersApi")>()),
  fetchUserOptions: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const node = (partial: Partial<ChatbotNode> & Pick<ChatbotNode, "id">): ChatbotNode => ({
  companyId: 1,
  connectionId: 1,
  parentId: null,
  order: 0,
  key: "",
  title: "",
  action: "submenu",
  message: "",
  mediaUrl: null,
  mediaMime: null,
  mediaName: null,
  queueId: null,
  userId: null,
  ...partial,
});

const connection: Connection = {
  id: 1,
  companyId: 1,
  name: "Principal",
  instanceName: "wo_1",
  status: "connected",
  number: null,
  isDefault: true,
  defaultQueueId: 10,
  outOfHoursMessage: "",
  closingMessage: "",
  transferMessage: "",
  botTimeoutMinutes: 30,
};

const tree = [
  node({ id: 1, message: "Olá! Escolha:", title: "Início" }),
  node({ id: 2, parentId: 1, order: 1, key: "1", title: "Financeiro", action: "submenu" }),
  node({ id: 3, parentId: 1, order: 2, key: "2", title: "Encerrar", action: "close" }),
];

beforeEach(() => {
  setTestUser({ profile: "admin" });
  vi.mocked(fetchConnections).mockResolvedValue([connection]);
  vi.mocked(fetchQueues).mockResolvedValue([{ id: 10, companyId: 1, name: "Suporte", color: "#6d5dfc", schedule: {} }]);
  vi.mocked(fetchUserOptions).mockResolvedValue([{ id: 1, name: "Ana", queueIds: [10] }]);
});

function renderPage() {
  return renderWithProviders(<ChatbotPage />, { socket: new FakeSocket() });
}

describe("ChatbotPage", () => {
  it("creates the welcome message when the bot is empty", async () => {
    vi.mocked(fetchNodes).mockResolvedValue([]);
    vi.mocked(createNode).mockResolvedValue(node({ id: 1, message: "Olá! Escolha uma opção:" }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Criar mensagem de boas-vindas" }));
    await waitFor(() =>
      expect(createNode).toHaveBeenCalledWith(1, { parentId: null, message: "Olá! Escolha uma opção:" }),
    );
  });

  it("shows options in order and reorders them", async () => {
    vi.mocked(fetchNodes).mockResolvedValue(tree);
    vi.mocked(reorderChildren).mockResolvedValue([]);
    renderPage();
    const options = await screen.findAllByTestId("bot-option");
    expect(options.map((o) => within(o).getByTestId("bot-option-title").textContent)).toEqual(["Financeiro", "Encerrar"]);
    await userEvent.click(screen.getByRole("button", { name: "Mover Financeiro para baixo" }));
    await waitFor(() => expect(reorderChildren).toHaveBeenCalledWith(1, [3, 2]));
  });

  it("adds a transfer option to the main menu", async () => {
    vi.mocked(fetchNodes).mockResolvedValue(tree);
    vi.mocked(createNode).mockResolvedValue(node({ id: 4, parentId: 1, key: "3", title: "Suporte", action: "transfer_queue", queueId: 10 }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Adicionar opção em Início" }));
    const form = screen.getByRole("form", { name: "Opção do chatbot" });
    expect(within(form).getByLabelText("Número")).toHaveValue("3");
    await userEvent.type(within(form).getByLabelText("Título"), "Suporte");
    await userEvent.selectOptions(within(form).getByLabelText("Ação"), "transfer_queue");
    expect(within(form).getByRole("button", { name: "Salvar" })).toBeDisabled();
    await within(form).findByRole("option", { name: "Suporte" });
    await userEvent.selectOptions(within(form).getByLabelText("Fila"), "10");
    await userEvent.click(within(form).getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(createNode).toHaveBeenCalledWith(1, {
        parentId: 1,
        key: "3",
        title: "Suporte",
        action: "transfer_queue",
        message: "",
        mediaUrl: null,
        mediaMime: null,
        mediaName: null,
        queueId: 10,
        userId: null,
      }),
    );
  });

  it("simulates a conversation", async () => {
    vi.mocked(fetchNodes).mockResolvedValue(tree);
    vi.mocked(simulate)
      .mockResolvedValueOnce({
        effects: [{ type: "send_text", text: "Olá! Escolha:\n\n1 - Financeiro\n2 - Encerrar" }],
        state: { nodeId: 1, attempts: 0 },
        finished: false,
      })
      .mockResolvedValueOnce({
        effects: [{ type: "send_text", text: "Aguarde" }, { type: "transfer", queueId: 10, userId: null }],
        state: { nodeId: null, attempts: 0 },
        finished: true,
      });
    renderPage();
    const sim = await screen.findByRole("region", { name: "Simulador" });

    await userEvent.type(within(sim).getByLabelText("Mensagem do cliente"), "oi{Enter}");
    expect(await within(sim).findByText(/1 - Financeiro/)).toBeInTheDocument();
    expect(simulate).toHaveBeenLastCalledWith(1, { nodeId: null, attempts: 0 }, "oi");

    await userEvent.type(within(sim).getByLabelText("Mensagem do cliente"), "1{Enter}");
    expect(await within(sim).findByText("Transferido para a fila Suporte")).toBeInTheDocument();
    expect(simulate).toHaveBeenLastCalledWith(1, { nodeId: 1, attempts: 0 }, "1");
    expect(within(sim).getByLabelText("Mensagem do cliente")).toBeDisabled();

    await userEvent.click(within(sim).getByRole("button", { name: "Reiniciar" }));
    expect(within(sim).queryByText("Transferido para a fila Suporte")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/chatbot`
Expected: FAIL com `Failed to resolve import "./tree"`.

- [ ] **Step 3: Implementar**

`frontend/src/features/chatbot/chatbotApi.ts`:

```ts
import { api } from "@/lib/api";
import type { BotAction, BotState, ChatbotNode, StepResult } from "@/types/api";

export const chatbotKeys = {
  nodes: (connectionId: number) => ["chatbot", connectionId] as const,
};

export interface NodeInput {
  parentId?: number | null;
  key?: string;
  title?: string;
  action?: BotAction;
  message?: string;
  mediaUrl?: string | null;
  mediaMime?: string | null;
  mediaName?: string | null;
  queueId?: number | null;
  userId?: number | null;
}

export async function fetchNodes(connectionId: number): Promise<ChatbotNode[]> {
  const { data } = await api.get<ChatbotNode[]>(`/connections/${connectionId}/chatbot`);
  return data;
}

export async function createNode(connectionId: number, input: NodeInput): Promise<ChatbotNode> {
  const { data } = await api.post<ChatbotNode>(`/connections/${connectionId}/chatbot/nodes`, input);
  return data;
}

export async function updateNode(id: number, input: NodeInput): Promise<ChatbotNode> {
  const { data } = await api.put<ChatbotNode>(`/chatbot/nodes/${id}`, input);
  return data;
}

export async function deleteNode(id: number): Promise<void> {
  await api.delete(`/chatbot/nodes/${id}`);
}

export async function reorderChildren(parentId: number, ids: number[]): Promise<ChatbotNode[]> {
  const { data } = await api.put<ChatbotNode[]>(`/chatbot/nodes/${parentId}/children-order`, { ids });
  return data;
}

export async function simulate(connectionId: number, state: BotState, input: string | null): Promise<StepResult> {
  const { data } = await api.post<StepResult>(`/connections/${connectionId}/chatbot/simulate`, { state, input });
  return data;
}
```

`frontend/src/features/chatbot/tree.ts`:

```ts
import type { BotAction, ChatbotNode } from "@/types/api";

export interface TreeNode {
  node: ChatbotNode;
  children: TreeNode[];
}

export const ACTION_LABELS: Record<BotAction, string> = {
  submenu: "Submenu",
  reply: "Responder",
  transfer_queue: "Transferir para fila",
  transfer_agent: "Transferir para atendente",
  close: "Encerrar conversa",
};

const byOrder = (a: ChatbotNode, b: ChatbotNode) => a.order - b.order || a.id - b.id;

export function buildTree(nodes: ChatbotNode[]): TreeNode | null {
  const byParent = new Map<number | null, ChatbotNode[]>();
  for (const n of nodes) {
    const list = byParent.get(n.parentId) ?? [];
    list.push(n);
    byParent.set(n.parentId, list);
  }
  const make = (n: ChatbotNode): TreeNode => ({
    node: n,
    children: [...(byParent.get(n.id) ?? [])].sort(byOrder).map(make),
  });
  const root = byParent.get(null)?.[0];
  return root ? make(root) : null;
}

export function moveId(ids: number[], activeId: number, overId: number): number[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

export function moveByOffset(ids: number[], id: number, offset: -1 | 1): number[] {
  const index = ids.indexOf(id);
  const target = ids[index + offset];
  return index < 0 || target === undefined ? ids : moveId(ids, id, target);
}

export function nextFreeKey(siblings: ChatbotNode[]): string {
  for (let key = 1; key <= 99; key++) {
    if (!siblings.some((s) => s.key === String(key))) return String(key);
  }
  return "";
}

export function canHaveChildren(node: ChatbotNode): boolean {
  return node.parentId === null || node.action === "submenu";
}
```

`frontend/src/features/chatbot/NodeTree.tsx`:

```tsx
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ACTION_LABELS, canHaveChildren, moveByOffset, moveId, type TreeNode } from "./tree";

export interface NodeTreeHandlers {
  selectedId: number | null;
  onSelect: (id: number) => void;
  onAddChild: (parentId: number) => void;
  onDelete: (id: number, title: string) => void;
  onReorder: (parentId: number, ids: number[]) => void;
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded-md p-1 text-ink-muted hover:bg-background hover:text-ink"
    >
      {children}
    </button>
  );
}

function OptionRow({ item, siblingIds, parentId, handlers }: {
  item: TreeNode;
  siblingIds: number[];
  parentId: number;
  handlers: NodeTreeHandlers;
}) {
  const { node } = item;
  const sortable = useSortable({ id: node.id });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };
  return (
    <li ref={sortable.setNodeRef} style={style}>
      <div
        data-testid="bot-option"
        onClick={() => handlers.onSelect(node.id)}
        className={cn(
          "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-background",
          handlers.selectedId === node.id && "bg-primary-soft hover:bg-primary-soft",
        )}
      >
        <span {...sortable.attributes} {...sortable.listeners} aria-label={`Arrastar ${node.title}`} className="cursor-grab text-ink-muted">
          <GripVertical className="h-4 w-4" aria-hidden />
        </span>
        <span className="flex h-6 min-w-6 items-center justify-center rounded-md bg-primary px-1.5 text-xs font-bold text-white">
          {node.key}
        </span>
        <span data-testid="bot-option-title" className="font-medium">{node.title}</span>
        <span className="text-xs text-ink-muted">{ACTION_LABELS[node.action]}</span>
        <span className="ml-auto flex items-center">
          <IconButton label={`Mover ${node.title} para cima`} onClick={() => handlers.onReorder(parentId, moveByOffset(siblingIds, node.id, -1))}>
            <ArrowUp className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton label={`Mover ${node.title} para baixo`} onClick={() => handlers.onReorder(parentId, moveByOffset(siblingIds, node.id, 1))}>
            <ArrowDown className="h-4 w-4" aria-hidden />
          </IconButton>
          {canHaveChildren(node) && (
            <IconButton label={`Adicionar opção em ${node.title}`} onClick={() => handlers.onAddChild(node.id)}>
              <Plus className="h-4 w-4" aria-hidden />
            </IconButton>
          )}
          <IconButton label={`Excluir ${node.title}`} onClick={() => handlers.onDelete(node.id, node.title)}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </IconButton>
        </span>
      </div>
      {item.children.length > 0 && <Children parent={item} handlers={handlers} />}
    </li>
  );
}

function Children({ parent, handlers }: { parent: TreeNode; handlers: NodeTreeHandlers }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = parent.children.map((c) => c.node.id);

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) handlers.onReorder(parent.node.id, moveId(ids, Number(active.id), Number(over.id)));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="ml-5 space-y-1 border-l border-border pl-3">
          {parent.children.map((child) => (
            <OptionRow key={child.node.id} item={child} siblingIds={ids} parentId={parent.node.id} handlers={handlers} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

export function NodeTree({ tree, handlers }: { tree: TreeNode; handlers: NodeTreeHandlers }) {
  const root = tree.node;
  return (
    <div className="space-y-2">
      <div
        onClick={() => handlers.onSelect(root.id)}
        className={cn(
          "cursor-pointer rounded-lg border border-border bg-surface p-3",
          handlers.selectedId === root.id && "border-primary",
        )}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Mensagem de boas-vindas</p>
          <IconButton label={`Adicionar opção em ${root.title}`} onClick={() => handlers.onAddChild(root.id)}>
            <Plus className="h-4 w-4" aria-hidden />
          </IconButton>
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{root.message || "(sem mensagem)"}</p>
      </div>
      {tree.children.length > 0 ? (
        <Children parent={tree} handlers={handlers} />
      ) : (
        <p className="px-2 text-sm text-ink-muted">Nenhuma opção ainda. Sem opções, o cliente vai direto para a fila padrão.</p>
      )}
    </div>
  );
}
```

`frontend/src/features/chatbot/NodeForm.tsx`:

```tsx
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
import { useQueues } from "@/features/queues/queuesApi";
import { useUserOptions } from "@/features/users/usersApi";
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
```

`frontend/src/features/chatbot/Simulator.tsx`:

```tsx
import { useMutation } from "@tanstack/react-query";
import { RotateCcw, Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQueues } from "@/features/queues/queuesApi";
import { useUserOptions } from "@/features/users/usersApi";
import { errorMessage } from "@/lib/apiError";
import { cn } from "@/lib/cn";
import type { BotEffect, BotState } from "@/types/api";
import { simulate } from "./chatbotApi";

interface Entry {
  from: "customer" | "bot" | "system";
  text: string;
}

const INITIAL: BotState = { nodeId: null, attempts: 0 };

export function Simulator({ connectionId }: { connectionId: number }) {
  const queues = useQueues();
  const users = useUserOptions();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [state, setState] = useState<BotState>(INITIAL);
  const [finished, setFinished] = useState(false);
  const [input, setInput] = useState("");

  const describe = (effect: BotEffect): Entry => {
    switch (effect.type) {
      case "send_text":
        return { from: "bot", text: effect.text };
      case "send_media":
        return { from: "bot", text: `📎 ${effect.media.name ?? "arquivo"}${effect.caption ? `\n${effect.caption}` : ""}` };
      case "transfer": {
        if (effect.userId !== null) {
          const user = users.data?.find((u) => u.id === effect.userId);
          return { from: "system", text: `Transferido para o atendente ${user?.name ?? effect.userId}` };
        }
        const queue = queues.data?.find((q) => q.id === effect.queueId);
        return { from: "system", text: queue ? `Transferido para a fila ${queue.name}` : "Transferido para a fila padrão" };
      }
      case "close":
        return { from: "system", text: "Conversa encerrada" };
    }
  };

  const mutation = useMutation({
    mutationFn: (text: string) => simulate(connectionId, state, text),
    onSuccess: (result) => {
      setEntries((list) => [...list, ...result.effects.map(describe)]);
      setState(result.state);
      setFinished(result.finished);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || finished) return;
    setEntries((list) => [...list, { from: "customer", text }]);
    setInput("");
    mutation.mutate(text);
  }

  function reset() {
    setEntries([]);
    setState(INITIAL);
    setFinished(false);
  }

  return (
    <section aria-label="Simulador" className="flex h-[480px] flex-col rounded-xl border border-border bg-surface">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="font-semibold">Simulador</p>
          <p className="text-xs text-ink-muted">Teste o menu sem enviar nada pelo WhatsApp.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={reset}>
          <RotateCcw className="h-4 w-4" aria-hidden /> Reiniciar
        </Button>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto bg-background p-4">
        {entries.length === 0 && <p className="text-center text-sm text-ink-muted">Envie qualquer mensagem para começar.</p>}
        {entries.map((entry, index) =>
          entry.from === "system" ? (
            <p key={index} className="text-center text-xs font-medium text-ink-muted">
              {entry.text}
            </p>
          ) : (
            <div key={index} className={cn("flex", entry.from === "customer" ? "justify-start" : "justify-end")}>
              <p
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm",
                  entry.from === "customer" ? "border border-border bg-surface" : "bg-primary text-white",
                )}
              >
                {entry.text}
              </p>
            </div>
          ),
        )}
      </div>
      <form onSubmit={onSubmit} className="flex gap-2 border-t border-border p-3">
        <Input
          aria-label="Mensagem do cliente"
          placeholder={finished ? "Conversa finalizada — reinicie para testar de novo" : "Digite como se fosse o cliente"}
          value={input}
          disabled={finished}
          onChange={(e) => setInput(e.target.value)}
        />
        <Button type="submit" size="icon" aria-label="Enviar" disabled={finished || !input.trim()} loading={mutation.isPending}>
          <Send className="h-4 w-4" aria-hidden />
        </Button>
      </form>
    </section>
  );
}
```

`frontend/src/features/chatbot/ChatbotPage.tsx`:

```tsx
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
import { useConnections } from "@/features/connections/connectionsApi";
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
        {connections.isLoading || nodes.isLoading ? (
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
```

Em `frontend/src/app/routes.tsx`:

```tsx
import { ChatbotPage } from "@/features/chatbot/ChatbotPage";
// ...
        <Route
          path="chatbot"
          element={
            <RequireProfile profiles={["admin"]}>
              <ChatbotPage />
            </RequireProfile>
          }
        />
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat(frontend): editor do chatbot com árvore reordenável e simulador"
```

---

### Task 14: Configurações da empresa e deploy com Nginx

**Files:**
- Create: `frontend/src/features/settings/{companyApi.ts,SettingsPage.tsx}`
- Create: `frontend/Dockerfile`, `frontend/nginx.conf`, `frontend/.dockerignore`
- Modify: `frontend/src/app/routes.tsx` (rota `/configuracoes`, só admin), `docker-compose.yml` (serviço `frontend`), `.env.example` (`FRONTEND_URL`), `docs/smoke-test.md` (seção do frontend)
- Test: `frontend/src/features/settings/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: `api`, `PageHeader`, `RequireProfile`, UI.
- Produces:
  - `fetchCompany(): Promise<Company>`, `updateCompany({ name?, timezone? }): Promise<Company>`, `TIMEZONES` (lista de fusos do Brasil).
  - `SettingsPage` em `/configuracoes`: campos "Nome da empresa" e "Fuso horário", botão "Salvar".
  - Imagem Docker do frontend (Nginx) servindo o build e fazendo proxy de `/api/`, `/media/` e `/socket.io/` para `backend:4000`; publicada em `http://localhost:3000`.

- [ ] **Step 1: Escrever o teste que falha**

`frontend/src/features/settings/SettingsPage.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { renderWithProviders, setTestUser } from "@/test/utils";
import { fetchCompany, updateCompany } from "./companyApi";
import { SettingsPage } from "./SettingsPage";

vi.mock("./companyApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./companyApi")>()),
  fetchCompany: vi.fn(),
  updateCompany: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("SettingsPage", () => {
  it("loads and saves the company name and time zone", async () => {
    setTestUser({ profile: "admin" });
    vi.mocked(fetchCompany).mockResolvedValue({ id: 1, name: "Loja X", status: "active", timezone: "America/Sao_Paulo" });
    vi.mocked(updateCompany).mockResolvedValue({ id: 1, name: "Loja Y", status: "active", timezone: "America/Manaus" });
    renderWithProviders(<SettingsPage />);

    const name = await screen.findByLabelText("Nome da empresa");
    expect(name).toHaveValue("Loja X");
    await userEvent.clear(name);
    await userEvent.type(name, "Loja Y");
    await userEvent.selectOptions(screen.getByLabelText("Fuso horário"), "America/Manaus");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(updateCompany).toHaveBeenCalledWith({ name: "Loja Y", timezone: "America/Manaus" }));
    expect(toast.success).toHaveBeenCalledWith("Configurações salvas");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/settings`
Expected: FAIL com `Failed to resolve import "./companyApi"`.

- [ ] **Step 3: Implementar a página**

`frontend/src/features/settings/companyApi.ts`:

```ts
import { api } from "@/lib/api";
import type { Company } from "@/types/api";

export const companyKeys = { current: ["company"] as const };

export const TIMEZONES: { value: string; label: string }[] = [
  { value: "America/Sao_Paulo", label: "Brasília (São Paulo, Rio, Sul, MG, GO, DF)" },
  { value: "America/Bahia", label: "Bahia" },
  { value: "America/Fortaleza", label: "Fortaleza (CE, RN, PB, PI, MA)" },
  { value: "America/Recife", label: "Recife (PE)" },
  { value: "America/Maceio", label: "Maceió (AL, SE)" },
  { value: "America/Belem", label: "Belém (PA, AP)" },
  { value: "America/Araguaina", label: "Araguaína (TO)" },
  { value: "America/Cuiaba", label: "Cuiabá (MT)" },
  { value: "America/Campo_Grande", label: "Campo Grande (MS)" },
  { value: "America/Manaus", label: "Manaus (AM)" },
  { value: "America/Porto_Velho", label: "Porto Velho (RO)" },
  { value: "America/Boa_Vista", label: "Boa Vista (RR)" },
  { value: "America/Rio_Branco", label: "Rio Branco (AC)" },
  { value: "America/Noronha", label: "Fernando de Noronha" },
];

export async function fetchCompany(): Promise<Company> {
  const { data } = await api.get<Company>("/company");
  return data;
}

export async function updateCompany(input: { name?: string; timezone?: string }): Promise<Company> {
  const { data } = await api.put<Company>("/company", input);
  return data;
}
```

`frontend/src/features/settings/SettingsPage.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/apiError";
import { companyKeys, fetchCompany, TIMEZONES, updateCompany } from "./companyApi";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const company = useQuery({ queryKey: companyKeys.current, queryFn: fetchCompany });
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");

  useEffect(() => {
    if (company.data) {
      setName(company.data.name);
      setTimezone(company.data.timezone);
    }
  }, [company.data]);

  const mutation = useMutation({
    mutationFn: () => updateCompany({ name: name.trim(), timezone }),
    onSuccess: (saved) => {
      queryClient.setQueryData(companyKeys.current, saved);
      toast.success("Configurações salvas");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const zones = TIMEZONES.some((z) => z.value === timezone) ? TIMEZONES : [{ value: timezone, label: timezone }, ...TIMEZONES];

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader title="Configurações" description="Dados gerais da empresa. As mensagens automáticas ficam em Conexões." />
      <div className="max-w-xl p-6">
        <Card>
          {company.isLoading ? (
            <Spinner />
          ) : company.isError ? (
            <p className="text-sm text-danger">{errorMessage(company.error)}</p>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                mutation.mutate();
              }}
            >
              <div>
                <Label htmlFor="company-name">Nome da empresa</Label>
                <Input id="company-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="company-tz">Fuso horário</Label>
                <Select id="company-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  {zones.map((z) => (
                    <option key={z.value} value={z.value}>
                      {z.label}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-ink-muted">Usado para calcular o horário de expediente das filas.</p>
              </div>
              <div className="flex justify-end">
                <Button type="submit" loading={mutation.isPending} disabled={!name.trim()}>
                  Salvar
                </Button>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
```

Em `frontend/src/app/routes.tsx`:

```tsx
import { SettingsPage } from "@/features/settings/SettingsPage";
// ...
        <Route
          path="configuracoes"
          element={
            <RequireProfile profiles={["admin"]}>
              <SettingsPage />
            </RequireProfile>
          }
        />
```

- [ ] **Step 4: Rodar testes, typecheck e build**

Run: `npm test && npm run typecheck && npm run build`
Expected: todos os testes PASS; `dist/` gerado sem erros.

- [ ] **Step 5: Docker do frontend**

`frontend/.dockerignore`:

```
node_modules
dist
coverage
```

`frontend/nginx.conf`:

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  client_max_body_size 20m;

  location /api/ {
    proxy_pass http://backend:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location /media/ {
    proxy_pass http://backend:4000;
  }

  location /socket.io/ {
    proxy_pass http://backend:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
  }

  location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
    try_files $uri =404;
  }

  location / {
    try_files $uri /index.html;
  }
}
```

`frontend/Dockerfile`:

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

Em `docker-compose.yml`, acrescente o serviço (antes de `volumes:`):

```yaml
  frontend:
    build: ./frontend
    restart: unless-stopped
    ports:
      - "3000:80"
    depends_on:
      - backend
```

Em `.env.example` (raiz), troque a linha `FRONTEND_URL=http://localhost:5173` por:

```env
FRONTEND_URL=http://localhost:3000
```

Acrescente ao final de `docs/smoke-test.md`:

```markdown
## Frontend

Pré-requisito: `docker compose up -d --build` (inclui o serviço `frontend` em http://localhost:3000).
Para desenvolvimento com recarga automática: `cd frontend && npm run dev` (http://localhost:5173, com proxy para o backend em :4000).

1. Abra http://localhost:3000, entre com o admin. A barra lateral mostra Atendimento, Contatos, Filas, Usuários, Conexões, Chatbot e Configurações.
2. **Conexões**: crie uma conexão, leia o QR code. O diálogo fecha sozinho com "WhatsApp conectado".
3. **Chatbot**: crie a mensagem de boas-vindas, adicione "1 - Suporte" (Transferir para fila) e teste no simulador.
4. **Atendimento**: envie "oi" de outro celular. Como admin, a aba "No bot" mostra o ticket; responda "1" pelo celular e o ticket aparece em "Aguardando" sem recarregar a página.
5. Aceite, envie texto e um anexo; confira as marcas de enviada/entregue/lida mudando sozinhas.
6. Derrube a rede do navegador por alguns segundos (DevTools → Offline) e mande uma mensagem: ela aparece como "Não enviada"; volte a rede e use "Tentar novamente".
7. Desconecte o aparelho pelo celular: aparece o aviso "A conexão ... caiu".
```

- [ ] **Step 6: Subir e verificar**

Run (na raiz): `docker compose up -d --build frontend`
Expected: container `frontend` em execução.

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/`
Expected: `200`.

Run: `curl -s http://localhost:3000/api/auth/me`
Expected: `{"error":{"code":"UNAUTHENTICATED","message":"Token ausente"}}` (prova que o proxy para o backend funciona).

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/atendimento`
Expected: `200` (fallback do SPA).

Observação: o `.env` local da raiz pode ainda ter `FRONTEND_URL=http://localhost:5173`; com o Nginx servindo tudo na mesma origem isso não afeta o uso, mas atualize para `http://localhost:3000` para manter o CORS do backend coerente.

- [ ] **Step 7: Commit**

```bash
git add frontend docker-compose.yml .env.example docs/smoke-test.md
git commit -m "feat(frontend): configurações da empresa e deploy com Nginx no compose"
```

---

## Depois deste plano

Com o Plano B executado, o subprojeto 1 (núcleo) está completo. Próximos passos sugeridos:
1. Rodar `docs/smoke-test.md` inteiro com um WhatsApp real (backend + frontend).
2. Abrir o brainstorming do subprojeto 2 (Produtividade: respostas rápidas, tags/kanban, agendamentos, notas, avaliação).
