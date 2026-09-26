import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import type { UserRole } from "../lib/types";
import { AppShell } from "./layout/AppShell";
import { LoadingState } from "./ui/LoadingState";
import { ErrorState } from "./ui/ErrorState";

// This is a UX-layer guard only, same principle the approved
// architecture already established for Bioverse/ECE Hub Buddy: it
// determines what a signed-in user SEES, not what they can actually
// read or write. The real enforcement is the RLS policies in the
// approved migrations — a student's JWT genuinely cannot read
// teacher/admin-only rows no matter what this component does.
export function dashboardPathForRole(role: UserRole): string {
  if (role === "super_admin") return "/admin";
  if (role === "teacher") return "/teacher";
  return "/student";
}

export function ProtectedRoute({
  allowedRoles,
  children,
}: {
  allowedRoles: UserRole[];
  children: ReactNode;
}) {
  const { session, profile, profileError, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <LoadingState label="Checking your session…" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (profileError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-4">
        <div className="w-full max-w-sm">
          <ErrorState title="Couldn't load your profile" message={profileError} />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <LoadingState label="Loading your profile…" />
      </div>
    );
  }

  if (!allowedRoles.includes(profile.role)) {
    return <Navigate to={dashboardPathForRole(profile.role)} replace />;
  }

  return <AppShell>{children}</AppShell>;
}
