import { CliError } from "../../errors.js";

export interface Output {
  emit(value: unknown): void;
  fail(err: unknown): void;
}

export interface OutputOptions {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

export function createOutput(opts: OutputOptions): Output {
  return {
    emit(value) {
      opts.stdout(`${JSON.stringify(value)}\n`);
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
  };
}
