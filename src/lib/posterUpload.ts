import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

export const POSTERS_BUCKET = "posters";
export const MAX_POSTER_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_POSTER_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

// In-memory cache for downloaded poster Blob URLs: path -> { blobUrl, createdAt }
const objectUrlCache = new Map<string, { blobUrl: string; createdAt: number }>();

/**
 * Clears the in-memory poster cache and revokes all active browser Blob URLs.
 * Call this on logout or account switch to prevent cached private posters from persisting.
 */
export function clearPosterCache(): void {
  for (const entry of objectUrlCache.values()) {
    try {
      URL.revokeObjectURL(entry.blobUrl);
    } catch {
      // ignore revocation errors
    }
  }
  objectUrlCache.clear();
}

// Automatically clear cache on sign-out or auth state change
if (typeof window !== "undefined" && supabase) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" || event === "USER_UPDATED" || event === "SIGNED_IN") {
      clearPosterCache();
    }
  });
}

/**
 * Validates poster image file format and size limits.
 * Returns null if valid, or an error string if invalid.
 */
export function validatePosterFile(file: File): string | null {
  if (!ALLOWED_POSTER_MIME_TYPES.includes(file.type)) {
    return "Only PNG, JPEG, and WebP images are allowed.";
  }
  if (file.size > MAX_POSTER_SIZE_BYTES) {
    return `Poster image must be 5 MB or smaller (selected file is ${(file.size / (1024 * 1024)).toFixed(1)} MB).`;
  }
  return null;
}

/**
 * Sanitizes the filename by removing non-alphanumeric characters.
 */
export function sanitizePosterFilename(name: string): string {
  const parts = name.split(".");
  const ext = parts.length > 1 ? parts.pop()! : "";
  const base = parts.join(".");
  const cleanBase = base.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
  const cleanExt = ext.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return cleanExt ? `${cleanBase}.${cleanExt}` : cleanBase || "poster";
}

/**
 * Uploads a poster image to the dedicated 'posters' Supabase bucket.
 * The path is scoped under the user's ID:
 * - General / planner / admin: `${userId}/${folder}/${uuid}-${filename}`
 * - Section-scoped announcements (CRs): `${userId}/${folder}/${sectionId}/${uuid}-${filename}`
 *
 * Persists and returns the stable relative storage path (not a temporary signed URL).
 */
