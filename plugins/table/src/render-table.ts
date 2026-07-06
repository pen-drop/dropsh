import type { JsonApiDocument, RenderContext } from "dropsh/plugin";
import { cell, formatTable, pickColumns } from "./columns.js";

export { formatTable, pickColumns };

function isScalar(v: unknown): boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

export function renderTable(doc: JsonApiDocument, _ctx: RenderContext): string {
  const data = doc.data;
  if (Array.isArray(data)) {
    if (data.length === 0) return "(0 rows)";
    const first = data[0];
    if (!first) return "(0 rows)";
    const cols = pickColumns(first);
    const rows = data.map((res) =>
      cols.map((c) => cell(c === "id" ? res.id : (res.attributes ?? {})[c])),
    );
    return formatTable(cols, rows);
  }
  const rows: string[][] = [
    ["type", data.type],
    ["id", data.id],
  ];
  for (const [k, v] of Object.entries(data.attributes ?? {})) {
    if (isScalar(v)) rows.push([k, cell(v)]);
  }
  return formatTable(["field", "value"], rows);
}
