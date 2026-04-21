export interface FilterSpec {
  key: string;
  value: string;
  operator?: string;
}

export interface QueryParams {
  filter?: FilterSpec[];
  sort?: string;
  page?: { limit?: number; offset?: number };
  include?: string[];
}

export function buildQueryString(q: QueryParams): string {
  const params = new URLSearchParams();
  for (const f of q.filter ?? []) {
    params.append(`filter[${f.key}][value]`, f.value);
    if (f.operator) params.append(`filter[${f.key}][operator]`, f.operator);
  }
  if (q.sort) params.append("sort", q.sort);
  if (q.page?.limit !== undefined) params.append("page[limit]", String(q.page.limit));
  if (q.page?.offset !== undefined) params.append("page[offset]", String(q.page.offset));
  if (q.include && q.include.length > 0) params.append("include", q.include.join(","));
  const s = params.toString();
  return s.length === 0 ? "" : `?${s}`;
}
