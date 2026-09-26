// Study Mode — typed wrappers over the two read-only functions
// (study_outline, study_topic_context) and URL helpers.
//
// The URL (?subject=&unit=&topic=&focus=) is NAVIGATION STATE ONLY.
// Every id in it is re-checked by the database: the functions return
// nothing unless the signed-in student is enrolled in that subject, and
// every resource query below runs under the existing RLS. A guessed or
// edited id therefore yields the same "not found or unavailable" result
// as an id that doesn't exist.
import { supabase } from "./supabaseClient";
import { friendlyDbError } from "./supabaseErrors";

export type StudyFocus = "content" | "notes" | "formulas" | "tests";
const FOCUS: StudyFocus[] = ["content", "notes", "formulas", "tests"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const looksLikeUuid = (v: string | null | undefined): v is string => !!v && UUID_RE.test(v);
export const parseFocus = (v: string | null): StudyFocus | null => (FOCUS.includes(v as StudyFocus) ? (v as StudyFocus) : null);

export function studyUrl(p: { subject?: string | null; unit?: string | null; topic?: string | null; focus?: StudyFocus | null } = {}): string {
  const q = new URLSearchParams();
  if (p.subject) q.set("subject", p.subject);
  if (p.unit) q.set("unit", p.unit);
  if (p.topic) q.set("topic", p.topic);
  if (p.focus) q.set("focus", p.focus);
  const s = q.toString();
  return s ? `/student/study?${s}` : "/student/study";
}

export interface TopicContext {
  subject_id: string; subject_name: string; subject_code: string | null;
  unit_id: string; unit_name: string;
  topic_id: string; topic_name: string;
  progress_pct: number;
  prev_topic_id: string | null; prev_topic_name: string | null; prev_unit_id: string | null;
  next_topic_id: string | null; next_topic_name: string | null; next_unit_id: string | null;
}
export interface OutlineRow {
  unit_id: string; unit_name: string; unit_order: number;
  topic_id: string; topic_name: string; topic_order: number;
  progress_pct: number; content_total: number; content_done: number;
}

export async function getTopicContext(topicId: string): Promise<{ data: TopicContext | null; error: string | null }> {
  if (!supabase) return { data: null, error: "Not connected." };
  if (!looksLikeUuid(topicId)) return { data: null, error: null };
  const { data, error } = await supabase.rpc("study_topic_context", { p_topic_id: topicId });
  if (error) return { data: null, error: friendlyDbError(error, "this topic") };
  return { data: ((data ?? []) as TopicContext[])[0] ?? null, error: null };
}

export async function getOutline(subjectId: string): Promise<{ data: OutlineRow[]; error: string | null }> {
  if (!supabase) return { data: [], error: "Not connected." };
  if (!looksLikeUuid(subjectId)) return { data: [], error: null };
  const { data, error } = await supabase.rpc("study_outline", { p_subject_id: subjectId });
  if (error) return { data: [], error: friendlyDbError(error, "this subject") };
  return { data: (data ?? []) as OutlineRow[], error: null };
}

// Only http(s) links are ever opened from stored content URLs.
export function safeExternalUrl(u: string | null): string | null {
  if (!u) return null;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}
