# dropsh Skill Examples

These examples show how dropsh-focused skills can be structured in practice.
Each example uses `SKILL.md` as a small orchestrator and keeps executable
workflow guidance in separate files.

The examples are documentation, not installed skills. Copy the structure into a
real skill directory when you want to adapt one for a project or marketplace.

## Structure

```text
example-skill/
├── SKILL.md
└── workflows/
    ├── create-*.md
    └── update-*.md
```

Use `SKILL.md` for:

- trigger rules and scope
- required Drupal modules and dropsh plugins
- workflow dispatch
- high-level guardrails

Use `workflows/*.md` for:

- concrete dropsh commands
- schema inspection rules
- payload-building steps
- dry-run, validation, and error handling

## Examples

| Example | Purpose |
| --- | --- |
| [Article Publishing](article-publishing/SKILL.md) | Classic Drupal article create/update workflow over JSON:API |
| [Canvas Page](canvas-page/SKILL.md) | Canvas page workflow driven by component schemas |
| [Display Builder Page](display-builder-page/SKILL.md) | Display Builder workflow driven by display metadata and override fields |

