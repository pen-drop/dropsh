import { AuthError, HttpError, ValidationError } from "dropsh/plugin";

export interface McpErrorBody {
  code: string;
  message: string;
  backendStatus?: number;
}

export interface McpErrorResult {
  isError: true;
  content: [{ type: "text"; text: string }];
}

export function mcpErrorResult(body: McpErrorBody): McpErrorResult {
  const payload: McpErrorBody = { code: body.code, message: body.message };
  if (body.backendStatus !== undefined) payload.backendStatus = body.backendStatus;
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

export function errorFromUnknown(err: unknown): McpErrorResult {
  if (err instanceof HttpError) {
    return mcpErrorResult({
      code: "E_HTTP",
      message: err.message,
      backendStatus: err.status,
    });
  }
  if (err instanceof ValidationError) {
    return mcpErrorResult({ code: err.code, message: err.message });
  }
  if (err instanceof AuthError) {
    return mcpErrorResult({ code: err.code, message: err.message });
  }
  const message = err instanceof Error ? err.message : String(err);
  return mcpErrorResult({ code: "E_MCP", message });
}

export function policyError(message: string): McpErrorResult {
  return mcpErrorResult({ code: "E_POLICY", message });
}
