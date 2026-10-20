import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { CompanyBanner } from "@/features/admin/CompanyBanner";
import { ConnectionAlerts } from "@/features/connections/ConnectionAlerts";
import { TicketRealtime, useTicketSummary } from "@/features/tickets/useTickets";
import { VersionBadge } from "@/features/version/VersionBadge";
import { RealtimeProvider, useRealtimeReconnecting } from "@/realtime/RealtimeProvider";
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
      <ConnectionAlerts />
      <ReconnectingBanner />
      <TicketRealtime />
      <div className="flex h-full min-w-[768px] flex-col">
        <CompanyBanner />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="min-w-0 flex-1 overflow-hidden">
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
