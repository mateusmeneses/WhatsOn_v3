import { Outlet } from "react-router-dom";
import { CompanyBanner } from "@/features/admin/CompanyBanner";
import { ConnectionAlerts } from "@/features/connections/ConnectionAlerts";
import { TicketRealtime } from "@/features/tickets/useTickets";
import { RealtimeProvider, useRealtimeReconnecting } from "@/realtime/RealtimeProvider";
import { Sidebar } from "./Sidebar";

export function AppShell() {
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
