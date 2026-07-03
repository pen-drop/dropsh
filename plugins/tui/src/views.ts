import { ConfigError } from "dropsh/plugin";

export interface TuiViewConfig {
  entityType: string;
  bundle?: string;
  columns?: string[];
  filters?: Record<string, string>;
  detailRenderer?: string;
  pageSize?: number;
}

export interface TuiOptions {
  views?: TuiViewConfig[];
  defaultPageSize?: number;
  detailRenderer?: string;
}

export interface ResolvedView {
  columns?: string[];
  filters: Record<string, string>;
  detailRenderer: string;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 25;

export function resolveView(opts: TuiOptions, entityType: string, bundle?: string): ResolvedView {
  const views = opts.views ?? [];
  const withBundle = views.find((v) => v.entityType === entityType && v.bundle === bundle);
  const typeOnly = views.find((v) => v.entityType === entityType && v.bundle === undefined);
  const match = withBundle ?? typeOnly;
  const resolved: ResolvedView = {
    filters: match?.filters ?? {},
    detailRenderer: match?.detailRenderer ?? opts.detailRenderer ?? "md",
    pageSize: match?.pageSize ?? opts.defaultPageSize ?? DEFAULT_PAGE_SIZE,
  };
  if (match?.columns !== undefined) resolved.columns = match.columns;
  return resolved;
}

export function assertTty(isTty: boolean): void {
  if (!isTty) {
    throw new ConfigError("--format tui requires an interactive terminal");
  }
}
