import { useAuth } from "../../contexts/AuthContext";
import type { UserRole } from "../../lib/types";
import { Logo } from "../branding/Logo";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { GlobalSearch } from "../search/GlobalSearch";

const ROLE_LABEL: Record<UserRole, string> = {
  student: "Student",
  teacher: "Teacher",
  super_admin: "Super Admin",
};

export function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  const { profile, signOut } = useAuth();

  return (
    <header className="flex h-14 items-center justify-between border-b border-line bg-panel px-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="rounded-md p-2 text-ink hover:bg-paper md:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
          aria-label="Open navigation menu"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 5H17M3 10H17M3 15H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <Logo compact />
      </div>

      {profile && (
        <div className="flex flex-1 items-center justify-end gap-2 md:justify-center">
          <GlobalSearch />
        </div>
      )}

      {profile && (
        <div className="flex items-center gap-3">
          <ThemeSwitcher />
          <div className="hidden text-right sm:block">
            <p className="font-body text-sm font-medium text-ink">{profile.full_name || profile.email}</p>
            <p className="font-mono text-[11px] uppercase tracking-wide text-inkmuted">
              {ROLE_LABEL[profile.role]}
            </p>
          </div>
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt=""
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-copper-light font-display text-sm font-semibold text-copper-dark">
              {(profile.full_name || profile.email).charAt(0).toUpperCase()}
            </div>
          )}
          <button
            onClick={signOut}
            className="rounded-md border border-line px-3 py-1.5 font-body text-sm text-inkmuted hover:border-copper hover:text-copper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
          >
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}
