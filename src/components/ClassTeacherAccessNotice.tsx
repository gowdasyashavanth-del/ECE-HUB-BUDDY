import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

// Shows a one-time dismissible notice on the Teacher dashboard after
// ClassTeacherRoute redirected someone away from a Class Teacher-only
// page. The flag travels in router location state; it is cleared right
// away so a refresh or back/forward doesn't show the notice again.
export function ClassTeacherAccessNotice() {
  const location = useLocation();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const state = location.state as { classTeacherRequired?: boolean } | null;
    if (state?.classTeacherRequired) {
      setVisible(true);
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [location, navigate]);

  if (!visible) return null;

  return (
    <div
      role="status"
      className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-copper/40 bg-copper-light/30 px-4 py-3 font-body"
    >
      <p className="text-sm text-ink">
        <span className="font-semibold">Class Teacher access required.</span> CR1 / CR2 and Lab Batches are only
        available to teachers with a current Class Teacher assignment.
      </p>
      <button
        type="button"
        onClick={() => setVisible(false)}
        className="shrink-0 text-sm font-medium text-ink underline underline-offset-2 hover:no-underline"
      >
        Dismiss
      </button>
    </div>
  );
}
