import { renderMarkdown } from "@dropsh/plugin-markdown/render";
import type { JsonApiClient, JsonApiResource } from "dropsh/plugin";
import { DrupalJsonApiParams } from "drupal-jsonapi-params";
import { Box, Text, useApp, useInput } from "ink";
import type React from "react";
import { useEffect, useState } from "react";
import type { ResolvedView } from "./views.js";

export interface BrowseProps {
  client: JsonApiClient;
  entityType: string;
  bundle?: string;
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

export function Browse({ client, entityType, bundle, view }: BrowseProps): React.ReactElement {
  const { exit } = useApp();
  const [rows, setRows] = useState<JsonApiResource[]>([]);
  const [selected, setSelected] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new DrupalJsonApiParams();
    for (const [k, v] of Object.entries(view.filters)) params.addFilter(k, v);
    params.addPageLimit(view.pageSize);
    const path = bundle ? `${entityType}/${bundle}` : entityType;
    client
      .get(path, params)
      .then((doc) => setRows(Array.isArray(doc.data) ? doc.data : [doc.data]))
      .catch((e) => setError(String(e)));
  }, [client, entityType, bundle, view]);

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      if (detail) setDetail(null);
      else exit();
      return;
    }
    if (detail) return;
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(rows.length - 1, s + 1));
    if (key.return && rows[selected]) {
      setDetail(renderMarkdown({ data: rows[selected] }, { command: "read" }));
    }
  });

  if (error) return <Text color="red">{error}</Text>;
  if (detail) {
    return (
      <Box flexDirection="column">
        <Text>{detail}</Text>
        <Text dimColor>(esc/q: back)</Text>
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
      {rows.length === 0 ? <Text dimColor>loading…</Text> : null}
      <Text dimColor>(↑/↓: move, enter: open, q: quit)</Text>
    </Box>
  );
}
