import { LogOut } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import logoMark from "@/assets/brand/logo-mark.webp";
import { logout } from "@/features/auth/authApi";
import { initials } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useAuth } from "@/stores/auth";

/** Layout do painel da plataforma (super-admin). */
export function AdminShell() {
  const user = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clear);
  const navigate = useNavigate();
  if (!user) return null;

  async function onLogout() {
    await logout();
    clear();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 bg-sidebar px-4 py-2 text-white">
        <img src={logoMark} alt="WhatsOn" width={32} height={32} className="h-8 w-8" />
        <span className="hidden truncate text-sm font-semibold sm:inline">Painel da plataforma</span>
        <nav aria-label="Painel da plataforma" className="flex min-w-0 gap-1">
          {[
            { to: "/empresas", label: "Empresas" },
            { to: "/parceiros", label: "Parceiros" },
          ].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn("rounded-lg px-3 py-1.5 text-sm", isActive ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10 hover:text-white")
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-sm text-white/80" title={user.name}>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white">
            {initials(user.name)}
          </span>
          <span className="hidden sm:inline">{user.name}</span>
        </span>
        <button
          type="button"
          onClick={onLogout}
          title="Sair"
          aria-label="Sair"
          className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white"
        >
          <LogOut className="h-5 w-5" aria-hidden />
        </button>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
