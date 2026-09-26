import { usePWAUpdate } from "../../hooks/usePWAUpdate";

// Mounted once alongside PWAInstallCard. `needRefresh` only becomes
// true once a genuinely new, already-downloaded service worker is
// waiting (Workbox's real update lifecycle) — never a timer, never
// assumed.
export function PWAUpdateToast() {
  const { needRefresh, offlineReady, applyUpdate, dismissUpdate, dismissOfflineReady } = usePWAUpdate();

  if (!needRefresh && !offlineReady) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-3 top-3 z-40 mx-auto max-w-sm rounded-lg border border-line bg-panel p-3 shadow-lg sm:inset-x-auto sm:right-5"
    >
      {needRefresh ? (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-xs text-ink">A new version of ECE Hub Buddy is ready.</p>
          <button
            onClick={applyUpdate}
            className="rounded-md bg-copper px-2.5 py-1 text-xs font-medium text-white hover:bg-copper-dark"
          >
            Reload
          </button>
          <button onClick={dismissUpdate} className="text-xs text-inkmuted hover:text-ink">
            Later
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-xs text-ink">ECE Hub Buddy is ready to work offline.</p>
          <button onClick={dismissOfflineReady} className="text-xs text-inkmuted hover:text-ink">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
