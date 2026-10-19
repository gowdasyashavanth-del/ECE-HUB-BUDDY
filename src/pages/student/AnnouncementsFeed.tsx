import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import { useAuth } from "../../contexts/AuthContext";
import { uploadPoster, deletePoster, validatePosterFile, PosterImage } from "../../lib/posterUpload";
import { resolveScopeLabels, scopeDisplay, type AnnouncementLike } from "../../lib/announcementScope";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingState } from "../../components/ui/LoadingState";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";
import { Badge } from "../../components/ui/Badge";

interface AnnouncementRow extends AnnouncementLike {
  title: string; body: string; created_at: string; created_by: string | null; image_url?: string | null;
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
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterPreview, setPosterPreview] = useState<string | null>(null);
  const [posterError, setPosterError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowActionError, setRowActionError] = useState<string | null>(null);

  function handlePosterChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validatePosterFile(file);
    if (err) {
      setPosterError(err);
      return;
    }
    setPosterError(null);
    setPosterFile(file);
    setPosterPreview(URL.createObjectURL(file));
  }

  function handleRemovePoster() {
    setPosterFile(null);
    setPosterPreview(null);
    setPosterError(null);
  }

  useEffect(() => {
    return () => {
      if (posterPreview && posterPreview.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(posterPreview);
        } catch {
          // ignore revocation errors
        }
      }
    };
  }, [posterPreview]);

  async function load() {
    if (!supabase || !profile) return;
    setError(null);
    const [annRes, crRes] = await Promise.all([
      supabase.from("announcements").select("id, title, body, scope_type, scope_id, image_url, created_at, created_by").order("created_at", { ascending: false }),
      supabase.from("cr_designations").select("section_id").eq("student_id", profile.id).eq("is_current", true).maybeSingle(),
    ]);
    if (annRes.error) { setError(friendlyDbError(annRes.error, "Announcements")); return; }
    setRows((annRes.data ?? []) as AnnouncementRow[]);
    setScopeLabels(await resolveScopeLabels((annRes.data ?? []) as AnnouncementLike[]));
    setCrSectionId(crRes.data?.section_id ?? null);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  async function handlePost() {
    if (!supabase || !profile || !crSectionId) return;
    setFormError(null);
    if (!title.trim()) return setFormError("Title is required.");
    if (!body.trim()) return setFormError("Body is required.");
    setSaving(true);

    let imageUrl: string | null = null;
    if (posterFile) {
      const uploadRes = await uploadPoster({
        file: posterFile,
        userId: profile.id,
        folder: "announcements",
        sectionId: crSectionId,
      });
      if (uploadRes.error) {
        setSaving(false);
        setFormError(uploadRes.error);
        return;
      }
      imageUrl = uploadRes.url;
    }

    const { error: err } = await supabase.from("announcements").insert({
      title: title.trim(),
      body: body.trim(),
      image_url: imageUrl,
      scope_type: "section",
      scope_id: crSectionId,
      created_by: profile.id,
    });
    setSaving(false);
    if (err) {
      if (imageUrl) {
        await deletePoster(imageUrl);
      }
      setFormError(friendlyDbError(err, "Announcement"));
      return;
    }
    setTitle(""); setBody("");
    setPosterFile(null); setPosterPreview(null); setPosterError(null);
    setComposing(false);
    await load();
  }

  async function handleDelete(row: AnnouncementRow) {
    if (!supabase) return;
    if (!window.confirm(`Delete your note "${row.title}"?`)) return;
    setRowActionError(null);
    const { error: err } = await supabase.from("announcements").delete().eq("id", row.id);
    if (err) { setRowActionError(friendlyDbError(err, "Announcement")); return; }
    if (row.image_url) {
      await deletePoster(row.image_url);
    }
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
          <div className="mt-3">
            <label className="block text-xs font-medium text-inkmuted">Poster / Image (optional)</label>
            {posterPreview ? (
              <div className="mt-1 space-y-2">
                <div className="relative max-w-xs overflow-hidden rounded-md border border-line bg-paper">
                  <img src={posterPreview} alt="Poster preview" className="max-h-48 w-full object-contain" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-copper">
                    Replace image
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePosterChange} className="sr-only" />
                  </label>
                  <button type="button" onClick={handleRemovePoster} className="rounded-md border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/5">
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-1">
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePosterChange} className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-copper focus:outline-none" />
                <p className="mt-1 text-xs text-inkmuted">PNG, JPEG, or WebP up to 5 MB.</p>
              </div>
            )}
            {posterError && <p className="mt-1 text-xs text-danger">{posterError}</p>}
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
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{row.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-inkmuted">{row.body}</p>
                  {row.image_url && (
                    <div className="mt-3 max-w-sm">
                      <PosterImage src={row.image_url} alt={row.title} maxHeightClass="max-h-60" />
                    </div>
                  )}
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
