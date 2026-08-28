import * as fs from 'fs';
import * as path from 'path';
import { ComponentDoc, PropItem } from 'react-docgen-typescript';
import { parseComponentFile, parseEnumValues } from '../preview/docgen';
import { detectSelfNestingWarnings } from './detectSelfNesting';
import { scanStagingDir } from '../paths';
import { ScanCandidate } from './types';

const COMPONENT_FILE_PATTERN = /\.(tsx|jsx)$/i;
const TEST_FILE_PATTERN = /\.(test|spec)\.(tsx|jsx)$/i;

// Directory names (case-insensitive) that never contain reusable UI
// components worth surfacing as candidates, no matter how deep they sit
// under `src/` -- see docs/ui-components-feature-design.md §6. This is
// deliberately a *noise* filter, not the real detection: it only rules out
// directories where "component-shaped file" is virtually guaranteed to
// mean a page/route, not a reusable piece. The structural check
// (`parseComponentFile` finding a real Props type) is what actually
// decides candidacy -- this just keeps obviously-irrelevant subtrees out
// of the (comparatively expensive) TypeScript parse entirely.
const EXCLUDED_DIR_NAMES = new Set(['node_modules', 'pages', 'app', 'routes']);

/** One file that structurally looks like a reusable component -- passed
 * `parseComponentFile` and returned at least one `ComponentDoc` with a
 * non-empty `props` map. `docs` is kept (not just a boolean) because
 * scaffolding a `preview.tsx` later needs the actual prop list to build a
 * props stub from. */
interface DetectedComponentFile {
  absPath: string;
  docs: ComponentDoc[];
}

/**
 * Walks `<projectRoot>/src/**\/*.{tsx,jsx}` looking for structurally
 * reusable React components (a file exporting something `react-docgen-
 * typescript` can describe with a real, non-empty props map -- see
 * `parseComponentFile`'s own doc comment), and turns each one into a
 * `ScanCandidate` of kind `'ui-component'`, skipping any whose id is
 * already tracked/published (via the same `isNew` closure
 * `scanForNewArtifacts` builds from the remote catalog + lockfile).
 *
 * Deliberately does NOT restrict the glob to a folder-naming convention
 * (`src/components/**`, `src/ui/**`, etc.) -- every team names it
 * differently, so the directory-name exclusions above are the only
 * folder-based filtering here; the structural parse is what actually
 * decides "is this a component" (design doc §6: "cast a wide net
 * structurally, filter semantically, not by folder-naming convention").
 * A parse failure, or a parse that succeeds but finds no component with
 * props, is treated as "not a candidate," never an error -- this is a
 * pure best-effort heuristic (no AI/LLM call, nothing that can fail
 * loudly), and false positives (a page component with a `Props` type,
 * a render-prop helper) are explicitly tolerated: Review is still
 * required before anything is proposed, so noise here is harmless, just
 * unhelpful (design doc §12.2).
 */
