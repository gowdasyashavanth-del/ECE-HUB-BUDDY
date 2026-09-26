import { useState, type ReactNode } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { ThemeProvider, useTheme } from "../../contexts/ThemeContext";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

// Wraps every authenticated route. Sidebar is a fixed column on
// desktop (md+) and a slide-over drawer on mobile — the one piece of
// deliberate motion in this app, since it's functional (revealing
// navigation) rather than decorative.
//
// ThemeProvider + the data-theme attribute both live here, scoped to
// this one wrapper element. Every color in the app is built from CSS
// variables (see index.css) that only change *inside* an element
// carrying [data-theme] — the login/portal-selection page renders on
// an entirely separate route outside this tree, so it keeps its own
// fixed light look no matter what theme a signed-in user has chosen.
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AppShellChrome>{children}</AppShellChrome>
    </ThemeProvider>
  );
}

function AppShellChrome({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const { theme } = useTheme();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (!profile) return null;

  return (
    <div data-theme={theme} className="flex h-screen h-dvh flex-col bg-paper font-body text-ink">
      <TopBar onMenuClick={() => setMobileNavOpen(true)} />
      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden w-56 shrink-0 overflow-y-auto overscroll-contain border-r border-line bg-panel md:block">
          <Sidebar role={profile.role} />
        </aside>

        {mobileNavOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setMobileNavOpen(false)}
              aria-hidden="true"
            />
            <div className="absolute inset-y-0 left-0 w-64 overflow-y-auto overscroll-contain bg-panel shadow-xl [-webkit-overflow-scrolling:touch]">
              <Sidebar role={profile.role} onNavigate={() => setMobileNavOpen(false)} />
            </div>
          </div>
        )}

        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
