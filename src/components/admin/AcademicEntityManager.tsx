import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { friendlyDbError } from "../../lib/supabaseErrors";
import type { EntityConfig } from "../../pages/admin/academic/entityConfigs";
import { PageHeader } from "../ui/PageHeader";
import { LoadingState } from "../ui/LoadingState";
import { ErrorState } from "../ui/ErrorState";
import { EmptyState } from "../ui/EmptyState";
import { Badge } from "../ui/Badge";

type FormState = Record<string, string>;

// The one CRUD engine driving all 8 academic-hierarchy management
// pages. Every read/write goes straight to Supabase using the
// project's real RLS — there is no local/mock data path here at all;
// a failed request surfaces as a real error, never a silently faked
// success.
export function AcademicEntityManager({ config }: { config: EntityConfig }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [parentOptions, setParentOptions] = useState<Record<string, any[]>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rowActionError, setRowActionError] = useState<string | null>(null);

  async function loadAll() {
    if (!supabase) return;
    setLoadError(null);
    setRows(null);

    const [rowsRes, ...parentRes] = await Promise.all([
      supabase.from(config.table).select(config.listSelect).order(config.orderBy),
      ...config.parents.map((p) => supabase!.from(p.table).select(p.optionsSelect)),
    ]);

    if (rowsRes.error) {
      setLoadError(friendlyDbError(rowsRes.error, config.titlePlural));
      return;
    }
    setRows(rowsRes.data ?? []);

    const opts: Record<string, any[]> = {};
    config.parents.forEach((p, i) => {
      opts[p.key] = parentRes[i]?.data ?? [];
    });
    setParentOptions(opts);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.key]);

  function openCreateForm() {
    const initial: FormState = {};
    config.fields.forEach((f) => (initial[f.key] = ""));
    config.parents.forEach((p) => (initial[p.key] = ""));
    setForm(initial);
    setEditingId(null);
    setFormError(null);
    setFormOpen(true);
  }

  function openEditForm(row: any) {
    const initial: FormState = {};
    config.fields.forEach((f) => (initial[f.key] = row[f.key] != null ? String(row[f.key]) : ""));
    config.parents.forEach((p) => (initial[p.key] = row[p.key] != null ? String(row[p.key]) : ""));
    setForm(initial);
    setEditingId(row.id);
    setFormError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setFormError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;

    // Client-side validation, mirroring (not replacing) the DB's own
    // constraints — this exists so a required/range error is caught
    // before a round-trip, not instead of the DB check.
    for (const f of config.fields) {
      if (f.required && !form[f.key]?.trim()) {
        setFormError(`${f.label} is required.`);
        return;
      }
      if (f.type === "number" && form[f.key] !== "") {
        const n = Number(form[f.key]);
        if (Number.isNaN(n)) {
          setFormError(`${f.label} must be a number.`);
          return;
        }
        if (f.min != null && n < f.min) {
          setFormError(`${f.label} must be at least ${f.min}.`);
          return;
        }
        if (f.max != null && n > f.max) {
          setFormError(`${f.label} must be at most ${f.max}.`);
          return;
        }
      }
    }
    for (const p of config.parents) {
      if (!form[p.key]) {
        setFormError(`${p.label} is required.`);
        return;
      }
    }

    setSaving(true);
    setFormError(null);

    const payload: Record<string, any> = {};
    config.fields.forEach((f) => {
      const raw = form[f.key];
      payload[f.key] = f.type === "number" ? (raw === "" ? null : Number(raw)) : raw || null;
    });
    config.parents.forEach((p) => {
      payload[p.key] = form[p.key];
    });

    const query = editingId
      ? supabase.from(config.table).update(payload).eq("id", editingId)
      : supabase.from(config.table).insert(payload);

    const { error } = await query;
    setSaving(false);

    if (error) {
      setFormError(friendlyDbError(error, config.titleSingular));
      return;
    }
    setFormOpen(false);
    await loadAll();
  }

  async function handleDelete(row: any) {
    if (!supabase) return;
    if (!window.confirm(config.deleteConfirmMessage(row))) return;
    setRowActionError(null);
    const { error } = await supabase.from(config.table).delete().eq("id", row.id);
    if (error) {
      setRowActionError(friendlyDbError(error, config.titleSingular));
      return;
    }
    await loadAll();
  }

  async function handleSetCurrent(row: any) {
    if (!supabase) return;
    setRowActionError(null);
    // A single update is enough — the DB trigger (migration 22)
    // atomically unsets whichever row was previously current as part
    // of this same statement, so there's no window with zero or two
    // "current" rows regardless of what the client does.
    const { error } = await supabase.from(config.table).update({ is_current: true }).eq("id", row.id);
    if (error) {
      setRowActionError(friendlyDbError(error, config.titleSingular));
      return;
    }
    await loadAll();
  }

  async function handleToggleActive(row: any) {
    if (!supabase) return;
    setRowActionError(null);
    const { error } = await supabase.from(config.table).update({ is_active: !row.is_active }).eq("id", row.id);
    if (error) {
      setRowActionError(friendlyDbError(error, config.titleSingular));
      return;
    }
    await loadAll();
  }

  const ghostBtnClass =
    "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:border-copper hover:text-copper-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper";
  const dangerBtnClass =
    "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-danger hover:border-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger";

  return (
    <div>
      <PageHeader
        title={config.titlePlural}
        subtitle={config.subtitle}
        action={
          <button
            onClick={openCreateForm}
            className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper"
          >
            + Add {config.titleSingular}
          </button>
        }
      />

      {rowActionError && (
        <div className="mb-4">
          <ErrorState message={rowActionError} onRetry={() => setRowActionError(null)} />
        </div>
      )}

      {formOpen && (
        <div className="mb-6 rounded-lg border border-line bg-panel p-5">
          <p className="mb-3 font-display text-sm font-semibold text-ink">
            {editingId ? `Edit ${config.titleSingular}` : `New ${config.titleSingular}`}
          </p>
          <form onSubmit={handleSubmit} className="space-y-3">
            {config.parents.map((p) => (
              <div key={p.key}>
                <label className="block text-xs font-medium text-inkmuted">{p.label}</label>
                <select
                  value={form[p.key] ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, [p.key]: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink focus:border-copper focus:outline-none"
                >
                  <option value="">Select {p.label}…</option>
                  {(parentOptions[p.key] ?? []).map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {p.optionLabel(opt)}
                    </option>
                  ))}
                </select>
                {(parentOptions[p.key] ?? []).length === 0 && (
                  <p className="mt-1 text-xs text-inkmuted">
                    No {p.label.toLowerCase()} exist yet — create one first.
                  </p>
                )}
              </div>
            ))}
            {config.fields.map((f) => (
              <div key={f.key}>
                <label className="block text-xs font-medium text-inkmuted">{f.label}</label>
                <input
                  type={f.type}
                  value={form[f.key] ?? ""}
                  min={f.min}
                  max={f.max}
                  placeholder={f.placeholder}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink focus:border-copper focus:outline-none"
                />
              </div>
            ))}

            {formError && (
              <p className="rounded-md bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
                {formError}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-copper px-4 py-2 text-sm font-medium text-white hover:bg-copper-dark disabled:opacity-60"
              >
                {saving ? "Saving…" : editingId ? "Save changes" : "Create"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="rounded-md border border-line px-4 py-2 text-sm text-ink hover:border-copper hover:text-copper-dark"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loadError && <ErrorState message={loadError} onRetry={loadAll} />}

      {!loadError && rows === null && <LoadingState label={`Loading ${config.titlePlural.toLowerCase()}…`} />}

      {!loadError && rows !== null && rows.length === 0 && (
        <EmptyState
          title={`No ${config.titlePlural.toLowerCase()} yet`}
          message={`Create the first ${config.titleSingular.toLowerCase()} to get started.`}
          action={{ label: `+ Add ${config.titleSingular}`, onClick: openCreateForm }}
        />
      )}

      {!loadError && rows !== null && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-paper">
                <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">
                  {config.titleSingular}
                </th>
                {config.parents.length > 0 && (
                  <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">
                    Belongs to
                  </th>
                )}
                <th className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-inkmuted">Status</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2.5 font-medium text-ink">
                    {row.name ?? (row.number != null ? `Semester ${row.number}` : "—")}
                  </td>
                  {config.parents.length > 0 && (
                    <td className="px-4 py-2.5 font-mono text-xs text-inkmuted">{config.renderParentChain(row)}</td>
                  )}
                  <td className="px-4 py-2.5">
                    {config.hasIsCurrentToggle && row.is_current && <Badge tone="current">Current</Badge>}
                    {config.hasIsActiveToggle && <Badge tone={row.is_active ? "active" : "archived"}>{row.is_active ? "Active" : "Archived"}</Badge>}
                    {!config.hasIsCurrentToggle && !config.hasIsActiveToggle && <Badge tone="muted">—</Badge>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {config.hasIsCurrentToggle && !row.is_current && (
                        <button onClick={() => handleSetCurrent(row)} className={ghostBtnClass}>
                          Set current
                        </button>
                      )}
                      {config.hasIsActiveToggle && (
                        <button onClick={() => handleToggleActive(row)} className={ghostBtnClass}>
                          {row.is_active ? "Archive" : "Restore"}
                        </button>
                      )}
                      <button onClick={() => openEditForm(row)} className={ghostBtnClass}>
                        Edit
                      </button>
                      {!config.disableDelete && (
                        <button onClick={() => handleDelete(row)} className={dangerBtnClass}>
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
