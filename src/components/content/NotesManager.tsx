import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader } from "../ui/PageHeader";
import { LoadingState } from "../ui/LoadingState";
import { ErrorState } from "../ui/ErrorState";
import { EmptyState } from "../ui/EmptyState";

interface SectionRow { id: string; name: string; semester_id: string; semesterNumber: number | null; }
interface SubjectRow { id: string; name: string; code: string | null; semester_id: string; }
interface UnitRow { id: string; name: string; subject_id: string; }
interface TopicRow { id: string; name: string; unit_id: string; }
interface NoteRow {
  id: string; section_id: string; subject_id: string; topic_id: string;
  title: string; file_path: string; file_size_bytes: number | null;
  uploaded_by_name: string | null; uploaded_by_role: string | null; created_at: string;
}
interface Pair { sectionId: string; subjectId: string; }

// Notes live in the SAME private `content-files` bucket as the rest of
// Learning Content, under a distinct `notes/` path prefix:
//   notes/{section_id}/{subject_id}/{topic_id}/{uuid}-{filename}.pdf
// Every read/write against that prefix is gated by the notes_manager()/
// notes_viewer() DB functions (see the Notes Module migration) — this
// component's own filtering below is a UX convenience only, same
// relationship ContentManager already has with the generic `content`
// table's RLS.
const BUCKET = "content-files";
const MAX_BYTES = 50 * 1024 * 1024;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function formatBytes(n: number | null): string {
  if (!n) return "—";
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

// One component, used at both /admin/notes and /teacher/notes.
// Admin: every section/subject combination is offered (subject to the
// two belonging to the same semester). Teacher: only the exact
// section+subject combinations they're actually assigned to
// (teacher_assignments), plus — for any section where they are the
// CURRENT class teacher — every subject in that section's semester.
// This filtering is UX only; the database re-checks the identical
// authorization (notes_manager()) on every write regardless.
export function NotesManager() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "super_admin";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [pairs, setPairs] = useState<Pair[]>([]); // teacher-only: allowed (section,subject) combos
  const [classTeacherSectionIds, setClassTeacherSectionIds] = useState<string[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);

  const [filterSectionId, setFilterSectionId] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fSectionId, setFSectionId] = useState("");
  const [fSubjectId, setFSubjectId] = useState("");
  const [fUnitId, setFUnitId] = useState("");
  const [fTopicId, setFTopicId] = useState("");
  const [fTitle, setFTitle] = useState("");
  const [fFile, setFFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadLabel, setUploadLabel] = useState<string | null>(null);
  const [rowActionError, setRowActionError] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  async function loadAll() {
    if (!supabase || !profile) return;
    setLoadError(null);
    setLoading(true);

    if (isAdmin) {
      const [secRes, subRes] = await Promise.all([
        supabase.from("sections").select("id, name, semester_id, semesters(number)").order("name"),
        supabase.from("subjects").select("id, name, code, semester_id").order("name"),
      ]);
      if (secRes.error) { setLoading(false); setLoadError(friendlyDbError(secRes.error, "Sections")); return; }
      if (subRes.error) { setLoading(false); setLoadError(friendlyDbError(subRes.error, "Subjects")); return; }
      const first = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
      setSections((secRes.data ?? []).map((r: any) => ({
        id: r.id, name: r.name, semester_id: r.semester_id,
        semesterNumber: first<{ number: number }>(r.semesters)?.number ?? null,
      })));
      setSubjects((subRes.data ?? []) as SubjectRow[]);
      setPairs([]);
      setClassTeacherSectionIds([]);
    } else {
      const first = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
      const [taRes, ctRes] = await Promise.all([
        supabase.from("teacher_assignments")
          .select("section_id, subject_id, sections(name, semester_id, semesters(number)), subjects(name, code, semester_id)")
          .eq("teacher_id", profile.id),
        supabase.from("class_teacher_assignments")
          .select("section_id, sections(name, semester_id, semesters(number))")
          .eq("teacher_id", profile.id).eq("is_current", true),
      ]);
      if (taRes.error) { setLoading(false); setLoadError(friendlyDbError(taRes.error, "Your assignments")); return; }
      if (ctRes.error) { setLoading(false); setLoadError(friendlyDbError(ctRes.error, "Your class-teacher sections")); return; }

      const sectionMap = new Map<string, SectionRow>();
      const subjectMap = new Map<string, SubjectRow>();
      const directPairs: Pair[] = [];
      for (const r of (taRes.data ?? []) as any[]) {
        const sec = first<any>(r.sections);
        const sub = first<any>(r.subjects);
        if (sec) sectionMap.set(r.section_id, { id: r.section_id, name: sec.name, semester_id: sec.semester_id, semesterNumber: first<{ number: number }>(sec.semesters)?.number ?? null });
        if (sub) subjectMap.set(r.subject_id, { id: r.subject_id, name: sub.name, code: sub.code, semester_id: sub.semester_id });
        directPairs.push({ sectionId: r.section_id, subjectId: r.subject_id });
      }
      const ctSectionIds: string[] = [];
      for (const r of (ctRes.data ?? []) as any[]) {
        const sec = first<any>(r.sections);
        if (sec) sectionMap.set(r.section_id, { id: r.section_id, name: sec.name, semester_id: sec.semester_id, semesterNumber: first<{ number: number }>(sec.semesters)?.number ?? null });
        ctSectionIds.push(r.section_id);
      }
      setClassTeacherSectionIds(ctSectionIds);

      // Class-teacher sections can use ANY subject in that section's
      // semester — fetch those subjects too, same as notes_manager()
      // grants server-side.
      const ctSemesterIds = Array.from(new Set(
        ctSectionIds.map((id) => sectionMap.get(id)?.semester_id).filter((v): v is string => !!v)
      ));
      if (ctSemesterIds.length > 0) {
        const { data: semSubjects, error: semSubErr } = await supabase
          .from("subjects").select("id, name, code, semester_id").in("semester_id", ctSemesterIds);
        if (semSubErr) { setLoading(false); setLoadError(friendlyDbError(semSubErr, "Subjects")); return; }
        for (const s of semSubjects ?? []) subjectMap.set(s.id, s as SubjectRow);
      }

      setSections(Array.from(sectionMap.values()));
      setSubjects(Array.from(subjectMap.values()));
      setPairs(directPairs);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, isAdmin]);

  // Second pass: units/topics/notes for whichever sections we ended up
  // with (kept separate so re-running it doesn't require re-fetching
  // the section/subject pool above).
  async function loadUnitsTopicsNotes() {
    if (!supabase || subjects.length === 0) { setUnits([]); setTopics([]); setNotes([]); return; }
    const subjectIds = subjects.map((s) => s.id);
    const { data: unitRows, error: unitErr } = await supabase.from("units").select("id, name, subject_id").in("subject_id", subjectIds);
    if (unitErr) { setLoadError(friendlyDbError(unitErr, "Units")); return; }
    setUnits(unitRows ?? []);

    const unitIds = (unitRows ?? []).map((u) => u.id);
    let topicRows: TopicRow[] = [];
    if (unitIds.length > 0) {
      const { data, error } = await supabase.from("topics").select("id, name, unit_id").in("unit_id", unitIds);
      if (error) { setLoadError(friendlyDbError(error, "Chapters")); return; }
      topicRows = data ?? [];
    }
    setTopics(topicRows);

    const sectionIds = sections.map((s) => s.id);
    if (sectionIds.length === 0) { setNotes([]); return; }
    const { data: noteRows, error: noteErr } = await supabase
      .from("notes")
      .select("id, section_id, subject_id, topic_id, title, file_path, file_size_bytes, uploaded_by_name, uploaded_by_role, created_at")
      .in("section_id", sectionIds)
      .order("created_at", { ascending: false });
    if (noteErr) { setLoadError(friendlyDbError(noteErr, "Notes")); return; }
    setNotes((noteRows ?? []) as NoteRow[]);
  }

  useEffect(() => {
    if (!loading) loadUnitsTopicsNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, sections, subjects]);

  const allowedSubjectsForSection = (sectionId: string): SubjectRow[] => {
    if (!sectionId) return [];
    if (isAdmin) {
      const sec = sections.find((s) => s.id === sectionId);
      return sec ? subjects.filter((sub) => sub.semester_id === sec.semester_id) : [];
    }
    if (classTeacherSectionIds.includes(sectionId)) {
      const sec = sections.find((s) => s.id === sectionId);
      return sec ? subjects.filter((sub) => sub.semester_id === sec.semester_id) : [];
    }
    const subjectIds = new Set(pairs.filter((p) => p.sectionId === sectionId).map((p) => p.subjectId));
    return subjects.filter((s) => subjectIds.has(s.id));
  };

  const sectionsForPicker = useMemo(() => {
    if (isAdmin) return sections;
    const ids = new Set<string>([...pairs.map((p) => p.sectionId), ...classTeacherSectionIds]);
    return sections.filter((s) => ids.has(s.id));
  }, [sections, pairs, classTeacherSectionIds, isAdmin]);

  const unitsForSubject = (subjectId: string) => units.filter((u) => u.subject_id === subjectId);
  const topicsForUnit = (unitId: string) => topics.filter((t) => t.unit_id === unitId);

  function sectionLabel(id: string): string {
    const s = sections.find((x) => x.id === id);
    if (!s) return "—";
    return s.semesterNumber ? `Sem ${s.semesterNumber} · Section ${s.name}` : `Section ${s.name}`;
  }
  function subjectLabel(id: string): string {
    return subjects.find((s) => s.id === id)?.name ?? "—";
  }
  function topicLabel(id: string): string {
    return topics.find((t) => t.id === id)?.name ?? "—";
  }

  const visibleNotes = useMemo(() => {
    if (!filterSectionId) return notes;
    return notes.filter((n) => n.section_id === filterSectionId);
  }, [notes, filterSectionId]);

  function openCreate() {
    setEditingId(null);
    setFSectionId(""); setFSubjectId(""); setFUnitId(""); setFTopicId("");
    setFTitle(""); setFFile(null);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(row: NoteRow) {
    const topic = topics.find((t) => t.id === row.topic_id);
    setEditingId(row.id);
    setFSectionId(row.section_id);
    setFSubjectId(row.subject_id);
    setFUnitId(topic?.unit_id ?? "");
    setFTopicId(row.topic_id);
    setFTitle(row.title);
    setFFile(null);
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit() {
    if (!supabase || !profile) return;
    setFormError(null);
    if (!editingId) {
      if (!fSectionId) return setFormError("Select a section.");
      if (!fSubjectId) return setFormError("Select a subject.");
      if (!fTopicId) return setFormError("Select a chapter.");
    }
    if (!fTitle.trim()) return setFormError("Title is required.");
    if (!editingId && !fFile) return setFormError("Choose a PDF file to upload.");

    if (fFile) {
      if (fFile.type !== "application/pdf") return setFormError("Notes must be a PDF file.");
      if (fFile.size > MAX_BYTES) return setFormError("File is too large — the limit is 50MB.");
    }

    setSaving(true);
    setUploadLabel(null);

    if (editingId) {
      const existing = notes.find((n) => n.id === editingId);
      if (!existing) { setSaving(false); setFormError("Note not found."); return; }

      let file_path = existing.file_path;
      let file_size_bytes = existing.file_size_bytes;
      let newPath: string | null = null;
      if (fFile) {
        setUploadLabel("Uploading replacement file…");
        newPath = `notes/${existing.section_id}/${existing.subject_id}/${existing.topic_id}/${crypto.randomUUID()}-${sanitizeFilename(fFile.name)}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(newPath, fFile, { contentType: "application/pdf", upsert: false });
        if (upErr) { setSaving(false); setUploadLabel(null); setFormError(`Upload failed: ${upErr.message}`); return; }
        file_path = newPath;
        file_size_bytes = fFile.size;
      }
      const { error } = await supabase.from("notes").update({ title: fTitle.trim(), file_path, file_size_bytes }).eq("id", editingId);
      setSaving(false);
      setUploadLabel(null);
      if (error) {
        // Row update failed — clean up the just-uploaded replacement
        // (not the still-referenced original) so no orphaned file is
        // left behind, and the note row keeps pointing at a file that
        // actually exists.
        if (newPath) await supabase.storage.from(BUCKET).remove([newPath]);
        setFormError(friendlyDbError(error, "Notes"));
        return;
      }
      // Only delete the OLD file once the row is confirmed pointing at
      // the new one — deleting it earlier risked leaving the note
      // pointing at a file that no longer exists if this update had
      // failed.
      if (newPath) await supabase.storage.from(BUCKET).remove([existing.file_path]);
    } else {

      setUploadLabel("Uploading file…");
      const path = `notes/${fSectionId}/${fSubjectId}/${fTopicId}/${crypto.randomUUID()}-${sanitizeFilename(fFile!.name)}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, fFile!, { contentType: "application/pdf", upsert: false });
      if (upErr) { setSaving(false); setUploadLabel(null); setFormError(`Upload failed: ${upErr.message}`); return; }

      const { error } = await supabase.from("notes").insert({
        section_id: fSectionId, subject_id: fSubjectId, topic_id: fTopicId,
        title: fTitle.trim(), file_path: path, file_size_bytes: fFile!.size,
        uploaded_by: profile.id,
      });
      setSaving(false);
      setUploadLabel(null);
      if (error) {
        // Row rejected (e.g. RLS/trigger) — clean up the orphaned file.
        await supabase.storage.from(BUCKET).remove([path]);
        setFormError(friendlyDbError(error, "Notes"));
        return;
      }
    }

    setFormOpen(false);
    await loadUnitsTopicsNotes();
  }

  async function handleDelete(row: NoteRow) {
    if (!supabase) return;
    if (!window.confirm(`Delete "${row.title}"? This cannot be undone.`)) return;
    setRowActionError(null);
    const { error } = await supabase.from("notes").delete().eq("id", row.id);
    if (error) { setRowActionError(friendlyDbError(error, "Notes")); return; }
    await supabase.storage.from(BUCKET).remove([row.file_path]);
    await loadUnitsTopicsNotes();
  }

  async function handleView(row: NoteRow) {
    if (!supabase) return;
    setRowActionError(null);
    setViewingId(row.id);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(row.file_path, 3600);
    setViewingId(null);
    if (error || !data?.signedUrl) { setRowActionError("Couldn't open this file. Please try again."); return; }
    window.open(data.signedUrl, "_blank", "noreferrer");
  }

  const selectClass = "mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink focus:border-copper focus:outline-none disabled:bg-paper disabled:text-inkmuted";
  const ghostBtn = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-copper hover:text-copper-dark";
  const dangerBtn = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-danger hover:border-danger";

  if (!profile) return null;

  return (
    <div>
      <PageHeader
        title="Notes"
        subtitle={isAdmin ? "Manage PDF notes across every section and subject." : "Manage PDF notes for the sections/subjects you're authorized for."}
        action={
          sectionsForPicker.length > 0 ? (
            <button onClick={openCreate} className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark">
              + Add Note
            </button>
          ) : undefined
        }
      />

      {loadError && <ErrorState message={loadError} onRetry={loadAll} />}
      {loading && !loadError && <LoadingState label="Loading notes…" />}

      {!loading && !loadError && sectionsForPicker.length === 0 && (
        <EmptyState
          title={isAdmin ? "No sections exist yet" : "No sections assigned to you yet"}
          message={isAdmin ? "Create sections under Academic Management first." : "You'll see this once you're assigned as a subject or class teacher for a section."}
        />
      )}

      {!loading && !loadError && sectionsForPicker.length > 0 && (
        <>
          <div className="mb-4">
            <label className="block text-xs font-medium text-inkmuted">Filter by section</label>
            <select value={filterSectionId} onChange={(e) => setFilterSectionId(e.target.value)} className={`${selectClass} max-w-xs`}>
              <option value="">All sections</option>
              {sectionsForPicker.map((s) => <option key={s.id} value={s.id}>{sectionLabel(s.id)}</option>)}
            </select>
          </div>

          {formOpen && (
            <div className="mb-6 rounded-lg border border-line bg-panel p-5">
              <p className="mb-3 font-display text-sm font-semibold text-ink">{editingId ? "Replace / Edit Note" : "New Note"}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Section</label>
                  <select
                    value={fSectionId}
                    disabled={!!editingId}
                    onChange={(e) => { setFSectionId(e.target.value); setFSubjectId(""); setFUnitId(""); setFTopicId(""); }}
                    className={selectClass}
                  >
                    <option value="">Select…</option>
                    {sectionsForPicker.map((s) => <option key={s.id} value={s.id}>{sectionLabel(s.id)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Subject</label>
                  <select
                    value={fSubjectId}
                    disabled={!!editingId || !fSectionId}
                    onChange={(e) => { setFSubjectId(e.target.value); setFUnitId(""); setFTopicId(""); }}
                    className={selectClass}
                  >
                    <option value="">{fSectionId ? "Select…" : "Select section first"}</option>
                    {allowedSubjectsForSection(fSectionId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Unit</label>
                  <select
                    value={fUnitId}
                    disabled={!!editingId || !fSubjectId}
                    onChange={(e) => { setFUnitId(e.target.value); setFTopicId(""); }}
                    className={selectClass}
                  >
                    <option value="">{fSubjectId ? "Select…" : "Select subject first"}</option>
                    {unitsForSubject(fSubjectId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Chapter (Topic)</label>
                  <select
                    value={fTopicId}
                    disabled={!!editingId || !fUnitId}
                    onChange={(e) => setFTopicId(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">{fUnitId ? "Select…" : "Select unit first"}</option>
                    {topicsForUnit(fUnitId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  {fUnitId && topicsForUnit(fUnitId).length === 0 && (
                    <p className="mt-1 text-xs text-inkmuted">No chapters exist for this unit yet.</p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-inkmuted">Title</label>
                  <input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="e.g. Unit 1 Notes — Circuit Laws" className={selectClass} />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-inkmuted">PDF file{editingId ? " (leave blank to keep the current file)" : ""}</label>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setFFile(e.target.files?.[0] ?? null)}
                    className="mt-1 w-full text-sm text-ink"
                  />
                  {fFile && <p className="mt-1 text-xs text-inkmuted">{fFile.name} · {(fFile.size / 1024 / 1024).toFixed(1)}MB</p>}
                </div>
              </div>

              {uploadLabel && <p className="mt-3 text-sm text-inkmuted">{uploadLabel}</p>}
              {formError && <p className="mt-3 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{formError}</p>}

              <div className="mt-4 flex gap-2">
                <button onClick={handleSubmit} disabled={saving} className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark disabled:opacity-60">
                  {saving ? "Saving…" : editingId ? "Save changes" : "Upload"}
                </button>
                <button onClick={() => setFormOpen(false)} className="rounded-md border border-line px-4 py-2 text-sm text-ink hover:border-copper hover:text-copper-dark">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {rowActionError && <div className="mb-4"><ErrorState message={rowActionError} onRetry={() => setRowActionError(null)} /></div>}

          {visibleNotes.length === 0 && (
            <EmptyState title="No notes yet" message="Add your first PDF note above." />
          )}

          {visibleNotes.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-line bg-panel">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-paper">
                    <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Title</th>
                    <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Section</th>
                    <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Subject · Chapter</th>
                    <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Size</th>
                    <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Uploaded by</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleNotes.map((row) => (
                    <tr key={row.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-medium text-ink">{row.title}</td>
                      <td className="px-4 py-2.5 text-xs text-inkmuted">{sectionLabel(row.section_id)}</td>
                      <td className="px-4 py-2.5 text-xs text-inkmuted">{subjectLabel(row.subject_id)} · {topicLabel(row.topic_id)}</td>
                      <td className="px-4 py-2.5 text-xs text-inkmuted">{formatBytes(row.file_size_bytes)}</td>
                      <td className="px-4 py-2.5 text-xs text-inkmuted">
                        {row.uploaded_by_name || "—"}{row.uploaded_by_role ? ` (${row.uploaded_by_role === "super_admin" ? "Super Admin" : row.uploaded_by_role === "teacher" ? "Teacher" : "CR"})` : ""}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1.5">
                          <button onClick={() => handleView(row)} disabled={viewingId === row.id} className={ghostBtn}>
                            {viewingId === row.id ? "Opening…" : "View"}
                          </button>
                          <button onClick={() => openEdit(row)} className={ghostBtn}>Replace</button>
                          <button onClick={() => handleDelete(row)} className={dangerBtn}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
