import { jsonapi, print, BASE_URL } from "./lib/client.js";

const index = await jsonapi("/jsonapi") as { links?: Record<string, { href: string }> };
const links = Object.entries(index.links ?? {});

const canvasLinks = links.filter(([k]) => k.toLowerCase().includes("canvas"));
print("Canvas-related JSON:API endpoints", canvasLinks);

const nodeLinks = links.filter(([k]) => k.startsWith("node--"));
print("All node-- endpoints", nodeLinks.map(([k, v]) => ({ type: k, href: v.href })));

print("Full JSON:API index links (keys)", links.map(([k]) => k).sort());
