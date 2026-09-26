import { useEffect, useState, type ComponentType, type FormEvent, type SVGProps } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { Logo } from "../components/branding/Logo";
import {
  EyeIcon,
  EyeOffIcon,
  GraduationCapIcon,
  PresentationIcon,
  ShieldIcon,
} from "../components/branding/PortalIcons";
import { dashboardPathForRole } from "../components/ProtectedRoute";
import campusImage from "../assets/campus-bgsit.jpg";
import type { UserRole } from "../lib/types";

interface Portal {
  role: UserRole;
  label: string;
  path: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  accent: "azure" | "copper" | "admin";
}

// Same three destinations as before (/student/login, /teacher/login,
// /admin/login) — picking one is still pure navigation. The real
// Supabase Auth sign-in + DB-sourced role check still happens on
// PortalLoginPage exactly as it did before this redesign; nothing
// about that flow changed. Student = blue, Teacher = copper,
// Super Admin = subtle purple, per the requested palette.
const PORTALS: Portal[] = [
  { role: "student", label: "Student", path: "/student/login", Icon: GraduationCapIcon, accent: "azure" },
  { role: "teacher", label: "Teacher", path: "/teacher/login", Icon: PresentationIcon, accent: "copper" },
  { role: "super_admin", label: "Super Admin", path: "/admin/login", Icon: ShieldIcon, accent: "admin" },
];

const ACCENT_CLASSES: Record<Portal["accent"], { idle: string; selected: string }> = {
  azure: {
    idle: "hover:border-azure/50 hover:bg-azure-light/70",
    selected: "border-azure bg-azure-light shadow-[0_0_0_3px_rgba(47,111,224,0.18)] text-azure-dark",
  },
  copper: {
    idle: "hover:border-copper/50 hover:bg-copper-light/70",
    selected: "border-copper bg-copper-light shadow-[0_0_0_3px_rgba(199,116,42,0.18)] text-copper-dark",
  },
  admin: {
    idle: "hover:border-admin/50 hover:bg-admin-light/70",
    selected: "border-admin bg-admin-light shadow-[0_0_0_3px_rgba(110,90,158,0.18)] text-admin",
  },
};

const ICON_TONE: Record<Portal["accent"], string> = {
  azure: "text-azure-dark",
  copper: "text-copper-dark",
  admin: "text-admin",
};

