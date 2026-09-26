import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  MIN_QUERY_LENGTH, SEARCH_GROUPS, contextLine, runGlobalSearch, type SearchResult,
} from "../../lib/globalSearch";

const DEBOUNCE_MS = 300;

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// Entry point shown in the TopBar: a wide search field on desktop, a
// compact "Search" button on phones. Also opens with Ctrl/⌘ + K.
export function GlobalSearch() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search ECE Hub Buddy"
        aria-haspopup="dialog"
        className="hidden items-center gap-2 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-inkmuted hover:border-copper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper md:flex md:w-64 lg:w-80"
      >
        <SearchIcon />
        <span className="flex-1 text-left">Search ECE Hub Buddy…</span>
        <kbd className="rounded border border-line px-1.5 font-mono text-[10px]">Ctrl K</kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        aria-haspopup="dialog"
        className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-sm text-inkmuted hover:border-copper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper md:hidden"
      >
        <SearchIcon />
        <span className="hidden min-[430px]:inline">Search</span>
      </button>
      {open && <SearchDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false); // a search for the CURRENT query has completed
  const [active, setActive] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const requestId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const trimmed = query.trim();
  const tooShort = trimmed.length < MIN_QUERY_LENGTH;

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced, race-safe search. A newer keystroke invalidates any
  // in-flight request so stale responses never overwrite fresh ones.
  useEffect(() => {
    const id = ++requestId.current;
    if (tooShort || !profile) {
      setResults([]); setError(null); setSearched(false); setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      const { results: rows, error: err } = await runGlobalSearch(trimmed, profile.role);
      if (id !== requestId.current) return;
      setLoading(false);
      setSearched(true);
      setError(err);
      setResults(rows);
      setActive(0);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, tooShort, profile, retryKey]);

  const grouped = useMemo(
    () => SEARCH_GROUPS.map((g) => ({ ...g, items: results.filter((r) => r.type === g.type) })).filter((g) => g.items.length > 0),
    [results]
  );
  const flat = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  const go = useCallback((r: SearchResult) => { onClose(); navigate(r.route); }, [navigate, onClose]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); if (flat.length) setActive((i) => (i + 1) % flat.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (flat.length) setActive((i) => (i - 1 + flat.length) % flat.length); }
    else if (e.key === "Enter") { const r = flat[active]; if (r) { e.preventDefault(); go(r); } }
  }

  let idx = -1;
  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/40 md:items-start md:px-4 md:pt-[10vh]" role="dialog" aria-modal="true" aria-label="Search ECE Hub Buddy" onKeyDown={onKeyDown}>
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative flex h-full w-full flex-col bg-panel md:h-auto md:max-h-[75vh] md:max-w-2xl md:rounded-xl md:border md:border-line md:shadow-xl">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <span className="text-inkmuted"><SearchIcon /></span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={100}
            placeholder="Search content, notes, formulas, tests, planner…"
            aria-label="Search"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls="global-search-results"
            aria-activedescendant={flat.length ? `gs-opt-${active}` : undefined}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            className="min-w-0 flex-1 bg-transparent py-1 font-body text-base text-ink placeholder:text-inkmuted focus:outline-none"
          />
          <button onClick={onClose} className="rounded-md border border-line px-2.5 py-1 text-xs text-inkmuted hover:border-copper">Esc</button>
        </div>

        <div ref={listRef} id="global-search-results" role="listbox" aria-label="Search results" className="flex-1 overflow-y-auto overscroll-contain px-2 py-2">
          {tooShort && (
            <p className="px-2 py-6 text-center text-sm text-inkmuted">
              {trimmed.length === 0 ? "Start typing to search across your academic content." : `Type at least ${MIN_QUERY_LENGTH} characters.`}
            </p>
          )}

          {!tooShort && loading && (
            <p className="px-2 py-6 text-center text-sm text-inkmuted" role="status" aria-live="polite">Searching…</p>
          )}

          {!tooShort && !loading && error && (
            <div className="px-3 py-4" role="alert">
              <p className="text-sm text-danger">{error}</p>
              <button onClick={() => setRetryKey((k) => k + 1)} className="mt-2 text-sm font-medium text-danger underline underline-offset-2">Try again</button>
            </div>
          )}

          {!tooShort && !loading && !error && searched && flat.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-inkmuted">No results for “{trimmed}”.</p>
          )}

          {!tooShort && !loading && !error && grouped.map((g) => (
            <div key={g.type} className="mb-2" role="group" aria-label={g.label}>
              <p className="px-2 pb-1 pt-2 font-mono text-[11px] uppercase tracking-widest text-inkmuted">
                <span aria-hidden="true">{g.icon}</span> {g.label}
              </p>
              {g.items.map((r) => {
                idx += 1;
                const i = idx;
                const line = contextLine(r);
                return (
                  <button
                    key={`${r.type}-${r.id}`}
                    id={`gs-opt-${i}`}
                    data-idx={i}
                    role="option"
                    aria-selected={i === active}
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r)}
                    className={`block w-full rounded-md px-3 py-2 text-left ${i === active ? "bg-trace-light" : "hover:bg-paper"}`}
                  >
                    <span className="block truncate font-body text-sm font-medium text-ink">{r.title}</span>
                    {line && <span className="block truncate text-xs text-inkmuted">{line}</span>}
                    {r.preview && <span className="mt-0.5 block line-clamp-2 text-xs text-inkmuted/90">{r.preview}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="hidden border-t border-line px-3 py-1.5 font-mono text-[10px] text-inkmuted md:block">
          ↑↓ navigate · Enter open · Esc close
        </div>
      </div>
    </div>
  );
}
