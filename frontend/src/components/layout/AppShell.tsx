import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { CompanyBanner } from "@/features/admin/CompanyBanner";
import { ConnectionAlerts } from "@/features/connections/ConnectionAlerts";
import { IdleAlerts } from "@/features/tickets/IdleAlerts";
import { TicketRealtime, useTicketSummary } from "@/features/tickets/useTickets";
import { VersionBadge } from "@/features/version/VersionBadge";
import { RealtimeProvider, useRealtimeReconnecting } from "@/realtime/RealtimeProvider";
import { CommandPalette } from "./CommandPalette";
import { NotificationSound } from "./NotificationSound";
import { NAV_ITEMS, Sidebar } from "./Sidebar";

/** Título da aba do navegador acompanha a tela atual ("Dashboard · WhatsOn"). */
function usePageTitle() {
  const { pathname } = useLocation();
  const unread = useTicketSummary()?.unread ?? 0;
  useEffect(() => {
    const item = NAV_ITEMS.find((i) => pathname === i.to || pathname.startsWith(`${i.to}/`));
    const base = item ? `${item.label} · WhatsOn` : "WhatsOn";
    document.title = unread > 0 ? `(${unread > 99 ? "99+" : unread}) ${base}` : base;
  }, [pathname, unread]);
}

export function AppShell() {
  usePageTitle();
  return (
    <RealtimeProvider>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary focus:shadow-pop"
      >
        Ir para o conteúdo
      </a>
      <ConnectionAlerts />
      <ReconnectingBanner />
      <TicketRealtime />
      <CommandPalette />
      <NotificationSound />
      <IdleAlerts />
      <div className="flex h-full min-w-[768px] flex-col">
        <CompanyBanner />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main id="conteudo" tabIndex={-1} className="min-w-0 flex-1 overflow-hidden focus:outline-none">
            <Outlet />
          </main>
        </div>
      </div>
      <VersionBadge />
    </RealtimeProvider>
  );
}

function ReconnectingBanner() {
  const reconnecting = useRealtimeReconnecting();
  if (!reconnecting) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 bg-warning px-4 py-1 text-center text-xs font-medium text-white shadow"
    >
      Reconectando ao servidor…
    </div>
  );
}
