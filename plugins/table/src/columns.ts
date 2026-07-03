import type { JsonApiResource } from "dropsh/plugin";

const PREFERRED = ["title", "name", "label", "status"];
const MAX_CELL = 40;
const MAX_COLS = 5;

function isScalar(v: unknown): boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

export function pickColumns(res: JsonApiResource): string[] {
  const attrs = res.attributes ?? {};
  const scalars = Object.entries(attrs).filter(([, v]) => isScalar(v)).map(([k]) => k);
  const preferred = PREFERRED.filter((k) => scalars.includes(k));
  const rest = scalars.filter((k) => !preferred.includes(k));
  return ["id", ...preferred, ...rest].slice(0, MAX_COLS);
}

export function cell(v: unknown): string {
  const s = v === undefined || v === null ? "" : String(v);
  return s.length > MAX_CELL ? `${s.slice(0, MAX_CELL - 1)}…` : s;
}

export function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length), 0),
  );
  const bar = (l: string, m: string, r: string) =>
    `${l}${widths.map((w) => "─".repeat(w + 2)).join(m)}${r}`;
  const line = (cells: string[]) =>
    `│ ${cells.map((c, i) => (c ?? "").padEnd(widths[i] ?? 0)).join(" │ ")} │`;
  return [
    bar("┌", "┬", "┐"),
    line(headers),
    bar("├", "┼", "┤"),
    ...rows.map(line),
    bar("└", "┴", "┘"),
  ].join("\n");
}
