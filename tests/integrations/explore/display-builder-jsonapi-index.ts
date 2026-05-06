import { jsonapi, print } from "./lib/client.js";

const index = await jsonapi("/jsonapi") as { links?: Record<string, { href: string }> };
const links = Object.entries(index.links ?? {});

const dbLinks = links.filter(([k]) =>
  ["display", "landing", "pattern", "ui_"].some((kw) => k.toLowerCase().includes(kw))
);
print("Display Builder / landing / pattern endpoints", dbLinks);

print("Full index keys", links.map(([k]) => k).sort());
