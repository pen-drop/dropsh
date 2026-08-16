import { PluginError } from "../errors.js";
import type { HttpRequest } from "./http.js";
import type { DropSHOperation } from "./jsonapi/client.js";
import type { DropSHPlugin, PluginContext, RequestContext } from "./plugin.js";

export function composeRequestHooks(plugins: DropSHPlugin[], ctx: PluginContext) {
  return async (
    req: HttpRequest,
    operation: DropSHOperation,
    entityType?: string,
    bundle?: string,
  ): Promise<HttpRequest> => {
    const requestContext: RequestContext = {
      ...ctx,
      operation,
      ...(entityType !== undefined ? { entityType } : {}),
      ...(bundle !== undefined ? { bundle } : {}),
    };

    let current = req;
    for (const plugin of plugins) {
      if (!plugin.alterRequest) continue;
      try {
        const next = await plugin.alterRequest(current, requestContext);
        if (next === undefined) throw new Error("alterRequest must return an HttpRequest");
        current = next;
      } catch (cause) {
        throw new PluginError(plugin.id, "alterRequest", cause);
      }
    }
    return current;
  };
}
