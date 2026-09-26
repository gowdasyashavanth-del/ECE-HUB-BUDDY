// Lightweight, dependency-free export helpers.
//
// Deliberate choice: rather than adding an xlsx/pdf-generation library
// to the bundle, CSV (which Excel opens natively) covers "Excel export"
// and the browser's own print-to-PDF (via a plain, isolated print
// stylesheet) covers "PDF export." Both operate ONLY on rows the caller
// already fetched through an RLS-scoped Supabase query — this module
// has no data access of its own, so it can't leak anything the caller
// wasn't already authorized to see.

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number;
}

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportToCsv<T>(filename: string, columns: ExportColumn<T>[], rows: T[]) {
  const header = columns.map((c) => csvEscape(c.header)).join(",");
  const body = rows.map((row) => columns.map((c) => csvEscape(c.value(row))).join(",")).join("\n");
  const csv = `${header}\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportToPdf<T>(title: string, columns: ExportColumn<T>[], rows: T[]) {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return;
  const headerRow = columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join("");
  const bodyRows = rows
    .map((row) => `<tr>${columns.map((c) => `<td>${escapeHtml(String(c.value(row)))}</td>`).join("")}</tr>`)
    .join("");
  win.document.write(`
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: system-ui, sans-serif; padding: 24px; color: #1a1a1a; }
          h1 { font-size: 18px; margin-bottom: 4px; }
          p { font-size: 11px; color: #666; margin-top: 0; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
          th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
          th { background: #f2f2f2; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <p>Generated ${new Date().toLocaleString()}</p>
        <table><thead><tr>${headerRow}</tr></thead><tbody>${bodyRows}</tbody></table>
        <script>window.onload = () => window.print();</script>
      </body>
    </html>
  `);
  win.document.close();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
