import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt" (not "autoUpdate"): a new build never silently takes
      // over an open tab mid-session — the app decides when to apply
      // it (see src/hooks/usePWAUpdate.ts), so in-progress form input
      // is never yanked out from under a user.
      registerType: "prompt",
      // Registered via the plugin's own generated registerSW.js script
      // tag (auto-injected into index.html) — avoids the
      // virtual:pwa-register import path, which fails to resolve in
      // this Rollup/Vite combination. Update lifecycle (needRefresh /
      // applyUpdate) is then handled with the plain browser Service
      // Worker API in src/hooks/usePWAUpdate.ts, not the virtual module.
      injectRegister: "script",
      includeAssets: ["icons/apple-touch-icon.png", "favicon.ico", "favicon-16.png", "favicon-32.png", "favicon-48.png"],
      manifest: {
        name: "ECE Hub Buddy",
        short_name: "ECE Hub Buddy",
        description: "Academic management and learning portal for the ECE department at BGSIT.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait-primary",
        // Same tokens as the app's light theme (src/index.css) — the
        // install surface (browser splash/toolbar) matches the app.
        theme_color: "#C7742A",
        background_color: "#F3F6F4",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/maskable-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App-shell precaching ONLY: JS/CSS/HTML/fonts/icons that Vite
        // actually emits. Supabase is a different origin entirely
        // (*.supabase.co), so it is never matched by these same-origin
        // asset globs — and no `runtimeCaching` entry is defined below,
        // so the service worker never intercepts, and therefore never
        // caches, ANY Supabase request (auth, REST/PostgREST, storage).
        // Every data request goes straight to the network, exactly as
        // it did before the service worker existed.
        globPatterns: ["**/*.{js,css,html,woff2,png,svg,ico}"],
        // The SPA offline fallback only ever applies to same-origin
        // page NAVIGATIONS (the browser loading a route while offline)
        // — Workbox's navigateFallback never applies to fetch/XHR calls
        // like Supabase's, only to `mode: "navigate"` requests.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/admin\/academic\//], // has its own dynamic :entityKey segment; avoid over-eager shell matches
        cleanupOutdatedCaches: true,
        // No runtimeCaching array — deliberately. Adding one is the one
        // change that could ever cause "Student A's data served to
        // Student B"; leaving it absent means that failure mode does
        // not exist in this build.
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
  },
});

