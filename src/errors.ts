export class CliError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.details = details;
  }
}

export class ConfigError extends CliError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("E_CONFIG", message, details);
    this.name = "ConfigError";
  }
}

export class AuthError extends CliError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("E_AUTH", message, details);
    this.name = "AuthError";
  }
}

export class ValidationError extends CliError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("E_VALIDATION", message, details);
    this.name = "ValidationError";
  }
}

export class HttpError extends CliError {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown = null) {
    super("E_HTTP", message, { status, body });
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

export function exitCodeFor(err: unknown): number {
  if (err instanceof ConfigError) return 2;
  if (err instanceof AuthError) return 3;
  if (err instanceof ValidationError) return 4;
  if (err instanceof HttpError) return 5;
  return 1;
}
