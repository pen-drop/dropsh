import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

export interface PromptDeps {
  input?: Readable;
  write?: (s: string) => void;
  /** TTY check override (tests). Defaults to input.isTTY. */
  isTTY?: boolean;
}

export type PromptFn = (opts: { label: string; secret?: boolean }) => Promise<string>;

/**
 * Build a prompt function. Secret prompts use raw mode + manual key
 * accumulation on a real TTY so the input is never echoed. On a non-TTY
 * stream (tests/pipes) input is read as a line so the value is still captured.
 */
export function createPrompt(deps: PromptDeps = {}): PromptFn {
  const input = deps.input ?? process.stdin;
  const write = deps.write ?? ((s: string) => process.stderr.write(s));
  const isTTY = deps.isTTY ?? Boolean((input as NodeJS.ReadStream).isTTY);

  return ({ label, secret }) =>
    new Promise<string>((resolve, reject) => {
      write(`${label}: `);

      if (secret && isTTY) {
        const stdin = input as NodeJS.ReadStream;
        const prevRaw = stdin.isRaw === true;
        let buf = "";
        stdin.setRawMode?.(true);
        stdin.resume();
        const cleanup = (): void => {
          stdin.setRawMode?.(prevRaw);
          stdin.pause();
          stdin.off("data", onData);
        };
        const onData = (d: Buffer): void => {
          for (const ch of d.toString("utf8")) {
            if (ch === "\n" || ch === "\r") {
              cleanup();
              write("\n");
              resolve(buf);
              return;
            }
            if (ch === "\u0003") {
              cleanup();
              reject(new Error("input cancelled"));
              return;
            }
            if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);
            else buf += ch;
          }
        };
        stdin.on("data", onData);
        return;
      }

      // Non-secret, or non-TTY (tests/pipes): read a single line.
      const rl = createInterface({ input });
      rl.once("line", (line) => {
        rl.close();
        resolve(line.replace(/\r?\n$/, ""));
      });
    });
}
