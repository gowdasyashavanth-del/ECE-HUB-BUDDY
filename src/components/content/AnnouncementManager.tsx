import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { useAuth } from "../../contexts/AuthContext";
import { SCOPE_LABELS, resolveScopeLabels, scopeDisplay, type AnnouncementLike, type ScopeType } from "../../lib/announcementScope";
import { PageHeader } from "../ui/PageHeader";
import { LoadingState } from "../ui/LoadingState";
import { ErrorState } from "../ui/ErrorState";
import { EmptyState } from "../ui/EmptyState";
import { Badge } from "../ui/Badge";

interface Year { id: string; name: string; }
interface Reg { id: string; name: string; academic_year_id: string; }
interface Prog { id: string; name: string; regulation_id: string; }
interface Sem { id: string; number: number; program_id: string; }
interface Sect { id: string; name: string; semester_id: string; academic_year_id: string; }
interface TeacherSection { section_id: string; label: string; }
interface AnnouncementRow extends AnnouncementLike {
  title: string; body: string; created_at: string;
}

// Authorization is entirely RLS's job (announcements_select/_insert/
// _delete, unchanged since Phase 6/7) — this component never decides
// who can see or do what; it only decides which WIDGETS to show,
// which is a UX convenience, not a security boundary. A teacher who
// somehow got a request through with a different scope_type would
// still be rejected by announcements_insert's own check, regardless
// of what this form renders.
export function AnnouncementManager() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "super_admin";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<AnnouncementRow[]>([]);
  const [scopeLabels, setScopeLabels] = useState<Map<string, string>>(new Map());

  // Admin: full hierarchy reference data, fetched once.
  const [years, setYears] = useState<Year[]>([]);
  const [regs, setRegs] = useState<Reg[]>([]);
  const [programs, setPrograms] = useState<Prog[]>([]);
  const [semesters, setSemesters] = useState<Sem[]>([]);
  const [sections, setSections] = useState<Sect[]>([]);

  // Teacher: their own sections only, flat (they're already pre-scoped
  // by their assignments — no cascade needed).
  const [teacherSections, setTeacherSections] = useState<TeacherSection[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [fScopeType, setFScopeType] = useState<ScopeType>(isAdmin ? "all" : "section");
  const [fYearId, setFYearId] = useState("");
  const [fRegId, setFRegId] = useState("");
  const [fProgId, setFProgId] = useState("");
  const [fSemId, setFSemId] = useState("");
  const [fSectionId, setFSectionId] = useState("");
  const [fTitle, setFTitle] = useState("");
  const [fBody, setFBody] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rowActionError, setRowActionError] = useState<string | null>(null);

  async function loadAll() {
    if (!supabase || !profile) return;
    setLoadError(null);
    setLoading(true);

    if (isAdmin) {
      const [y, r, p, s, sec] = await Promise.all([
        supabase.from("academic_years").select("id, name").order("name"),
        supabase.from("regulations").select("id, name, academic_year_id"),
        supabase.from("programs").select("id, name, regulation_id"),
        supabase.from("semesters").select("id, number, program_id"),
        supabase.from("sections").select("id, name, semester_id, academic_year_id"),
      ]);
      const firstErr = [y, r, p, s, sec].find((res) => res.error);
      if (firstErr?.error) { setLoading(false); setLoadError(friendlyDbError(firstErr.error, "Academic structure")); return; }
      setYears(y.data ?? []); setRegs(r.data ?? []); setPrograms(p.data ?? []); setSemesters(s.data ?? []); setSections(sec.data ?? []);
    } else {
      // Both a subject-teaching relationship (teacher_assignments) and a
      // Class Teacher relationship (class_teacher_assignments) now let a
      // teacher post a section announcement (announcements_insert, fixed
      // in the 16G final pass) — so both sources feed this picker, not
      // just teacher_assignments alone.
      const [ta, cta] = await Promise.all([
        supabase
          .from("teacher_assignments")
          .select("section_id, sections(name, semesters(number, programs(name)))")
          .eq("teacher_id", profile.id),
        supabase
          .from("class_teacher_assignments")
          .select("section_id, sections(name, semesters(number, programs(name)))")
          .eq("teacher_id", profile.id)
          .eq("is_current", true),
      ]);
      if (ta.error || cta.error) { setLoading(false); setLoadError(friendlyDbError((ta.error || cta.error)!, "Your sections")); return; }
      const first = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
      const seen = new Set<string>();
      const list: TeacherSection[] = [];
      [...(ta.data ?? []), ...(cta.data ?? [])].forEach((r: any) => {
        if (seen.has(r.section_id)) return;
        seen.add(r.section_id);
        const sec = first<{ name: string; semesters: any }>(r.sections);
        const sem = sec ? first<{ number: number; programs: any }>(sec.semesters) : null;
        const prog = sem ? first<{ name: string }>(sem.programs) : null;
        list.push({ section_id: r.section_id, label: `${prog?.name ?? "—"} · Sem ${sem?.number ?? "—"} · Section ${sec?.name ?? "—"}` });
      });
      setTeacherSections(list);
    }

    // No manual scoping on this read at all — announcements_select RLS
    // already returns exactly what this session (admin: everything;
    // teacher: their own authored + relevant broader ones) is allowed
    // to see.
    const { data: annRows, error: annErr } = await supabase
      .from("announcements")
      .select("id, title, body, scope_type, scope_id, created_at")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (annErr) { setLoadError(friendlyDbError(annErr, "Announcements")); return; }
    setRows((annRows ?? []) as AnnouncementRow[]);
    setScopeLabels(await resolveScopeLabels((annRows ?? []) as AnnouncementLike[]));
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const filteredRegs = useMemo(() => regs.filter((r) => r.academic_year_id === fYearId), [regs, fYearId]);
  const filteredPrograms = useMemo(() => programs.filter((p) => p.regulation_id === fRegId), [programs, fRegId]);
  const filteredSemesters = useMemo(() => semesters.filter((s) => s.program_id === fProgId), [semesters, fProgId]);
  const filteredSections = useMemo(
    () => sections.filter((s) => s.semester_id === fSemId && s.academic_year_id === fYearId),
    [sections, fSemId, fYearId]
  );

  function openCreate() {
    setFScopeType(isAdmin ? "all" : "section");
    setFYearId(""); setFRegId(""); setFProgId(""); setFSemId(""); setFSectionId("");
    setFTitle(""); setFBody("");
    setFormError(null);
    setFormOpen(true);
  }

  function resetBelow(level: ScopeType) {
    if (level === "academic_year") { setFRegId(""); setFProgId(""); setFSemId(""); setFSectionId(""); }
    if (level === "regulation") { setFProgId(""); setFSemId(""); setFSectionId(""); }
    if (level === "program") { setFSemId(""); setFSectionId(""); }
    if (level === "semester") { setFSectionId(""); }
  }

  async function handleSubmit() {
    if (!supabase) return;
    setFormError(null);
    if (!fTitle.trim()) return setFormError("Title is required.");
    if (!fBody.trim()) return setFormError("Body is required.");

    let scopeId: string | null = null;
    if (!isAdmin) {
      // Teacher path: fixed to section, from their own assignments only.
      if (!fSectionId) return setFormError("Select a section.");
      scopeId = fSectionId;
    } else {
      if (fScopeType === "all") {
        scopeId = null;
      } else if (fScopeType === "academic_year") {
        if (!fYearId) return setFormError("Select an academic year.");
        scopeId = fYearId;
      } else if (fScopeType === "regulation") {
        if (!fRegId) return setFormError("Select a regulation.");
        scopeId = fRegId;
      } else if (fScopeType === "program") {
        if (!fProgId) return setFormError("Select a program.");
        scopeId = fProgId;
      } else if (fScopeType === "semester") {
        if (!fSemId) return setFormError("Select a semester.");
        scopeId = fSemId;
      } else if (fScopeType === "section") {
        if (!fSectionId) return setFormError("Select a section.");
        scopeId = fSectionId;
      }
    }

    setSaving(true);
    const { error } = await supabase.from("announcements").insert({
      title: fTitle.trim(),
      body: fBody.trim(),
      scope_type: isAdmin ? fScopeType : "section",
      scope_id: scopeId,
      created_by: profile?.id,
    });
    setSaving(false);
    if (error) { setFormError(friendlyDbError(error, "Announcement")); return; }
    setFormOpen(false);
    await loadAll();
  }

  async function handleDelete(row: AnnouncementRow) {
    if (!supabase) return;
    if (!window.confirm(`Delete announcement "${row.title}"?`)) return;
    setRowActionError(null);
    const { error } = await supabase.from("announcements").delete().eq("id", row.id);
    if (error) { setRowActionError(friendlyDbError(error, "Announcement")); return; }
    await loadAll();
  }

  const inputClass = "mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink focus:border-copper focus:outline-none disabled:bg-paper disabled:text-inkmuted";
  const dangerBtn = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-danger hover:border-danger";

  if (!profile) return null;

  return (
    <div>
      <PageHeader
        title="Announcements"
        subtitle={isAdmin ? "Post announcements at any scope, from platform-wide down to a single section." : "Post announcements for the sections you're assigned to."}
        action={<button onClick={openCreate} className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark">+ New Announcement</button>}
      />

      {loadError && <ErrorState message={loadError} onRetry={loadAll} />}
      {loading && !loadError && <LoadingState label="Loading announcements…" />}

      {!loading && !loadError && !isAdmin && teacherSections.length === 0 && (
        <EmptyState title="No sections assigned to you yet" message="Your Super Admin hasn't assigned you to any subject/section yet." />
      )}

      {!loading && !loadError && (isAdmin || teacherSections.length > 0) && (
        <>
          {formOpen && (
            <div className="mb-6 rounded-lg border border-line bg-panel p-5">
              <p className="mb-3 font-display text-sm font-semibold text-ink">New Announcement</p>

              {isAdmin ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-inkmuted">Scope</label>
                    <select
                      value={fScopeType}
                      onChange={(e) => { const v = e.target.value as ScopeType; setFScopeType(v); setFYearId(""); setFRegId(""); setFProgId(""); setFSemId(""); setFSectionId(""); }}
                      className={inputClass}
                    >
                      {(["all", "academic_year", "regulation", "program", "semester", "section"] as ScopeType[]).map((s) => (
                        <option key={s} value={s}>{SCOPE_LABELS[s]}</option>
                      ))}
                    </select>
                  </div>

                  {/* Only the dropdowns actually needed to reach the chosen scope level are shown. */}
                  {fScopeType !== "all" && (
                    <div className="mt-3">
                      <label className="block text-xs font-medium text-inkmuted">Academic Year</label>
                      <select value={fYearId} onChange={(e) => { setFYearId(e.target.value); resetBelow("academic_year"); }} className={inputClass}>
                        <option value="">Select…</option>
                        {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
                      </select>
                    </div>
                  )}
                  {["regulation", "program", "semester", "section"].includes(fScopeType) && (
                    <div className="mt-3">
                      <label className="block text-xs font-medium text-inkmuted">Regulation</label>
                      <select value={fRegId} disabled={!fYearId} onChange={(e) => { setFRegId(e.target.value); resetBelow("regulation"); }} className={inputClass}>
                        <option value="">{fYearId ? "Select…" : "Select academic year first"}</option>
                        {filteredRegs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </div>
                  )}
                  {["program", "semester", "section"].includes(fScopeType) && (
                    <div className="mt-3">
                      <label className="block text-xs font-medium text-inkmuted">Program</label>
                      <select value={fProgId} disabled={!fRegId} onChange={(e) => { setFProgId(e.target.value); resetBelow("program"); }} className={inputClass}>
                        <option value="">{fRegId ? "Select…" : "Select regulation first"}</option>
                        {filteredPrograms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  )}
                  {["semester", "section"].includes(fScopeType) && (
                    <div className="mt-3">
                      <label className="block text-xs font-medium text-inkmuted">Semester</label>
                      <select value={fSemId} disabled={!fProgId} onChange={(e) => { setFSemId(e.target.value); resetBelow("semester"); }} className={inputClass}>
                        <option value="">{fProgId ? "Select…" : "Select program first"}</option>
                        {filteredSemesters.map((s) => <option key={s.id} value={s.id}>Semester {s.number}</option>)}
                      </select>
                    </div>
                  )}
                  {fScopeType === "section" && (
                    <div className="mt-3">
                      <label className="block text-xs font-medium text-inkmuted">Section</label>
                      <select value={fSectionId} disabled={!fSemId} onChange={(e) => setFSectionId(e.target.value)} className={inputClass}>
                        <option value="">{fSemId ? "Select…" : "Select semester first"}</option>
                        {filteredSections.map((s) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
                      </select>
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Section</label>
                  <select value={fSectionId} onChange={(e) => setFSectionId(e.target.value)} className={inputClass}>
                    <option value="">Select one of your sections…</option>
                    {teacherSections.map((s) => <option key={s.section_id} value={s.section_id}>{s.label}</option>)}
                  </select>
                </div>
              )}

              <div className="mt-3">
                <label className="block text-xs font-medium text-inkmuted">Title</label>
                <input value={fTitle} onChange={(e) => setFTitle(e.target.value)} className={inputClass} />
              </div>
              <div className="mt-3">
                <label className="block text-xs font-medium text-inkmuted">Body</label>
                <textarea value={fBody} onChange={(e) => setFBody(e.target.value)} rows={3} className={inputClass} />
              </div>

              {formError && <p className="mt-3 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{formError}</p>}

              <div className="mt-4 flex gap-2">
                <button onClick={handleSubmit} disabled={saving} className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark disabled:opacity-60">
                  {saving ? "Posting…" : "Post Announcement"}
                </button>
                <button onClick={() => setFormOpen(false)} className="rounded-md border border-line px-4 py-2 text-sm text-ink hover:border-copper hover:text-copper-dark">Cancel</button>
              </div>
            </div>
          )}

          {rowActionError && <div className="mb-4"><ErrorState message={rowActionError} onRetry={() => setRowActionError(null)} /></div>}

          {rows.length === 0 && <EmptyState title="No announcements yet" message="Post your first announcement above." />}

          {rows.length > 0 && (
            <div className="space-y-3">
              {rows.map((row) => (
                <div key={row.id} className="rounded-lg border border-line bg-panel p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-ink">{row.title}</p>
                      <p className="mt-1 text-sm text-inkmuted">{row.body}</p>
                    </div>
                    {isAdmin && (
                      <button onClick={() => handleDelete(row)} className={dangerBtn}>Delete</button>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Badge tone="muted">{scopeDisplay(row, scopeLabels)}</Badge>
                    <span className="font-mono text-[10px] text-inkmuted">{new Date(row.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
