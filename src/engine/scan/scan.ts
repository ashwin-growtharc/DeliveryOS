import * as fs from 'fs';
import * as path from 'path';
import { findRemote } from '../remote/remoteRegistry';
import { cachePath } from '../remote/remoteCache';
import { fetchAndReset } from '../git/git';
import { buildCatalog } from '../catalog/catalog';
import { readLockfile } from '../lockfile/lockfile';
import { guessDescriptionFromFrontmatter } from '../manifest/frontmatter';
import { RemoteRegistryError } from '../errors';
import { ProgressCallback } from '../pull/pull';

/** One agent/skill/command/rule found on disk under `.claude/` that isn't
 * yet tracked in this project's lockfile and doesn't already exist (by id)
 * in the target remote's catalog -- a candidate to propose as a new
 * artifact via `push --new`. `description` is a best-effort guess from the
 * file's own frontmatter (see `guessDescriptionFromFrontmatter`), not a
 * guarantee -- review before pushing, same as Add New already asks.
 * Commands/rules commonly live in category subfolders
 * (`.claude/commands/java/foo.md`) -- `installTarget` preserves whatever
 * relative path was actually found, category subfolder included, so a
 * proposed command/rule pulls back to the exact same place. Rule files in
 * particular use a `paths: [glob, ...]` frontmatter convention, never
 * `description:` -- expect `description` to come back undefined for those
 * and need manual entry, same as any file with no frontmatter at all. */
export interface ScanCandidate {
  id: string;
  kind: 'agent' | 'skill' | 'command' | 'rule';
  payloadPath: string; // absolute path to the real file/folder on disk
  installTarget: string; // relative to cwd, e.g. '.claude/agents/foo.md'
  description?: string;
}

/**
 * Scans `<cwd>/.claude/agents`, `.claude/skills`, `.claude/commands`, and
 * `.claude/rules` for content not already tracked locally (the lockfile) or
 * already present (by id) in `remoteName`'s catalog, so it doesn't show up
 * as "new" if it was already pulled from there, or already proposed by
 * someone else. Fetches `remoteName` fresh first, the same way `push`
 * does, so "already exists" reflects the remote's current state, not a
 * possibly-stale local cache.
 *
 * Deliberately does NOT try to guess `roles`/`teams`/`stacks` -- there's no
 * reliable folder-category signal for a single flat `.claude/agents/`
 * directory (unlike the growtharc-ai-helpers import, which had real
 * per-language category subfolders to key off of), and guessing wrong tags
 * silently is worse than leaving them for the reviewer to fill in via Add
 * New's existing Stack/Team/Role fields. Same reasoning extends to
 * commands/rules even though THEY do often have real category subfolders --
 * scan doesn't try to bundle multi-file structures (a command with its own
 * nested references/, several commands sharing one references/ folder) the
 * way the growtharc-ai-helpers import handled by hand; it just walks every
 * `.md` file under `.claude/commands`/`.claude/rules` recursively and turns
 * each one into its own candidate, including ones sitting inside what's
 * clearly a shared references/ folder. Reviewing candidates before pushing
 * (Add New, or the CLI's printed command) is what catches "this one doesn't
 * really need its own artifact" -- scan itself doesn't try to guess that.
 */
export async function scanForNewArtifacts(
  cwd: string,
  remoteName: string,
  onProgress?: ProgressCallback,
): Promise<ScanCandidate[]> {
  const remoteEntry = findRemote(remoteName);
  if (!remoteEntry) {
    throw new RemoteRegistryError(`No remote named "${remoteName}" is registered`);
  }

  onProgress?.('fetch', `Fetching remote "${remoteName}"...`);
  await fetchAndReset(cachePath(remoteName));

  const remoteCatalogIds = new Set(
    buildCatalog()
      .filter((entry) => entry.remoteName === remoteName)
      .map((entry) => entry.manifest.id),
  );
  const trackedIds = new Set(readLockfile(cwd).entries.map((entry) => entry.id));
  const isNew = (id: string): boolean => !remoteCatalogIds.has(id) && !trackedIds.has(id);

  onProgress?.(
    'scan',
    'Scanning .claude/agents, .claude/skills, .claude/commands, and .claude/rules for new artifacts...',
  );
  const candidates: ScanCandidate[] = [];

  const agentsDir = path.join(cwd, '.claude', 'agents');
  if (fs.existsSync(agentsDir)) {
    for (const file of fs.readdirSync(agentsDir)) {
      if (!file.toLowerCase().endsWith('.md')) {
        continue;
      }
      const filePath = path.join(agentsDir, file);
      if (!fs.statSync(filePath).isFile()) {
        continue;
      }
      const id = file.slice(0, -3); // strip '.md'
      if (!isNew(id)) {
        continue;
      }
      candidates.push({
        id,
        kind: 'agent',
        payloadPath: filePath,
        installTarget: path.posix.join('.claude', 'agents', file),
        description: guessDescriptionFromFrontmatter(fs.readFileSync(filePath, 'utf-8')),
      });
    }
  }

  const skillsDir = path.join(cwd, '.claude', 'skills');
  if (fs.existsSync(skillsDir)) {
    for (const dirName of fs.readdirSync(skillsDir)) {
      const skillDir = path.join(skillsDir, dirName);
      if (!fs.statSync(skillDir).isDirectory()) {
        continue;
      }
      if (!isNew(dirName)) {
        continue;
      }
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      candidates.push({
        id: dirName,
        kind: 'skill',
        payloadPath: skillDir,
        installTarget: path.posix.join('.claude', 'skills', dirName),
        description: fs.existsSync(skillMdPath)
          ? guessDescriptionFromFrontmatter(fs.readFileSync(skillMdPath, 'utf-8'))
          : undefined,
      });
    }
  }

  candidates.push(...scanMarkdownFilesRecursively(cwd, 'commands', 'command', isNew));
  candidates.push(...scanMarkdownFilesRecursively(cwd, 'rules', 'rule', isNew));

  return candidates;
}

/** Recursively finds every `.md` file under `<cwd>/.claude/<subdir>`
 * (commands/rules commonly nest into category subfolders, unlike the
 * one-level-deep agents/skills), each becoming its own candidate keyed by
 * its own basename -- not the folder-qualified name the growtharc-ai-
 * helpers import used to dodge cross-category name collisions, since a
 * general-purpose scan can't know in advance whether a given project's
 * commands/rules actually collide the way that particular source backup's
 * did. `installTarget` still preserves the real subfolder path found, so a
 * proposed command/rule pulls back to exactly where it was found. */
function scanMarkdownFilesRecursively(
  cwd: string,
  subdir: string,
  kind: 'command' | 'rule',
  isNew: (id: string) => boolean,
): ScanCandidate[] {
  const rootDir = path.join(cwd, '.claude', subdir);
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const candidates: ScanCandidate[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        const id = entry.name.slice(0, -3);
        if (!isNew(id)) {
          continue;
        }
        const relFromClaude = path.relative(path.join(cwd, '.claude'), fullPath).split(path.sep).join('/');
        candidates.push({
          id,
          kind,
          payloadPath: fullPath,
          installTarget: path.posix.join('.claude', relFromClaude),
          description: guessDescriptionFromFrontmatter(fs.readFileSync(fullPath, 'utf-8')),
        });
      }
    }
  }

  walk(rootDir);
  return candidates;
}
