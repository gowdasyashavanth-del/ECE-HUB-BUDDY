import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useClassTeacher } from "../contexts/ClassTeacherContext";
import { LoadingState } from "./ui/LoadingState";
import { ErrorState } from "./ui/ErrorState";

// Extra route guard for pages that only make sense for a current Class
// Teacher (/teacher/cr, /teacher/lab-batches). Always nest it INSIDE
// <ProtectedRoute allowedRoles={["teacher"]}>, which already handles
// session / profile / role.
//
// Fails closed: children render ONLY after a successful lookup that found
// at least one current assignment. Loading, idle and error all withhold
// the page. UX layer only — RLS and the RPC checks remain the real
// security boundary.
export function ClassTeacherRoute({ children }: { children: ReactNode }) {
  const { status, isClassTeacher, error, retry } = useClassTeacher();

  if (status === "error") {
    return (
      <ErrorState
        title="Couldn't verify Class Teacher access"
        message={error ?? "We couldn't check your Class Teacher assignment. Access is withheld until it can be verified."}
        onRetry={retry}
      />
    );
  }

  if (status !== "ready") {
    return <LoadingState label="Checking your Class Teacher access…" />;
  }

  if (!isClassTeacher) {
    return <Navigate to="/teacher" replace state={{ classTeacherRequired: true }} />;
  }

  return <>{children}</>;
}
