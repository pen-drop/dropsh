import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, rel), "utf8")) as Record<string, unknown>;
}

type ExportsMap = Record<string, string | Record<string, string>>;

/** A subpath export must be an object whose FIRST key is `types` (so resolvers
 *  matching conditions in order pick up declarations), pointing at a `.d.ts`. */
function expectTypesFirst(exports: ExportsMap, subpath: string): void {
  const entry = exports[subpath];
  expect(entry, `exports["${subpath}"] must be a conditions object`).toBeTypeOf("object");
  const conditions = entry as Record<string, string>;
  const keys = Object.keys(conditions);
  expect(keys[0], `exports["${subpath}"] first condition must be "types"`).toBe("types");
  expect(conditions.types).toMatch(/\.d\.ts$/);
  expect(conditions.default ?? conditions.import).toMatch(/\.js$/);
}

describe("AC-1: dropsh ships type declarations via exports", () => {
  const pkg = readJson("package.json");
  const exports = pkg.exports as ExportsMap;

  it('emits declarations from tsconfig (declaration: true)', () => {
    const tsconfig = readJson("tsconfig.json");
    const opts = tsconfig.compilerOptions as Record<string, unknown>;
    expect(opts.declaration).toBe(true);
  });

  it('exports["."] resolves types first', () => {
    expectTypesFirst(exports, ".");
  });

  it('exports["./plugin"] resolves types first', () => {
    expectTypesFirst(exports, "./plugin");
  });

  it("declares a top-level types field", () => {
    expect(pkg.types).toMatch(/\.d\.ts$/);
  });

  it("ships the declaration directory in the tarball (files includes dist/src)", () => {
    expect(pkg.files as string[]).toContain("dist/src");
  });
});

describe("AC-3: @dropsh/plugin-* child packages ship declarations", () => {
  for (const dir of ["markdown", "jsonapi-schema", "oauth2"]) {
    it(`plugins/${dir} exports every subpath types-first`, () => {
      const pkg = readJson(`plugins/${dir}/package.json`);
      const exports = pkg.exports as ExportsMap;
      for (const subpath of Object.keys(exports)) expectTypesFirst(exports, subpath);
      expect(pkg.types).toMatch(/\.d\.ts$/);
    });
  }
});
