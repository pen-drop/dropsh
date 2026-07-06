# JSON:API Research Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install Canvas and Display Builder in DDEV, write exploration scripts that probe their JSON:API surfaces, and produce a findings document that drives the three implementation specs.

**Architecture:** A new git worktree `spike/jsonapi-research` extends the existing DDEV fixture with Canvas and Display Builder, adds a `spike-up.sh` boot script, and adds plain TypeScript exploration scripts under `tests/integrations/explore/` that print raw JSON:API responses. No production code. No assertions. No companion module.

**Tech Stack:** DDEV, Drupal 11, Drush, PHP (setup scripts), Node.js + TypeScript (exploration scripts), existing `testConfig()` helper

---

## File map

| File | Action |
|---|---|
| `tests/integrations/drupal/composer.json` | Modify — add Canvas + Display Builder packages |
| `tests/integrations/drupal/fixtures/setup-canvas.php` | Create — enable Canvas, create canvas_page bundle |
| `tests/integrations/drupal/fixtures/setup-display-builder.php` | Create — enable Display Builder, create landing_page bundle |
| `tests/integrations/bin/spike-up.sh` | Create — boot DDEV, install all modules incl. Canvas + DB |
| `tests/integrations/bin/spike-down.sh` | Create — tear down spike DDEV project |
| `tests/integrations/explore/lib/client.ts` | Create — thin HTTP helper (auth + fetch) |
| `tests/integrations/explore/canvas-jsonapi-index.ts` | Create — print all Canvas-related JSON:API endpoints |
| `tests/integrations/explore/canvas-create-page.ts` | Create — create a Canvas page, print full response |
| `tests/integrations/explore/canvas-component-types.ts` | Create — find where component types are exposed |
| `tests/integrations/explore/display-builder-jsonapi-index.ts` | Create — print all Display Builder JSON:API endpoints |
| `tests/integrations/explore/display-builder-create-page.ts` | Create — create a Display Builder page, print full response |
| `tests/integrations/explore/display-builder-component-types.ts` | Create — find where component types are exposed |
| `tests/integrations/explore/layout-builder-jsonapi-index.ts` | Create — print Layout Builder JSON:API surface |
| `tests/integrations/explore/layout-builder-section-types.ts` | Create — find available section/block types |
| `docs/research/2026-05-06-component-tree-jsonapi-findings.md` | Create — filled findings document |

---

### Task 1: Create the spike worktree

**Files:** git operations only

- [ ] **Step 1: Create worktree**

```bash
git worktree add ../dropsh-spike spike/jsonapi-research 2>/dev/null \
  || git worktree add ../dropsh-spike -b spike/jsonapi-research
```

- [ ] **Step 2: Verify**

```bash
git worktree list
```

Expected: `../dropsh-spike` appears with branch `spike/jsonapi-research`.

- [ ] **Step 3: All remaining work happens in the worktree**

```bash
cd ../dropsh-spike
```

---

### Task 2: Research package names on drupal.org

**Files:** none (manual research step)

- [ ] **Step 1: Look up Canvas**

Visit `https://www.drupal.org/project/canvas` — confirm the composer package name (expected: `drupal/canvas`). Note the current stable version.

- [ ] **Step 2: Look up Display Builder**

The user described Display Builder as having multiple fields per entity, each carrying a UI-patterns component tree. Check these candidates:
- `https://www.drupal.org/project/display_builder`
- `https://www.drupal.org/project/ui_patterns`
- `https://www.drupal.org/project/ui_patterns_field_formatters`

Confirm which one matches the description. Note the composer package name and version.

- [ ] **Step 3: Record the package names**

Write them down — you will use them in Task 3.

---

### Task 3: Add packages to DDEV fixture

**Files:**
- Modify: `tests/integrations/drupal/composer.json`

- [ ] **Step 1: Add Canvas and Display Builder to `require`**

Open `tests/integrations/drupal/composer.json`. Add the two packages to the `require` block (use the exact names found in Task 2). Example — adjust versions to what drupal.org shows:

