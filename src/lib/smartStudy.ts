// Smart Study — data layer only (Phase 5.1). There is no UI yet.
//
// Calls the read-only database function `smart_study_overview`. The
// database derives the student from auth.uid(), applies the existing RLS,
// scores and orders the recommendations, and writes the human-readable
// reason. This file:
//   • never sends a student id, a clock value, or anything except `p_limit`
//   • never caches or stores recommendations (no localStorage/sessionStorage)
//   • turns each recommendation's `action_type` into one of the app's
//     EXISTING routes — and returns null instead of guessing when a needed
//     id is missing or malformed.
import { supabase } from "./supabaseClient";
import { friendlyDbError } from "./supabaseErrors";
import { looksLikeUuid, studyUrl } from "./study";

export type SmartStudyCategory = "DEADLINE" | "TEST" | "CONTENT" | "REVIEW" | "CONTINUE" | "EXPLORE";
export type SmartStudyPriority = "high" | "medium" | "low";
export type SmartStudyAction = "study_topic" | "open_content" | "open_test" | "open_note" | "open_formula" | "open_planner_event";

const CATEGORIES: SmartStudyCategory[] = ["DEADLINE", "TEST", "CONTENT", "REVIEW", "CONTINUE", "EXPLORE"];
const ACTIONS: SmartStudyAction[] = ["study_topic", "open_content", "open_test", "open_note", "open_formula", "open_planner_event"];
const PRIORITIES: SmartStudyPriority[] = ["high", "medium", "low"];

export const DEFAULT_LIMIT = 5;
export const MAX_LIMIT = 10;

export interface SmartStudyRecommendation {
  rec_id: string;
  category: SmartStudyCategory;
  priority: SmartStudyPriority;
  priority_score: number;
  title: string;
  reason: string;
  reason_code: string;
  details: Record<string, unknown>;
  subject_id: string | null;
  subject_name: string | null;
  unit_id: string | null;
  topic_id: string | null;
  topic_name: string | null;
  planner_event_id: string | null;
  test_id: string | null;
  content_id: string | null;
  note_id: string | null;
  formula_id: string | null;
  due_at: string | null;
  action_type: SmartStudyAction;
  action_target: string;
}

export async function getSmartStudy(limit: number = DEFAULT_LIMIT): Promise<{ data: SmartStudyRecommendation[]; error: string | null }> {
  if (!supabase) return { data: [], error: "Not connected." };
  const p_limit = Math.min(Math.max(Math.trunc(Number.isFinite(limit) ? limit : DEFAULT_LIMIT), 1), MAX_LIMIT);
  const { data, error } = await supabase.rpc("smart_study_overview", { p_limit });
  if (error) return { data: [], error: friendlyDbError(error, "your study suggestions") };
  const rows = ((data ?? []) as SmartStudyRecommendation[])
    // Defensive: ignore anything the UI doesn't know how to act on.
    .filter((r) => CATEGORIES.includes(r.category) && ACTIONS.includes(r.action_type) && PRIORITIES.includes(r.priority) && looksLikeUuid(r.action_target))
    .map((r) => ({ ...r, priority_score: Number(r.priority_score), details: r.details ?? {} }));
  return { data: rows, error: null };
}

// Maps a recommendation's action to an existing route. The ids come from
// the database's own answer; the destination pages still re-check access.
export function actionRoute(rec: Pick<SmartStudyRecommendation, "action_type" | "action_target" | "subject_id" | "unit_id" | "topic_id">): string | null {
  const study = (focus?: "content" | "notes" | "formulas") =>
    looksLikeUuid(rec.topic_id) ? studyUrl({ subject: looksLikeUuid(rec.subject_id) ? rec.subject_id : null, unit: looksLikeUuid(rec.unit_id) ? rec.unit_id : null, topic: rec.topic_id, focus }) : null;
  switch (rec.action_type) {
    case "study_topic": return study();
    case "open_content": return study("content");
    case "open_note": return study("notes");
    case "open_formula": return study("formulas");
    case "open_test": return looksLikeUuid(rec.action_target) ? `/student/tests/${rec.action_target}` : null;
    case "open_planner_event": return looksLikeUuid(rec.action_target) ? `/student/planner?event=${rec.action_target}` : null;
    default: return null;
  }
}