export function detectUiComponentCandidates(cwd: string, isNew: (id: string) => boolean): ScanCandidate[] {
  const srcRoot = path.join(cwd, 'src');
  if (!fs.existsSync(srcRoot)) {
    return [];
  }

  const candidateFiles: string[] = [];
  collectComponentShapedFiles(srcRoot, candidateFiles);

  const detected: DetectedComponentFile[] = [];
  for (const file of candidateFiles) {
    let docs: ComponentDoc[];
    try {
      docs = parseComponentFile(file);
    } catch {
      continue; // Not a component -- a parse failure isn't a scan error.
    }
    if (docs.some((doc) => Object.keys(doc.props).length > 0)) {
      detected.push({ absPath: file, docs });
    }
  }

  // Sorted by absolute path before anything below keys off order --
  // `fs.readdirSync` order is filesystem/platform-dependent, and both the
  // dedicated-vs-flat folder count and the id-collision tie-break (below)
  // need to be reproducible across machines and runs, not just internally
  // consistent within a single one.
  detected.sort((a, b) => (a.absPath < b.absPath ? -1 : a.absPath > b.absPath ? 1 : 0));

  // How many detected components share each immediate containing folder
  // -- the signal `isDedicatedFolder` below uses to tell "this component
  // owns this folder" apart from "this folder is a shared bucket of many
  // unrelated components" (design doc §11's flat-convention example:
  // `src/ui/button.tsx` sitting alongside many other components in one
  // shared folder).
  const siblingCountByFolder = new Map<string, number>();
  for (const file of detected) {
    const folder = path.dirname(file.absPath);
    siblingCountByFolder.set(folder, (siblingCountByFolder.get(folder) ?? 0) + 1);
  }

  // Grouped by their pre-dedupe id so same-batch collisions (two
  // different files that happen to derive the same id) can be resolved
  // deterministically -- see the loop below and its own comment.
  const groupsById = new Map<string, DetectedComponentFile[]>();
  for (const file of detected) {
    const baseId = deriveComponentId(file.absPath, srcRoot);
    const group = groupsById.get(baseId);
    if (group) {
      group.push(file);
    } else {
      groupsById.set(baseId, [file]);
    }
  }

  const candidates: ScanCandidate[] = [];
  for (const [baseId, group] of groupsById) {
    group.forEach((file, indexInGroup) => {
      const warnings: string[] = [];

      // Same-batch id collision: two DIFFERENT files in this one scan run
      // derived the same id (e.g. `src/a/forms/Button.tsx` and
      // `src/b/forms/Button.tsx` -- the immediate-parent-folder id scheme
      // only looks at `forms`, not the full path, so this is a real,
      // if rare, case). Distinct from `IdCollisionError` (errors.ts),
      // which is only ever thrown against the *remote* catalog in
      // push.ts -- this is two local candidates colliding with each
      // other, not with anything already published. Resolution: first
      // occurrence (by the deterministic absPath sort above) keeps the
      // clean id; every later one gets a numeric suffix and a warning
      // pointing at what it collided with. A numeric suffix rather than
      // silently skipping the later file -- both components are equally
      // real and equally worth reviewing, so disambiguating and
      // surfacing both beats dropping one on the floor without saying so.
      const id = indexInGroup === 0 ? baseId : `${baseId}-${indexInGroup + 1}`;
      if (indexInGroup > 0) {
        warnings.push(
          `Candidate id "${baseId}" was already used by ${path.relative(cwd, group[0].absPath)} ` +
            `earlier in this scan -- disambiguated to "${id}". Consider renaming one of these folders ` +
            'for a clearer id.',
        );
      }

      if (!isNew(id)) {
        return;
      }

      const folder = path.dirname(file.absPath);
      const dedicated = folder !== srcRoot && siblingCountByFolder.get(folder) === 1;
      // Guaranteed to exist: this is exactly the condition that made
      // `file` a member of `detected` above.
      const doc = file.docs.find((d) => Object.keys(d.props).length > 0)!;
      const source = fs.readFileSync(file.absPath, 'utf-8');

      const materialized = dedicated
        ? materializeDedicatedCandidate(file.absPath, folder, cwd, doc, source)
        : materializeFlatCandidate(file.absPath, cwd, id, doc, source);

      warnings.push(...materialized.importWarnings);
      // First mechanical anti-pattern rule (PLAN.md Phase 11 item 2) --
      // see detectSelfNesting.ts's own doc comment for why this needs a
      // real AST walk (react-docgen-typescript returns no raw tree) and
      // why the threshold is two levels of self-nesting, not one.
      warnings.push(...detectSelfNestingWarnings(source, doc.displayName, file.absPath));

      candidates.push({
        id,
        kind: 'ui-component',
        payloadPath: materialized.payloadPath,
        installTarget: materialized.installTarget,
        // `doc.description` is `react-docgen-typescript`'s own parse of a
        // real JSDoc/leading comment directly above the component -- an
        // author-written fact, not a guess, exactly like
        // `guessDescriptionFromFrontmatter` for the markdown kinds. Left
        // undefined (for the reviewer to fill in) only when no such
        // comment actually exists.
        description: doc.description.trim().length > 0 ? doc.description.trim() : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
      });
    });
  }

  return candidates;
}

