/** @type {import('tailwindcss').Config} */

// Reads a "R G B" CSS custom property (defined per-theme in index.css)
// and turns it into a Tailwind color that still supports opacity
// modifiers (bg-paper/50 etc). Only the *app* surface/accent tokens use
// this — the login page's own tokens (steel, azure, admin) stay plain
// hex because the login page intentionally sits outside the themed
// AppShell subtree and must never change with the in-app theme toggle.
function themed(varName) {
  return ({ opacityValue }) =>
    opacityValue === undefined ? `rgb(var(${varName}))` : `rgb(var(${varName}) / ${opacityValue})`;
}

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: themed("--color-paper"),
        panel: themed("--color-panel"),
        ink: themed("--color-ink"),
        inkmuted: themed("--color-inkmuted"),
        line: themed("--color-line"),
        // Solid (non-alpha) secondary-text color used specifically on
        // the login page's frosted glass surfaces — deliberately
        // static, not theme-driven (see note above).
        steel: "#2E3F55",
        copper: {
          DEFAULT: themed("--color-copper"),
          dark: themed("--color-copper-dark"),
          light: themed("--color-copper-light"),
        },
        trace: {
          DEFAULT: themed("--color-trace"),
          dark: themed("--color-trace-dark"),
          light: themed("--color-trace-light"),
        },
        danger: themed("--color-danger"),
        // Role-accent colors used only on the login page's role
        // selection cards — kept separate from `trace` (which the rest
        // of the app already uses as a general "success/active" color)
        // so repurposing student's accent to blue here doesn't ripple
        // anywhere else. Static, not theme-driven, same reason as steel.
        azure: {
          DEFAULT: "#2F6FE0",
          dark: "#1F4FB0",
          light: "#E8EFFC",
        },
        // Subtle Super Admin accent only — not used elsewhere in the app.
        admin: {
          DEFAULT: "#6E5A9E",
          light: "#ECE8F5",
        },
      },
      fontFamily: {
        display: ["'Space Grotesk'", "system-ui", "sans-serif"],
        body: ["'IBM Plex Sans'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
    },
  },
  plugins: [],
};
