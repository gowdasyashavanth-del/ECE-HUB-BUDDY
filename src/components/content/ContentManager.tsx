import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader } from "../ui/PageHeader";
import { LoadingState } from "../ui/LoadingState";
import { ErrorState } from "../ui/ErrorState";
import { EmptyState } from "../ui/EmptyState";
import { Badge } from "../ui/Badge";

interface Subject { id: string; name: string; code: string | null; }
interface Unit { id: string; name: string; subject_id: string; }
interface Topic { id: string; name: string; unit_id: string; }
interface ContentRow {
  id: string; topic_id: string; type: string; title: string;
  file_url: string | null; external_url: string | null; is_published: boolean; created_at: string;
}

const CONTENT_TYPES = ["note", "video", "document", "link", "assignment", "quiz"] as const;

// content-files bucket facts (verified live against Supabase, not
// assumed from the migration file): PRIVATE bucket, 50MB limit,
// allowed_mime_types = application/pdf, image/png, image/jpeg. Storage
// RLS: INSERT/UPDATE = is_teacher_or_admin() (any teacher, not scoped
// to their own subject at the storage layer — the `content` TABLE row
// is what's actually scoped to teacher_has_subject(), so an
// unauthorized content *record* still can't be created even though the
// storage object itself has coarser write scoping). DELETE = is_admin()
// only — teachers cannot remove storage objects directly, matching why
// only admins see the "Delete" button on this page already.
// SELECT = any `authenticated` user — NOT scoped to enrollment. Since
// the bucket is private (not public), this means the real protection
// against an unenrolled student finding a file is (a) the `content`
// TABLE row being invisible to them via content_select RLS, and
// (b) storage object paths being unguessable UUIDs, NOT a per-file
// storage-level enrollment check. This is a pre-existing DB design
// decision — verified, not changed, and not something this frontend
// change alters.
const CONTENT_FILES_BUCKET = "content-files";
const CONTENT_FILE_MAX_BYTES = 50 * 1024 * 1024;
const CONTENT_FILE_ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg"];

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// One component, used at both /admin/content and /teacher/content.
// It reads the caller's OWN role/assignments to decide which subjects
// are selectable — but that's a UX convenience only (so a teacher
// isn't shown a picker full of subjects they can't use). The actual
// enforcement is entirely server-side: RLS on `content` already
// requires teacher_has_subject()/is_admin() for writes, so even if
// this component's filtering had a bug, an unauthorized write would
// still be rejected by the database, not by this code.
export function ContentManager() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "super_admin";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [rows, setRows] = useState<ContentRow[]>([]);

  const [filterSubjectId, setFilterSubjectId] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fSubjectId, setFSubjectId] = useState("");
  const [fUnitId, setFUnitId] = useState("");
  const [fTopicId, setFTopicId] = useState("");
  const [fType, setFType] = useState<string>("note");
  const [fTitle, setFTitle] = useState("");
  const [fMode, setFMode] = useState<"link" | "file">("link");
  const [fUrl, setFUrl] = useState("");
  const [fFile, setFFile] = useState<File | null>(null);
  const [fExistingFilePath, setFExistingFilePath] = useState<string | null>(null);
  const [fPublished, setFPublished] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadProgressLabel, setUploadProgressLabel] = useState<string | null>(null);
  const [rowActionError, setRowActionError] = useState<string | null>(null);
  const [viewingRowId, setViewingRowId] = useState<string | null>(null);

  async function loadAll() {
    if (!supabase || !profile) return;
    setLoadError(null);
    setLoading(true);

    // Subject pool: admin sees every subject; a teacher sees only
    // subjects they're actually assigned to (via teacher_assignments).
    let subjectRows: Subject[] = [];
    if (isAdmin) {
      const { data, error } = await supabase.from("subjects").select("id, name, code").order("name");
      if (error) { setLoading(false); setLoadError(friendlyDbError(error, "Subjects")); return; }
      subjectRows = data ?? [];
    } else {
      const { data, error } = await supabase
        .from("teacher_assignments")
        .select("subjects(id, name, code)")
        .eq("teacher_id", profile.id);
      if (error) { setLoading(false); setLoadError(friendlyDbError(error, "Your subjects")); return; }
      const first = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
      const seen = new Set<string>();
      subjectRows = (data ?? [])
        .map((r: any) => first<Subject>(r.subjects))
        .filter((s): s is Subject => !!s && !seen.has(s.id) && (seen.add(s.id), true));
    }
    setSubjects(subjectRows);

    if (subjectRows.length === 0) {
      setUnits([]); setTopics([]); setRows([]); setLoading(false);
      return;
    }

    const subjectIds = subjectRows.map((s) => s.id);
    const { data: unitRows, error: unitErr } = await supabase.from("units").select("id, name, subject_id").in("subject_id", subjectIds);
    if (unitErr) { setLoading(false); setLoadError(friendlyDbError(unitErr, "Units")); return; }
    setUnits(unitRows ?? []);

    const unitIds = (unitRows ?? []).map((u) => u.id);
    let topicRows: Topic[] = [];
    if (unitIds.length > 0) {
      const { data, error } = await supabase.from("topics").select("id, name, unit_id").in("unit_id", unitIds);
      if (error) { setLoading(false); setLoadError(friendlyDbError(error, "Topics")); return; }
      topicRows = data ?? [];
    }
    setTopics(topicRows);

    const topicIds = topicRows.map((t) => t.id);
    let contentRows: ContentRow[] = [];
    if (topicIds.length > 0) {
      const { data, error } = await supabase
        .from("content")
        .select("id, topic_id, type, title, file_url, external_url, is_published, created_at")
        .in("topic_id", topicIds)
        .order("created_at", { ascending: false });
      if (error) { setLoading(false); setLoadError(friendlyDbError(error, "Content")); return; }
      contentRows = (data ?? []) as ContentRow[];
    }
    setRows(contentRows);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const unitsForSubject = (subjectId: string) => units.filter((u) => u.subject_id === subjectId);
  const topicsForUnit = (unitId: string) => topics.filter((t) => t.unit_id === unitId);

  const visibleRows = useMemo(() => {
    if (!filterSubjectId) return rows;
    const unitIds = new Set(units.filter((u) => u.subject_id === filterSubjectId).map((u) => u.id));
    const topicIds = new Set(topics.filter((t) => unitIds.has(t.unit_id)).map((t) => t.id));
    return rows.filter((r) => topicIds.has(r.topic_id));
  }, [rows, filterSubjectId, units, topics]);

  function subjectNameForTopic(topicId: string): string {
    const topic = topics.find((t) => t.id === topicId);
    const unit = topic ? units.find((u) => u.id === topic.unit_id) : undefined;
    const subject = unit ? subjects.find((s) => s.id === unit.subject_id) : undefined;
    return `${subject?.name ?? "—"} · ${unit?.name ?? "—"} · ${topic?.name ?? "—"}`;
  }

  function openCreate() {
    setEditingId(null);
    setFSubjectId(""); setFUnitId(""); setFTopicId("");
    setFType("note"); setFTitle(""); setFMode("link"); setFUrl(""); setFFile(null); setFExistingFilePath(null); setFPublished(true);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(row: ContentRow) {
    const topic = topics.find((t) => t.id === row.topic_id);
    const unit = topic ? units.find((u) => u.id === topic.unit_id) : undefined;
    setEditingId(row.id);
    setFSubjectId(unit?.subject_id ?? "");
    setFUnitId(unit?.id ?? "");
    setFTopicId(row.topic_id);
    setFType(row.type);
    setFTitle(row.title);
    setFMode(row.file_url ? "file" : "link");
    setFUrl(row.external_url ?? "");
    setFFile(null);
    setFExistingFilePath(row.file_url ?? null);
    setFPublished(row.is_published);
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit() {
    if (!supabase) return;
    setFormError(null);
    if (!fTopicId) return setFormError("Select Subject → Unit → Topic.");
    if (!fTitle.trim()) return setFormError("Title is required.");

    if (fMode === "link" && !fUrl.trim()) {
      return setFormError("Provide an external URL, or switch to \"Upload file\".");
    }
    if (fMode === "file" && !fFile && !fExistingFilePath) {
      return setFormError("Choose a file to upload.");
    }

    // Client-side checks below are UX ONLY — they exist to give a fast,
    // friendly error instead of a round-trip failure. They are NOT a
    // security boundary: the bucket's own file_size_limit (50MB) and
    // allowed_mime_types (application/pdf, image/png, image/jpeg) are
    // enforced by Supabase Storage itself regardless of what this code
    // checks, so a bypassed/edited client still can't upload something
    // the bucket configuration rejects.
    if (fMode === "file" && fFile) {
      if (fFile.size > CONTENT_FILE_MAX_BYTES) {
        return setFormError("File is too large — the limit is 50MB.");
      }
      if (!CONTENT_FILE_ALLOWED_TYPES.includes(fFile.type)) {
        return setFormError("Only PDF, PNG, or JPEG files are allowed.");
      }
    }

    setSaving(true);
    setUploadProgressLabel(null);

    let file_url: string | null = fExistingFilePath;
    let external_url: string | null = null;

    if (fMode === "file" && fFile) {
      setUploadProgressLabel("Uploading file…");
      const path = `${fSubjectId}/${fTopicId}/${crypto.randomUUID()}-${sanitizeFilename(fFile.name)}`;
      const { error: uploadErr } = await supabase.storage
        .from(CONTENT_FILES_BUCKET)
        .upload(path, fFile, { contentType: fFile.type, upsert: false });
      if (uploadErr) {
        setSaving(false);
        setUploadProgressLabel(null);
        setFormError(`File upload failed: ${uploadErr.message}`);
        return;
      }
      file_url = path;
    } else if (fMode === "link") {
      file_url = null;
      external_url = fUrl.trim();
    }

    setUploadProgressLabel(null);

    const payload: Record<string, unknown> = {
      topic_id: fTopicId,
      type: fType,
      title: fTitle.trim(),
      file_url,
      external_url,
      is_published: fPublished,
    };
    // Only set uploaded_by when creating — editing shouldn't reassign
    // authorship to whoever happens to save an edit later.
    if (!editingId) payload.uploaded_by = profile?.id;

    const query = editingId
      ? supabase.from("content").update(payload).eq("id", editingId)
      : supabase.from("content").insert(payload);
    const { error } = await query;
    setSaving(false);

    if (error) {
      setFormError(friendlyDbError(error, "Content"));
      return;
    }
    setFormOpen(false);
    await loadAll();
  }

  async function handleDelete(row: ContentRow) {
    if (!supabase) return;
    if (!window.confirm(`Delete "${row.title}"? This cannot be undone.`)) return;
    setRowActionError(null);
    const { error } = await supabase.from("content").delete().eq("id", row.id);
    if (error) {
      setRowActionError(friendlyDbError(error, "Content"));
      return;
    }
    // Best-effort storage cleanup. content_files_admin_delete already
    // restricts this DELETE to is_admin() at the storage-policy level —
    // this call can only ever succeed for the admin role that already
    // has that permission; it never grants anything new. If it fails
    // (e.g. path already gone), the content ROW is still correctly
    // deleted above — this is a non-blocking cleanup step, not a
    // condition for the delete's success.
    if (isAdmin && row.file_url) {
      await supabase.storage.from(CONTENT_FILES_BUCKET).remove([row.file_url]);
    }
    await loadAll();
  }

  async function handleViewFile(row: ContentRow) {
    if (!supabase || !row.file_url) return;
    setRowActionError(null);
    setViewingRowId(row.id);
    // content-files is a PRIVATE bucket — a signed URL (time-limited)
    // is the correct access mechanism here, not a public URL. Signing
    // itself is gated by the content_files_authenticated_read storage
    // policy (any authenticated user), same as opening the file any
    // other way through the Storage API.
    const { data, error } = await supabase.storage.from(CONTENT_FILES_BUCKET).createSignedUrl(row.file_url, 3600);
    setViewingRowId(null);
    if (error || !data?.signedUrl) {
      setRowActionError("Couldn't open this file. Please try again.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noreferrer");
  }

  const selectClass = "mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink focus:border-copper focus:outline-none disabled:bg-paper disabled:text-inkmuted";
  const ghostBtn = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-copper hover:text-copper-dark";
  const dangerBtn = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-danger hover:border-danger";

  if (!profile) return null;

  return (
    <div>
      <PageHeader
        title="Content"
        subtitle={isAdmin ? "Manage notes, videos, documents, links, assignments and quizzes across all subjects." : "Manage content for the subjects you're assigned to."}
        action={
          <button onClick={openCreate} className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark">
            + Add Content
          </button>
        }
      />

      {loadError && <ErrorState message={loadError} onRetry={loadAll} />}
      {loading && !loadError && <LoadingState label="Loading content…" />}

      {!loading && !loadError && subjects.length === 0 && (
        <EmptyState
          title={isAdmin ? "No subjects exist yet" : "No subjects assigned to you yet"}
          message={isAdmin ? "Create subjects under Academic Management first." : "Your Super Admin hasn't assigned you to any subject yet."}
        />
      )}

      {!loading && !loadError && subjects.length > 0 && (
        <>
          <div className="mb-4">
            <label className="block text-xs font-medium text-inkmuted">Filter by subject</label>
            <select value={filterSubjectId} onChange={(e) => setFilterSubjectId(e.target.value)} className={`${selectClass} max-w-xs`}>
              <option value="">All subjects</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {formOpen && (
            <div className="mb-6 rounded-lg border border-line bg-panel p-5">
              <p className="mb-3 font-display text-sm font-semibold text-ink">{editingId ? "Edit Content" : "New Content"}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Subject</label>
                  <select value={fSubjectId} onChange={(e) => { setFSubjectId(e.target.value); setFUnitId(""); setFTopicId(""); }} className={selectClass}>
                    <option value="">Select…</option>
                    {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Unit</label>
                  <select value={fUnitId} disabled={!fSubjectId} onChange={(e) => { setFUnitId(e.target.value); setFTopicId(""); }} className={selectClass}>
                    <option value="">{fSubjectId ? "Select…" : "Select subject first"}</option>
                    {unitsForSubject(fSubjectId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  {fSubjectId && unitsForSubject(fSubjectId).length === 0 && (
                    <p className="mt-1 text-xs text-inkmuted">No units exist for this subject yet.</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Topic</label>
                  <select value={fTopicId} disabled={!fUnitId} onChange={(e) => setFTopicId(e.target.value)} className={selectClass}>
                    <option value="">{fUnitId ? "Select…" : "Select unit first"}</option>
                    {topicsForUnit(fUnitId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  {fUnitId && topicsForUnit(fUnitId).length === 0 && (
                    <p className="mt-1 text-xs text-inkmuted">No topics exist for this unit yet.</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-inkmuted">Type</label>
                  <select value={fType} onChange={(e) => setFType(e.target.value)} className={selectClass}>
                    {CONTENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-inkmuted">Title</label>
                  <input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="e.g. Unit 1 Notes — Circuit Laws" className={selectClass} />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-inkmuted">Source</label>
                  <div className="mt-1 flex gap-4 text-sm text-ink">
                    <label className="flex items-center gap-1.5">
                      <input type="radio" name="fmode" checked={fMode === "link"} onChange={() => setFMode("link")} />
                      External link
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="radio" name="fmode" checked={fMode === "file"} onChange={() => setFMode("file")} />
                      Upload file
                    </label>
                  </div>
                </div>

                {fMode === "link" ? (
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-inkmuted">URL</label>
                    <input value={fUrl} onChange={(e) => setFUrl(e.target.value)} placeholder="https://…" className={selectClass} />
                  </div>
                ) : (
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-inkmuted">File (PDF, PNG, or JPEG — up to 50MB)</label>
                    <input
                      type="file"
                      accept="application/pdf,image/png,image/jpeg"
                      onChange={(e) => setFFile(e.target.files?.[0] ?? null)}
                      className="mt-1 w-full text-sm text-ink"
                    />
                    {fExistingFilePath && !fFile && (
                      <p className="mt-1 text-xs text-inkmuted">
                        A file is already attached. Choose a new one to replace it, or leave blank to keep it.
                      </p>
                    )}
                    {fFile && (
                      <p className="mt-1 text-xs text-inkmuted">
                        {fFile.name} · {(fFile.size / 1024 / 1024).toFixed(1)}MB
                      </p>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="published" checked={fPublished} onChange={(e) => setFPublished(e.target.checked)} />
                  <label htmlFor="published" className="text-sm text-ink">Published (visible to enrolled students)</label>
                </div>
              </div>

              {uploadProgressLabel && <p className="mt-3 text-sm text-inkmuted">{uploadProgressLabel}</p>}
              {formError && <p className="mt-3 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{formError}</p>}

              <div className="mt-4 flex gap-2">
                <button onClick={handleSubmit} disabled={saving} className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark disabled:opacity-60">
                  {saving ? "Saving…" : editingId ? "Save changes" : "Create"}
                </button>
                <button onClick={() => setFormOpen(false)} className="rounded-md border border-line px-4 py-2 text-sm text-ink hover:border-copper hover:text-copper-dark">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {rowActionError && <div className="mb-4"><ErrorState message={rowActionError} onRetry={() => setRowActionError(null)} /></div>}

          {visibleRows.length === 0 && (
            <EmptyState title="No content yet" message="Add your first note, video, or resource above." />
          )}

          {visibleRows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-line bg-panel">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-paper">
                    <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Title</th>
                    <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Type</th>
                    <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Subject · Unit · Topic</th>
                    <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Status</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr key={row.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 font-medium text-ink">{row.title}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-inkmuted">{row.type}</td>
                      <td className="px-4 py-2.5 text-xs text-inkmuted">{subjectNameForTopic(row.topic_id)}</td>
                      <td className="px-4 py-2.5"><Badge tone={row.is_published ? "active" : "archived"}>{row.is_published ? "Published" : "Draft"}</Badge></td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1.5">
                          {row.file_url && (
                            <button onClick={() => handleViewFile(row)} disabled={viewingRowId === row.id} className={ghostBtn}>
                              {viewingRowId === row.id ? "Opening…" : "View file"}
                            </button>
                          )}
                          {row.external_url && (
                            <a href={row.external_url} target="_blank" rel="noreferrer" className={ghostBtn}>
                              Open link
                            </a>
                          )}
                          <button onClick={() => openEdit(row)} className={ghostBtn}>Edit</button>
                          {isAdmin && <button onClick={() => handleDelete(row)} className={dangerBtn}>Delete</button>}
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
