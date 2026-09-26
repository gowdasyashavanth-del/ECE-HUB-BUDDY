import { useState } from "react";
import { usePWAInstall } from "../../hooks/usePWAInstall";
import { IOSInstallGuide } from "./IOSInstallGuide";

// Mounted once, at the application root (App.tsx) — outside the routed
// pages — so it appears identically for logged-out and every signed-in
// role without being duplicated per page. Renders nothing once
// installed, dismissed, or on a browser that hasn't offered install.
export function PWAInstallCard() {
  const { isIOS, showInstallPrompt, installApp, dismissInstallPrompt } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [installing, setInstalling] = useState(false);

  if (!showInstallPrompt) return null;

  async function handleInstall() {
    if (isIOS) {
      setShowIOSGuide(true);
      return;
    }
    setInstalling(true);
    await installApp(); // real browser prompt; resolves only after the user actually responds
    setInstalling(false);
  }

  return (
    <div
      role="complementary"
      aria-label="Install ECE Hub Buddy"
      className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-sm rounded-lg border border-line bg-panel p-4 shadow-lg sm:inset-x-auto sm:bottom-5 sm:right-5"
    >
      <div className="flex items-start gap-3">
        <span className="text-xl" aria-hidden>📱</span>
        <div className="flex-1">
          <p className="font-display text-sm font-semibold text-ink">Install ECE Hub Buddy</p>
          <p className="mt-0.5 text-xs text-inkmuted">
            Install ECE Hub Buddy on your device for quick access from your home screen.
          </p>

          {showIOSGuide && (
            <div className="mt-3 rounded-md border border-line bg-paper p-3">
              <IOSInstallGuide />
            </div>
          )}

          <div className="mt-3 flex gap-2">
            {!showIOSGuide && (
              <button
                onClick={handleInstall}
                disabled={installing}
                className="rounded-md bg-copper px-3 py-1.5 text-xs font-medium text-white hover:bg-copper-dark disabled:opacity-60"
              >
                {installing ? "Opening…" : "Install App"}
              </button>
            )}
            <button
              onClick={dismissInstallPrompt}
              className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-copper"
            >
              {showIOSGuide ? "Got it" : "Not Now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
