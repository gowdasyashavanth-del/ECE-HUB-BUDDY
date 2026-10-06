import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";

interface UnitRow { id: string; name: string; subject_id: string; order_number: number; }
// Notes-specific chapter entity — NOT the academic syllabus Topic.
interface NoteChapterRow { id: string; name: string; unit_id: string; subject_id: string; topic_id: string | null; display_order: number; }
interface SubjectRow { id: string; name: string; code: string | null; }
interface NoteRow {
  id: string; subject_id: string; note_chapter_id: string;
  title: string; file_path: string; file_size_bytes: number | null;
  uploaded_by_name: string | null; uploaded_by_role: string | null; created_at: string;
}

const BUCKET = "content-files";
const MAX_BYTES = 50 * 1024 * 1024;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}
function formatBytes(n: number | null): string {
  if (!n) return "—";
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

// Every student sees Notes for their OWN current section only — this
// page never filters by section itself; the `notes_select` RLS policy
// (notes_viewer(), scoped to the caller's own current student_assignments
// row) is what actually restricts the rows a plain, unfiltered select
// can return. A CR additionally gets upload/replace/delete controls,
// gated the same way server-side by notes_manager() — removing or
// bypassing the `isCr` check below would not grant any extra access,
// since the database re-checks it independently.
export function NotesPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [isCr, setIsCr] = useState(false);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);
  // Notes-specific chapters — NOT academic syllabus topics.
  const [noteChapters, setNoteChapters] = useState<NoteChapterRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fSubjectId, setFSubjectId] = useState("");
  const [fUnitId, setFUnitId] = useState("");
  const [fNoteChapterId, setFNoteChapterId] = useState("");
  const [fTitle, setFTitle] = useState("");
  const [fFile, setFFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadLabel, setUploadLabel] = useState<string | null>(null);
  const [rowActionError, setRowActionError] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  async function load() {
    if (!supabase || !profile) return;
    setError(null);
    setLoading(true);

    const [saRes, crRes] = await Promise.all([
      supabase.from("student_assignments").select("section_id, semester_id").eq("student_id", profile.id).eq("is_current", true).maybeSingle(),
      supabase.from("cr_designations").select("id").eq("student_id", profile.id).eq("is_current", true).maybeSingle(),
    ]);
    if (saRes.error) { setLoading(false); setError(friendlyDbError(saRes.error, "Your section")); return; }
    setIsCr(!!crRes.data);
    const mySectionId = saRes.data?.section_id ?? null;
    setSectionId(mySectionId);

    if (!saRes.data?.semester_id) { setSubjects([]); setUnits([]); setNoteChapters([]); setNotes([]); setLoading(false); return; }

    const { data: subjectRows, error: subErr } = await supabase
      .from("subjects").select("id, name, code").eq("semester_id", saRes.data.semester_id).order("order_number");
    if (subErr) { setLoading(false); setError(friendlyDbError(subErr, "Subjects")); return; }
    setSubjects(subjectRows ?? []);

    const subjectIds = (subjectRows ?? []).map((s) => s.id);
    if (subjectIds.length === 0) { setUnits([]); setNoteChapters([]); setNotes([]); setLoading(false); return; }

    const [unitRes, chapterRes] = await Promise.all([
      supabase.from("units").select("id, name, subject_id, order_number").in("subject_id", subjectIds).order("order_number"),
      // Load Notes-specific chapters — NOT academic syllabus topics.
      supabase.from("note_chapters").select("id, name, unit_id, subject_id, topic_id, display_order").in("subject_id", subjectIds).order("display_order"),
    ]);
    if (unitRes.error) { setLoading(false); setError(friendlyDbError(unitRes.error, "Units")); return; }
    if (chapterRes.error) { setLoading(false); setError(friendlyDbError(chapterRes.error, "Chapters")); return; }
    setUnits(unitRes.data ?? []);
    setNoteChapters((chapterRes.data ?? []) as NoteChapterRow[]);

    // Unfiltered by section on purpose — see the top-of-file note.
    const { data: noteRows, error: noteErr } = await supabase
      .from("notes")
      .select("id, subject_id, note_chapter_id, title, file_path, file_size_bytes, uploaded_by_name, uploaded_by_role, created_at")
      .order("created_at", { ascending: false });
    if (noteErr) { setLoading(false); setError(friendlyDbError(noteErr, "Notes")); return; }
    setNotes((noteRows ?? []) as NoteRow[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const unitsForSubject = (subjectId: string) => units.filter((u) => u.subject_id === subjectId);
  const chaptersForUnit = (unitId: string) =>
    noteChapters.filter((c) => c.unit_id === unitId).sort((a, b) => a.display_order - b.display_order);
  // Notes grouped by note_chapter_id — the key display relationship.
  const notesForChapter = (chapterId: string) => notes.filter((n) => n.note_chapter_id === chapterId);

  function subjectName(id: string) { return subjects.find((s) => s.id === id)?.name ?? "—"; }

  function openCreate() {
    setEditingId(null);
    setFSubjectId(""); setFUnitId(""); setFNoteChapterId(""); setFTitle(""); setFFile(null);
    setFormError(null);
    setFormOpen(true);
  }
  function openEdit(row: NoteRow) {
    const chapter = noteChapters.find((c) => c.id === row.note_chapter_id);
    setEditingId(row.id);
    setFSubjectId(row.subject_id);
    setFUnitId(chapter?.unit_id ?? "");
    setFNoteChapterId(row.note_chapter_id);
    setFTitle(row.title);
    setFFile(null);
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit() {
    if (!supabase || !profile || !sectionId) return;
    setFormError(null);
    if (!editingId) {
      if (!fSubjectId) return setFormError("Select a subject.");
      if (!fNoteChapterId) return setFormError("Select a chapter.");
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
        // Replacement files always use the note_chapter_id path format.
        newPath = `notes/${sectionId}/${existing.subject_id}/${existing.note_chapter_id}/${crypto.randomUUID()}-${sanitizeFilename(fFile.name)}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(newPath, fFile, { contentType: "application/pdf", upsert: false });
        if (upErr) { setSaving(false); setUploadLabel(null); setFormError(`Upload failed: ${upErr.message}`); return; }
        file_path = newPath;
        file_size_bytes = fFile.size;
      }
      const { error } = await supabase.from("notes").update({ title: fTitle.trim(), file_path, file_size_bytes }).eq("id", editingId);
      setSaving(false);
      setUploadLabel(null);
      if (error) {
        if (newPath) await supabase.storage.from(BUCKET).remove([newPath]);
        setFormError(friendlyDbError(error, "Notes"));
        return;
      }
      if (newPath) await supabase.storage.from(BUCKET).remove([existing.file_path]);
    } else {
      setUploadLabel("Uploading file…");
      // New notes use note_chapter_id as the 4th path segment.
      const path = `notes/${sectionId}/${fSubjectId}/${fNoteChapterId}/${crypto.randomUUID()}-${sanitizeFilename(fFile!.name)}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, fFile!, { contentType: "application/pdf", upsert: false });
      if (upErr) { setSaving(false); setUploadLabel(null); setFormError(`Upload failed: ${upErr.message}`); return; }

      const { error } = await supabase.from("notes").insert({
        section_id: sectionId, subject_id: fSubjectId, note_chapter_id: fNoteChapterId,
        title: fTitle.trim(), file_path: path, file_size_bytes: fFile!.size,
        uploaded_by: profile.id,
      });
      setSaving(false);
      setUploadLabel(null);
      if (error) {
        await supabase.storage.from(BUCKET).remove([path]);
        setFormError(friendlyDbError(error, "Notes"));
        return;
      }
    }

    setFormOpen(false);
    await load();
  }

  async function handleDelete(row: NoteRow) {
    if (!supabase) return;
    if (!window.confirm(`Delete "${row.title}"? This cannot be undone.`)) return;
    setRowActionError(null);
    const { error } = await supabase.from("notes").delete().eq("id", row.id);
    if (error) { setRowActionError(friendlyDbError(error, "Notes")); return; }
    await supabase.storage.from(BUCKET).remove([row.file_path]);
    await load();
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

  const hasAnyNotes = useMemo(() => notes.length > 0, [notes]);
  const selectClass = "mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink focus:border-copper focus:outline-none disabled:bg-paper disabled:text-inkmuted";
  const ghostBtn = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-copper hover:text-copper-dark";
  const dangerBtn = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-danger hover:border-danger";

  if (!profile) return null;

  return (
    <div>
      <PageHeader
        title="Notes"
        subtitle={isCr ? "PDF notes for your section — you can upload, replace and delete as CR." : "PDF notes shared for your subjects."}
        action={
          isCr && subjects.length > 0 ? (
            <button onClick={openCreate} className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark">
              + Add Note
            </button>
          ) : undefined
        }
      />

      {error && <ErrorState message={error} onRetry={load} />}
      {loading && !error && <LoadingState label="Loading notes…" />}

      {!loading && !error && !sectionId && (
        <EmptyState title="No section assigned yet" message="Your Super Admin hasn't assigned you to a section yet." />
      )}

      {!loading && !error && sectionId && (
        <>
          {isCr && formOpen && (
            <div className="mb-6 rounded-lg border border-line bg-panel p-5">
              <p className="mb-3 font-display text-sm font-semibold text-ink">{editingId ? "Replace / Edit Note" : "New Note"}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Subject</label>
                  <select
                    value={fSubjectId}
                    disabled={!!editingId}
                    onChange={(e) => { setFSubjectId(e.target.value); setFUnitId(""); setFNoteChapterId(""); }}
                    className={selectClass}
                  >
                    <option value="">Select…</option>
                    {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Unit</label>
                  <select
                    value={fUnitId}
                    disabled={!!editingId || !fSubjectId}
                    onChange={(e) => { setFUnitId(e.target.value); setFNoteChapterId(""); }}
                    className={selectClass}
                  >
                    <option value="">{fSubjectId ? "Select…" : "Select subject first"}</option>
                    {unitsForSubject(fSubjectId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Chapter</label>
                  <select
                    value={fNoteChapterId}
                    disabled={!!editingId || !fUnitId}
                    onChange={(e) => setFNoteChapterId(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">{fUnitId ? "Select…" : "Select unit first"}</option>
                    {chaptersForUnit(fUnitId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {fUnitId && !editingId && chaptersForUnit(fUnitId).length === 0 && (
                    <p className="mt-1 text-xs text-inkmuted">
                      No chapters exist for this unit yet. Ask your teacher or admin to create them first.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Title</label>
                  <input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="e.g. Unit 1 Notes" className={selectClass} />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-inkmuted">PDF file{editingId ? " (leave blank to keep the current file)" : ""}</label>
                  <input type="file" accept="application/pdf" onChange={(e) => setFFile(e.target.files?.[0] ?? null)} className="mt-1 w-full text-sm text-ink" />
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

          {!hasAnyNotes && (
            <EmptyState title="No notes yet" message="Your teachers or class CR haven't uploaded any notes yet." />
          )}

          {hasAnyNotes && (
            <div className="space-y-4">
              {subjects.map((subject) => {
                const subjectUnits = unitsForSubject(subject.id);
                // Count notes via note_chapters, not academic topics.
                const subjectChapterIds = new Set(
                  subjectUnits.flatMap((u) => chaptersForUnit(u.id).map((c) => c.id))
                );
                const subjectNoteCount = notes.filter((n) => subjectChapterIds.has(n.note_chapter_id)).length;
                if (subjectNoteCount === 0) return null;
                return (
                  <div key={subject.id} className="rounded-lg border border-line bg-panel p-4">
                    <p className="font-display text-sm font-semibold text-ink">{subjectName(subject.id)}</p>
                    <div className="mt-2 space-y-3">
                      {subjectUnits.map((unit) => {
                        const unitChapters = chaptersForUnit(unit.id).filter((c) => notesForChapter(c.id).length > 0);
                        if (unitChapters.length === 0) return null;
                        return (
                          <div key={unit.id} className="ml-3 border-l border-line pl-3">
                            <p className="text-xs font-medium uppercase tracking-wide text-inkmuted">{unit.name}</p>
                            {unitChapters.map((chapter) => (
                              <div key={chapter.id} className="mt-1.5">
                                {/* "Chapter" label is specific to Notes — does not represent an academic syllabus Topic */}
                                <p className="text-sm font-medium text-ink">{chapter.name}</p>
                                <ul className="mt-1 space-y-1.5">
                                  {notesForChapter(chapter.id).map((note) => (
                                    <li key={note.id} className="flex flex-wrap items-center justify-between gap-2">
                                      <button
                                        onClick={() => handleView(note)}
                                        disabled={viewingId === note.id}
                                        className="inline-flex items-center gap-1.5 text-sm text-copper-dark hover:underline disabled:opacity-60"
                                      >
                                        <span className="font-mono text-[10px] uppercase text-inkmuted">PDF</span>
                                        {viewingId === note.id ? "Opening…" : note.title}
                                        <span className="font-mono text-[10px] text-inkmuted">· {formatBytes(note.file_size_bytes)}</span>
                                      </button>
                                      {isCr ? (
                                        <div className="flex gap-1.5">
                                          <button onClick={() => openEdit(note)} className={ghostBtn}>Replace</button>
                                          <button onClick={() => handleDelete(note)} className={dangerBtn}>Delete</button>
                                        </div>
                                      ) : (
                                        <span className="text-[11px] text-inkmuted">
                                          {note.uploaded_by_name || "—"}
                                        </span>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
