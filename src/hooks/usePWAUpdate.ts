import { useEffect, useState } from "react";

// Deliberately NOT using vite-plugin-pwa's `virtual:pwa-register` import
// (it fails to resolve under this project's Vite/Rollup combination) —
// this talks to the exact same underlying browser Service Worker API
// that module wraps, just directly. `registerType: "prompt"` +
// `injectRegister: "script"` (vite.config.ts) mean the plugin registers
// the worker via its generated registerSW.js, but a new version is
// never activated until `applyUpdate()` below is actually called, so a
// background deploy never yanks a user out of something they're
// mid-way through typing.
export function usePWAUpdate() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    let interval: number | undefined;

    function watch(reg: ServiceWorkerRegistration) {
      if (cancelled) return;
      setRegistration(reg);

      // A worker already waiting (e.g. installed while this tab was in
      // the background) is a real, already-downloaded update.
      if (reg.waiting && navigator.serviceWorker.controller) setNeedRefresh(true);
      if (reg.active && !navigator.serviceWorker.controller) setOfflineReady(true);

      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed") {
            if (navigator.serviceWorker.controller) {
              // A controller already exists, so this "installed" event is
              // a genuinely NEW version waiting to take over — not the
              // very first install.
              setNeedRefresh(true);
            } else {
              setOfflineReady(true);
            }
          }
        });
      });

      // Re-check for a newer build periodically — the same real
      // lifecycle (fetch the SW file, browser byte-compares it), just
      // on a schedule instead of only on hard reload.
      interval = window.setInterval(() => reg.update(), 60 * 60 * 1000);
    }

    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg) watch(reg);
    });

    let reloading = false;
    function onControllerChange() {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    }
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  function applyUpdate() {
    // Tells the WAITING worker to activate now. Workbox's generated
    // service worker always understands this exact message shape.
    registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
    // The page reloads from the `controllerchange` listener above, once
    // the new worker actually takes control — not assumed here.
  }
  function dismissUpdate() {
    setNeedRefresh(false);
  }
  function dismissOfflineReady() {
    setOfflineReady(false);
  }

  return { needRefresh, offlineReady, applyUpdate, dismissUpdate, dismissOfflineReady };
}