```json
"require": {
  "composer/installers": "^2",
  "drupal/canvas": "^1",
  "drupal/display_builder": "^1",
  "drupal/core-composer-scaffold": "^11",
  "drupal/core-recommended": "^11",
  "drupal/schemata": "1.x-dev",
  "drupal/simple_oauth": "^6",
  "drupal/simple_oauth_password_grant": "^2.1",
  "drush/drush": "^13"
}
```

- [ ] **Step 2: Verify composer.json is valid JSON**

```bash
python3 -m json.tool tests/integrations/drupal/composer.json > /dev/null && echo "valid"
```

Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add tests/integrations/drupal/composer.json
git commit -m "chore(spike): add Canvas and Display Builder to composer.json"
```

---

### Task 4: Canvas setup script

**Files:**
- Create: `tests/integrations/drupal/fixtures/setup-canvas.php`

The existing `setup-content-type.php` is the pattern to follow. This script runs via `ddev drush php:script`.

- [ ] **Step 1: Create the script**

```php
<?php

use Drupal\node\Entity\NodeType;

// Enable Canvas module (already done via drush en in spike-up.sh).
// Create a canvas_page content type if the Canvas module defines its own
// bundle name differently — inspect with: drush ev "print_r(array_keys(\Drupal::entityTypeManager()->getStorage('node_type')->loadMultiple()));"
// The bundle name below matches the Canvas module default. Adjust if needed.
$bundle = 'canvas_page';

$type = NodeType::load($bundle);
if (!$type) {
  // Canvas module may create this automatically on install.
  // If so this block will be skipped and we just report it.
  echo "Note: canvas_page bundle not auto-created by Canvas module — creating manually\n";
  $type = NodeType::create(['type' => $bundle, 'name' => 'Canvas Page']);
  $type->save();
  echo "Created content type {$bundle}\n";
} else {
  echo "Content type {$bundle} exists (created by Canvas module)\n";
}

// List all fields on this bundle so the exploration scripts know what to target.
$fields = \Drupal::service('entity_field.manager')->getFieldDefinitions('node', $bundle);
foreach ($fields as $name => $def) {
  echo "  field: {$name} type: " . $def->getType() . "\n";
}

echo "Canvas setup complete\n";
```

- [ ] **Step 2: Commit**

```bash
git add tests/integrations/drupal/fixtures/setup-canvas.php
git commit -m "chore(spike): add Canvas setup fixture"
```

---

### Task 5: Display Builder setup script

**Files:**
- Create: `tests/integrations/drupal/fixtures/setup-display-builder.php`

- [ ] **Step 1: Create the script**

```php
<?php

use Drupal\node\Entity\NodeType;

// Adjust $bundle to match Display Builder's actual default bundle name.
// If unsure: drush ev "print_r(array_keys(\Drupal::entityTypeManager()->getStorage('node_type')->loadMultiple()));"
$bundle = 'landing_page';

$type = NodeType::load($bundle);
if (!$type) {
  echo "Note: {$bundle} bundle not auto-created — creating manually\n";
  $type = NodeType::create(['type' => $bundle, 'name' => 'Landing Page']);
  $type->save();
  echo "Created content type {$bundle}\n";
} else {
  echo "Content type {$bundle} exists (created by Display Builder module)\n";
}

// List all fields so exploration scripts know which fields carry component trees.
$fields = \Drupal::service('entity_field.manager')->getFieldDefinitions('node', $bundle);
foreach ($fields as $name => $def) {
  echo "  field: {$name} type: " . $def->getType() . "\n";
}

echo "Display Builder setup complete\n";
```

- [ ] **Step 2: Commit**

```bash
git add tests/integrations/drupal/fixtures/setup-display-builder.php
git commit -m "chore(spike): add Display Builder setup fixture"
```

---

### Task 6: spike-up.sh and spike-down.sh

**Files:**
- Create: `tests/integrations/bin/spike-up.sh`
- Create: `tests/integrations/bin/spike-down.sh`

The spike gets its own DDEV project so it does not interfere with the existing integration test project.

- [ ] **Step 1: Create `spike-up.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DRUPAL_DIR="$ROOT/tests/integrations/drupal"

cd "$DRUPAL_DIR"

HASH="$(pwd | sha1sum | cut -c1-8)"
PROJECT_NAME="dropsh-spike-${HASH}"

