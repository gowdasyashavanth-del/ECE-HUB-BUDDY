import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { useAuth } from "../../contexts/AuthContext";
import { resolveScopeLabels, scopeDisplay, type AnnouncementLike } from "../../lib/announcementScope";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";
import { Badge } from "../../components/ui/Badge";

interface AnnouncementRow extends AnnouncementLike {
  title: string; body: string; created_at: string; created_by: string | null;
}

// No manual scoping in the read at all — announcements_select RLS
// (unchanged since Phase 6/7) already returns exactly the announcements
// applicable to this student's current academic context, computed
// entirely from their own student_assignments row. The CR compose box
// below is a UX convenience, not a security boundary: it only shows up
// if this student currently holds a CR designation for their own
// section, but the real authorization is announcements_insert/_delete
// (16G final pass) — a non-CR student's insert/delete attempt would be
// rejected by RLS regardless of what this component renders.
export function AnnouncementsFeed() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<AnnouncementRow[] | null>(null);
  const [scopeLabels, setScopeLabels] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [crSectionId, setCrSectionId] = useState<string | null>(null);

  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowActionError, setRowActionError] = useState<string | null>(null);

  async function load() {
    if (!supabase || !profile) return;
    setError(null);
    const [annRes, crRes] = await Promise.all([
      supabase.from("announcements").select("id, title, body, scope_type, scope_id, created_at, created_by").order("created_at", { ascending: false }),
      supabase.from("cr_designations").select("section_id").eq("student_id", profile.id).eq("is_current", true).maybeSingle(),
    ]);
    if (annRes.error) { setError(friendlyDbError(annRes.error, "Announcements")); return; }
    setRows((annRes.data ?? []) as AnnouncementRow[]);
    setScopeLabels(await resolveScopeLabels((annRes.data ?? []) as AnnouncementLike[]));
    setCrSectionId(crRes.data?.section_id ?? null);
  }

  useEffect(() => { load(); }, [profile]);

  async function handlePost() {
    if (!supabase || !profile || !crSectionId) return;
    setFormError(null);
    if (!title.trim()) return setFormError("Title is required.");
    if (!body.trim()) return setFormError("Body is required.");
    setSaving(true);
    const { error: err } = await supabase.from("announcements").insert({
      title: title.trim(),
      body: body.trim(),
      scope_type: "section",
      scope_id: crSectionId,
      created_by: profile.id,
    });
    setSaving(false);
    if (err) { setFormError(friendlyDbError(err, "Announcement")); return; }
    setTitle(""); setBody(""); setComposing(false);
    await load();
  }

  async function handleDelete(row: AnnouncementRow) {
    if (!supabase) return;
    if (!window.confirm(`Delete your note "${row.title}"?`)) return;
    setRowActionError(null);
    const { error: err } = await supabase.from("announcements").delete().eq("id", row.id);
    if (err) { setRowActionError(friendlyDbError(err, "Announcement")); return; }
    await load();
  }

  return (
    <div>
      <PageHeader
        title="Announcements"
        subtitle="Relevant to your current academic context."
        action={
          crSectionId ? (
            <button onClick={() => setComposing((c) => !c)} className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark">
              {composing ? "Cancel" : "+ Post to My Section"}
            </button>
          ) : undefined
        }
      />

      {crSectionId && composing && (
        <div className="mb-6 rounded-lg border border-line bg-panel p-5">
          <p className="mb-3 font-display text-sm font-semibold text-ink">New Section Note</p>
          <p className="mb-3 text-xs text-inkmuted">As CR, this posts to your own current section only.</p>
          <div>
            <label className="block text-xs font-medium text-inkmuted">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-copper focus:outline-none" />
          </div>
          <div className="mt-3">
            <label className="block text-xs font-medium text-inkmuted">Body</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-copper focus:outline-none" />
          </div>
          {formError && <p className="mt-3 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{formError}</p>}
          <button onClick={handlePost} disabled={saving} className="mt-4 rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark disabled:opacity-60">
            {saving ? "Posting…" : "Post Note"}
          </button>
        </div>
      )}

      {error && <ErrorState message={error} onRetry={load} />}
      {rowActionError && <div className="mb-4"><ErrorState message={rowActionError} onRetry={() => setRowActionError(null)} /></div>}
      {!error && rows === null && <LoadingState label="Loading announcements…" />}
      {!error && rows !== null && rows.length === 0 && (
        <EmptyState title="No announcements yet" message="Announcements from your teachers or admin will appear here." />
      )}

      {!error && rows !== null && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="rounded-lg border border-line bg-panel p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-ink">{row.title}</p>
                  <p className="mt-1 text-sm text-inkmuted">{row.body}</p>
                </div>
                {profile && row.created_by === profile.id && (
                  <button onClick={() => handleDelete(row)} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-danger hover:border-danger">Delete</button>
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
    </div>
  );
}
