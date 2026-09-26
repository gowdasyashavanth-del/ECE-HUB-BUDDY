import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import type { UserRole } from "../lib/types";
import { Logo } from "../components/branding/Logo";
import { dashboardPathForRole } from "../components/ProtectedRoute";

const ROLE_LABEL: Record<UserRole, string> = {
  student: "Student",
  teacher: "Teacher",
  super_admin: "Super Admin",
};

const ROLE_ICON: Record<UserRole, string> = {
  student: "🎓",
  teacher: "👨‍🏫",
  super_admin: "👑",
};

interface PortalLoginPageProps {
  expectedRole: UserRole;
}

// One shared component for all three portals, parameterized by
// expectedRole — NOT three duplicated forms. This component never
// grants access based on which portal URL the person is on: it only
// ever compares the DB-sourced `profile.role` (fetched by AuthContext,
// exactly as before) against `expectedRole` after a real Supabase Auth
// sign-in. A correct password on the wrong portal still authenticates
// with Supabase (there's only ever one Auth system) — it's simply
// signed back out immediately once the role mismatch is detected, so
// no session is left sitting on a portal it doesn't belong on.
export function PortalLoginPage({ expectedRole }: PortalLoginPageProps) {
  const { session, profile, signIn, signOut } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingRole, setCheckingRole] = useState(false);

  useEffect(() => {
    if (!profile || !checkingRole) return;

    if (profile.role === expectedRole) {
      navigate(dashboardPathForRole(profile.role), { replace: true });
      return;
    }

    // Mismatch: this account is real and the password was correct, but
    // it's the wrong portal. Sign out immediately rather than leaving
    // an authenticated session parked on a login page it doesn't match.
    setCheckingRole(false);
    setError(`This account is registered as a ${ROLE_LABEL[profile.role]}. Please use the ${ROLE_LABEL[profile.role]} Portal.`);
    signOut();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, checkingRole]);

  // Already signed in with the matching role (e.g. a refreshed tab) —
  // go straight to the dashboard rather than showing the form again.
  if (session && profile && profile.role === expectedRole && !checkingRole) {
    return <Navigate to={dashboardPathForRole(profile.role)} replace />;
  }

  // Already signed in but with a DIFFERENT role than this portal
  // expects — e.g. a teacher who's already logged in following a
  // bookmark to /student/login. They did nothing wrong here (no form
  // was submitted on this page), so this silently sends them to their
  // own correct dashboard rather than signing out a valid session.
  // The sign-out-on-mismatch behavior above is reserved for the case
  // where credentials were actually submitted on the wrong portal.
  if (session && profile && profile.role !== expectedRole && !checkingRole) {
    return <Navigate to={dashboardPathForRole(profile.role)} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await signIn(email, password);
    setSubmitting(false);
    if (signInError) {
      setError(signInError);
      return;
    }
    // Session now exists; wait for AuthContext to fetch `profile`, then
    // the effect above does the real (DB-sourced) role check.
    setCheckingRole(true);
  }

  const label = ROLE_LABEL[expectedRole];
  const icon = ROLE_ICON[expectedRole];

  return (
    <div className="flex min-h-screen font-body">
      <div
        className="relative hidden flex-1 items-center justify-center overflow-hidden bg-ink lg:flex"
        aria-hidden="true"
      >
        <svg width="100%" height="100%" className="absolute inset-0 opacity-[0.15]">
          <defs>
            <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M32 0H0V32" fill="none" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
        <div className="relative z-10 max-w-sm px-8 text-white">
          <p className="font-display text-3xl font-semibold leading-tight">
            Your engineering semester,
            <br />
            wired together.
          </p>
          <p className="mt-4 font-mono text-sm text-white/60">
            SUBJECTS · FORMULAS · NOTES · PROGRESS
          </p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center bg-paper px-6 py-12">
        <div className="w-full max-w-sm">
          <Logo />
          <p className="mt-8 text-3xl">{icon}</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-ink">{label} Portal</h1>
          <p className="mt-1 text-sm text-inkmuted">Sign in with your {label.toLowerCase()} account.</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="block font-body text-sm font-medium text-ink">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink focus:border-copper focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
              />
            </div>
            <div>
              <label htmlFor="password" className="block font-body text-sm font-medium text-ink">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink focus:border-copper focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
              />
            </div>

            {error && (
              <p className="rounded-md bg-danger/5 px-3 py-2 font-body text-sm text-danger" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || checkingRole}
              className="w-full rounded-md bg-copper px-4 py-2.5 font-body text-sm font-medium text-white transition-colors hover:bg-copper-dark disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
            >
              {submitting || checkingRole ? "Signing in…" : `Sign in to ${label} Portal`}
            </button>
          </form>

          <Link to="/login" className="mt-6 inline-block text-sm text-inkmuted hover:text-copper-dark hover:underline">
            ← Back to portal selection
          </Link>
        </div>
      </div>
    </div>
  );
}