// This unified login page combines the former plain role-picker with a
// quick email/password sign-in. It intentionally offers TWO equivalent
// paths to the same place, and neither duplicates the other's
// authorization logic:
//
//   1. Fill in email/password and press "Log in" right here → signs in
//      with Supabase Auth, then (once AuthContext resolves the
//      DB-sourced `profile.role`) redirects straight to that role's own
//      dashboard via the same `dashboardPathForRole` helper every other
//      part of the app already uses. No role is "selected" for this
//      path — the account's real role decides where it goes, same as
//      if the person had used the matching portal's dedicated login.
//
//   2. Tap a role card below → navigates to that role's dedicated
//      /student|teacher|admin/login page (unchanged, untouched
//      component), which does its own sign-in AND enforces that the
//      authenticated account's role matches the chosen portal (signing
//      back out on mismatch, exactly as before this change).
//
// Neither path trusts anything the client says about role — only
// `profile.role`, fetched from the `users` table under RLS, ever
// decides where someone lands.
export function PortalSelectionPage() {
  const { session, profile, signIn, resetPassword } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [awaitingProfile, setAwaitingProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);

  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotStatus, setForgotStatus] = useState<string | null>(null);
  const [forgotSubmitting, setForgotSubmitting] = useState(false);

  useEffect(() => {
    if (!profile || !awaitingProfile) return;
    setAwaitingProfile(false);
    // Redirect only — dashboardPathForRole is the same helper every
    // other portal entry point uses, so this can't send anyone
    // anywhere ProtectedRoute wouldn't already allow for their role.
  }, [profile, awaitingProfile]);

  // Already signed in — skip straight to the correct dashboard.
  if (session && profile) {
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
    setAwaitingProfile(true);
  }

  async function handleForgotSubmit(e: FormEvent) {
    e.preventDefault();
    setForgotSubmitting(true);
    setForgotStatus(null);
    const { error: resetError } = await resetPassword(forgotEmail);
    setForgotSubmitting(false);
    setForgotStatus(
      resetError ?? "If that email has an account, a password reset link is on its way."
    );
  }

  // Visually "select" the tapped role card first (border/glow/selected
  // state, per the iOS-style tactile feedback requested), then hand off
  // to that portal's own dedicated login route a beat later. This is
  // purely a presentation delay — it doesn't touch auth in any way;
  // /student|teacher|admin/login still does the real Supabase sign-in
  // and role check exactly as before.
  function handleRoleSelect(portal: Portal) {
    setSelectedRole(portal.role);
    window.setTimeout(() => navigate(portal.path), 180);
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden font-body">
      {/* Campus photo hero background. background-position shifts per
          breakpoint (not a single fixed crop) so the dome/entrance
          stays in frame whether the viewport is a tall narrow phone or
          a wide short desktop window. Desktop leans toward "center"
          since a 16:9-ish window crops relatively little of this
          photo's height to begin with — there's no need to bias hard
          toward the top the way a phone's tall aspect ratio requires. */}
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-20 bg-[position:center_14%] bg-cover bg-no-repeat sm:bg-[position:center_18%] md:bg-[position:center_24%] lg:bg-[position:center_34%] xl:bg-center"
        style={{ backgroundImage: `url(${campusImage})` }}
      />
      {/* Subtle scrim — just enough for the white branding text to read
          clearly; kept light (well under half-opacity almost
          everywhere) so the campus stays clearly recognizable. The
          glass card below does NOT depend on this scrim for its own
          contrast — the card gets there through opacity/blur/solid
          text color, not by darkening the photo behind it. */}
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-10 bg-gradient-to-b from-ink/45 via-ink/18 to-ink/32 lg:bg-gradient-to-r lg:from-ink/45 lg:via-ink/16 lg:to-ink/5"
      />

      <div className="relative z-10 flex min-h-screen flex-col px-5 py-8 sm:px-8 sm:py-10 lg:flex-row lg:items-center lg:justify-between lg:px-16 lg:py-12 xl:px-24">
        {/* ── Branding column ───────────────────────────────────────── */}
        <div className="flex flex-col items-center text-center lg:max-w-lg lg:items-start lg:text-left">
          <Logo tone="light" />
          <p className="mt-4 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-white/70">
            BGS Institute of Technology
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">
            ECE Hub Buddy
          </h1>
          <p className="mt-3 font-display text-base font-medium tracking-wide text-copper-light sm:text-lg">
            Learn <span aria-hidden="true">•</span> Practice <span aria-hidden="true">•</span> Grow
          </p>
          <p className="mt-2 max-w-sm text-sm text-white/75 sm:text-[15px]">
            Your ECE learning companion at BGSIT.
          </p>
        </div>

        {/* ── Glass login card ──────────────────────────────────────── */}
        <div className="mt-8 w-full max-w-[440px] lg:mt-0">
          <div className="relative overflow-hidden rounded-[28px] border border-white/60 bg-white/90 p-6 shadow-[0_24px_70px_-18px_rgba(22,35,58,0.5)] [backdrop-filter:blur(30px)_saturate(140%)] motion-safe:animate-[fadeSlideIn_0.5s_ease-out] sm:bg-white/89 sm:p-8 md:bg-white/87 lg:bg-white/85">
            {/* Faint top highlight — a thin light streak along the
                inner top edge, the one bit of "reflection" that reads
                as glass rather than a flat translucent panel. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/50 to-transparent"
            />
            {!forgotMode ? (
              <>
                <h2 className="font-display text-xl font-semibold text-ink sm:text-2xl">Welcome Back</h2>
                <p className="mt-1 text-sm text-steel">Sign in to your ECE Hub Buddy account.</p>

                <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                  <div>
                    <label htmlFor="quick-email" className="block text-sm font-medium text-ink">
                      Email Address
                    </label>
                    <input
                      id="quick-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-ink/15 bg-white/95 px-3.5 py-2.5 text-sm text-ink placeholder:text-inkmuted transition-colors focus:border-copper focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
                    />
                  </div>

                  <div>
                    <label htmlFor="quick-password" className="block text-sm font-medium text-ink">
                      Password
                    </label>
                    <div className="relative mt-1">
                      <input
                        id="quick-password"
                        type={showPassword ? "text" : "password"}
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-xl border border-ink/15 bg-white/95 px-3.5 py-2.5 pr-10 text-sm text-ink placeholder:text-inkmuted transition-colors focus:border-copper focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-steel transition-colors hover:text-copper-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
                      >
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <label className="flex items-center gap-1.5 font-medium text-steel">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-ink/25 text-copper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
                      />
                      Remember me
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setForgotMode(true);
                        setForgotEmail(email);
                        setForgotStatus(null);
                      }}
                      className="font-semibold text-copper-dark hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
                    >
                      Forgot password?
                    </button>
                  </div>

                  {error && (
                    <p className="rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={submitting || awaitingProfile}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-copper px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-copper-dark disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
                  >
                    {submitting || awaitingProfile ? "Signing in…" : "Log in"}
                    {!(submitting || awaitingProfile) && <span aria-hidden="true">→</span>}
                  </button>
                </form>

                <div className="my-6 flex items-center gap-3" aria-hidden="true">
                  <span className="h-px flex-1 bg-ink/15" />
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-steel">Or</span>
                  <span className="h-px flex-1 bg-ink/15" />
                </div>

                <p className="text-center text-sm font-semibold text-ink">Select your role</p>
                <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3" role="group" aria-label="Select your role">
                  {PORTALS.map((portal) => {
                    const { role, label, Icon, accent } = portal;
                    const isSelected = selectedRole === role;
                    return (
                      <button
                        key={role}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => handleRoleSelect(portal)}
                        className={`flex min-h-[44px] flex-col items-center gap-1.5 rounded-xl border border-ink/12 bg-white/85 px-3 py-3 text-center transition-all duration-150 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
                          isSelected ? ACCENT_CLASSES[accent].selected : ACCENT_CLASSES[accent].idle
                        }`}
                      >
                        <span className={`flex h-8 w-8 items-center justify-center rounded-lg bg-paper transition-colors ${isSelected ? ICON_TONE[accent] : "text-steel"}`}>
                          <Icon />
                        </span>
                        <span className={`text-xs font-semibold ${isSelected ? ICON_TONE[accent] : "text-ink"}`}>{label}</span>
                      </button>
                    );
                  })}
                </div>

                <p className="mt-6 text-center font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-steel">
                  BGSIT <span aria-hidden="true">•</span> ECE <span aria-hidden="true">•</span> Secure Access
                </p>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setForgotMode(false)}
                  className="text-sm font-semibold text-steel hover:text-copper-dark hover:underline"
                >
                  ← Back to sign in
                </button>
                <h2 className="mt-3 font-display text-xl font-semibold text-ink sm:text-2xl">Reset your password</h2>
                <p className="mt-1 text-sm text-steel">
                  Enter your account email and we'll send you a reset link.
                </p>

                <form onSubmit={handleForgotSubmit} className="mt-6 space-y-4">
                  <div>
                    <label htmlFor="forgot-email" className="block text-sm font-medium text-ink">
                      Email Address
                    </label>
                    <input
                      id="forgot-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-ink/15 bg-white/95 px-3.5 py-2.5 text-sm text-ink placeholder:text-inkmuted transition-colors focus:border-copper focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
                    />
                  </div>

                  {forgotStatus && (
                    <p className="rounded-lg bg-trace-light px-3 py-2 text-sm text-trace-dark" role="status">
                      {forgotStatus}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={forgotSubmitting}
                    className="w-full rounded-xl bg-copper px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-copper-dark disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
                  >
                    {forgotSubmitting ? "Sending…" : "Send reset link"}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
