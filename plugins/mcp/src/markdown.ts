import { lstat, readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { ConfigError } from "dropsh/plugin";

export async function loadMarkdown(directory?: string): Promise<Map<string, string>> {
  if (directory === undefined) return new Map();
  const root = isAbsolute(directory) ? directory : resolve(process.cwd(), directory);
  let names: string[];
  try {
    names = (await readdir(root)).sort();
  } catch {
    throw new ConfigError(`mcpPlugin: markdownDir '${directory}' is missing or unreadable`);
  }

  const files = new Map<string, string>();
  for (const filename of names) {
    if (!filename.endsWith(".md") || filename.startsWith(".")) continue;
    const full = join(root, filename);
    const stat = await lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    const stem = filename.slice(0, -".md".length);
    if (files.has(stem)) {
      throw new ConfigError(`mcpPlugin: duplicate markdown name '${stem}'`);
    }
    files.set(stem, await readFile(full, "utf8"));
  }
  return files;
}
