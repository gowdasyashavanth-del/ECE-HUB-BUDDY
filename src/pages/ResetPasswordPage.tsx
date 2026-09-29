import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";
import { PasswordField } from "../components/account/PasswordField";
import {
  completePasswordRecovery,
  validateNewPassword,
  MIN_PASSWORD_LENGTH,
  type FieldErrors,
} from "../lib/passwordChange";
import { Logo } from "../components/branding/Logo";

// This route is deliberately NOT wrapped in ProtectedRoute and does not
// use useAuth()/AuthContext's `session` at all. A recovery link must be
// usable by someone who isn't otherwise "logged in" in this browser, and
// — the actual bug this page exists to fix — an ORDINARY existing
// session must never be mistaken for a recovery one. So this page makes
// its own independent decision, from the URL alone, on every load:
// "did *this specific page load* arrive via a genuine, freshly-clicked
// recovery link?" Only "yes" ever shows the reset form.
//
// The Supabase client has `detectSessionInUrl: false` project-wide (see
// supabaseClient.ts) so links are never auto-parsed on other pages; this
// is the one place that deliberately does the equivalent work by hand,
// scoped to a route whose only job is finishing a recovery.
type Status = "checking" | "ready" | "invalid";

function extractRecoveryParams(): { code: string | null; accessToken: string | null; refreshToken: string | null } {
  const search = new URLSearchParams(window.location.search);
  // Supabase's default (PKCE) recovery link shape: ?code=...&type=recovery
  const code = search.get("code");

  // Legacy/implicit-flow shape, if a project has that flow type enabled:
  // #access_token=...&refresh_token=...&type=recovery
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");

  return { code, accessToken, refreshToken };
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("checking");
  const [invalidReason, setInvalidReason] = useState<string | null>(null);

  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function establishRecoverySession() {
      if (!isSupabaseConfigured || !supabase) {
        setInvalidReason("This app isn't connected to Supabase yet.");
        setStatus("invalid");
        return;
      }

      const { code, accessToken, refreshToken } = extractRecoveryParams();

      // Nothing recovery-shaped in the URL at all — e.g. someone
      // bookmarked this page, or reloaded it after the tokens were
      // already consumed. This is NOT "check if(session)": an unrelated
      // ordinary login elsewhere in this browser does not get in here.
      if (!code && !(accessToken && refreshToken)) {
        setInvalidReason(
          "This password reset link is invalid or has expired. Please request a new password reset link."
        );
        setStatus("invalid");
        return;
      }

      const { error } = code
        ? await supabase.auth.exchangeCodeForSession(code)
        : await supabase.auth.setSession({ access_token: accessToken as string, refresh_token: refreshToken as string });

      // Strip the recovery params from the URL/history immediately,
      // whether it worked or not — they're single-use and must not
      // linger in the address bar, browser history, or be re-shareable.
      window.history.replaceState(null, "", window.location.pathname);

      if (cancelled) return;

      if (error) {
        setInvalidReason(
          "This password reset link is invalid or has expired. Please request a new password reset link."
        );
        setStatus("invalid");
        return;
      }

      setStatus("ready");
    }

    void establishRecoverySession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase || submitting) return;
    setFormError(null);

    const fieldErrors = validateNewPassword(next, confirm);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setSubmitting(true);
    const result = await completePasswordRecovery(supabase, next);
    setSubmitting(false);

    if (!result.ok) {
      if (result.field) setErrors({ [result.field]: result.message });
      else setFormError(result.message);
      return;
    }

    setNext("");
    setConfirm("");
    setSuccess(true);
    // A brief pause so the success message is actually readable before
    // the user lands back on a normal, unauthenticated login screen.
    window.setTimeout(() => navigate("/login", { replace: true }), 2000);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-sm rounded-lg border border-line bg-panel p-6 shadow-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>

        {status === "checking" && (
          <p className="text-center text-sm text-inkmuted">Verifying your reset link…</p>
        )}

        {status === "invalid" && (
          <div className="text-center">
            <p className="mb-4 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
              {invalidReason}
            </p>
            <Link
              to="/login"
              className="inline-block rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark"
            >
              Back to login
            </Link>
          </div>
        )}

        {status === "ready" && !success && (
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
              <h1 className="font-display text-lg font-semibold text-ink">Reset Password</h1>
              <p className="mt-1 text-xs text-inkmuted">Choose a new password for your account.</p>
            </div>

            <PasswordField
              id="new-password"
              label="New Password"
              value={next}
              onChange={setNext}
              autoComplete="new-password"
              error={errors.next}
              hint={`At least ${MIN_PASSWORD_LENGTH} characters, with a letter and a number.`}
              disabled={submitting}
            />
            <PasswordField
              id="confirm-password"
              label="Confirm New Password"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              error={errors.confirm}
              disabled={submitting}
            />

            {formError && (
              <p className="rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark disabled:opacity-60"
            >
              {submitting ? "Updating…" : "Update Password"}
            </button>
          </form>
        )}

        {status === "ready" && success && (
          <div className="text-center">
            <p className="rounded-md bg-trace-light px-3 py-2 text-sm text-trace-dark" role="status">
              Password changed successfully. Redirecting you to login…
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
