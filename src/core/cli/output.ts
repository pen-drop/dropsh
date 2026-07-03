import { CliError, ConfigError } from "../../errors.js";
import type { JsonApiDocument } from "../jsonapi/types.js";
import type { RenderContext, Renderer } from "./render.js";

export interface Output {
  emit(value: unknown, ctx?: RenderContext): void;
  fail(err: unknown): void;
  hasFormat(id: string): boolean;
}

export interface OutputOptions {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  renderers?: Renderer[];
  getFormat?: () => string;
}

function isJsonApiDocument(v: unknown): v is JsonApiDocument {
  return !!v && typeof v === "object" && "data" in (v as Record<string, unknown>);
}

export function createOutput(opts: OutputOptions): Output {
  const registry = new Map<string, Renderer>();
  for (const r of opts.renderers ?? []) {
    if (registry.has(r.id)) throw new ConfigError(`Duplicate renderer id: ${r.id}`);
    registry.set(r.id, r);
  }
  const getFormat = opts.getFormat ?? (() => "json");

  return {
    emit(value, ctx) {
      const fmt = getFormat();
      if (fmt === "json" || !isJsonApiDocument(value)) {
        opts.stdout(`${JSON.stringify(value)}\n`);
        return;
      }
      const renderer = registry.get(fmt);
      if (!renderer) {
        throw new ConfigError(`Unknown format: ${fmt}`, {
          available: ["json", ...registry.keys()],
        });
      }
      const text = renderer.render(value, ctx ?? { command: "read" });
      opts.stdout(text.endsWith("\n") ? text : `${text}\n`);
    },
    fail(err) {
      const payload =
        err instanceof CliError
          ? { error: { code: err.code, message: err.message, details: err.details } }
          : {
              error: {
                code: "E_UNKNOWN",
                message: (err as Error).message ?? String(err),
                details: {},
              },
            };
      opts.stderr(`${JSON.stringify(payload)}\n`);
    },
    hasFormat(id) {
      return id === "json" || registry.has(id);
    },
  };
}
