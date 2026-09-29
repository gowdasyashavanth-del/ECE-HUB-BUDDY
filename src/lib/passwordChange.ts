import type { SupabaseClient } from "@supabase/supabase-js";

// Self-service password change. Supabase Auth is the ONLY authority for
// passwords: nothing here reads, stores, hashes or compares a password
// itself, and no password ever touches the `users` table.
//
// Deliberately client-agnostic (the Supabase client is passed in) so the
// logic can be exercised with a fake client in tests.

export const MIN_PASSWORD_LENGTH = 8;

// Shared by both the Profile "Change password" form (with a current-
// password field) and the recovery "Reset password" form (no current
// password — the recovery session itself is the proof of identity).
// One rule set, so the two forms can never silently drift apart.
export function validateNewPassword(next: string, confirm: string): Pick<FieldErrors, "next" | "confirm"> {
  const errors: Pick<FieldErrors, "next" | "confirm"> = {};
  if (!next) {
    errors.next = "Enter a new password.";
  } else if (next.length < MIN_PASSWORD_LENGTH) {
    errors.next = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  } else if (!/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) {
    errors.next = "Include at least one letter and one number.";
  }
  if (!confirm) {
    errors.confirm = "Confirm your new password.";
  } else if (next && confirm !== next) {
    errors.confirm = "The passwords don't match.";
  }
  return errors;
}

export interface PasswordFields {
  current: string;
  next: string;
  confirm: string;
}
export type FieldErrors = Partial<Record<keyof PasswordFields, string>>;

// Client-side checks only improve feedback — Supabase Auth still enforces
// its own password policy server-side and is what actually decides.
export function validatePasswordChange(f: PasswordFields): FieldErrors {
  const errors: FieldErrors = {};
  if (!f.current) errors.current = "Enter your current password.";
  const { next, confirm } = validateNewPassword(f.next, f.confirm);
  if (next) errors.next = next;
  if (confirm) errors.confirm = confirm;
  // Only flag "must differ" once the new password is otherwise valid —
  // otherwise a too-short password could get two overlapping messages.
  if (!errors.next && f.current && f.next === f.current) {
    errors.next = "Your new password must be different from your current one.";
  }
  return errors;
}

export type ChangeResult =
  | { ok: true }
  | { ok: false; field?: "current" | "next"; message: string };

interface AuthErrorLike {
  name?: string;
  code?: string;
  status?: number;
  message?: string;
}

function isNetworkError(e: AuthErrorLike): boolean {
  return e.name === "AuthRetryableFetchError" || /failed to fetch|network|fetch/i.test(e.message ?? "");
}
function isSessionError(e: AuthErrorLike): boolean {
  return (
    e.name === "AuthSessionMissingError" ||
    e.code === "session_not_found" ||
    e.code === "bad_jwt" ||
    e.code === "refresh_token_not_found" ||
    e.code === "user_not_found" ||
    e.status === 401
  );
}

// Every message shown to the user is written here — raw Supabase/internal
// error text is never displayed.
function mapVerifyError(e: AuthErrorLike): ChangeResult {
  if (e.code === "invalid_credentials" || /invalid login credentials/i.test(e.message ?? "")) {
    return { ok: false, field: "current", message: "Your current password is incorrect." };
  }
  if (e.status === 429 || e.code === "over_request_rate_limit") {
    return { ok: false, message: "Too many attempts. Please wait a few minutes and try again." };
  }
  if (isNetworkError(e)) {
    return { ok: false, message: "Network problem. Check your connection and try again." };
  }
  return { ok: false, message: "We couldn't verify your current password. Please try again." };
}

function mapUpdateError(e: AuthErrorLike): ChangeResult {
  if (e.code === "same_password" || /different from the old password/i.test(e.message ?? "")) {
    return { ok: false, field: "next", message: "Your new password must be different from your current one." };
  }
  if (e.code === "weak_password" || e.name === "AuthWeakPasswordError") {
    return { ok: false, field: "next", message: "That password is too weak. Try a longer one with letters and numbers." };
  }
  if (e.status === 429 || e.code === "over_request_rate_limit") {
    return { ok: false, message: "Too many attempts. Please wait a few minutes and try again." };
  }
  if (isSessionError(e)) {
    return { ok: false, message: "Your session has expired. Please sign in again to change your password." };
  }
  if (isNetworkError(e)) {
    return { ok: false, message: "Network problem. Check your connection and try again." };
  }
  return { ok: false, message: "We couldn't change your password. Please try again." };
}

export async function changeOwnPassword(
  client: SupabaseClient,
  email: string | undefined,
  currentPassword: string,
  newPassword: string
): Promise<ChangeResult> {
  if (!email) {
    return { ok: false, message: "Your session has expired. Please sign in again to change your password." };
  }

  // 1) Re-authenticate with the CURRENT password through Supabase Auth's
  //    normal sign-in. The email comes from the live session — there is
  //    no email input, so this can only ever verify the signed-in user.
  try {
    const { error } = await client.auth.signInWithPassword({ email, password: currentPassword });
    if (error) return mapVerifyError(error);
  } catch {
    return { ok: false, message: "Network problem. Check your connection and try again." };
  }

  // 2) Official Supabase Auth password update. It acts on the session
  //    user only; the API has no way to target another account.
  try {
    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) return mapUpdateError(error);
  } catch {
    return { ok: false, message: "Network problem. Check your connection and try again." };
  }

  // 3) Best effort: sign out this account's OTHER sessions (other
  //    devices/browsers) so a changed password actually cuts off anyone
  //    holding an older login. The current session is untouched.
  try {
    await client.auth.signOut({ scope: "others" });
  } catch {
    // non-fatal: the password change itself already succeeded
  }

  return { ok: true };
}

// Password-RECOVERY completion. The recovery session itself (established
// from the emailed link) is the proof of identity here — there is no
// "current password" to re-verify, unlike changeOwnPassword above.
export async function completePasswordRecovery(
  client: SupabaseClient,
  newPassword: string
): Promise<ChangeResult> {
  try {
    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) return mapUpdateError(error);
  } catch {
    return { ok: false, message: "Network problem. Check your connection and try again." };
  }

  // The recovery session was only ever meant to last long enough to set
  // a new password — end it (and any other lingering session for this
  // account) so the user comes back through a normal login with the
  // password they just chose, exactly as the flow is meant to end.
  try {
    await client.auth.signOut();
  } catch {
    // non-fatal: the password update itself already succeeded
  }

  return { ok: true };
}