mkdir -p .ddev
printf 'name: %s\n' "$PROJECT_NAME" > .ddev/config.local.yaml

ddev start
ddev composer install --no-interaction

ddev drush site:install standard -y \
  --account-name=admin --account-pass=admin \
  --site-name="dropsh spike"

# Enable base modules
ddev drush en -y basic_auth jsonapi schemata schemata_json_schema

# Enable Canvas — adjust module machine name if different
ddev drush en -y canvas || echo "WARNING: canvas module not found — check package name"

# Enable Display Builder — adjust module machine name if different
ddev drush en -y display_builder || echo "WARNING: display_builder module not found — check package name"

# Enable Layout Builder (core)
ddev drush en -y layout_builder

ddev drush php:eval "\Drupal::configFactory()->getEditable('jsonapi.settings')->set('read_only', FALSE)->save();"

ddev drush php:script fixtures/setup-canvas.php
ddev drush php:script fixtures/setup-display-builder.php

URL="$(ddev describe -j | python3 -c 'import json, sys; print(json.load(sys.stdin)["raw"]["services"]["web"]["http_url"])')"

cat > .spike-config.json <<EOF
{
  "url": "${URL}",
  "basic": { "user": "admin", "pass": "admin" }
}
EOF

echo ""
echo "Spike Drupal is up at ${URL}"
echo "Config written to tests/integrations/drupal/.spike-config.json"
echo "Run exploration scripts with: node --import tsx/esm tests/integrations/explore/<script>.ts"
```

- [ ] **Step 2: Make executable**

```bash
chmod +x tests/integrations/bin/spike-up.sh
```

- [ ] **Step 3: Create `spike-down.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DRUPAL_DIR="$ROOT/tests/integrations/drupal"

cd "$DRUPAL_DIR"

ddev delete -O -y
rm -f .ddev/config.local.yaml .spike-config.json
echo "Spike DDEV project removed"
```

- [ ] **Step 4: Make executable**

```bash
chmod +x tests/integrations/bin/spike-down.sh
```

- [ ] **Step 5: Add spike scripts to package.json**

In the root `package.json`, add to `scripts`:

```json
"spike:up": "bash tests/integrations/bin/spike-up.sh",
"spike:down": "bash tests/integrations/bin/spike-down.sh"
```

- [ ] **Step 6: Commit**

```bash
git add tests/integrations/bin/spike-up.sh tests/integrations/bin/spike-down.sh package.json
git commit -m "chore(spike): add spike-up/spike-down scripts"
```

---

### Task 7: Shared exploration client

**Files:**
- Create: `tests/integrations/explore/lib/client.ts`

All exploration scripts use this helper to avoid repeating auth boilerplate.

- [ ] **Step 1: Create the helper**

```typescript
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface SpikeConfig {
  url: string;
  basic: { user: string; pass: string };
}

function spikeConfig(): SpikeConfig {
  const path = resolve("tests/integrations/drupal/.spike-config.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SpikeConfig;
  } catch {
    throw new Error("Spike DDEV not running. Run: npm run spike:up");
  }
}

const cfg = spikeConfig();

const AUTH = "Basic " + Buffer.from(`${cfg.basic.user}:${cfg.basic.pass}`).toString("base64");
export const BASE_URL = cfg.url.replace(/\/$/, "");

export async function jsonapi(path: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: AUTH,
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
    },
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text, _status: res.status };
  }
}

export async function jsonapiPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: AUTH,
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text, _status: res.status };
  }
}

export function print(label: string, data: unknown): void {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(data, null, 2));
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/integrations/explore/lib/client.ts
git commit -m "chore(spike): add exploration HTTP client helper"
```

---

### Task 8: Canvas exploration scripts

**Files:**
- Create: `tests/integrations/explore/canvas-jsonapi-index.ts`
- Create: `tests/integrations/explore/canvas-create-page.ts`
- Create: `tests/integrations/explore/canvas-component-types.ts`

- [ ] **Step 1: Create `canvas-jsonapi-index.ts`**

```typescript
import { jsonapi, print, BASE_URL } from "./lib/client.js";

