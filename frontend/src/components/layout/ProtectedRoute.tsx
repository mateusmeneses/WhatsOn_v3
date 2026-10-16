import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/stores/auth";
import type { Profile } from "@/types/api";

/** Exige sessão; sem `platform`, exige também uma empresa (o super-admin fora dela vai para /empresas). */
export function ProtectedRoute({ children, platform = false }: { children: ReactNode; platform?: boolean }) {
  const user = useAuth((s) => s.user);
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword) return <Navigate to="/trocar-senha" replace />;
  if (platform && !user.superAdmin) return <Navigate to="/atendimento" replace />;
  if (!platform && user.companyId === null) return <Navigate to="/empresas" replace />;
  return <>{children}</>;
}

export function RequireProfile({ profiles, children }: { profiles: Profile[]; children: ReactNode }) {
  const user = useAuth((s) => s.user);
  if (!user || !profiles.includes(user.profile)) return <Navigate to="/atendimento" replace />;
  return <>{children}</>;
}
