import type { JsonApiClient } from "dropsh/plugin";
import type { ReactElement } from "react";
import type { Registry } from "./registry.js";
import type { ControllerContext } from "./types.js";

export interface Router {
  stackDepth(): number;
  current(): ReactElement | null;
  navigate(
    route: string,
    params: Record<string, string>,
    seededDoc?: import("dropsh/plugin").JsonApiDocument,
  ): Promise<void>;
  back(): boolean;
  // Registers where controller-initiated (fire-and-forget) navigation errors
  // are surfaced; without a handler they are logged rather than silently lost.
  setErrorHandler(fn: (message: string) => void): void;
}

export function createRouter(opts: {
  registry: Registry;
  client: JsonApiClient;
  viewMode: string;
}): Router {
  const stack: ReactElement[] = [];
  let errorHandler: (message: string) => void = (message) => {
    console.error(`tui navigation error: ${message}`);
  };

  async function navigate(
    routeName: string,
    params: Record<string, string>,
    seededDoc?: import("dropsh/plugin").JsonApiDocument,
  ): Promise<void> {
    const route = opts.registry.routes.get(routeName);
    if (!route) throw new Error(`unknown route: ${routeName}`);
    const ctx: ControllerContext = {
      client: opts.client,
      viewMode: opts.viewMode,
      ...(seededDoc !== undefined ? { seededDoc } : {}),
      navigate: (r, p) => {
        // Host-level navigation surfaces errors in the UI; a controller-initiated
        // navigation failure must not become an unhandled rejection / crash, but
        // it is reported through the registered error handler, not swallowed.
        void navigate(r, p).catch((err: unknown) => {
          errorHandler(err instanceof Error ? err.message : String(err));
        });
      },
      resolveView: opts.registry.resolveView,
      resolveList: opts.registry.resolveList,
    };
    const element = await route.controller(params, ctx);
    stack.push(element);
  }

  return {
    stackDepth: () => stack.length,
    current: () => stack[stack.length - 1] ?? null,
    navigate,
    back() {
      stack.pop();
      return stack.length > 0;
    },
    setErrorHandler(fn) {
      errorHandler = fn;
    },
  };
}