// Step 1: inspect the JSON:API index
const index = await jsonapi("/jsonapi") as { links?: Record<string, { href: string }> };
const links = Object.entries(index.links ?? {});

// All links that mention canvas
const canvasLinks = links.filter(([k]) => k.toLowerCase().includes("canvas"));
print("Canvas-related JSON:API endpoints", canvasLinks);

// All node--* endpoints for reference
const nodeLinks = links.filter(([k]) => k.startsWith("node--"));
print("All node-- endpoints", nodeLinks.map(([k, v]) => ({ type: k, href: v.href })));

// Full index for manual inspection
print("Full JSON:API index links (keys)", links.map(([k]) => k).sort());
```

- [ ] **Step 2: Create `canvas-create-page.ts`**

```typescript
import { jsonapi, jsonapiPost, print, BASE_URL } from "./lib/client.js";

// First: check what bundles exist for node
const index = await jsonapi("/jsonapi") as { links?: Record<string, { href: string }> };
const nodeLinks = Object.keys(index.links ?? {}).filter((k) => k.startsWith("node--"));
print("Available node bundles", nodeLinks);

// Try to create a minimal canvas_page node
// The field name for the canvas tree is unknown — try common names
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

// If successful, read it back to see all fields
const created = result as { data?: { id?: string } };
if (created.data?.id) {
  const readBack = await jsonapi(`/jsonapi/node/canvas_page/${created.data.id}`);
  print("Full read-back (all fields)", readBack);
}
```

- [ ] **Step 3: Create `canvas-component-types.ts`**

```typescript
import { jsonapi, print, BASE_URL } from "./lib/client.js";

// Look for any config/schema endpoint that lists Canvas component types.
// Try known patterns:

// 1. A custom Canvas REST/JSON:API endpoint
const candidates = [
  "/canvas/components",
  "/api/canvas/components",
  "/jsonapi/canvas_component_type/canvas_component_type",
  "/jsonapi/canvas_component/canvas_component",
  "/admin/structure/canvas",
];

for (const path of candidates) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Accept: "application/json, application/vnd.api+json" },
    });
    if (res.ok) {
      const body = await res.text();
      print(`HIT: ${path}`, JSON.parse(body));
    } else {
      console.log(`MISS: ${path} → HTTP ${res.status}`);
    }
  } catch (e) {
    console.log(`ERROR: ${path} →`, (e as Error).message);
  }
}

// 2. Look in the JSON:API index for any canvas_component* entity type
const index = await jsonapi("/jsonapi") as { links?: Record<string, unknown> };
const componentLinks = Object.keys(index.links ?? {}).filter((k) =>
  k.includes("component") || k.includes("canvas")
);
print("Component/canvas entries in JSON:API index", componentLinks);

// 3. Try the Drupal config entity approach — some modules expose component types as config entities
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
```

- [ ] **Step 4: Commit**

```bash
git add tests/integrations/explore/canvas-*.ts
git commit -m "chore(spike): add Canvas exploration scripts"
```

---

### Task 9: Display Builder exploration scripts

**Files:**
- Create: `tests/integrations/explore/display-builder-jsonapi-index.ts`
- Create: `tests/integrations/explore/display-builder-create-page.ts`
- Create: `tests/integrations/explore/display-builder-component-types.ts`

- [ ] **Step 1: Create `display-builder-jsonapi-index.ts`**

```typescript
import { jsonapi, print } from "./lib/client.js";

const index = await jsonapi("/jsonapi") as { links?: Record<string, { href: string }> };
const links = Object.entries(index.links ?? {});

// All links that mention display_builder, landing, pattern, or ui
const dbLinks = links.filter(([k]) =>
  ["display", "landing", "pattern", "ui_"].some((kw) => k.toLowerCase().includes(kw))
);
print("Display Builder / landing / pattern endpoints", dbLinks);

print("Full index keys", links.map(([k]) => k).sort());
```

- [ ] **Step 2: Create `display-builder-create-page.ts`**

```typescript
import { jsonapi, jsonapiPost, print } from "./lib/client.js";

