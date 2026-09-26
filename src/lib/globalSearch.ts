// Global Search — client side of `public.global_search()`.
//
// Authorization lives ENTIRELY in the database: the RPC is SECURITY
// INVOKER, so every table it reads is filtered by that table's own RLS
// for the signed-in user. This file only (a) calls the RPC with the
// query text as a bound parameter, and (b) maps returned rows to an
// in-app route. Nothing here decides who may see what.
import { supabase } from "./supabaseClient";
import { friendlyDbError } from "./supabaseErrors";
import type { UserRole } from "./types";
import { studyUrl, type StudyFocus } from "./study";
import { EVENT_TYPE_META, type PlannerEventType } from "./planner";

export type SearchType = "content" | "notes" | "formulas" | "tests" | "planner" | "announcements";

export const SEARCH_GROUPS: { type: SearchType; label: string; icon: string }[] = [
  { type: "content", label: "Content", icon: "📚" },
  { type: "notes", label: "Notes", icon: "📄" },
  { type: "formulas", label: "Formulas", icon: "🧮" },
  { type: "tests", label: "Tests", icon: "🧪" },
  { type: "planner", label: "Planner", icon: "📅" },
  { type: "announcements", label: "Announcements", icon: "📢" },
];

export const MIN_QUERY_LENGTH = 2;
export const PER_GROUP_LIMIT = 6;

export interface SearchResult {
  type: SearchType;
  id: string;
  title: string;
  preview: string | null;
  subjectName: string | null;
  unitName: string | null;
  topicName: string | null;
  sectionName: string | null;
  metadata: Record<string, unknown>;
  route: string;
}

interface RpcRow {
  result_type: SearchType;
  id: string;
  title: string;
  preview: string | null;
  subject_id: string | null;
  subject_name: string | null;
  unit_id: string | null;
  unit_name: string | null;
  topic_id: string | null;
  topic_name: string | null;
  section_name: string | null;
  meta: Record<string, unknown> | null;
}

const PREFIX: Record<UserRole, string> = { student: "/student", teacher: "/teacher", super_admin: "/admin" };

// Every route below already exists in App.tsx for that role — no new
// pages, no dead links.
type RouteRow = Pick<RpcRow, "result_type" | "id" | "subject_id"> & Partial<Pick<RpcRow, "unit_id" | "topic_id">>;

// For students, a Content / Note / Formula that belongs to a known
// subject + unit + topic opens Study Mode on that topic (focused on the
// matching section). The ids only say WHERE to navigate — Study Mode
// re-validates them in the database. Without a full hierarchy we fall
// back to the existing page rather than guessing a relationship.
export function routeFor(row: RouteRow, role: UserRole): string {
  const p = PREFIX[role];
  if (role === "student" && row.subject_id && row.unit_id && row.topic_id &&
      (row.result_type === "content" || row.result_type === "notes" || row.result_type === "formulas")) {
    return studyUrl({ subject: row.subject_id, unit: row.unit_id, topic: row.topic_id, focus: row.result_type as StudyFocus });
  }
  switch (row.result_type) {
    case "content":
      return role === "student" && row.subject_id ? `/student/subjects/${row.subject_id}?tab=content` : `${p}/content`;
    case "notes": return `${p}/notes`;
    case "formulas": return `${p}/formulas`;
    case "tests": return role === "student" ? `/student/tests/${row.id}` : `${p}/tests`;
    case "planner": return `${p}/planner?event=${row.id}`;
    case "announcements": return `${p}/announcements`;
  }
}

export async function runGlobalSearch(
  query: string,
  role: UserRole
): Promise<{ results: SearchResult[]; error: string | null }> {
  const q = query.trim();
  if (!supabase || q.length < MIN_QUERY_LENGTH) return { results: [], error: null };
  const { data, error } = await supabase.rpc("global_search", { p_query: q, p_limit: PER_GROUP_LIMIT });
  if (error) return { results: [], error: friendlyDbError(error, "search") };
  const results = ((data ?? []) as RpcRow[]).map((r) => ({
    type: r.result_type,
    id: r.id,
    title: r.title,
    preview: r.preview,
    subjectName: r.subject_name,
    unitName: r.unit_name,
    topicName: r.topic_name,
    sectionName: r.section_name,
    metadata: r.meta ?? {},
    route: routeFor(r, role),
  }));
  return { results, error: null };
}

// "Network Analysis • Unit 2" style context line, built only from fields
// the database actually returned.
export function contextLine(r: SearchResult): string {
  const parts: string[] = [];
  if (r.type === "planner") {
    const t = r.metadata.event_type as PlannerEventType | undefined;
    if (t && EVENT_TYPE_META[t]) parts.push(EVENT_TYPE_META[t].label);
  }
  if (r.type === "content" && typeof r.metadata.content_type === "string") parts.push(r.metadata.content_type);
  if (r.subjectName) parts.push(r.subjectName);
  if (r.unitName) parts.push(r.unitName);
  else if (r.topicName) parts.push(r.topicName);
  if ((r.type === "notes" || r.type === "planner") && r.sectionName) parts.push(`Section ${r.sectionName}`);
  if (r.type === "tests") {
    const n = r.metadata.question_count;
    if (typeof n === "number" && n > 0) parts.push(`${n} question${n === 1 ? "" : "s"}`);
    const d = r.metadata.duration_min;
    if (typeof d === "number") parts.push(`${d} min`);
  }
  if (r.type === "announcements" && typeof r.metadata.scope_type === "string" && r.metadata.scope_type !== "all") {
    parts.push(`${r.metadata.scope_type} announcement`);
  }
  return parts.join(" • ");
}
