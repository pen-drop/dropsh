import { describe, expect, it } from "vitest";
import { parseJson, runCli } from "./helpers/run.js";

interface CanvasPage {
  data: { id: string; attributes: { title: string; components: unknown[] } };
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

    // --no-validate skips client-side schema compilation: some SDC components
    // ship props with Drupal PHP types (e.g. Drupal\Core\Template\Attribute)
    // that Ajv cannot interpret. Drupal still validates server-side.
    const result = await runCli({
      site: "canvas",
      args: [
        "create",
        "canvas_page",
        "--bundle=canvas_page",
        `--data=${createPayload(title)}`,
        "--no-validate",
      ],
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
        "--no-validate",
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