export async function uploadPoster({
  file,
  userId,
  folder,
  sectionId,
}: {
  file: File;
  userId: string;
  folder: "planner" | "announcements";
  sectionId?: string | null;
}): Promise<{ path: string; url: string; error: null } | { path: null; url: null; error: string }> {
  if (!supabase) {
    return { path: null, url: null, error: "Database not connected." };
  }

  const validationError = validatePosterFile(file);
  if (validationError) {
    return { path: null, url: null, error: validationError };
  }

  const safeName = sanitizePosterFilename(file.name);
  const uniqueId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const path = sectionId
    ? `${userId}/${folder}/${sectionId}/${uniqueId}-${safeName}`
    : `${userId}/${folder}/${uniqueId}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(POSTERS_BUCKET)
    .upload(path, file, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    return { path: null, url: null, error: `Upload failed: ${uploadError.message}` };
  }

  // Return the stable relative storage path. Both `path` and `url` point to this stable path
  // so existing code that saves `res.url` or `res.path` persists the correct stable path.
  return { path, url: path, error: null };
}

const POSTER_PATH_REGEX = /^[0-9a-zA-Z_-]+\/(planner|announcements)(\/[0-9a-zA-Z_-]+)?\/[^/\s]+$/;

/**
 * Extracts the storage object path inside the posters bucket from either:
 * - A relative storage path (e.g. `userId/planner/uuid-filename.png`)
 * - A full public URL
 * - A full signed URL
 * - An authenticated storage URL
 *
 * Only returns paths that match the valid private posters path structure.
 * Unsupported external URLs or invalid paths return null.
 */
export function extractPosterStoragePath(urlOrPath: string | null | undefined): string | null {
  if (!urlOrPath) return null;
  const clean = urlOrPath.trim();
  if (!clean) return null;

  // If already a relative storage path (doesn't start with http:// or https://)
  if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
    const withoutPrefix = clean.replace(/^\/+/, "").replace(/^posters\//, "");
    const cleanPath = withoutPrefix.split("?")[0].split("#")[0] || "";
    return POSTER_PATH_REGEX.test(cleanPath) ? cleanPath : null;
  }

  try {
    const parsed = new URL(clean);
    const prefixes = [
      `/storage/v1/object/public/${POSTERS_BUCKET}/`,
      `/storage/v1/object/sign/${POSTERS_BUCKET}/`,
      `/storage/v1/object/authenticated/${POSTERS_BUCKET}/`,
      `/storage/v1/object/${POSTERS_BUCKET}/`,
    ];
    for (const marker of prefixes) {
      const idx = parsed.pathname.indexOf(marker);
      if (idx !== -1) {
        const decoded = decodeURIComponent(parsed.pathname.slice(idx + marker.length));
        const cleanPath = decoded.split("?")[0].split("#")[0] || "";
        return POSTER_PATH_REGEX.test(cleanPath) ? cleanPath : null;
      }
    }
    const segments = parsed.pathname.split("/").filter(Boolean);
    const bucketIdx = segments.indexOf(POSTERS_BUCKET);
    if (bucketIdx !== -1 && bucketIdx < segments.length - 1) {
      const decoded = decodeURIComponent(segments.slice(bucketIdx + 1).join("/"));
      const cleanPath = decoded.split("?")[0].split("#")[0] || "";
      return POSTER_PATH_REGEX.test(cleanPath) ? cleanPath : null;
    }
    return null;
  } catch {
    if (clean.includes(`${POSTERS_BUCKET}/`)) {
      const part = clean.split(`${POSTERS_BUCKET}/`)[1] || "";
      const cleanPath = part.split("?")[0].split("#")[0] || "";
      return POSTER_PATH_REGEX.test(cleanPath) ? cleanPath : null;
    }
    return null;
  }
}

/**
 * Fetches poster bytes through the authenticated Supabase client and creates
 * a local browser Blob URL. Does NOT rely on unauthenticated bearer links
 * or render unsupported external URLs directly.
 */
export async function getPosterAuthenticatedUrl(pathOrUrl: string | null | undefined): Promise<string | null> {
  if (!pathOrUrl || !supabase) return null;
  if (pathOrUrl.startsWith("blob:") || pathOrUrl.startsWith("data:")) {
    return pathOrUrl;
  }

  const clean = pathOrUrl.trim();
  const path = extractPosterStoragePath(clean);
  if (!path) return null;

  const cached = objectUrlCache.get(path);
  if (cached) {
    return cached.blobUrl;
  }

  try {
    const { data, error } = await supabase.storage.from(POSTERS_BUCKET).download(path);
    if (error || !data) {
      return null;
    }
    const blobUrl = URL.createObjectURL(data);
    objectUrlCache.set(path, { blobUrl, createdAt: Date.now() });
    return blobUrl;
  } catch {
    return null;
  }
}

/**
 * Custom React hook that resolves and caches an authenticated Blob URL for a private poster.
 */
export function usePosterUrl(pathOrUrl: string | null | undefined): { url: string | null; loading: boolean; error: boolean } {
  const [url, setUrl] = useState<string | null>(() => {
    if (!pathOrUrl) return null;
    if (pathOrUrl.startsWith("blob:") || pathOrUrl.startsWith("data:")) return pathOrUrl;
    const clean = pathOrUrl.trim();
    const path = extractPosterStoragePath(clean);
    if (!path) return null;
    const cached = objectUrlCache.get(path);
    return cached ? cached.blobUrl : null;
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (!pathOrUrl) return false;
    if (pathOrUrl.startsWith("blob:") || pathOrUrl.startsWith("data:")) return false;
    const clean = pathOrUrl.trim();
    const path = extractPosterStoragePath(clean);
    if (!path) return false;
    return !objectUrlCache.has(path);
  });
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!pathOrUrl) {
      setUrl(null);
      setLoading(false);
      setError(false);
      return;
    }
    if (pathOrUrl.startsWith("blob:") || pathOrUrl.startsWith("data:")) {
      setUrl(pathOrUrl);
      setLoading(false);
      setError(false);
      return;
    }

    const clean = pathOrUrl.trim();
    const path = extractPosterStoragePath(clean);
    if (!path) {
      setUrl(null);
      setLoading(false);
      setError(true);
      return;
    }

    const cached = objectUrlCache.get(path);
    if (cached) {
      setUrl(cached.blobUrl);
      setLoading(false);
      setError(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    getPosterAuthenticatedUrl(path).then((blobUrl) => {
      if (cancelled) return;
      setLoading(false);
      if (blobUrl) {
        setUrl(blobUrl);
        setError(false);
      } else {
        setUrl(null);
        setError(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [pathOrUrl]);

  return { url, loading, error };
}

/**
 * Reusable poster image component for private posters.
 * Resolves an authenticated signed URL on mount and handles link to full image.
 */
export function PosterImage({
  src,
  alt,
  className,
  maxHeightClass = "max-h-60",
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  maxHeightClass?: string;
}): React.ReactElement | null {
  const { url, loading, error } = usePosterUrl(src);

  if (!src || error) return null;
  if (loading && !url) {
    return React.createElement(
      "div",
      {
        className: `flex items-center justify-center bg-paper text-inkmuted text-xs ${maxHeightClass} w-full rounded-md border border-line py-8`,
      },
      React.createElement("span", { className: "animate-pulse" }, "Loading image…")
    );
  }
  if (!url) return null;

  return React.createElement(
    "div",
    { className: "overflow-hidden rounded-md border border-line bg-paper" },
    React.createElement(
      "a",
      {
        href: url,
        target: "_blank",
        rel: "noopener noreferrer",
        title: "Click to view full image in a new tab",
        className: "block",
      },
      React.createElement("img", {
        src: url,
        alt: alt,
        loading: "lazy",
        className: `${maxHeightClass} w-full object-contain transition hover:opacity-95 ${className ?? ""}`,
      })
    )
  );
}

/**
 * Safely removes a poster from the posters storage bucket if it belongs to it.
 * Errors are swallowed so failures don't block subsequent operations.
 */
export async function deletePoster(pathOrUrl: string | null | undefined): Promise<void> {
  if (!pathOrUrl || !supabase) return;
  const path = extractPosterStoragePath(pathOrUrl);
  if (!path) return;

  try {
    await supabase.storage.from(POSTERS_BUCKET).remove([path]);
  } catch (err) {
    console.warn("Failed to delete poster from storage:", err);
  }
}
