import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The user-global dropsh state directory. Single source of that path: the
 * per-host auth store and the connections directory both hang off it, so the
 * two cannot drift onto different roots.
 */
export function defaultStateDir(): string {
  return join(homedir(), ".config", "dropsh");
}

/** Default location of the named-connection files, one `<id>.js` per connection. */
export function defaultConnectionsDir(): string {
  return join(defaultStateDir(), "connections");
}
