import { renderMarkdown } from "@dropsh/plugin-markdown/render";
import type { JsonApiDocument, JsonApiResource, RenderContext } from "dropsh/plugin";
import { Box, Text, useApp, useInput } from "ink";
import type React from "react";
import { useState } from "react";
import type { ResolvedView } from "./views.js";

export interface BrowseProps {
  doc: JsonApiDocument;
  ctx: RenderContext;
  view: ResolvedView;
}

function label(res: JsonApiResource): string {
  const attrs = res.attributes ?? {};
  for (const key of ["title", "name", "label"]) {
    const v = attrs[key];
    if (typeof v === "string") return v;
  }
  return res.id;
}

function rowText(res: JsonApiResource, columns: string[] | undefined): string {
  if (!columns || columns.length === 0) return label(res);
  const attrs = res.attributes ?? {};
  return columns.map((key) => (key === "id" ? res.id : String(attrs[key] ?? ""))).join("  ");
}

// Renders an already-fetched JSON:API document. A single resource boots
// straight into the detail pane; a collection shows a navigable list that
// opens a detail pane on Enter. No fetching happens here — `read`/`search`
// already did that before selecting `--format tui`.
export function Browse({ doc, ctx, view }: BrowseProps): React.ReactElement {
  const { exit } = useApp();
  const isCollection = Array.isArray(doc.data);
  const rows: JsonApiResource[] = isCollection
    ? (doc.data as JsonApiResource[])
    : [doc.data as JsonApiResource];
  const [selected, setSelected] = useState(0);
  const [detail, setDetail] = useState<string | null>(
    isCollection ? null : renderMarkdown(doc, ctx),
  );

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      if (isCollection && detail) {
        setDetail(null);
        return;
      }
      exit();
      return;
    }
    if (!isCollection || detail) return;
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(rows.length - 1, s + 1));
    if (key.return && rows[selected]) {
      const selectedDoc: JsonApiDocument =
        doc.included !== undefined
          ? { data: rows[selected], included: doc.included }
          : { data: rows[selected] };
      setDetail(renderMarkdown(selectedDoc, ctx));
    }
  });

  if (detail !== null) {
    return (
      <Box flexDirection="column">
        <Text>{detail}</Text>
        <Text dimColor>{isCollection ? "(esc/q: back)" : "(esc/q: quit)"}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {rows.map((res, i) => (
        <Text key={res.id} inverse={i === selected}>
          {rowText(res, view.columns)}
        </Text>
      ))}
      {rows.length === 0 ? <Text dimColor>(no results)</Text> : null}
      <Text dimColor>(↑/↓: move, enter: open, q: quit)</Text>
    </Box>
  );
}
