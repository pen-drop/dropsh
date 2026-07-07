import type { JsonApiResource } from "dropsh/plugin";
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
    const attrs = entity.attributes ?? {};
    const rels = entity.relationships ?? {};
    return (
      <Box flexDirection="column">
        {Object.entries(attrs).map(([key, value]) => (
          <Text key={`a:${key}`}>
            {key}: {typeof value === "string" ? value : JSON.stringify(value)}
          </Text>
        ))}
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
