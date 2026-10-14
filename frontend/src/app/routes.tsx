import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { ProtectedRoute, RequireProfile } from "@/components/layout/ProtectedRoute";
import { LoginPage } from "@/features/auth/LoginPage";
import { ConnectionsPage } from "@/features/connections/ConnectionsPage";
import { ContactsPage } from "@/features/contacts/ContactsPage";
import { QueuesPage } from "@/features/queues/QueuesPage";
import { TicketsPage } from "@/features/tickets/TicketsPage";
import { UsersPage } from "@/features/users/UsersPage";

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
        <Route path="contatos" element={<ContactsPage />} />
        <Route
          path="filas"
          element={
            <RequireProfile profiles={["admin"]}>
              <QueuesPage />
            </RequireProfile>
          }
        />
        <Route
          path="conexoes"
          element={
            <RequireProfile profiles={["admin"]}>
              <ConnectionsPage />
            </RequireProfile>
          }
        />
        <Route
          path="usuarios"
          element={
            <RequireProfile profiles={["admin", "supervisor"]}>
              <UsersPage />
            </RequireProfile>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/atendimento" replace />} />
    </Routes>
  );
}
