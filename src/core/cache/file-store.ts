import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface FileStore {
  read<T>(relPath: string): Promise<T | undefined>;
  write(relPath: string, value: unknown): Promise<void>;
}

export interface FileStoreOptions {
  rootDir: string;
  warn: (message: string) => void;
}

export function createFileStore(opts: FileStoreOptions): FileStore {
  function resolve(rel: string): string {
    return join(opts.rootDir, rel);
  }

  return {
    async read<T>(relPath: string) {
      const abs = resolve(relPath);
      let raw: string;
      try {
        raw = await readFile(abs, "utf8");
      } catch {
        return undefined;
      }
      try {
        return JSON.parse(raw) as T;
      } catch {
        opts.warn(`warning: cache file ${abs} was unreadable and has been refetched`);
        return undefined;
      }
    },

    async write(relPath: string, value: unknown) {
      const abs = resolve(relPath);
      const tmp = `${abs}.tmp`;
      try {
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
        await rename(tmp, abs);
      } catch (err) {
        opts.warn(`warning: could not update cache at ${abs}: ${(err as Error).message}`);
      }
    },
  };
}
