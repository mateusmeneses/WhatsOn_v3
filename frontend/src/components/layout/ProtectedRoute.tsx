import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/stores/auth";
import type { Profile } from "@/types/api";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user);
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword) return <Navigate to="/trocar-senha" replace />;
  return <>{children}</>;
}

export function RequireProfile({ profiles, children }: { profiles: Profile[]; children: ReactNode }) {
  const user = useAuth((s) => s.user);
  if (!user || !profiles.includes(user.profile)) return <Navigate to="/atendimento" replace />;
  return <>{children}</>;
}
