import type { PostgrestError } from "@supabase/supabase-js";

export interface BatchInQueryOptions {
  /**
   * Maximum number of IDs per request chunk.
   * Default: 35 (produces query strings < 1.5 KB, well below standard 4 KB / 8 KB proxy limits).
   */
  chunkSize?: number;
}

export interface BatchQueryResult<T> {
  data: T[] | null;
  error: PostgrestError | Error | null;
}

/**
 * Executes a Supabase query with an .in() filter split into bounded chunks.
 *
 * Guarantees:
 * 1. Deduplicates IDs and handles empty ID arrays cleanly without issuing requests.
 * 2. Runs chunk queries and aborts immediately on the first error encountered.
 * 3. Returns all-or-nothing: either all data combined, or null data with the error.
 * 4. Preserves type safety with then-able PostgrestBuilder return types.
 */
export async function batchInQuery<T>(
  fetchChunk: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  ids: string[],
  options?: BatchInQueryOptions
): Promise<BatchQueryResult<T>> {
  const uniqueIds = Array.from(new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0)));

  if (uniqueIds.length === 0) {
    return { data: [], error: null };
  }

  const chunkSize = Math.max(1, options?.chunkSize ?? 35);
  const combined: T[] = [];

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    const { data, error } = await fetchChunk(chunk);

    if (error) {
      return { data: null, error };
    }

    if (data && data.length > 0) {
      combined.push(...data);
    }
  }

  return { data: combined, error: null };
}
