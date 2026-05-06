import { jsonapi, print, BASE_URL } from "./lib/client.js";

const candidates = [
  "/canvas/components",
  "/api/canvas/components",
  "/jsonapi/canvas_component_type/canvas_component_type",
  "/jsonapi/canvas_component/canvas_component",
];

for (const path of candidates) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Accept: "application/json, application/vnd.api+json" },
    });
    if (res.ok) {
      print(`HIT: ${path}`, JSON.parse(await res.text()));
    } else {
      console.log(`MISS: ${path} → HTTP ${res.status}`);
    }
  } catch (e) {
    console.log(`ERROR: ${path} →`, (e as Error).message);
  }
}

const index = await jsonapi("/jsonapi") as { links?: Record<string, unknown> };
const componentLinks = Object.keys(index.links ?? {}).filter((k) =>
  k.includes("component") || k.includes("canvas")
);
print("Component/canvas entries in JSON:API index", componentLinks);

const configCandidates = [
  "/jsonapi/canvas_component_type/canvas_component_type",
  "/jsonapi/canvas_block_type/canvas_block_type",
];
for (const path of configCandidates) {
  const res = await jsonapi(path);
  const data = res as { data?: unknown[]; errors?: unknown };
  if (!data.errors) {
    print(`Config entity at ${path}`, res);
  } else {
    console.log(`No config entity at ${path}`);
  }
}
