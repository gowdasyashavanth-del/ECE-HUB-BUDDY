import type { PostgrestError } from "@supabase/supabase-js";

// Translates the Postgres error codes our schema actually relies on
// into messages an admin can act on, instead of a raw SQL error string.
// The DATABASE is what actually prevents invalid data (unique
// constraints, FK restrict/cascade, check constraints) — this only
// makes that enforcement legible in the UI. Removing this file would
// not weaken validation at all, only the error message quality.
export function friendlyDbError(error: PostgrestError, entityLabel: string): string {
  switch (error.code) {
    case "23505": // unique_violation
      return `A ${entityLabel.toLowerCase()} with these details already exists in this context.`;
    case "23503": // foreign_key_violation
      if (error.message.includes("update or delete")) {
        return `This ${entityLabel.toLowerCase()} can't be deleted — other records (e.g. subjects, sections, or assignments) still depend on it. Remove those first.`;
      }
      return `That selection doesn't refer to a valid record. Please re-select and try again.`;
    case "23514": // check_violation
      return `That value isn't allowed for this field (it violates a database rule, such as semester range 1–8).`;
    case "42501": // insufficient_privilege (RLS denial)
      return `You don't have permission to do that.`;
    default:
      return error.message || "Something went wrong saving this record.";
  }
}
