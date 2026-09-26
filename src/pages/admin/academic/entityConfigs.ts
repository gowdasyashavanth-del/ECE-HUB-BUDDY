// Config-driven definitions for the 8 academic-hierarchy entities the
// Super Admin manages. One generic component (AcademicEntityManager)
// reads these instead of 8 hand-duplicated CRUD pages — the entities
// share the same shape (id, a few fields, 1-2 parent FKs, timestamps),
// so the duplication would be real technical debt, not a shortcut.
//
// Deliberately NOT here: Branches. There is no `branches` table and no
// branch concept anywhere in the approved schema — flagged separately,
// not silently included.

export type FieldType = "text" | "number";

export interface FieldConfig {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  min?: number;
  max?: number;
  placeholder?: string;
}

export interface ParentConfig {
  key: string; // FK column on this entity, e.g. "academic_year_id"
  label: string; // shown in the form, e.g. "Academic Year"
  table: string; // parent table to query for dropdown options
  optionsSelect: string; // select clause for fetching dropdown options
  optionLabel: (row: any) => string; // how to render each dropdown option
}

export interface EntityConfig {
  key: string; // URL segment
  table: string;
  titleSingular: string;
  titlePlural: string;
  subtitle: string;
  listSelect: string; // select clause including joined parent names
  orderBy: string;
  parents: ParentConfig[];
  fields: FieldConfig[];
  renderParentChain: (row: any) => string;
  hasIsCurrentToggle?: boolean; // academic_years only
  hasIsActiveToggle?: boolean; // regulations, programs
  deleteConfirmMessage: (row: any) => string;
  // Subjects/Units/Topics CASCADE-delete into Units/Topics/Content —
  // and, for Subjects, further into formulas, teacher_assignments,
  // tests, and (via Units→Topics) content, questions, progress, and
  // experiments too. That's far more destructive than these entities'
  // own delete-confirm text ever described, and violates "preserve
  // referential integrity for content/formulas/questions/tests/
  // results". Academic Years/Regulations/Programs/Semesters/Sections
  // are all ON DELETE RESTRICT instead — deleting one is either a
  // genuine no-op-safe removal (nothing depends on it yet) or a clean,
  // friendly-messaged refusal — so only those keep a Delete action.
  disableDelete?: boolean;
}

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export const ENTITY_CONFIGS: Record<string, EntityConfig> = {
  "academic-years": {
    key: "academic-years",
    table: "academic_years",
    titleSingular: "Academic Year",
    titlePlural: "Academic Years",
    subtitle: "The top level of the academic hierarchy, e.g. 2026–27.",
    listSelect: "id, name, is_current, created_at",
    orderBy: "name",
    parents: [],
    fields: [{ key: "name", label: "Name", type: "text", required: true, placeholder: "e.g. 2026-27" }],
    renderParentChain: () => "—",
    hasIsCurrentToggle: true,
    deleteConfirmMessage: (row) => `Delete academic year "${row.name}"? This is only possible if no regulations exist under it.`,
  },

  regulations: {
    key: "regulations",
    table: "regulations",
    titleSingular: "Regulation",
    titlePlural: "Regulations",
    subtitle: "A syllabus version, scoped to an academic year.",
    listSelect: "id, name, is_active, created_at, academic_years(name)",
    orderBy: "name",
    parents: [
      {
        key: "academic_year_id",
        label: "Academic Year",
        table: "academic_years",
        optionsSelect: "id, name",
        optionLabel: (r) => r.name,
      },
    ],
    fields: [{ key: "name", label: "Name", type: "text", required: true, placeholder: "e.g. 2026 Regulation" }],
    renderParentChain: (row) => first<{ name: string }>(row.academic_years)?.name ?? "—",
    hasIsActiveToggle: true,
    deleteConfirmMessage: (row) => `Delete regulation "${row.name}"? This is only possible if no programs exist under it.`,
  },

  programs: {
    key: "programs",
    table: "programs",
    titleSingular: "Program",
    titlePlural: "Programs",
    subtitle: "A degree program, scoped to a regulation. Not hardcoded — add/rename freely.",
    listSelect: "id, name, code, is_active, created_at, regulations(name)",
    orderBy: "name",
    parents: [
      {
        key: "regulation_id",
        label: "Regulation",
        table: "regulations",
        optionsSelect: "id, name",
        optionLabel: (r) => r.name,
      },
    ],
    fields: [
      { key: "name", label: "Name", type: "text", required: true, placeholder: "e.g. B.E. Electronics & Communication Engineering" },
      { key: "code", label: "Code", type: "text", placeholder: "e.g. ECE" },
    ],
    renderParentChain: (row) => first<{ name: string }>(row.regulations)?.name ?? "—",
    hasIsActiveToggle: true,
    deleteConfirmMessage: (row) => `Delete program "${row.name}"? This is only possible if no semesters exist under it.`,
  },

  semesters: {
    key: "semesters",
    table: "semesters",
    titleSingular: "Semester",
    titlePlural: "Semesters",
    subtitle: "Semester 1–8, scoped to a program.",
    listSelect: "id, number, name, created_at, programs(name)",
    orderBy: "number",
    parents: [
      {
        key: "program_id",
        label: "Program",
        table: "programs",
        optionsSelect: "id, name",
        optionLabel: (r) => r.name,
      },
    ],
    fields: [
      { key: "number", label: "Semester Number (1–8)", type: "number", required: true, min: 1, max: 8 },
      { key: "name", label: "Display Name (optional)", type: "text", placeholder: "e.g. Semester 3" },
    ],
    renderParentChain: (row) => first<{ name: string }>(row.programs)?.name ?? "—",
    deleteConfirmMessage: (row) => `Delete Semester ${row.number}? This is only possible if no sections or subjects exist under it.`,
  },

  sections: {
    key: "sections",
    table: "sections",
    titleSingular: "Section",
    titlePlural: "Sections",
    subtitle: "A section within a semester, for a specific academic year's offering.",
    listSelect: "id, name, created_at, semesters(number, programs(name)), academic_years(name)",
    orderBy: "name",
    parents: [
      {
        key: "semester_id",
        label: "Semester",
        table: "semesters",
        optionsSelect: "id, number, programs(name)",
        optionLabel: (r) => `Sem ${r.number} — ${first<{ name: string }>(r.programs)?.name ?? ""}`,
      },
      {
        key: "academic_year_id",
        label: "Academic Year",
        table: "academic_years",
        optionsSelect: "id, name",
        optionLabel: (r) => r.name,
      },
    ],
    fields: [{ key: "name", label: "Section Name", type: "text", required: true, placeholder: "e.g. A" }],
    renderParentChain: (row) => {
      const sem = first<{ number: number; programs: any }>(row.semesters);
      const year = first<{ name: string }>(row.academic_years);
      const prog = sem ? first<{ name: string }>(sem.programs) : null;
      return `${prog?.name ?? "—"} · Sem ${sem?.number ?? "—"} · ${year?.name ?? "—"}`;
    },
    deleteConfirmMessage: (row) => `Delete section "${row.name}"? This is only possible if no students are currently assigned to it.`,
  },

  subjects: {
    key: "subjects",
    table: "subjects",
    titleSingular: "Subject",
    titlePlural: "Subjects",
    subtitle: "A subject taught within a semester.",
    listSelect: "id, name, code, credits, order_number, created_at, semesters(number, programs(name))",
    orderBy: "order_number",
    parents: [
      {
        key: "semester_id",
        label: "Semester",
        table: "semesters",
        optionsSelect: "id, number, programs(name)",
        optionLabel: (r) => `Sem ${r.number} — ${first<{ name: string }>(r.programs)?.name ?? ""}`,
      },
    ],
    fields: [
      { key: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Network Analysis" },
      { key: "code", label: "Code", type: "text", placeholder: "e.g. EC301" },
      { key: "credits", label: "Credits", type: "number", min: 0 },
      { key: "order_number", label: "Display Order", type: "number", min: 0 },
    ],
    renderParentChain: (row) => {
      const sem = first<{ number: number; programs: any }>(row.semesters);
      return `${first<{ name: string }>(sem?.programs)?.name ?? "—"} · Sem ${sem?.number ?? "—"}`;
    },
    disableDelete: true,
    deleteConfirmMessage: (row) => `Delete subject "${row.name}"? This will also delete all Units and Topics under it — this cannot be undone.`,
  },

  units: {
    key: "units",
    table: "units",
    titleSingular: "Unit",
    titlePlural: "Units",
    subtitle: "A unit within a subject.",
    listSelect: "id, name, order_number, created_at, subjects(name)",
    orderBy: "order_number",
    parents: [
      {
        key: "subject_id",
        label: "Subject",
        table: "subjects",
        optionsSelect: "id, name",
        optionLabel: (r) => r.name,
      },
    ],
    fields: [
      { key: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Unit 1" },
      { key: "order_number", label: "Display Order", type: "number", min: 0 },
    ],
    renderParentChain: (row) => first<{ name: string }>(row.subjects)?.name ?? "—",
    disableDelete: true,
    deleteConfirmMessage: (row) => `Delete unit "${row.name}"? This will also delete all Topics under it — this cannot be undone.`,
  },

  topics: {
    key: "topics",
    table: "topics",
    titleSingular: "Topic",
    titlePlural: "Topics",
    subtitle: "A topic within a unit — the finest grain before content itself.",
    listSelect: "id, name, order_number, created_at, units(name, subjects(name))",
    orderBy: "order_number",
    parents: [
      {
        key: "unit_id",
        label: "Unit",
        table: "units",
        optionsSelect: "id, name, subjects(name)",
        optionLabel: (r) => `${r.name} (${first<{ name: string }>(r.subjects)?.name ?? ""})`,
      },
    ],
    fields: [
      { key: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Circuit Laws" },
      { key: "order_number", label: "Display Order", type: "number", min: 0 },
    ],
    renderParentChain: (row) => {
      const unit = first<{ name: string; subjects: any }>(row.units);
      return `${first<{ name: string }>(unit?.subjects)?.name ?? "—"} · ${unit?.name ?? "—"}`;
    },
    disableDelete: true,
    deleteConfirmMessage: (row) => `Delete topic "${row.name}"? This is permanent.`,
  },
};

export const ACADEMIC_NAV_ORDER = [
  "academic-years", "regulations", "programs", "semesters", "sections", "subjects", "units", "topics",
];
