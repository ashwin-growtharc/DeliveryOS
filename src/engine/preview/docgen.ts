import * as fs from 'fs';
import * as path from 'path';
import { withDefaultConfig, ComponentDoc, PropItem } from 'react-docgen-typescript';

export interface PropSchemaEntry {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  enumValues?: string[];
  description?: string;
}

const COMPONENT_FILE_PATTERN = /\.(tsx|jsx)$/;

const parser = withDefaultConfig({ savePropValueAsString: true });

/**
 * Parses a single `.tsx`/`.jsx` file via the real TypeScript compiler
 * (`react-docgen-typescript`), returning every component doc found in it
 * -- shared by `extractPropsSchemas` below (which turns each doc into a
 * props-controls schema) and Phase D's structural UI-component detector
 * (`src/engine/scan/detectUiComponents.ts`), which only needs the
 * boolean "did this find a component at all" signal. Deliberately does
 * NOT catch parse errors itself -- the two callers already have
 * different "fail soft" handling for a throw (`extractPropsSchemas`
 * continues on to other sibling files; the detector treats a throw as
 * "not a component candidate"), so swallowing the error here would
 * erase that distinction instead of leaving each caller to decide.
 */
export function parseComponentFile(file: string): ComponentDoc[] {
  return parser.parse(file);
}

/**
 * Derives a props-controls schema for every component sibling to a
 * preview.tsx file, via `react-docgen-typescript` against the real
 * TypeScript compiler -- NOT esbuild, which never type-checks at all (see
 * compile.ts's own React adapter, which strips TS syntax without
 * resolving a single type; confirmed the existing Button.tsx fixture uses
 * `React.ReactNode` with no `import React` and compiles fine today
 * because of exactly that). Keyed by each component's docgen
 * `displayName`, so the harness's runtime-introspected component name
 * (see compile.ts's postMessage protocol) can look up its matching schema
 * without `preview.tsx` ever needing to declare which Props interface is
 * "the" one -- this is the file-discovery convention Phase C settled on
 * instead of a new authoring requirement.
 *
 * Degrades to `{}` on any parse failure -- a preview with no controls
 * beats no preview at all (this feature's existing "preview fails soft"
 * principle, see docs/ui-components-feature-design.md §12.3).
 */
export function extractPropsSchemas(
  componentDir: string,
  excludeFile: string,
): Record<string, PropSchemaEntry[]> {
  const excludeBasename = path.basename(excludeFile);
  let siblingFiles: string[];
  try {
    siblingFiles = findComponentFiles(componentDir, excludeBasename);
  } catch {
    return {};
  }
  if (siblingFiles.length === 0) {
    return {};
  }

  const schemas: Record<string, PropSchemaEntry[]> = {};

  // Parses each file separately, not one `parser.parse(siblingFiles)`
  // call for all of them -- a syntax error in ANY single sibling (e.g. a
  // stray test/fixture file sitting in the payload directory) would
  // otherwise degrade every other, otherwise-valid component's schema in
  // this same directory to nothing too, not just the broken one.
  for (const file of siblingFiles) {
    try {
      const docs: ComponentDoc[] = parseComponentFile(file);
      for (const doc of docs) {
        // First-wins, not last-wins, on a displayName collision (two
        // sibling files exporting a same-named component) -- an
        // arbitrary but at least deterministic and readdir-order-stable
        // tie-break, rather than silently letting whichever file
        // happened to be read last win with no indication either way.
        if (!(doc.displayName in schemas)) {
          schemas[doc.displayName] = Object.values(doc.props).map(toPropSchemaEntry);
        }
      }
    } catch {
      // Degrades this one file's contribution to the schema, not the
      // whole result -- "preview fails soft" principle, applied per-file
      // rather than per-directory.
    }
  }
  return schemas;
}

/**
 * Recursively finds every `.tsx`/`.jsx` file under `componentDir`,
 * excluding `excludeBasename` (the preview entry itself) wherever it
 * appears. Recursive, not a flat `readdirSync`, because esbuild's own
 * import sandboxing (`createDirectorySandboxPlugin` in compile.ts) scopes
 * to the whole directory TREE, not just its top level -- a `preview.tsx`
 * that imports `./components/Button` from a subfolder compiles and
 * bundles fine today, so docgen's own discovery convention has to match
 * that same assumption or it would silently find zero siblings and
 * degrade to an empty (but not erroring) schema for a perfectly valid
 * authoring layout.
 *
 * Exported (not just used internally by `extractPropsSchemas`) so
 * `compile.ts`'s Tailwind CSS generation can reuse the exact same
 * "every .tsx/.jsx file in this payload directory" discovery -- it needs
 * every sibling's raw source text to scan for class names, not just the
 * ones docgen itself cares about. Pass `''` for `excludeBasename` there
 * (a name no real file ever has) to include every file with none
 * excluded, rather than adding a second, subtly-different traversal.
 */
export function findComponentFiles(dir: string, excludeBasename: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findComponentFiles(fullPath, excludeBasename));
    } else if (COMPONENT_FILE_PATTERN.test(entry.name) && entry.name !== excludeBasename) {
      found.push(fullPath);
    }
  }
  return found;
}

function toPropSchemaEntry(prop: PropItem): PropSchemaEntry {
  return {
    name: prop.name,
    type: prop.type.name,
    required: prop.required,
    defaultValue: prop.defaultValue?.value !== undefined ? String(prop.defaultValue.value) : undefined,
    enumValues: parseEnumValues(prop.type.name),
    description: prop.description || undefined,
  };
}

/**
 * Parses a docgen type name like `"primary" | "secondary"` into
 * `['primary', 'secondary']` -- only matches a union purely of quoted
 * string literals (a real TS string-literal-union prop type). Anything
 * else (booleans, numbers, `string | number`, arbitrary object types)
 * yields `undefined` so the controls panel falls back to a plain
 * text/boolean input instead of misreading a non-enum union as one.
 *
 * Exported (not just used internally by `toPropSchemaEntry` above) so
 * `detectUiComponents.ts`'s auto-scaffolded `preview.tsx` can pick a real
 * member of a required string-literal-union prop as its placeholder value,
 * instead of the empty string `placeholderForType` would otherwise fall
 * back to -- an empty string is a genuinely invalid value for a union
 * type (not even one of the type's own allowed literals), which a plain
 * "any required prop with no default gets ''" rule would silently produce.
 */
export function parseEnumValues(typeName: string): string[] | undefined {
  const parts = typeName.split('|').map((part) => part.trim());
  const isStringLiteralUnion = parts.length > 1 && parts.every((part) => /^"[^"]*"$/.test(part));
  if (!isStringLiteralUnion) {
    return undefined;
  }
  return parts.map((part) => part.slice(1, -1));
}
