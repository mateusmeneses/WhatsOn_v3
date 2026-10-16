import {
  BookUser,
  Bot,
  Braces,
  Layers,
  LogOut,
  MessagesSquare,
  Settings,
  Smartphone,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import logoMark from "@/assets/brand/logo-mark.webp";
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
  { to: "/integracao-api", label: "Integração API", icon: Braces, profiles: ["admin"] },
  { to: "/configuracoes", label: "Configurações", icon: Settings, profiles: ["admin"] },
];

export function navItemsFor(profile: Profile): NavItem[] {
  return NAV_ITEMS.filter((item) => item.profiles.includes(profile));
}

export function Sidebar() {
  const user = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clear);
  const navigate = useNavigate();
  if (!user) return null;

  async function onLogout() {
    await logout();
    clear(); // useSessionReset (App) limpa o cache ao trocar de usuário
    navigate("/login", { replace: true });
  }

  return (
    <nav aria-label="Navegação principal" className="flex w-16 shrink-0 flex-col items-center gap-2 bg-sidebar py-4">
      <img src={logoMark} alt="WhatsOn" width={40} height={40} className="mb-4 h-10 w-10 drop-shadow" />
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