/** Recursively collects every `.tsx`/`.jsx` file under `dir`, excluding
 * `node_modules`/dotfiles/dot-directories/`pages`/`app`/`routes` (by
 * directory name, case-insensitive, at any depth -- skipping the
 * directory during the walk means nothing under it is ever visited,
 * satisfying "anywhere in the path" for free) and `*.test.{tsx,jsx}` /
 * `*.spec.{tsx,jsx}` files. An unreadable directory (permissions, a broken
 * symlink) is skipped, not thrown -- one bad subtree shouldn't take down
 * the whole scan. */
function collectComponentShapedFiles(dir: string, results: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const lowerName = entry.name.toLowerCase();
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(lowerName)) {
        continue;
      }
      collectComponentShapedFiles(fullPath, results);
    } else if (entry.isFile() && COMPONENT_FILE_PATTERN.test(entry.name) && !TEST_FILE_PATTERN.test(entry.name)) {
      results.push(fullPath);
    }
  }
}

/**
 * Derives a stable candidate id from a component file's location, keyed
 * off its IMMEDIATE containing folder rather than the full path relative
 * to `src/` -- e.g. `src/ui/forms/button.tsx` becomes `forms-button`, not
 * `ui-forms-button`. The immediate folder is the only part of the path
 * that actually disambiguates one same-named component from another (two
 * different `button.tsx` files under `forms/` and `marketing/` need
 * different ids -- `forms-button`/`marketing-button`, exactly the example
 * in design doc §12.2); a shared ancestor segment like `ui` is common to
 * both and adds nothing but noise.
 *
 * When the immediate folder's name already equals the file's own
 * basename -- the `ComponentName/ComponentName.tsx` convention -- the
 * folder name alone is used instead of doubling it up (`card`, not
 * `card-card`), matching `src/components/Card/Card.tsx` -> `card` from
 * the design doc. A file sitting directly in `src/` itself (no
 * containing folder below `src` to key off of) just uses its own
 * basename.
 *
 * Everything is lowercased and slugified (non-alphanumeric runs collapse
 * to a single `-`, leading/trailing `-` trimmed) so this is stable and
 * deterministic across runs regardless of original casing or odd
 * characters in a folder/file name -- no randomness, no timestamps.
 */
