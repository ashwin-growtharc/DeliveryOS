import * as fs from 'fs';
import * as path from 'path';
import ignore from 'ignore';
import { PristineSnapshotMissingError } from '../errors';

/** Loads a gitignore-pattern filter from `<root>/.gitignore`, if present.
 * Returns a predicate that's `true` for paths that should be treated as
 * ignored -- i.e. excluded from local-edit/diff detection entirely.
 *
 * Why this matters: many real projects generate their own build/cache
 * artifacts as a normal side effect of being used (Python's `__pycache__`,
 * `node_modules`, `.pytest_cache`, etc.) -- files the project's own
 * `.gitignore` already excludes, and which `git add` would refuse to stage
 * without `-f` regardless. Without this filter, those files show up as
 * false "local edits" the moment anyone runs the pulled tool (not just
 * during its one-time post_install step), which both mislabels an
 * unmodified pull as "Edited locally" and would make a real `push` fail
 * outright trying to stage gitignored paths. `root` is always a plain
 * directory copy on the local machine (installTarget or its pristine
 * snapshot), never the actual git repo -- this only reads whatever
 * `.gitignore` file happens to be part of the copied payload itself, it
 * does not run git. `root` may also be a single file (per
 * `listFilesRecursive`'s doc comment) -- returns "nothing is ignored" in
 * that case, since there's no directory to hold a `.gitignore`. */
function loadIgnoreFilter(root: string): (relPath: string) => boolean {
  const gitignorePath = path.join(root, '.gitignore');
  if (!fs.existsSync(root) || fs.statSync(root).isFile() || !fs.existsSync(gitignorePath)) {
    return () => false;
  }
  const ig = ignore().add(fs.readFileSync(gitignorePath, 'utf-8'));
  return (relPath: string) => relPath !== '' && ig.ignores(relPath);
}

export interface ChangedFile {
  relPath: string;
  status: 'added' | 'modified' | 'deleted';
}

/** Recursively lists every file (not directory) under `root`, as paths
 * relative to `root` with forward slashes (stable across platforms).
 *
 * `root` itself may be a single file rather than a directory -- this is the
 * shape a `payload_path` pointing at a single real file (e.g.
 * `catalog/agents/code-reviewer.md`) takes on disk. In that case `root` has
 * no meaningful "relative path" of its own, so it's represented by the
 * single entry `''` (empty string), which callers join back onto `root`
 * with `path.join`/`path.posix.join` -- both no-ops on an empty segment. */
export function listFilesRecursive(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  if (fs.statSync(root).isFile()) {
    return [''];
  }

  const result: string[] = [];

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      // A `.git` directory is never something anyone wants copied/diffed as
      // payload content -- a project's own .gitignore typically doesn't even
      // list it (git never applies .gitignore to itself), so relying on
      // .gitignore filtering alone wouldn't catch it. Skipped unconditionally,
      // at the walk level, so a large repo's history is never even read.
      if (entry.isDirectory() && entry.name === '.git') {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        result.push(path.relative(root, fullPath).split(path.sep).join('/'));
      }
    }
  }

  walk(root);

  return result;
}

/**
 * Like `listFilesRecursive`, but also excludes anything the payload's own
 * `.gitignore` says to ignore (build output, `node_modules/`, caches, etc.)
 * -- for proposing a whole project folder as a new artifact's payload
 * (`push --new`), where nothing has diffed it against a pristine snapshot
 * yet to filter that noise out the way `computeChangedFiles` already does
 * for edit-mode pushes.
 */
export function listPayloadFiles(root: string): string[] {
  const isIgnored = loadIgnoreFilter(root);
  return listFilesRecursive(root).filter((relPath) => !isIgnored(relPath));
}

/**
 * Compares the current contents of `installTarget` against the pristine
 * snapshot taken at pull time (`pristineDir`), by file existence and byte
 * content -- never mtimes. Returns the union of added/modified/deleted
 * files, sorted by relative path for a deterministic, reproducible order.
 *
 * Throws PristineSnapshotMissingError if `pristineDir` doesn't exist at
 * all: that means this id has a lockfile entry but no pristine snapshot on
 * disk (a stale/pre-upgrade pull), and diffing against nothing would
 * incorrectly report every file as "added". The fix is always to re-pull.
 */
/**
 * `listFilesRecursive`, restricted to a given set of top-level entry names.
 *
 * Only used for a ROOT `install_target`, where `root` is the user's entire
 * project rather than a directory holding nothing but the artifact. An
 * unrestricted walk there would do two wrong things at once: report every
 * unrelated file in the project as artifact content, and read the whole tree
 * (node_modules included) on every single catalog.list. Restricting the WALK
 * -- rather than listing everything and filtering afterwards -- is what avoids
 * the second.
 */
function listFilesUnderTopLevel(root: string, topLevel: string[]): string[] {
  const result: string[] = [];
  for (const name of topLevel) {
    // Same unconditional skip listFilesRecursive applies, and it matters more
    // here: at the project root a `.git` entry is the real repository.
    if (name === '.git') {
      continue;
    }
    const fullPath = path.join(root, name);
    if (!fs.existsSync(fullPath)) {
      continue;
    }
    if (fs.statSync(fullPath).isDirectory()) {
      for (const relPath of listFilesRecursive(fullPath)) {
        result.push(`${name}/${relPath}`);
      }
    } else {
      result.push(name);
    }
  }
  return result;
}

export function computeChangedFiles(
  installTarget: string,
  pristineDir: string,
  options: { topLevelScope?: string[] } = {},
): ChangedFile[] {
  if (!fs.existsSync(pristineDir)) {
    throw new PristineSnapshotMissingError(
      `No pristine snapshot found at "${pristineDir}" for this artifact. This can happen if it was pulled before DeliveryOS tracked pristine snapshots. Re-pull it first: \`deliveryos pull <id>\`.`,
    );
  }

  // The pristine snapshot is a copy of the same payload, taken right after
  // pull -- its .gitignore (if any) is the same file, so either root works
  // as the source of truth for what's ignored; installTarget is preferred
  // since it's the one that actually reflects what's currently on disk.
  const isIgnored = loadIgnoreFilter(installTarget);

  // `topLevelScope` is set only for a root install_target, where it narrows
  // both walks to the entries the payload actually provided. Absent (every
  // normal subdirectory install), the whole tree IS the artifact and both
  // walks stay unrestricted exactly as before.
  const { topLevelScope } = options;
  const listFiles = (root: string): string[] => (
    topLevelScope ? listFilesUnderTopLevel(root, topLevelScope) : listFilesRecursive(root)
  );

  const currentFiles = new Set(listFiles(installTarget).filter((p) => !isIgnored(p)));
  const pristineFiles = new Set(listFiles(pristineDir).filter((p) => !isIgnored(p)));
  const allPaths = Array.from(new Set([...currentFiles, ...pristineFiles])).sort();

  const changes: ChangedFile[] = [];
  for (const relPath of allPaths) {
    const inCurrent = currentFiles.has(relPath);
    const inPristine = pristineFiles.has(relPath);

    if (inCurrent && !inPristine) {
      changes.push({ relPath, status: 'added' });
      continue;
    }
    if (!inCurrent && inPristine) {
      changes.push({ relPath, status: 'deleted' });
      continue;
    }

    const currentContent = fs.readFileSync(path.join(installTarget, relPath));
    const pristineContent = fs.readFileSync(path.join(pristineDir, relPath));
    if (!currentContent.equals(pristineContent)) {
      changes.push({ relPath, status: 'modified' });
    }
  }

  return changes;
}
