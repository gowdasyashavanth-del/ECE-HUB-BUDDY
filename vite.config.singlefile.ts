import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Dedicated config for the portable single-file build. Kept entirely
// separate from vite.config.ts (the normal dev/deploy config) so the
// regular app build is never affected by this variant.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist-singlefile",
    emptyOutDir: true,
    // Only this build inlines every asset (incl. the campus photo) as
    // base64 so the final output is a single file with zero external
    // references. The normal build (vite.config.ts) intentionally does
    // NOT set this, so the deployed app still serves/caches the image
    // as its own file for better real-world performance.
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input: "index.singlefile.html",
    },
  },
});