function deriveComponentId(filePath: string, srcRoot: string): string {
  const baseName = slugify(path.basename(filePath, path.extname(filePath)));
  const folder = path.dirname(filePath);
  if (folder === srcRoot) {
    return baseName;
  }
  const folderName = slugify(path.basename(folder));
  return folderName === baseName ? folderName : `${folderName}-${baseName}`;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface MaterializedPayload {
  payloadPath: string;
  installTarget: string;
  importWarnings: string[];
}

/**
 * "Dedicated folder" case: `folder` isn't `src` itself, and this file is
 * the only structurally-detected component directly inside it (siblings
 * may exist -- `utils.ts`, a stylesheet, a barrel `index.ts` -- they just
 * aren't independently detected components themselves). The payload is
 * that real folder, in place, exactly like `scanForNewArtifacts`'s
 * existing agent/skill candidates -- nothing is copied.
 *
 * When multiple detected components share one folder with no name match
 * to break the tie, this function is never called for any of them --
 * `siblingCountByFolder.get(folder) === 1` in the caller is strict, not
 * "closest match." Deliberately conservative: if we can't tell whose
 * folder it really is, it's safer to synthesize an isolated payload per
 * component (see `materializeFlatCandidate`) than to risk bundling one
 * component's folder as if it exclusively belonged to another.
 */
function materializeDedicatedCandidate(
  filePath: string,
  folder: string,
  cwd: string,
  doc: ComponentDoc,
  source: string,
): MaterializedPayload {
  const previewPath = path.join(folder, 'preview.tsx');
  if (!fs.existsSync(previewPath)) {
    fs.writeFileSync(previewPath, buildPreviewSource(filePath, doc, source), 'utf-8');
  }

  const importWarnings = findEscapingImportWarnings(filePath, source, folder);
  const installTarget = path.relative(cwd, folder).split(path.sep).join('/');
  return { payloadPath: folder, installTarget, importWarnings };
}

/**
 * "Flat convention" case (design doc §11): the component has no folder of
 * its own -- it's either sitting directly in `src/`, or in a folder it
 * shares with other independently-detected components (a bucket
 * directory, not a dedicated one). The original file is never moved or
 * modified: a COPY of it, plus a freshly generated `preview.tsx`, is
 * staged into `scanStagingDir(cwd)/<id>` -- a synthetic payload folder
 * built just for this candidate, mirroring the real "always one folder
 * per component" payload shape from design doc §11 even though nothing
 * like that exists on disk for this file yet.
 *
 * `id` is already slugified to `[a-z0-9-]+` (see `deriveComponentId`/the
 * numeric-suffix dedupe in the caller), so joining it onto
 * `scanStagingDir(cwd)` can't escape that directory even though `id`
 * ultimately derives from an on-disk folder/file name.
 *
 * The import-escape check is passed `null` for its allowed root (instead
 * of the component's real, original folder) -- deliberately stricter than
 * the dedicated-folder case: the staged payload will contain ONLY the
 * copied file and the generated preview, never any of its original
 * siblings, so ANY relative import at all (even one reaching a file that
 * genuinely sits right next to it on disk today) will fail to resolve
 * once staged, and is worth flagging.
 */
function materializeFlatCandidate(
  filePath: string,
  cwd: string,
  id: string,
  doc: ComponentDoc,
  source: string,
): MaterializedPayload {
  const stagingDir = path.join(scanStagingDir(cwd), id);
  fs.mkdirSync(stagingDir, { recursive: true });

  const basename = path.basename(filePath);
  fs.copyFileSync(filePath, path.join(stagingDir, basename));
  fs.writeFileSync(path.join(stagingDir, 'preview.tsx'), buildPreviewSource(filePath, doc, source), 'utf-8');

  const importWarnings = findEscapingImportWarnings(filePath, source, null);
  const installTarget = path.posix.join('src', 'components', id);
  return { payloadPath: stagingDir, installTarget, importWarnings };
}

/** Matches a static `import ... from '...'`/`export ... from '...'`
 * specifier, or a bare side-effect `import '...'`. Deliberately a
 * source-text regex, not a real parse -- same known-limitation tradeoff
 * `compile.ts`'s `listVariantNames` already makes for the same reason
 * (no TypeScript compiler invocation just to find import strings). Won't
 * catch a dynamic `import('...')` call or a `require('...')` -- both are
 * rare in component source and, if present, would need a real module
 * resolver to check meaningfully anyway, which is out of scope for a
 * static, deterministic, zero-cost heuristic. */
const IMPORT_SPECIFIER_PATTERN = /(?:from|import)\s+['"]([^'"]+)['"]/g;

function findRelativeImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  let match: RegExpExecArray | null;
  IMPORT_SPECIFIER_PATTERN.lastIndex = 0;
  while ((match = IMPORT_SPECIFIER_PATTERN.exec(source)) !== null) {
    const specifier = match[1];
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
}

/**
 * Flags relative imports in `filePath` whose resolved target falls
 * outside `allowedRoot` -- a static, non-resolving check (it never asks
 * whether the target file actually exists) surfaced as a `warnings` entry
 * on the candidate, not thrown. This is Scan-side and informational; the
 * real enforcement of this same boundary happens at compile time in
 * `compile.ts`'s `createDirectorySandboxPlugin`, which fails hard and
 * opaquely (an esbuild error) if it's ever actually violated. Catching it
 * here first means Review sees "this isn't self-contained yet" in plain
 * language instead of a raw bundler error surfacing much later, only once
 * someone tries to push or preview it.
 *
 * `allowedRoot: null` means no root is allowed at all (the flat-convention
 * case, where nothing but the component file itself and a generated
 * preview will ever be staged) -- every relative import is flagged.
 */
function findEscapingImportWarnings(filePath: string, source: string, allowedRoot: string | null): string[] {
  const specifiers = findRelativeImportSpecifiers(source);
  if (specifiers.length === 0) {
    return [];
  }

  const fileDir = path.dirname(filePath);
  const warnings: string[] = [];
  for (const specifier of specifiers) {
    if (allowedRoot === null) {
      warnings.push(
        `Relative import "${specifier}" won't resolve once this component is staged into its own payload ` +
          'folder -- it has no dedicated folder on disk to copy that dependency from. Either inline the ' +
          "dependency or give this component its own folder before proposing it.",
      );
      continue;
    }
    const resolved = path.resolve(fileDir, specifier);
    if (resolved !== allowedRoot && !resolved.startsWith(allowedRoot + path.sep)) {
      warnings.push(
        `Relative import "${specifier}" resolves outside this component's own folder (${allowedRoot}) -- ` +
          "it won't be included in the payload as-is; move the dependency inside the folder or expect a " +
          'compile failure on push.',
      );
    }
  }
  return warnings;
}

/**
 * Best-effort `preview.tsx` stub, matching this codebase's existing CSF-
 * style convention (see `test/fixtures/preview-spike/Button/preview.tsx`):
 * a plain import of the component plus one `Default` export rendering it.
 * Only REQUIRED props get a value -- optional props are simply omitted,
 * relying on the component's own defaults (a real callback prop like
 * `onClick` is never auto-wired to a fake handler, even when required in
 * principle it would need one -- inventing behavior a person didn't write
 * is a different, riskier kind of guess than a placeholder value). Each
 * required prop's value comes from its docgen `defaultValue` if one
 * happens to be present, a real member of its own string-literal union if
 * it has one (`parseEnumValues`), else a type-based placeholder (the
 * prop's own name, capitalized, for a plain string -- never an empty
 * string, which renders as invisible content; `false` for boolean, `0`
 * for number). Deliberately not cleverer than that:
 * this is a starting point for Review to edit, the same "AI guessed,
 * review before proposing" spirit as every other guessed field in scan.
 */
function buildPreviewSource(filePath: string, doc: ComponentDoc, source: string): string {
  const componentName = doc.displayName;
  const importSpecifier = `./${path.basename(filePath, path.extname(filePath))}`;
  const importLine = isDefaultExport(source, componentName)
    ? `import ${componentName} from '${importSpecifier}';`
    : `import { ${componentName} } from '${importSpecifier}';`;

  return (
    `${importLine}\n\n` +
    `const inferredProps = ${buildInferredPropsSource(doc)};\n\n` +
    `export const Default = () => <${componentName} {...inferredProps} />;\n`
  );
}

/** Best-effort default/named export detection, so the generated preview's
 * import statement matches how the component is actually exported. A
 * source-text regex, not a real parse -- same tradeoff as
 * `IMPORT_SPECIFIER_PATTERN` above. Only recognizes the common forms
 * (`export default function Name`, `export default class Name`, a bare
 * `export default Name;` re-export, or `export { Name as default }`);
 * anything else (an anonymous `export default () => ...`) falls through
 * to the named-import branch, which is this codebase's existing preview
 * fixture convention and the more common real-world shape anyway. */
function isDefaultExport(source: string, componentName: string): boolean {
  const patterns = [
    new RegExp(`export\\s+default\\s+(?:function|class)\\s+${componentName}\\b`),
    new RegExp(`export\\s+default\\s+${componentName}\\s*;`),
    new RegExp(`export\\s*\\{[^}]*\\b${componentName}\\s+as\\s+default\\b`),
  ];
  return patterns.some((pattern) => pattern.test(source));
}

function buildInferredPropsSource(doc: ComponentDoc): string {
  const requiredProps = Object.values(doc.props).filter((prop) => prop.required);
  if (requiredProps.length === 0) {
    return '{}';
  }
  const lines = requiredProps.map((prop) => `  ${prop.name}: ${literalForProp(prop)},`);
  return `{\n${lines.join('\n')}\n}`;
}

function literalForProp(prop: PropItem): string {
  if (prop.defaultValue?.value !== undefined) {
    return serializeDefaultValue(String(prop.defaultValue.value), prop.type.name);
  }
  // A required string-literal-union prop (`variant: 'primary' | 'secondary'`)
  // with no default falls through to placeholderForType's plain-string
  // branch unless checked first -- and an empty string is a genuinely
  // INVALID value for a union type (not one of its own allowed literals),
  // not just an uninformative one. Picking the union's own first member
  // instead is always valid input, not just a nicer-looking placeholder.
  const enumValues = parseEnumValues(prop.type.name);
  if (enumValues && enumValues.length > 0) {
    return JSON.stringify(enumValues[0]);
  }
  // A function-typed required prop (`onActivate: () => void`) needs a
  // real, callable placeholder -- the plain-string branch in
  // placeholderForType would otherwise hand it a STRING (the capitalized
  // prop name), which is worse than the old empty-string bug this whole
  // function exists to fix: a component that actually CALLS the prop
  // (`onClick={onActivate}`, then a real click) would throw "onActivate is
  // not a function" the moment someone interacts with the Review preview,
  // not just render blank. A no-op arrow function is syntactically valid
  // and safe to call, without fabricating any real BEHAVIOR (a materially
  // different, riskier kind of guess this codebase deliberately avoids --
  // see buildInferredPropsSource's own doc comment).
  if (prop.type.name.includes('=>')) {
    return '() => {}';
  }
  return placeholderForType(prop.type.name, prop.name);
}

/** `react-docgen-typescript` (with `savePropValueAsString`) stores a
 * default value's *runtime* value as a plain string, not source code --
 * e.g. a `variant = 'primary'` default comes back as the 3-character
 * string `primary`, not the 9-character source text `'primary'` (confirmed
 * empirically against the `Button` fixture). Boolean/number defaults are
 * already valid JS literal text as-is (`false`, `42`); anything else
 * needs to be re-quoted to become valid generated source. */
function serializeDefaultValue(rawValue: string, typeName: string): string {
  if (typeName === 'boolean' || typeName === 'number') {
    return rawValue;
  }
  return JSON.stringify(rawValue);
}

/**
 * Type-based placeholder for a required prop with no default and no enum
 * to pick from -- `propName` (the actual prop's own name, e.g. `label`)
 * becomes the string placeholder itself (capitalized: `label` -> `'Label'`)
 * rather than an empty string. An empty string technically satisfies a
 * `string` prop's type, but renders as genuinely blank/invisible content in
 * the live preview -- exactly the kind of "looks broken, not just
 * unfinished" first impression a Review-step live preview exists to avoid
 * (a person can't tell "this is a real bug" from "this is an unfilled
 * placeholder" when a component renders literally empty). Still just a
 * best-effort starting point for Review to edit, same as every other
 * guessed value here -- not an attempt to guess the "real" intended text.
 */
function placeholderForType(typeName: string, propName: string): string {
  if (typeName === 'boolean') {
    return 'false';
  }
  if (typeName === 'number') {
    return '0';
  }
  return JSON.stringify(propName.charAt(0).toUpperCase() + propName.slice(1));
}
