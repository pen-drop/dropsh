import { describe, expect, it } from "vitest";
import { parseJson, runCli } from "./helpers/run.js";

interface ComponentItem {
  uuid: string;
  component_id: string;
  component_version: string;
  parent_uuid?: string | null;
  slot?: string | null;
  inputs: Record<string, unknown>;
  label?: string | null;
}

interface CanvasPage {
  data: { id: string; attributes: { title: string; components: ComponentItem[] } };
}

interface CanvasSchema {
  "x-dropsh-components": { id: string; version: string | null }[];
}

function createPayload(title: string, components: unknown[] = []): string {
  return JSON.stringify({
    data: {
      type: "canvas_page--canvas_page",
      attributes: { title, components },
    },
  });
}

function updatePayload(uuid: string, title: string): string {
  return JSON.stringify({
    data: {
      type: "canvas_page--canvas_page",
      id: uuid,
      attributes: { title },
    },
  });
}

// Shared lifecycle state — populated by "create" and consumed by the other
// `it` blocks. Tests in a describe run sequentially by default in vitest, so
// the ordering is reliable; if "create" fails, the downstream tests fail
// loudly (uuid is undefined) which is the desired signal.
describe("integration: canvas CRUD (canvas_page entity)", () => {
  let title: string;
  let uuid: string;

  it("create — POST canvas_page returns a UUID", async () => {
    title = `it-canvas-${crypto.randomUUID()}`;

    // Client-side schema validation is on. The upstream jsonapi_sdc patch
    // at tests/integrations/drupal/patches/jsonapi_sdc-sanitize-props.patch
    // rewrites Drupal PHP type hints (e.g. Drupal\Core\Template\Attribute)
    // to "object" so Ajv can compile the canvas plugin's schema.
    const result = await runCli({
      site: "canvas",
      args: ["create", "canvas_page", "--bundle=canvas_page", `--data=${createPayload(title)}`],
    });
    expect(result.code).toBe(0);

    const body = parseJson<CanvasPage>(result.stdout);
    uuid = body.data.id;
    expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.data.attributes.title).toBe(title);
  });

  it("read — GET canvas_page returns the created entity", async () => {
    expect(uuid).toBeDefined();

    const result = await runCli({
      site: "canvas",
      args: ["read", `canvas_page/canvas_page/${uuid}`],
    });
    expect(result.code).toBe(0);

    const body = parseJson<CanvasPage>(result.stdout);
    expect(body.data.id).toBe(uuid);
    expect(body.data.attributes.title).toBe(title);
  });

  it("update — PATCH canvas_page changes the title", async () => {
    expect(uuid).toBeDefined();
    const newTitle = `${title}-updated`;

    const result = await runCli({
      site: "canvas",
      args: [
        "update",
        `canvas_page/canvas_page/${uuid}`,
        `--data=${updatePayload(uuid, newTitle)}`,
      ],
    });
    expect(result.code).toBe(0);

    const body = parseJson<CanvasPage>(result.stdout);
    expect(body.data.attributes.title).toBe(newTitle);
    title = newTitle;
  });

  it("delete — DELETE canvas_page returns ok and a follow-up read 404s", async () => {
    expect(uuid).toBeDefined();

    const deleted = await runCli({
      site: "canvas",
      args: ["delete", `canvas_page/canvas_page/${uuid}`],
    });
    expect(deleted.code).toBe(0);
    expect(parseJson<{ ok: boolean }>(deleted.stdout).ok).toBe(true);

    const afterDelete = await runCli({
      site: "canvas",
      args: ["read", `canvas_page/canvas_page/${uuid}`],
    });
    expect(afterDelete.code).toBe(5);
  });
});

// Regression guard for the component write path. The schema-only test never
// posted a component, which hid two gaps at once: the server requires
// component_version (the Canvas component config's active version hash) on
// every tree item, and the plugin schema used to reject that property via
// additionalProperties: false — making component writes impossible with
// client-side validation enabled.
describe("integration: canvas component round-trip (canvas_page entity)", () => {
  const componentId = "sdc.olivero.teaser";
  let version: string;
  let uuid: string;
  let componentUuid: string;

  it("schema — exposes the active component version in metadata", async () => {
    const result = await runCli({
      site: "canvas",
      args: ["schema", "canvas_page/canvas_page", "--for=create", "--refresh"],
    });
    expect(result.code, result.stderr).toBe(0);

    const schema = parseJson<CanvasSchema>(result.stdout);
    const teaser = schema["x-dropsh-components"].find((c) => c.id === componentId);
    expect(teaser, `component ${componentId} missing from schema metadata`).toBeDefined();
    expect(teaser?.version).toMatch(/^[0-9a-f]{16}$/);
    version = teaser?.version as string;
  });

  it("create — POST canvas_page with a component stores the tree item", async () => {
    expect(version).toBeDefined();
    componentUuid = crypto.randomUUID();

    const result = await runCli({
      site: "canvas",
      args: [
        "create",
        "canvas_page",
        "--bundle=canvas_page",
        `--data=${createPayload(`it-canvas-component-${componentUuid}`, [
          {
            uuid: componentUuid,
            component_id: componentId,
            component_version: version,
            parent_uuid: null,
            slot: null,
            inputs: {},
            label: "Round-trip teaser",
          },
        ])}`,
      ],
    });
    expect(result.code, result.stderr).toBe(0);

    const body = parseJson<CanvasPage>(result.stdout);
    uuid = body.data.id;
    const item = body.data.attributes.components[0];
    expect(item?.uuid).toBe(componentUuid);
    expect(item?.component_id).toBe(componentId);
    expect(item?.component_version).toBe(version);
    expect(item?.label).toBe("Round-trip teaser");
  });

  it("read — GET canvas_page returns the stored component", async () => {
    expect(uuid).toBeDefined();

    const result = await runCli({
      site: "canvas",
      args: ["read", `canvas_page/canvas_page/${uuid}`],
    });
    expect(result.code, result.stderr).toBe(0);

    const body = parseJson<CanvasPage>(result.stdout);
    const item = body.data.attributes.components[0];
    expect(item?.uuid).toBe(componentUuid);
    expect(item?.component_id).toBe(componentId);
    expect(item?.component_version).toBe(version);
  });

  it("delete — DELETE canvas_page cleans up", async () => {
    expect(uuid).toBeDefined();

    const deleted = await runCli({
      site: "canvas",
      args: ["delete", `canvas_page/canvas_page/${uuid}`],
    });
    expect(deleted.code, deleted.stderr).toBe(0);
    expect(parseJson<{ ok: boolean }>(deleted.stdout).ok).toBe(true);
  });
});