// Check available node bundles
const index = await jsonapi("/jsonapi") as { links?: Record<string, unknown> };
const nodeLinks = Object.keys(index.links ?? {}).filter((k) => k.startsWith("node--"));
print("Available node bundles", nodeLinks);

// Try landing_page bundle — adjust if Display Builder uses a different name
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
```

- [ ] **Step 3: Create `display-builder-component-types.ts`**

```typescript
import { jsonapi, print, BASE_URL } from "./lib/client.js";

// Same discovery approach as Canvas — probe candidate endpoints

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
      const body = await res.text();
      print(`HIT: ${path}`, JSON.parse(body));
    } else {
      console.log(`MISS: ${path} → HTTP ${res.status}`);
    }
  } catch (e) {
    console.log(`ERROR: ${path} →`, (e as Error).message);
  }
}

// Look in JSON:API index
const index = await jsonapi("/jsonapi") as { links?: Record<string, unknown> };
const patternLinks = Object.keys(index.links ?? {}).filter((k) =>
  ["pattern", "component", "display_builder", "ui_"].some((kw) => k.includes(kw))
);
print("Pattern/component entries in JSON:API index", patternLinks);
```

- [ ] **Step 4: Commit**

```bash
git add tests/integrations/explore/display-builder-*.ts
git commit -m "chore(spike): add Display Builder exploration scripts"
```

---

### Task 10: Layout Builder exploration scripts

**Files:**
- Create: `tests/integrations/explore/layout-builder-jsonapi-index.ts`
- Create: `tests/integrations/explore/layout-builder-section-types.ts`

- [ ] **Step 1: Create `layout-builder-jsonapi-index.ts`**

```typescript
import { jsonapi, print } from "./lib/client.js";

const index = await jsonapi("/jsonapi") as { links?: Record<string, { href: string }> };
const links = Object.entries(index.links ?? {});

const lbLinks = links.filter(([k]) =>
  ["layout", "section", "block"].some((kw) => k.toLowerCase().includes(kw))
);
print("Layout Builder related endpoints", lbLinks);

// Also check if layout_builder__layout field shows up in any node bundle
// by reading a node that has Layout Builder enabled
const nodeLinks = links.filter(([k]) => k.startsWith("node--"));
print("Node bundles (check which have layout_builder fields)", nodeLinks.map(([k]) => k));
```

- [ ] **Step 2: Create `layout-builder-section-types.ts`**

```typescript
import { jsonapi, print, BASE_URL } from "./lib/client.js";

// Layout Builder sections are Drupal plugins, not entities.
// They may not be exposed via JSON:API at all without a contrib module.
// This script checks known candidate endpoints.


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
      const body = await res.text();
      print(`HIT: ${path}`, JSON.parse(body));
    } else {
      console.log(`MISS: ${path} → HTTP ${res.status}`);
    }
  } catch (e) {
    console.log(`ERROR: ${path} →`, (e as Error).message);
  }
}

