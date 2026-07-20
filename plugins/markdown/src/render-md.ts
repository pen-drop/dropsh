import {
  indexIncluded,
  type JsonApiDocument,
  type JsonApiResource,
  type RenderContext,
} from "dropsh/plugin";

type Scalar = string | number | boolean;

function isScalar(v: unknown): v is Scalar {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function yamlScalar(v: Scalar): string {
  if (typeof v === "string") {
    return v === "" || v.trim() !== v || /[:#\n"'[\]{}]/.test(v) ? JSON.stringify(v) : v;
  }
  return String(v);
}

function isRef(x: unknown): x is { type: string; id: string } {
  return (
    !!x &&
    typeof x === "object" &&
    typeof (x as { type?: unknown }).type === "string" &&
    typeof (x as { id?: unknown }).id === "string"
  );
}

function relIds(rel: unknown): string[] {
  if (!rel || typeof rel !== "object") return [];
  const data = (rel as { data?: unknown }).data;
  if (Array.isArray(data)) return data.filter(isRef).map((r) => `${r.type}/${r.id}`);
  if (isRef(data)) return [`${data.type}/${data.id}`];
  return [];
}

// Extracts an attribute's text as-is. Long-text objects (`{ value, format,
// processed }`) resolve to their raw `value` (the markdown source) — never the
// `processed` HTML; `processed` remains the fallback for text objects that
// carry no raw value. Other objects/arrays fall back to compact JSON.
function fieldText(v: unknown): string {
  if (isScalar(v)) return typeof v === "string" ? v : String(v);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.value === "string" && typeof o.format === "string") return o.value;
    if (typeof o.processed === "string") return o.processed;
    if (typeof o.value === "string") return o.value;
    return JSON.stringify(v);
  }
  return "";
}

// Renders a resource as a flat `label: value` list: type/id first, then every
// attribute, then relationships as `[type/id]` reference lists.
function renderResource(res: JsonApiResource): string {
  const lines: string[] = [`type: ${res.type}`, `id: ${res.id}`];
  for (const [k, v] of Object.entries(res.attributes ?? {})) {
    const text = fieldText(v);
    if (text.includes("\n")) {
      // Multi-line field content (descriptions, comment bodies) is emitted as
      // a readable indented block, not a `\n`-escaped quoted one-liner.
      lines.push(`${k}: |`);
      for (const l of text.replace(/\n+$/, "").split("\n")) lines.push(l === "" ? "" : `  ${l}`);
    } else {
      lines.push(`${k}: ${yamlScalar(text)}`);
    }
  }
  for (const [k, v] of Object.entries(res.relationships ?? {})) {
    const ids = relIds(v);
    if (ids.length) lines.push(`${k}: [${ids.join(", ")}]`);
  }
  return lines.join("\n");
}

export function renderMarkdown(doc: JsonApiDocument, _ctx: RenderContext): string {
  const data = doc.data;
  const primary = Array.isArray(data)
    ? data.length === 0
      ? "_(no results)_"
      : data.map(renderResource).join("\n\n---\n\n")
    : renderResource(data);

  // Resources pulled in via `--include` are appended under an Included section
  // so the related entities are visible, not just their reference ids.
  const included = [...indexIncluded(doc).values()];
  if (included.length === 0) return primary;
  const inc = included.map(renderResource).join("\n\n---\n\n");
  return `${primary}\n\n## Included\n\n${inc}`;
}
