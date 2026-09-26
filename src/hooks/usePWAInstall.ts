import { useCallback, useEffect, useState } from "react";

// Real browser PWA install lifecycle only — no simulated state.
// `beforeinstallprompt` is Chromium-only (Android Chrome, desktop
// Chrome/Edge); Safari/iOS never fires it, which is why `isIOS` exists
// as a separate, explicit branch rather than a fallback guess.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const DISMISS_KEY = "ece-hub-buddy:pwa-install-dismissed-at";
const DISMISS_SNOOZE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days — re-offer later, don't nag every visit

function detectIOS(): boolean {
  const ua = window.navigator.userAgent;
  const isAppleMobile = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ reports as "Macintosh" but exposes multi-touch, unlike a real Mac.
  const isIpadOS13 = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return isAppleMobile || isIpadOS13;
}

function detectStandalone(): boolean {
  const mql = window.matchMedia?.("(display-mode: standalone)").matches;
  // iOS Safari's own (non-standard, but real) standalone flag — the
  // only reliable "already installed" signal Safari exposes.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return Boolean(mql || iosStandalone);
}

export function usePWAInstall() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(detectStandalone);
  const [isIOS] = useState(detectIOS);
  const [dismissed, setDismissed] = useState(() => {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < DISMISS_SNOOZE_MS;
  });

  useEffect(() => {
    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault(); // suppress the browser's own mini-infobar; we show our own card instead
      setDeferredEvent(e as BeforeInstallPromptEvent);
    }
    function onAppInstalled() {
      // The ONLY place isInstalled is set true from an install action —
      // driven by the browser's own real lifecycle event, never assumed
      // from a click handler.
      setIsInstalled(true);
      setDeferredEvent(null);
    }
    const mql = window.matchMedia("(display-mode: standalone)");
    function onDisplayModeChange(e: MediaQueryListEvent) {
      if (e.matches) setIsInstalled(true);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    mql.addEventListener("change", onDisplayModeChange);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      mql.removeEventListener("change", onDisplayModeChange);
    };
  }, []);

  const installApp = useCallback(async () => {
    if (!deferredEvent) return { outcome: "unavailable" as const };
    await deferredEvent.prompt();
    const choice = await deferredEvent.userChoice; // real browser result — accepted or dismissed, never assumed
    setDeferredEvent(null); // a captured prompt event can only be used once
    if (choice.outcome === "dismissed") {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
      setDismissed(true);
    }
    return choice;
  }, [deferredEvent]);

  const dismissInstallPrompt = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  }, []);

  // Chromium: only once the browser has actually fired the real event.
  // iOS: the browser never fires an install event at all, so "available"
  // here means "show the manual Add-to-Home-Screen guide instead".
  const installAvailable = Boolean(deferredEvent) || isIOS;
  const showInstallPrompt = installAvailable && !isInstalled && !dismissed;

  return { installAvailable, isInstalled, isIOS, showInstallPrompt, installApp, dismissInstallPrompt };
}
