import { jsonapi, print } from "./lib/client.js";

const index = await jsonapi("/jsonapi") as { links?: Record<string, { href: string }> };
const links = Object.entries(index.links ?? {});

const lbLinks = links.filter(([k]) =>
  ["layout", "section", "block"].some((kw) => k.toLowerCase().includes(kw))
);
print("Layout Builder related endpoints", lbLinks);

const nodeLinks = links.filter(([k]) => k.startsWith("node--"));
print("Node bundles (check which have layout_builder fields)", nodeLinks.map(([k]) => k));
