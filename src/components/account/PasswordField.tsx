import { useState } from "react";

// Shared by ChangePasswordSection (Profile) and ResetPasswordPage
// (recovery link) — one show/hide password input, so both forms stay
// visually and behaviorally identical.
export function PasswordField({
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
