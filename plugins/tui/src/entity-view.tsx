import { renderMarkdown } from "@dropsh/plugin-markdown/render";
import type { JsonApiDocument, JsonApiResource, RenderContext } from "dropsh/plugin";
import { Box, Text } from "ink";
import React, { type ReactElement } from "react";
import { splitType } from "./jsonapi-type.js";
import { TuiLink } from "./link.js";
import type { BuildContext, ViewModeMap } from "./types.js";

export abstract class TuiEntityView {
  static entityType: string;
  static bundle?: string;
  static viewModes: ViewModeMap = { default: {} };
  abstract build(entity: JsonApiResource, ctx: BuildContext): ReactElement;
}

export class GenericEntityView extends TuiEntityView {
  static override entityType = "*";
  static override viewModes: ViewModeMap = { default: {} };

  build(entity: JsonApiResource, ctx: BuildContext): ReactElement {
    const rels = entity.relationships ?? {};
    // Reuse the markdown renderer for the attribute pane (AC: "the detail pane
    // reuses the markdown renderer"). Relationships are stripped from the copy
    // fed to markdown so they stay focusable `TuiLink`s below, keeping in-pane
    // navigation working instead of the markdown renderer's inert `[type/id]`.
    const attrDoc: JsonApiDocument = {
      data: {
        type: entity.type,
        id: entity.id,
        ...(entity.attributes ? { attributes: entity.attributes } : {}),
      },
    };
    const renderCtx: RenderContext = { command: "read", viewMode: ctx.viewMode };
    const markdown = renderMarkdown(attrDoc, renderCtx);
    return (
      <Box flexDirection="column">
        <Text>{markdown}</Text>
        {Object.entries(rels).map(([key, rel]) => {
          const data = (rel as { data?: { type: string; id: string } }).data;
          if (!data || Array.isArray(data)) return <Text key={`r:${key}`}>{key}: —</Text>;
          const { entityType, bundle } = splitType(data.type);
          const params: Record<string, string> = { type: entityType, id: data.id };
          if (bundle) params.bundle = bundle;
          return (
            <Box key={`r:${key}`}>
              <Text>{key}: </Text>
              <TuiLink target={ctx.link("entity.canonical", params)}>{data.id}</TuiLink>
            </Box>
          );
        })}
      </Box>
    );
  }
}
