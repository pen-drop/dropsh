import type { JsonApiResource } from "dropsh/plugin";
import { Box, Text } from "ink";
import React, { type ReactElement } from "react";
import { label, splitType } from "./jsonapi-type.js";
import { TuiLink } from "./link.js";
import type { BuildContext } from "./types.js";

export abstract class TuiEntityList {
  static entityType: string;
  static bundle?: string;
  abstract build(resources: JsonApiResource[], ctx: BuildContext): ReactElement;
}

export class GenericEntityList extends TuiEntityList {
  static override entityType = "*";

  build(resources: JsonApiResource[], ctx: BuildContext): ReactElement {
    if (resources.length === 0) return <Text dimColor>(no results)</Text>;
    return (
      <Box flexDirection="column">
        {resources.map((res) => {
          const { entityType, bundle } = splitType(res.type);
          const params: Record<string, string> = { type: entityType, id: res.id };
          if (bundle) params.bundle = bundle;
          return (
            <TuiLink key={res.id} target={ctx.link("entity.canonical", params)}>
              {label(res)}
            </TuiLink>
          );
        })}
      </Box>
    );
  }
}
