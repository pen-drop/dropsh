import type { JsonApiDocument, JsonApiResource, RenderContext } from "dropsh/plugin";

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

function extractBody(attrs: Record<string, unknown>): string {
  const b = attrs.body;
  if (b && typeof b === "object") {
    const o = b as Record<string, unknown>;
    if (typeof o.processed === "string") return o.processed;
    if (typeof o.value === "string") return o.value;
  }
  if (typeof b === "string") return b;
  let best = "";
  for (const [k, v] of Object.entries(attrs)) {
    if (k !== "body" && typeof v === "string" && v.length > best.length) best = v;
  }
  return best;
}

function renderResource(res: JsonApiResource): string {
  const attrs = res.attributes ?? {};
  const fm: string[] = [`type: ${res.type}`, `id: ${res.id}`];
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "body") continue;
    if (isScalar(v)) fm.push(`${k}: ${yamlScalar(v)}`);
  }
  for (const [k, v] of Object.entries(res.relationships ?? {})) {
    const ids = relIds(v);
    if (ids.length) fm.push(`${k}: [${ids.join(", ")}]`);
  }
  const body = extractBody(attrs);
  return `---\n${fm.join("\n")}\n---\n\n${body}`.trimEnd();
}

export function renderMarkdown(doc: JsonApiDocument, _ctx: RenderContext): string {
  const data = doc.data;
  if (Array.isArray(data)) {
    if (data.length === 0) return "_(no results)_";
    return data.map(renderResource).join("\n\n---\n\n");
  }
  return renderResource(data);
}
