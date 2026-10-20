import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { ProtectedRoute, RequireProfile } from "@/components/layout/ProtectedRoute";
import { ApiDocsPage } from "@/features/apiDocs/ApiDocsPage";
import { ChangePasswordPage } from "@/features/auth/ChangePasswordPage";
import { LoginPage } from "@/features/auth/LoginPage";
import { AdminShell } from "@/features/admin/AdminShell";
import { CompaniesPage } from "@/features/admin/CompaniesPage";
import { PartnersPage } from "@/features/admin/PartnersPage";
import { ChatbotPage } from "@/features/chatbot/ChatbotPage";
import { ConnectionsPage } from "@/features/connections/ConnectionsPage";
import { ContactsPage } from "@/features/contacts/ContactsPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { QueuesPage } from "@/features/queues/QueuesPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { TicketsPage } from "@/features/tickets/TicketsPage";
import { UsersPage } from "@/features/users/UsersPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/trocar-senha" element={<ChangePasswordPage />} />
      <Route
        element={
          <ProtectedRoute platform>
            <AdminShell />
          </ProtectedRoute>
        }
      >
        <Route path="empresas" element={<CompaniesPage />} />
        <Route path="parceiros" element={<PartnersPage />} />
      </Route>
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/atendimento" replace />} />
        <Route
          path="dashboard"
          element={
            <RequireProfile profiles={["admin", "supervisor"]}>
              <DashboardPage />
            </RequireProfile>
          }
        />
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
          path="chatbot"
          element={
            <RequireProfile profiles={["admin"]}>
              <ChatbotPage />
            </RequireProfile>
          }
        />
        <Route
          path="integracao-api"
          element={
            <RequireProfile profiles={["admin"]}>
              <ApiDocsPage />
            </RequireProfile>
          }
        />
        <Route
          path="configuracoes"
          element={
            <RequireProfile profiles={["admin"]}>
              <SettingsPage />
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
