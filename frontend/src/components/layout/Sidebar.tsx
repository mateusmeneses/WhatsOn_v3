import {
  BookUser,
  Building2,
  Bot,
  Braces,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  Layers,
  LogOut,
  MessagesSquare,
  Settings,
  Smartphone,
  UserCog,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import logoMark from "@/assets/brand/logo-mark.webp";
import { logout } from "@/features/auth/authApi";
import { useTicketSummary } from "@/features/tickets/useTickets";
import { ChangelogButton } from "@/features/version/ChangelogButton";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";
import { useAuth } from "@/stores/auth";
import type { Profile } from "@/types/api";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  profiles: Profile[];
  group: "operacao" | "gestao" | "sistema";
}

const ALL: Profile[] = ["admin", "supervisor", "agent"];

export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, profiles: ["admin", "supervisor"], group: "operacao" },
  { to: "/atendimento", label: "Atendimento", icon: MessagesSquare, profiles: ALL, group: "operacao" },
  { to: "/contatos", label: "Contatos", icon: BookUser, profiles: ALL, group: "operacao" },
  { to: "/meu-desempenho", label: "Meu desempenho", icon: UserRound, profiles: ALL, group: "operacao" },
  { to: "/filas", label: "Filas", icon: Layers, profiles: ["admin"], group: "gestao" },
  { to: "/usuarios", label: "Usuários", icon: UserCog, profiles: ["admin", "supervisor"], group: "gestao" },
  { to: "/conexoes", label: "Conexões", icon: Smartphone, profiles: ["admin"], group: "gestao" },
  { to: "/chatbot", label: "Chatbot", icon: Bot, profiles: ["admin"], group: "gestao" },
  { to: "/integracao-api", label: "Integração API", icon: Braces, profiles: ["admin"], group: "sistema" },
  { to: "/configuracoes", label: "Configurações", icon: Settings, profiles: ["admin"], group: "sistema" },
];

const GROUP_LABEL: Record<NavItem["group"], string> = { operacao: "Operação", gestao: "Gestão", sistema: "Sistema" };

/** Só para o super-admin: volta ao painel da plataforma. */
const PLATFORM_ITEM: NavItem = { to: "/empresas", label: "Empresas", icon: Building2, profiles: [], group: "sistema" };

const PROFILE_LABEL: Record<Profile, string> = {
  admin: "Administrador",
  supervisor: "Supervisor",
  agent: "Atendente",
  superadmin: "Super-admin",
};

const COLLAPSED_KEY = "whatson.sidebarCollapsed";

/** Sem preferência salva, telas estreitas (tablet) começam com o menu recolhido para sobrar espaço ao conteúdo. */
function readCollapsed(): boolean {
  try {
    const saved = localStorage.getItem(COLLAPSED_KEY);
    if (saved !== null) return saved === "1";
  } catch {
    // sem armazenamento: usa o padrão pela largura
  }
  return typeof window !== "undefined" && window.innerWidth < 1280;
}

export function navItemsFor(profile: Profile): NavItem[] {
  return NAV_ITEMS.filter((item) => item.profiles.includes(profile));
}

export function Sidebar() {
  const user = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clear);
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const summary = useTicketSummary();
  if (!user) return null;

  async function onLogout() {
    await logout();
    clear(); // useSessionReset (App) limpa o cache ao trocar de usuário
    navigate("/login", { replace: true });
  }

  function toggle() {
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, value ? "0" : "1");
      } catch {
        // preferência não persistida
      }
      return !value;
    });
  }

  const items = [...navItemsFor(user.profile), ...(user.superAdmin ? [PLATFORM_ITEM] : [])];
  const groups = (Object.keys(GROUP_LABEL) as NavItem["group"][])
    .map((group) => ({ group, items: items.filter((i) => i.group === group) }))
    .filter((g) => g.items.length > 0);

  return (
    <nav
      aria-label="Navegação principal"
      className={cn(
        "flex shrink-0 flex-col bg-sidebar py-4 transition-[width] duration-200 ease-out",
        collapsed ? "w-[68px] items-center px-2" : "w-[232px] px-3",
      )}
    >
      <div className={cn("mb-5 flex items-center", collapsed ? "justify-center" : "gap-2.5 px-1")}>
        <img src={logoMark} alt="WhatsOn" width={40} height={40} className="h-10 w-10 shrink-0 drop-shadow" />
        {!collapsed && (
          <span className="min-w-0 leading-tight">
            <span className="block text-[17px] font-bold tracking-tight text-white">
              Whats<span className="text-[#2fd16a]">On</span>
            </span>
            <span className="block truncate text-[10.5px] text-white/50">Gerenciador de Atendimento</span>
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden">
        {groups.map(({ group, items: groupItems }) => (
          <div key={group} className={cn("space-y-1", collapsed && "flex flex-col items-center")}>
            {!collapsed ? (
              <p className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-white/35">{GROUP_LABEL[group]}</p>
            ) : (
              group !== groups[0]!.group && <span className="mb-1 block h-px w-6 bg-white/10" aria-hidden />
            )}
            {groupItems.map(({ to, label, icon: Icon }) => {
              // Atendimento mostra quantos estão esperando por este usuário (aguardando + dele em andamento).
              const waiting = to === "/atendimento" && summary ? summary.pending : 0;
              const hint = waiting > 0 ? `${label}, ${waiting} aguardando` : label;
              return (
              <NavLink
                key={to}
                to={to}
                title={hint}
                aria-label={hint}
                className={({ isActive }) =>
                  cn(
                    "group relative flex items-center rounded-lg text-sm font-medium text-white/65 transition hover:bg-white/10 hover:text-white",
                    collapsed ? "h-10 w-10 justify-center" : "h-10 gap-3 px-3",
                    isActive && "bg-primary text-white shadow-lift hover:bg-primary",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && !collapsed && <span aria-hidden className="absolute -left-3 h-5 w-1 rounded-r-full bg-[#2fd16a]" />}
                    <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                    {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
                    {waiting > 0 && (
                      <span
                        aria-hidden
                        className={cn(
                          "grid place-items-center rounded-full bg-warning font-bold tabular-nums text-white",
                          collapsed ? "absolute -right-1 -top-1 h-4 min-w-4 px-1 text-[10px]" : "h-5 min-w-5 px-1.5 text-[11px]",
                        )}
                      >
                        {waiting > 99 ? "99+" : waiting}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
              );
            })}
          </div>
        ))}
      </div>

      <div className={cn("mt-3 space-y-2 border-t border-white/10 pt-3", collapsed && "flex flex-col items-center")}>
        <div className={cn("flex items-center", collapsed ? "flex-col gap-2" : "justify-between px-1")}>
          <ChangelogButton />
          <button
            type="button"
            onClick={toggle}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            aria-pressed={collapsed}
            className="rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" aria-hidden /> : <ChevronsLeft className="h-4 w-4" aria-hidden />}
          </button>
        </div>
        <div className={cn("flex items-center rounded-xl bg-white/5", collapsed ? "flex-col gap-1 p-1.5" : "gap-2.5 p-2")}>
          <span
            title={user.name}
            className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/90 text-xs font-semibold text-white"
          >
            {initials(user.name)}
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-[#2fd16a] ring-2 ring-sidebar" aria-hidden />
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13px] font-semibold text-white">{user.name}</span>
              <span className="block truncate text-[11px] text-white/50">{PROFILE_LABEL[user.profile]}</span>
            </span>
          )}
          <button
            type="button"
            onClick={onLogout}
            title="Sair"
            aria-label="Sair"
            className="rounded-lg p-2 text-white/55 transition hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>
      </div>
    </nav>
  );
}
