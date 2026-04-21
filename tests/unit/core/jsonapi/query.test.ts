import { describe, expect, it } from "vitest";
import { buildQueryString } from "../../../../src/core/jsonapi/query.js";

describe("buildQueryString", () => {
  it("returns empty string for no params", () => {
    expect(buildQueryString({})).toBe("");
  });

  it("serialises a single equality filter", () => {
    expect(buildQueryString({ filter: [{ key: "title", value: "Hello" }] }))
      .toBe("?filter%5Btitle%5D%5Bvalue%5D=Hello");
  });

  it("serialises multiple filters as separate groups", () => {
    const q = buildQueryString({
      filter: [
        { key: "title", value: "Hello" },
        { key: "status", value: "1" },
      ],
    });
    expect(q).toContain("filter%5Btitle%5D%5Bvalue%5D=Hello");
    expect(q).toContain("filter%5Bstatus%5D%5Bvalue%5D=1");
  });

  it("includes operator when given", () => {
    const q = buildQueryString({
      filter: [{ key: "title", value: "Hello", operator: "CONTAINS" }],
    });
    expect(q).toContain("filter%5Btitle%5D%5Boperator%5D=CONTAINS");
    expect(q).toContain("filter%5Btitle%5D%5Bvalue%5D=Hello");
  });

  it("serialises page limit and offset", () => {
    const q = buildQueryString({ page: { limit: 25, offset: 50 } });
    expect(q).toContain("page%5Blimit%5D=25");
    expect(q).toContain("page%5Boffset%5D=50");
  });

  it("serialises sort and include", () => {
    const q = buildQueryString({ sort: "-created", include: ["field_tags", "field_image"] });
    expect(q).toContain("sort=-created");
    expect(q).toContain("include=field_tags%2Cfield_image");
  });
});
