import { supabase } from "./supabaseClient";

// announcements.scope_id has no real FK — its meaning depends on
// scope_type (documented in 06_engagement_and_progress.sql: Postgres
// has no polymorphic FK constraint). So resolving a human-readable
// label for display requires a manual lookup per scope_type, not a
// Supabase embedded-resource select. This is purely a display concern
// — it has no bearing on authorization, which RLS already handles
// entirely on its own.
export const SCOPE_LEVELS = ["all", "academic_year", "regulation", "program", "semester", "section"] as const;
export type ScopeType = (typeof SCOPE_LEVELS)[number];

export const SCOPE_LABELS: Record<ScopeType, string> = {
  all: "All",
  academic_year: "Academic Year",
  regulation: "Regulation",
  program: "Program",
  semester: "Semester",
  section: "Section",
};

const SCOPE_TABLE: Record<Exclude<ScopeType, "all">, { table: string; select: string; label: (row: any) => string }> = {
  academic_year: { table: "academic_years", select: "id, name", label: (r) => r.name },
  regulation: { table: "regulations", select: "id, name", label: (r) => r.name },
  program: { table: "programs", select: "id, name", label: (r) => r.name },
  semester: { table: "semesters", select: "id, number", label: (r) => `Semester ${r.number}` },
  section: { table: "sections", select: "id, name", label: (r) => `Section ${r.name}` },
};

export interface AnnouncementLike {
  id: string;
  scope_type: string;
  scope_id: string | null;
}

// Given a list of announcements, resolves a display label for each
// one's scope in as few queries as possible (one per scope_type
// actually present, not one per row).
export async function resolveScopeLabels(rows: AnnouncementLike[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (!supabase) return labels;

  const byType = new Map<string, Set<string>>();
  rows.forEach((r) => {
    if (r.scope_type === "all" || !r.scope_id) return;
    if (!byType.has(r.scope_type)) byType.set(r.scope_type, new Set());
    byType.get(r.scope_type)!.add(r.scope_id);
  });

  for (const [scopeType, ids] of byType) {
    const cfg = SCOPE_TABLE[scopeType as Exclude<ScopeType, "all">];
    if (!cfg) continue;
    const { data } = await supabase.from(cfg.table).select(cfg.select).in("id", Array.from(ids));
    (data ?? []).forEach((row: any) => labels.set(`${scopeType}:${row.id}`, cfg.label(row)));
  }

  return labels;
}

export function scopeDisplay(row: AnnouncementLike, labels: Map<string, string>): string {
  if (row.scope_type === "all") return "All";
  const resolved = row.scope_id ? labels.get(`${row.scope_type}:${row.scope_id}`) : null;
  return resolved ?? `${SCOPE_LABELS[row.scope_type as ScopeType] ?? row.scope_type} (unknown)`;
}
