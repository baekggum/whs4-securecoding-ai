import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// UI-level gate only — purely to avoid flashing the admin page at a logged
// -in non-admin before redirecting. The real security boundary is the
// server's requireAdmin middleware (backend/src/middleware/admin.ts), which
// re-checks role on every request; this component must never be treated as
// the enforcement point (docs/architecture.md §9.2).
export function AdminRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (user.role !== "admin") return <Navigate to="/" replace />;

  return <>{children}</>;
}
