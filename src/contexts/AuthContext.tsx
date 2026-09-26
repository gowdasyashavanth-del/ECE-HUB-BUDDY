import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import type { Profile } from "../lib/types";

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileError: string | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  const fetchProfile = useCallback(async (userId: string) => {
    if (!supabase) return;
    setProfileError(null);
    // Role always comes from this DB row, never trusted from the JWT
    // or from client state — the row itself is protected server-side
    // by the RLS + trigger pattern in the approved migrations, so a
    // student can never make this query return role: 'super_admin' for
    // themselves no matter what the client does.
    const { data, error } = await supabase
      .from("users")
      .select("id, email, full_name, phone, role, xp, streak, avatar_url, usn, created_at")
      .eq("id", userId)
      .single();

    if (error) {
      setProfileError(
        "We couldn't load your profile. This can happen right after signing up, or if the database isn't set up yet."
      );
      setProfile(null);
      return;
    }
    setProfile(data as Profile);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!isMounted) return;
      setSession(data.session);
      if (data.session) {
        await fetchProfile(data.session.user.id);
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        await fetchProfile(newSession.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return { error: "Supabase is not configured yet." };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? error.message : null };
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
  }, []);

  // Standard Supabase Auth password-reset email — does not touch the
  // `users` table, RLS, or roles. Supabase always returns a generic
  // success response here regardless of whether the email exists, so
  // this never leaks whether an account is registered.
  const resetPassword = useCallback(async (email: string) => {
    if (!supabase) return { error: "Supabase is not configured yet." };
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });
    return { error: error ? error.message : null };
  }, []);

  // Re-reads the current user's row (e.g. avatar_url, full_name) into
  // shared context state, so components like TopBar that read `profile`
  // from context reflect an update immediately, without waiting for a
  // full logout/login or auth state change event.
  const refreshProfile = useCallback(async () => {
    if (!session) return;
    await fetchProfile(session.user.id);
  }, [session, fetchProfile]);

  return (
    <AuthContext.Provider
      value={{ session, profile, loading, profileError, signIn, signOut, resetPassword, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
