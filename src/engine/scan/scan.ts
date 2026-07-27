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

/** One agent/skill found on disk under `.claude/agents`/`.claude/skills`
 * that isn't yet tracked in this project's lockfile and doesn't already
 * exist (by id) in the target remote's catalog -- a candidate to propose
 * as a new artifact via `push --new`. `description` is a best-effort guess
 * from the file's own frontmatter (see `guessDescriptionFromFrontmatter`),
 * not a guarantee -- review before pushing, same as Add New already asks. */
export interface ScanCandidate {
  id: string;
  kind: 'agent' | 'skill';
  payloadPath: string; // absolute path to the real file/folder on disk
  installTarget: string; // relative to cwd, e.g. '.claude/agents/foo.md'
  description?: string;
}

/**
 * Scans `<cwd>/.claude/agents/<id>.md` and `<cwd>/.claude/skills/<id>` for
 * agents/skills not already tracked locally (the lockfile) or already
 * present (by id) in `remoteName`'s catalog, so they don't show up as
 * "new" if they were already pulled from there, or already proposed by
 * someone else. Fetches `remoteName` fresh first, the same way `push`
 * does, so "already exists" reflects the remote's current state, not a
 * possibly-stale local cache.
 *
 * Deliberately does NOT try to guess `roles`/`teams`/`stacks` -- there's no
 * reliable folder-category signal for a single flat `.claude/agents/`
 * directory (unlike the growtharc-ai-helpers import, which had real
 * per-language category subfolders to key off of), and guessing wrong tags
 * silently is worse than leaving them for the reviewer to fill in via Add
 * New's existing Stack/Team/Role fields.
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

  onProgress?.('scan', 'Scanning .claude/agents and .claude/skills for new artifacts...');
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

  return candidates;
}