// Check if layout_builder_layout appears in the JSON:API index at all
const index = await jsonapi("/jsonapi") as { links?: Record<string, unknown> };
const lbKeys = Object.keys(index.links ?? {}).filter((k) => k.includes("layout"));
print("Layout-related keys in JSON:API index", lbKeys);
if (lbKeys.length === 0) {
  console.log("\nCONCLUSION: Layout Builder sections are not exposed via JSON:API core.");
  console.log("A contrib module will be needed. Document this in findings.");
}
```

- [ ] **Step 3: Commit**

```bash
git add tests/integrations/explore/layout-builder-*.ts
git commit -m "chore(spike): add Layout Builder exploration scripts"
```

---

### Task 11: Boot DDEV and run all exploration scripts

**Files:** none (runtime only)

- [ ] **Step 1: Boot the spike DDEV project**

```bash
npm run spike:up
```

Expected: DDEV starts, all modules install, setup scripts run, `.spike-config.json` written. Watch for any `WARNING:` lines about missing modules — if Canvas or Display Builder modules are not found, go back to Task 2 and correct the module machine name in `spike-up.sh`.

- [ ] **Step 2: Run Canvas scripts in order**

```bash
node --import tsx/esm tests/integrations/explore/canvas-jsonapi-index.ts 2>&1 | tee /tmp/canvas-index.txt
node --import tsx/esm tests/integrations/explore/canvas-create-page.ts 2>&1 | tee /tmp/canvas-create.txt
node --import tsx/esm tests/integrations/explore/canvas-component-types.ts 2>&1 | tee /tmp/canvas-components.txt
```

- [ ] **Step 3: Run Display Builder scripts**

```bash
node --import tsx/esm tests/integrations/explore/display-builder-jsonapi-index.ts 2>&1 | tee /tmp/db-index.txt
node --import tsx/esm tests/integrations/explore/display-builder-create-page.ts 2>&1 | tee /tmp/db-create.txt
node --import tsx/esm tests/integrations/explore/display-builder-component-types.ts 2>&1 | tee /tmp/db-components.txt
```

- [ ] **Step 4: Run Layout Builder scripts**

```bash
node --import tsx/esm tests/integrations/explore/layout-builder-jsonapi-index.ts 2>&1 | tee /tmp/lb-index.txt
node --import tsx/esm tests/integrations/explore/layout-builder-section-types.ts 2>&1 | tee /tmp/lb-sections.txt
```

- [ ] **Step 5: Review all output files**

```bash
cat /tmp/canvas-index.txt /tmp/canvas-create.txt /tmp/canvas-components.txt \
    /tmp/db-index.txt /tmp/db-create.txt /tmp/db-components.txt \
    /tmp/lb-index.txt /tmp/lb-sections.txt
```

Identify:
- Which JSON:API endpoints each module exposes
- What the component/section tree field is named
- What a single component entry looks like as JSON
- Whether component types are discoverable via API or only via config

---

### Task 12: Write findings document

**Files:**
- Create: `docs/research/2026-05-06-component-tree-jsonapi-findings.md`

- [ ] **Step 1: Create the findings document**

Fill in the table with real values from the exploration output. The template:

```markdown
# JSON:API Research Findings: Canvas / Display Builder / Layout Builder

**Date:** 2026-05-06
**Drupal version:** (from ddev drush status)
**Canvas version:** (from composer.lock)
**Display Builder version:** (from composer.lock)

## Canvas

### JSON:API endpoints exposed
(list here)

### Component tree field name on canvas_page bundle
(e.g. `field_canvas` or `canvas_tree`)

### JSON shape of one component entry
```json
(paste example from canvas-create-page.ts output)
```

### Source of available component types
- [ ] Module's own JSON:API endpoint at `___`
- [ ] Contrib module: `___`
- [ ] Not discoverable via API — BLOCKER, inform developer

### Notes
(anything unexpected)

---

## Display Builder

### JSON:API endpoints exposed
(list here)

### Component tree field name(s) on landing_page bundle
(list all fields that carry a component tree)

### JSON shape of one component entry
```json
(paste example)
```

### Source of available component types
- [ ] Module's own JSON:API endpoint at `___`
- [ ] Contrib module: `___`
- [ ] Not discoverable via API — BLOCKER, inform developer

### Notes

---

## Layout Builder

### JSON:API endpoints exposed
(list here)

### Section/block field exposed
- [ ] Yes, via `layout_builder__layout` field
- [ ] No — contrib module needed: `___`
- [ ] Not discoverable at all — BLOCKER

### Notes

---

## Summary: `discover` command data sources

| Feature | Source |
|---|---|
| Canvas available_components | (fill in) |
| Display Builder available_components | (fill in) |
| Layout Builder available_sections | (fill in) |

## Open blockers
(list any cases where neither module nor contrib exposes what we need)
```

- [ ] **Step 2: Commit**

```bash
git add docs/research/2026-05-06-component-tree-jsonapi-findings.md
git commit -m "docs(spike): add JSON:API research findings"
```

---

### Task 13: Push spike branch and tear down

- [ ] **Step 1: Push the spike branch**

```bash
git push pen-drop spike/jsonapi-research
```

- [ ] **Step 2: Tear down DDEV**

```bash
npm run spike:down
```

- [ ] **Step 3: Confirm findings document is complete**

The findings document must have no empty sections before the Canvas implementation spec can be written. If any section has a BLOCKER, stop and inform the developer — do not proceed to the Canvas implementation worktree.
