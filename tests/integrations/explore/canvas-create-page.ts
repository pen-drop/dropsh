import { jsonapi, jsonapiPost, print, BASE_URL } from "./lib/client.js";

const index = await jsonapi("/jsonapi") as { links?: Record<string, { href: string }> };
const nodeLinks = Object.keys(index.links ?? {}).filter((k) => k.startsWith("node--"));
print("Available node bundles", nodeLinks);

const payload = {
  data: {
    type: "node--canvas_page",
    attributes: {
      title: "Spike: Canvas test page",
      status: true,
    },
  },
};

print("Attempting to create node--canvas_page", payload);
const result = await jsonapiPost("/jsonapi/node/canvas_page", payload);
print("Create response", result);

const created = result as { data?: { id?: string } };
if (created.data?.id) {
  const readBack = await jsonapi(`/jsonapi/node/canvas_page/${created.data.id}`);
  print("Full read-back (all fields)", readBack);
}
