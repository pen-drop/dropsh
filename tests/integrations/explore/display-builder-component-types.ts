import { jsonapi, print, BASE_URL } from "./lib/client.js";

const candidates = [
  "/jsonapi/display_builder_component/display_builder_component",
  "/jsonapi/ui_pattern/ui_pattern",
  "/jsonapi/ui_patterns_source/ui_patterns_source",
  "/display-builder/components",
  "/api/display-builder/components",
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
const patternLinks = Object.keys(index.links ?? {}).filter((k) =>
  ["pattern", "component", "display_builder", "ui_"].some((kw) => k.includes(kw))
);
print("Pattern/component entries in JSON:API index", patternLinks);
