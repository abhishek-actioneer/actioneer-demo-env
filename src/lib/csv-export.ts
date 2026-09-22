/**
 * Converts an array of row objects to CSV and triggers a browser download.
 */
export function downloadCSV(rows: Record<string, unknown>[], filename: string): void {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const header = columns.join(",");
  const body = rows.map((row) =>
    columns
      .map((c) => {
        const v = row[c];
        if (v == null) return "";
        if (typeof v === "string" && (v.includes(",") || v.includes('"') || v.includes("\n")))
          return `"${v.replace(/"/g, '""')}"`;
        return String(v);
      })
      .join(","),
  );
  const blob = new Blob([header + "\n" + body.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
