import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import { PageHeader } from "../components/ui/PageHeader";
import { usePWAInstall } from "../hooks/usePWAInstall";
import { IOSInstallGuide } from "../components/pwa/IOSInstallGuide";

// avatars bucket facts (verified live against Supabase, not assumed
// from the migration file): PUBLIC bucket, 5MB limit, allowed_mime_types
// = image/png, image/jpeg, image/webp. Storage RLS: INSERT/UPDATE/DELETE
// all require (storage.foldername(name))[1] = auth.uid() OR is_admin()
// — a user can only ever write into their OWN folder. SELECT is
// unrestricted (bucket is public), matching "public-read, profile
// photos" by design — anyone with the URL can view an avatar, which is
// the intended behavior for a profile photo.
const AVATARS_BUCKET = "avatars";
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function ProfilePage() {
  const { profile, refreshProfile } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [usn, setUsn] = useState(profile?.usn ?? "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Teacher-only: a light read-only summary of their own assignments,
  // scoped entirely by RLS (teacher_assignments/class_teacher_assignments
  // already return only this teacher's own rows) — no student data is
  // ever touched on this page.
  const [teachingCounts, setTeachingCounts] = useState<{ subjects: number; classTeacherSections: number } | null>(null);
  useEffect(() => {
    if (!supabase || !profile || profile.role !== "teacher") return;
    let cancelled = false;
    async function load() {
      const [ta, cta] = await Promise.all([
        supabase!.from("teacher_assignments").select("id", { count: "exact", head: true }).eq("teacher_id", profile!.id),
        supabase!.from("class_teacher_assignments").select("id", { count: "exact", head: true }).eq("teacher_id", profile!.id).eq("is_current", true),
      ]);
      if (!cancelled) setTeachingCounts({ subjects: ta.count ?? 0, classTeacherSections: cta.count ?? 0 });
    }
    load();
    return () => { cancelled = true; };
  }, [profile]);

  // Local state gives this page's own preview immediate visual feedback
  // on upload; refreshProfile() (below) is what keeps the shared
  // AuthContext profile — and therefore the TopBar avatar — in sync
  // without needing a full logout/login.
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  if (!profile) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setStatus(null);

    // Mirrors the DB's own users_usn_format_check constraint (6-15
    // uppercase alphanumeric) so a bad value gets a clear inline message
    // instead of a raw Postgres error — the DB constraint remains the
    // real authority either way.
    const normalizedUsn = usn.trim().toUpperCase();
    if (normalizedUsn !== "" && !/^[A-Z0-9]{6,15}$/.test(normalizedUsn)) {
      setStatus({ type: "error", message: "USN must be 6–15 letters/numbers (e.g. 1BG23EC001)." });
      return;
    }

    setSaving(true);
    // RLS (users_update_own_or_admin) allows this because id = auth.uid();
    // note role/xp/streak are NOT sent here and couldn't be changed by
    // this call even if they were — the protected-column trigger blocks
    // it regardless of what the client sends.
    const { error } = await supabase
      .from("users")
      .update({ full_name: fullName, phone: phone || null, usn: normalizedUsn === "" ? null : normalizedUsn })
      .eq("id", profile!.id);
    setSaving(false);
    setStatus(
      error
        ? { type: "error", message: error.code === "23505" ? "That USN is already registered to another student." : "We couldn't save your changes. Please try again." }
        : { type: "success", message: "Profile updated." }
    );
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file || !supabase) return;

    setAvatarError(null);

    // UX-only checks — the bucket's own file_size_limit (5MB) and
    // allowed_mime_types (png/jpeg/webp) are enforced by Supabase
    // Storage itself regardless of what this code checks.
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError("Image is too large — the limit is 5MB.");
      return;
    }
    if (!AVATAR_ALLOWED_TYPES.includes(file.type)) {
      setAvatarError("Only PNG, JPEG, or WEBP images are allowed.");
      return;
    }

    setAvatarUploading(true);

    // Deterministic, extension-free path: {user_id}/avatar. Every
    // upload overwrites the same object (upsert: true) — no orphaned
    // old avatars pile up in storage, and the write is only ever
    // permitted into this user's own folder (storage RLS above).
    const path = `${profile!.id}/avatar`;
    const { error: uploadErr } = await supabase.storage
      .from(AVATARS_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: true });

    if (uploadErr) {
      setAvatarUploading(false);
      setAvatarError(`Upload failed: ${uploadErr.message}`);
      return;
    }

    const { data: publicUrlData } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
    // Cache-bust: the path is always the same object, so without a
    // changing query param the browser/CDN would keep showing the
    // previous image after a replacement.
    const newUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

    const { error: dbErr } = await supabase.from("users").update({ avatar_url: newUrl }).eq("id", profile!.id);
    setAvatarUploading(false);

    if (dbErr) {
      setAvatarError("Uploaded, but couldn't save your profile. Please try again.");
      return;
    }
    setAvatarUrl(newUrl);
    // Sync shared AuthContext profile so TopBar (and any other consumer)
    // reflects the new avatar immediately, without a full logout/login.
    await refreshProfile();
  }

  return (
    <div>
      <PageHeader title="Profile" subtitle="Your account details." />

      <div className="max-w-md space-y-6">
        <div className="rounded-lg border border-line bg-panel p-5">
          <p className="mb-3 font-body text-sm font-medium text-ink">Profile photo</p>
          <div className="flex items-center gap-4">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-paper font-display text-xl font-semibold text-inkmuted">
                {(profile.full_name || profile.email).charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <label className="inline-block cursor-pointer rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper hover:text-copper-dark">
                {avatarUploading ? "Uploading…" : "Change photo"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleAvatarChange}
                  disabled={avatarUploading}
                  className="hidden"
                />
              </label>
              <p className="mt-1 text-xs text-inkmuted">PNG, JPEG, or WEBP — up to 5MB.</p>
            </div>
          </div>
          {avatarError && (
            <p className="mt-3 rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
              {avatarError}
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-line bg-panel p-5">
        <div>
          <label className="block font-body text-sm font-medium text-ink">Email</label>
          <p className="mt-1 font-mono text-sm text-inkmuted">{profile.email}</p>
        </div>

        <div>
          <label htmlFor="full_name" className="block font-body text-sm font-medium text-ink">
            Full name
          </label>
          <input
            id="full_name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm text-ink focus:border-copper focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="phone" className="block font-body text-sm font-medium text-ink">
            Phone
          </label>
          <input
            id="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm text-ink focus:border-copper focus:outline-none"
          />
        </div>

        {profile.role === "student" && (
          <div>
            <label htmlFor="usn" className="block font-body text-sm font-medium text-ink">
              USN
            </label>
            <input
              id="usn"
              value={usn}
              onChange={(e) => setUsn(e.target.value)}
              placeholder="e.g. 1BG23EC001"
              className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm uppercase text-ink focus:border-copper focus:outline-none"
            />
            <p className="mt-1 text-xs text-inkmuted">Only you can set your own USN. It's visible to your Super Admin and your assigned teachers.</p>
          </div>
        )}

        <div className="flex items-center gap-4 border-t border-line pt-4 font-mono text-xs text-inkmuted">
          <span>XP: {profile.xp}</span>
          <span>Streak: {profile.streak} days</span>
          <span className="capitalize">Role: {profile.role}</span>
        </div>

        {profile.role === "teacher" && teachingCounts && (
          <div className="flex items-center gap-4 border-t border-line pt-4 font-mono text-xs text-inkmuted">
            <span>Subject Assignments: {teachingCounts.subjects}</span>
            <span>Class Teacher Sections: {teachingCounts.classTeacherSections}</span>
          </div>
        )}

        {status && (
          <p
            className={`text-sm ${status.type === "success" ? "text-trace-dark" : "text-danger"}`}
            role={status.type === "error" ? "alert" : undefined}
          >
            {status.message}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        </form>

        <ProfileInstallSection />
      </div>
    </div>
  );
}

// Secondary install entry point (requirement: Profile → "Install ECE
// Hub Buddy"), independent of the global card's dismiss/snooze state —
// a user who dismissed the card once can still come back here later.
function ProfileInstallSection() {
  const { isIOS, isInstalled, installAvailable, installApp } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  if (isInstalled) {
    return (
      <div className="border-t border-line pt-4">
        <p className="text-sm text-inkmuted">ECE Hub Buddy is installed on this device. ✓</p>
      </div>
    );
  }
  if (!installAvailable) return null;

  async function handleClick() {
    if (isIOS) {
      setShowGuide((v) => !v);
      return;
    }
    setInstalling(true);
    const choice = await installApp();
    setInstalling(false);
    if (choice.outcome === "accepted") setResult("Installed! Look for ECE Hub Buddy on your home screen.");
    else if (choice.outcome === "dismissed") setResult(null);
  }

  return (
    <div className="border-t border-line pt-4">
      <p className="mb-2 text-sm font-medium text-ink">Install ECE Hub Buddy</p>
      <button
        onClick={handleClick}
        disabled={installing}
        className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-copper disabled:opacity-60"
      >
        {installing ? "Opening…" : isIOS ? (showGuide ? "Hide instructions" : "Show instructions") : "Install App"}
      </button>
      {showGuide && (
        <div className="mt-3 rounded-md border border-line bg-paper p-3">
          <IOSInstallGuide />
        </div>
      )}
      {result && <p className="mt-2 text-sm text-trace-dark">{result}</p>}
    </div>
  );
}
