import { jsonapi, print, BASE_URL } from "./lib/client.js";

const candidates = [
  "/jsonapi/layout_section/layout_section",
  "/jsonapi/block_content/basic",
  "/layout_builder/sections",
  "/api/layout-builder/sections",
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
const lbKeys = Object.keys(index.links ?? {}).filter((k) => k.includes("layout"));
print("Layout-related keys in JSON:API index", lbKeys);
if (lbKeys.length === 0) {
  console.log("\nCONCLUSION: Layout Builder sections are not exposed via JSON:API core.");
  console.log("A contrib module will be needed. Document this in findings.");
}
