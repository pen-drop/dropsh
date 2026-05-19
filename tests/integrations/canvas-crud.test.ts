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

describe("integration: canvas CRUD (canvas_page entity)", () => {
  it("creates, reads, updates, and deletes a canvas_page", async () => {
    const title = `it-canvas-${crypto.randomUUID()}`;

    // CREATE — POST to /jsonapi/canvas_page/canvas_page. --no-validate skips
    // client-side schema compilation because some SDC components ship props
    // with Drupal PHP types (e.g. Drupal\Core\Template\Attribute) that Ajv
    // cannot interpret. Drupal still validates server-side.
    const created = await runCli({
      site: "canvas",
      args: [
        "create",
        "canvas_page",
        "--bundle=canvas_page",
        `--data=${createPayload(title)}`,
        "--no-validate",
      ],
    });
    expect(created.code).toBe(0);
    const createdBody = parseJson<CanvasPage>(created.stdout);
    const uuid = createdBody.data.id;
    expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(createdBody.data.attributes.title).toBe(title);

    // READ
    const read = await runCli({
      site: "canvas",
      args: ["read", `canvas_page/canvas_page/${uuid}`],
    });
    expect(read.code).toBe(0);
    const readBody = parseJson<CanvasPage>(read.stdout);
    expect(readBody.data.id).toBe(uuid);
    expect(readBody.data.attributes.title).toBe(title);

    // UPDATE — change the title only.
    const newTitle = `${title}-updated`;
    const updated = await runCli({
      site: "canvas",
      args: [
        "update",
        `canvas_page/canvas_page/${uuid}`,
        `--data=${updatePayload(uuid, newTitle)}`,
        "--no-validate",
      ],
    });
    expect(updated.code).toBe(0);
    const updatedBody = parseJson<CanvasPage>(updated.stdout);
    expect(updatedBody.data.attributes.title).toBe(newTitle);

    // DELETE
    const deleted = await runCli({
      site: "canvas",
      args: ["delete", `canvas_page/canvas_page/${uuid}`],
    });
    expect(deleted.code).toBe(0);
    expect(parseJson<{ ok: boolean }>(deleted.stdout).ok).toBe(true);

    // Verify it's gone — read should 404 → exit 5.
    const afterDelete = await runCli({
      site: "canvas",
      args: ["read", `canvas_page/canvas_page/${uuid}`],
    });
    expect(afterDelete.code).toBe(5);
  });
});
