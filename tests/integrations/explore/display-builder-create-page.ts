import { jsonapi, jsonapiPost, print } from "./lib/client.js";

const index = await jsonapi("/jsonapi") as { links?: Record<string, unknown> };
const nodeLinks = Object.keys(index.links ?? {}).filter((k) => k.startsWith("node--"));
print("Available node bundles", nodeLinks);

const payload = {
  data: {
    type: "node--landing_page",
    attributes: {
      title: "Spike: Display Builder test page",
      status: true,
    },
  },
};

print("Attempting to create node--landing_page", payload);
const result = await jsonapiPost("/jsonapi/node/landing_page", payload);
print("Create response", result);

const created = result as { data?: { id?: string } };
if (created.data?.id) {
  const readBack = await jsonapi(`/jsonapi/node/landing_page/${created.data.id}`);
  print("Full read-back (all fields — look for component tree fields)", readBack);
}
