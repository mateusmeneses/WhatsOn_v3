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
