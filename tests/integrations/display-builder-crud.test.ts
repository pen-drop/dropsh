import { describe, expect, it } from "vitest";
import { parseJson, runCli } from "./helpers/run.js";

interface SourceTreeItem {
  node_id?: string;
  source_id: string;
  source: {
    component?: {
      component_id: string;
      variant_id: string | null;
      props: unknown;
      slots: Record<string, { sources: { source_id: string; source: { value: string } }[] }>;
    };
  };
}

interface ArticleNode {
  data: {
    id: string;
    attributes: {
      title: string;
      field_display_builder_override: SourceTreeItem[] | null;
    };
  };
}

function sourceTree(headerText: string, contentText: string): SourceTreeItem[] {
  return [
    {
      node_id: "",
      source_id: "component",
      source: {
        component: {
          component_id: "display_builder:card",
          variant_id: null,
          props: {},
          slots: {
            header: {
              sources: [{ source_id: "textfield", source: { value: headerText } }],
            },
            content: {
              sources: [{ source_id: "textfield", source: { value: contentText } }],
            },
          },
        },
      },
    },
  ];
}

function createPayload(title: string, tree: SourceTreeItem[]): string {
  return JSON.stringify({
    data: {
      type: "node--article",
      attributes: { title, field_display_builder_override: tree },
    },
  });
}

function updatePayload(uuid: string, tree: SourceTreeItem[]): string {
  return JSON.stringify({
    data: {
      type: "node--article",
      id: uuid,
      attributes: { field_display_builder_override: tree },
    },
  });
}

/**
 * Assert the override field round-tripped as a real source tree. A targeted
 * structural check instead of a deep-equal because Drupal adds server-side
 * keys (third_party_settings) and serializes empty PHP arrays as `[]`.
 *
 * This is the regression guard for the map-field bug: a `map` typed override
 * field silently collapses every item to `{ value: [] }` on write, which the
 * schema-only test never noticed. The field must be `ui_patterns_source`.
 */
function expectCardTree(
  field: SourceTreeItem[] | null,
  headerText: string,
  contentText: string,
): void {
  expect(Array.isArray(field), `expected source tree array, got ${JSON.stringify(field)}`).toBe(
    true,
  );
  const item = (field as SourceTreeItem[])[0];
  expect(item?.source_id).toBe("component");
  const component = item?.source.component;
  expect(component?.component_id).toBe("display_builder:card");
  expect(component?.slots.header?.sources[0]?.source.value).toBe(headerText);
  expect(component?.slots.content?.sources[0]?.source.value).toBe(contentText);
}

// Shared lifecycle state — populated by "create" and consumed by the other
// `it` blocks. Tests in a describe run sequentially by default in vitest, so
// the ordering is reliable; if "create" fails, the downstream tests fail
// loudly (uuid is undefined) which is the desired signal.
describe("integration: display builder override CRUD (node/article)", () => {
  let uuid: string;
  let header: string;
  const content = "Card placed through the display builder override field.";

  it("create — POST article with a source tree stores the tree", async () => {
    header = `it-db-${crypto.randomUUID()}`;

    const result = await runCli({
      site: "db",
      args: [
        "create",
        "node",
        "--bundle=article",
        `--data=${createPayload(`Display Builder ${header}`, sourceTree(header, content))}`,
      ],
    });
    expect(result.code, result.stderr).toBe(0);

    const body = parseJson<ArticleNode>(result.stdout);
    uuid = body.data.id;
    expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
    expectCardTree(body.data.attributes.field_display_builder_override, header, content);
  });

  it("read — GET article returns the stored source tree", async () => {
    expect(uuid).toBeDefined();

    const result = await runCli({
      site: "db",
      args: ["read", `node/article/${uuid}`],
    });
    expect(result.code, result.stderr).toBe(0);

    const body = parseJson<ArticleNode>(result.stdout);
    expectCardTree(body.data.attributes.field_display_builder_override, header, content);
  });

  it("update — PATCH article replaces the source tree", async () => {
    expect(uuid).toBeDefined();
    const newHeader = `${header}-updated`;

    const result = await runCli({
      site: "db",
      args: [
        "update",
        `node/article/${uuid}`,
        `--data=${updatePayload(uuid, sourceTree(newHeader, content))}`,
      ],
    });
    expect(result.code, result.stderr).toBe(0);

    const body = parseJson<ArticleNode>(result.stdout);
    expectCardTree(body.data.attributes.field_display_builder_override, newHeader, content);
    header = newHeader;
  });

  it("delete — DELETE article returns ok and a follow-up read 404s", async () => {
    expect(uuid).toBeDefined();

    const deleted = await runCli({
      site: "db",
      args: ["delete", `node/article/${uuid}`],
    });
    expect(deleted.code, deleted.stderr).toBe(0);
    expect(parseJson<{ ok: boolean }>(deleted.stdout).ok).toBe(true);

    const afterDelete = await runCli({
      site: "db",
      args: ["read", `node/article/${uuid}`],
    });
    expect(afterDelete.code).toBe(5);
  });
});
