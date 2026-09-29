import { useState, type FormEvent } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import {
  changeOwnPassword,
  validatePasswordChange,
  MIN_PASSWORD_LENGTH,
  type FieldErrors,
} from "../../lib/passwordChange";

// Shared by every role (student, teacher, super_admin) via ProfilePage.
// There is no user/email input anywhere in this form: it can only change
// the password of the account that is currently signed in.

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  error,
  hint,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  error?: string;
  hint?: string;
  disabled: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="block font-body text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative mt-1">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className="w-full rounded-md border border-line px-3 py-2 pr-16 text-sm text-ink focus:border-copper focus:outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-inkmuted hover:text-copper-dark"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-inkmuted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function ChangePasswordSection() {
  const { session } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Bumped after success so every field remounts with its visibility
  // toggle reset to hidden.
  const [resetKey, setResetKey] = useState(0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase || submitting) return;
    setSuccess(false);
    setFormError(null);

    const fieldErrors = validatePasswordChange({ current, next, confirm });
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setSubmitting(true);
    const result = await changeOwnPassword(supabase, session?.user.email, current, next);
    setSubmitting(false);

    if (!result.ok) {
      if (result.field) setErrors({ [result.field]: result.message });
      else setFormError(result.message);
      return;
    }

    setCurrent("");
    setNext("");
    setConfirm("");
    setErrors({});
    setResetKey((k) => k + 1);
    setSuccess(true);
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="space-y-4 rounded-lg border border-line bg-panel p-5"
      aria-labelledby="change-password-title"
    >
      <div>
        <p id="change-password-title" className="font-body text-sm font-medium text-ink">
          Change password
        </p>
        <p className="mt-1 text-xs text-inkmuted">
          Enter your current password, then choose a new one.
        </p>
      </div>

      <PasswordField
        key={`c-${resetKey}`}
        id="current-password"
        label="Current password"
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
        error={errors.current}
        disabled={submitting}
      />
      <PasswordField
        key={`n-${resetKey}`}
        id="new-password"
        label="New password"
        value={next}
        onChange={setNext}
        autoComplete="new-password"
        error={errors.next}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters, with a letter and a number.`}
        disabled={submitting}
      />
      <PasswordField
        key={`f-${resetKey}`}
        id="confirm-password"
        label="Confirm new password"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        error={errors.confirm}
        disabled={submitting}
      />

      {formError && (
        <p className="rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
          {formError}
        </p>
      )}
      {success && (
        <p className="rounded-md bg-trace-light px-3 py-2 text-sm text-trace-dark" role="status">
          Password changed successfully.
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark disabled:opacity-60 sm:w-auto"
      >
        {submitting ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}
