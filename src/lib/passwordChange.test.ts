import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MIN_PASSWORD_LENGTH,
  changeOwnPassword,
  completePasswordRecovery,
  validateNewPassword,
  validatePasswordChange,
} from "./passwordChange";

// Authentication flow tests. The module is client-agnostic by design, so a
// small fake stands in for the Supabase client — nothing here touches a
// network, a real project, or any credential.

type AuthErr = { name?: string; code?: string; status?: number; message?: string };

function fakeClient(opts: {
  signIn?: { error: AuthErr | null } | (() => never);
  update?: { error: AuthErr | null } | (() => never);
} = {}) {
  const signInWithPassword = vi.fn(async () => {
    if (typeof opts.signIn === "function") opts.signIn();
    return opts.signIn ?? { error: null };
  });
  const updateUser = vi.fn(async () => {
    if (typeof opts.update === "function") opts.update();
    return opts.update ?? { error: null };
  });
  const signOut = vi.fn(async () => ({ error: null }));
  const client = { auth: { signInWithPassword, updateUser, signOut } } as unknown as SupabaseClient;
  return { client, signInWithPassword, updateUser, signOut };
}

describe("validateNewPassword", () => {
  it("accepts a password with enough length, a letter and a number", () => {
    expect(validateNewPassword("abcdef12", "abcdef12")).toEqual({});
  });

  it("rejects empty, short, letters-only and digits-only passwords", () => {
    expect(validateNewPassword("", "").next).toBeTruthy();
    expect(validateNewPassword("a1".repeat(MIN_PASSWORD_LENGTH / 2 - 1), "x").next).toMatch(/at least/i);
    expect(validateNewPassword("abcdefgh", "abcdefgh").next).toMatch(/letter and one number/i);
    expect(validateNewPassword("12345678", "12345678").next).toMatch(/letter and one number/i);
  });

  it("requires confirmation and flags a mismatch", () => {
    expect(validateNewPassword("abcdef12", "").confirm).toBeTruthy();
    expect(validateNewPassword("abcdef12", "abcdef13").confirm).toMatch(/match/i);
  });
});

describe("validatePasswordChange", () => {
  it("requires the current password and refuses reusing it", () => {
    expect(validatePasswordChange({ current: "", next: "abcdef12", confirm: "abcdef12" }).current).toBeTruthy();
    const same = validatePasswordChange({ current: "abcdef12", next: "abcdef12", confirm: "abcdef12" });
    expect(same.next).toMatch(/different/i);
  });

  it("does not stack two messages on an invalid new password", () => {
    const e = validatePasswordChange({ current: "abc", next: "abc", confirm: "abc" });
    expect(e.next).toMatch(/at least/i);
  });
});

describe("changeOwnPassword", () => {
  it("fails closed without a session email and never calls Auth", async () => {
    const { client, signInWithPassword, updateUser } = fakeClient();
    const r = await changeOwnPassword(client, undefined, "old", "newpass12");
    expect(r.ok).toBe(false);
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("re-verifies the current password, then updates, then signs out other sessions", async () => {
    const { client, signInWithPassword, updateUser, signOut } = fakeClient();
    const r = await changeOwnPassword(client, "t@x.test", "oldpass12", "newpass12");
    expect(r).toEqual({ ok: true });
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "t@x.test", password: "oldpass12" });
    expect(updateUser).toHaveBeenCalledWith({ password: "newpass12" });
    expect(signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("blocks the update when the current password is wrong", async () => {
    const { client, updateUser } = fakeClient({ signIn: { error: { code: "invalid_credentials", message: "Invalid login credentials" } } });
    const r = await changeOwnPassword(client, "t@x.test", "wrong", "newpass12");
    expect(r).toMatchObject({ ok: false, field: "current" });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("maps weak / same-password / rate-limit errors to friendly messages", async () => {
    const weak = await changeOwnPassword(fakeClient({ update: { error: { code: "weak_password" } } }).client, "t@x.test", "o", "newpass12");
    expect(weak).toMatchObject({ ok: false, field: "next" });
    const same = await changeOwnPassword(fakeClient({ update: { error: { code: "same_password" } } }).client, "t@x.test", "o", "newpass12");
    expect(same).toMatchObject({ ok: false, field: "next" });
    const limited = await changeOwnPassword(fakeClient({ update: { error: { status: 429 } } }).client, "t@x.test", "o", "newpass12");
    expect(limited).toMatchObject({ ok: false });
    expect((limited as { message: string }).message).toMatch(/too many/i);
  });

  it("never shows raw provider error text", async () => {
    const r = await changeOwnPassword(fakeClient({ update: { error: { message: "internal: pg stack trace 0xdeadbeef" } } }).client, "t@x.test", "o", "newpass12");
    expect((r as { message: string }).message).not.toMatch(/0xdeadbeef|stack trace/);
  });

  it("reports a network failure that throws, without crashing", async () => {
    const { client } = fakeClient({ signIn: () => { throw new Error("boom"); } });
    const r = await changeOwnPassword(client, "t@x.test", "o", "newpass12");
    expect(r).toMatchObject({ ok: false });
    expect((r as { message: string }).message).toMatch(/network/i);
  });
});

describe("completePasswordRecovery", () => {
  it("updates the password and ends the recovery session", async () => {
    const { client, updateUser, signOut } = fakeClient();
    expect(await completePasswordRecovery(client, "newpass12")).toEqual({ ok: true });
    expect(updateUser).toHaveBeenCalledWith({ password: "newpass12" });
    expect(signOut).toHaveBeenCalled();
  });

  it("does not sign out when the update failed", async () => {
    const { client, signOut } = fakeClient({ update: { error: { code: "weak_password" } } });
    const r = await completePasswordRecovery(client, "newpass12");
    expect(r).toMatchObject({ ok: false, field: "next" });
    expect(signOut).not.toHaveBeenCalled();
  });
});
