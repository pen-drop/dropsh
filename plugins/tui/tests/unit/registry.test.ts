import { describe, expect, it } from "vitest";
import { GenericEntityList } from "../../src/entity-list.js";
import { GenericEntityView, TuiEntityView } from "../../src/entity-view.js";
import { buildRegistry } from "../../src/registry.js";

class ArticleView extends TuiEntityView {
  static override entityType = "node";
  static override bundle = "article";
  static override viewModes = { default: {}, teaser: {} };
  build() {
    return null as never;
  }
}

describe("buildRegistry", () => {
  it("resolves a registered view by type+bundle, else the generic default", () => {
    const reg = buildRegistry([{ id: "x", entities: [ArticleView] }]);
    expect(reg.resolveView("node", "article")).toBe(ArticleView);
    expect(reg.resolveView("node", "page")).toBe(GenericEntityView);
    expect(reg.resolveView("user")).toBe(GenericEntityView);
    expect(reg.resolveList("node", "article")).toBe(GenericEntityList);
  });

  it("provides core default routes and lets sub-plugin routes override by name", () => {
    const custom = {
      name: "entity.canonical",
      path: "/custom/{id}",
      controller: async () => null as never,
    };
    const reg = buildRegistry([{ id: "x", routes: [custom] }]);
    expect(reg.routes.get("entity.collection")?.path).toBe("/{type}");
    expect(reg.routes.get("entity.canonical")).toBe(custom);
  });
});
