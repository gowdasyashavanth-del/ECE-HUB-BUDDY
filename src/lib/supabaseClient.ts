import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Whether a real Supabase project has been configured yet. Deliberately
// NOT a hard throw-on-import: this app must be viewable (branding,
// shell, login screen) even before a new ECE Hub Buddy Supabase project
// exists, since connecting one is an explicit later step, not part of
// this phase. AuthContext checks this flag and the app shows a clear
// "not configured yet" screen instead of a blank crash.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // This app only ever uses email/password sign-in (see
        // AuthContext.tsx) — never OAuth or magic links — so there is
        // never a session token to recover from the page URL. Leaving
        // this on is not just unnecessary: Supabase's default session-
        // detection runs `new URL(window.location.href)` on startup,
        // which throws in embedding contexts where the page has no
        // normal browsable location (e.g. some in-app HTML previewers,
        // sandboxed webviews loaded via loadData-style APIs). Turning
        // it off avoids that call entirely, with zero effect on the
        // password-based login flow this app actually uses.
        detectSessionInUrl: false,
      },
    })
  : null;
