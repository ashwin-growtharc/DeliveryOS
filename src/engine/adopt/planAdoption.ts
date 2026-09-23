import * as fs from 'fs';
import { AdoptionPlanError } from '../errors';
import * as path from 'path';
import { Manifest, ManifestSchema } from '../manifest/schema';
import { guessDescriptionFromFrontmatter } from '../manifest/frontmatter';
import { bumpVersion } from '../manifest/version';
import { AdoptionProfile, AdoptionRule, slugify } from './profile';
import { describeOfficeFile, isOfficeFile } from './officeText';
import { listFilesRecursive } from '../push/diff';
import { isSyncDetritus } from '../remote/backends';

/**
 * What adopting a client's folder WOULD produce, without producing any of it.
 *
 * Same posture as `planPush` and `scaffold-backend-plugin`: propose, let a
 * person correct, then commit. `scaffoldBackendPlugin` states the rule this
 * follows -- it writes a draft "and never writes to a real manifest.yaml."
 *
 * WHY EVERY CANDIDATE IS VALIDATED BEFORE ANY IS WRITTEN
 *
 * `discoverManifests` treats one invalid manifest as fatal for the ENTIRE
 * catalog, and `schema.ts` records the incident: a single bad `install_target`
 * blanked all 227 artifacts. So adoption is all-or-nothing by construction. A
 * partial adoption that landed 180 good manifests and one bad one would take
 * the whole catalog down, and the bad one would be the hardest to find.
 *
 * WHY A SECOND ADOPTION IS AN UPDATE AND NOT A COLLISION
 *
 * The first version of this treated every id already in the catalog as a fatal
 * collision. Correct for a first adoption; fatal for the second, because the
 * moment a client edited one file, every file was "already in the catalog" and
 * the catalog could never be brought up to date again. An existing manifest
 * whose `payload_path` is the very file being planned is the same artifact,
 * and planning it again is an update.
 *
 * In an update the EXISTING manifest wins for everything a person may have
 * edited -- description, tags, install target, kind. A heading derived from the
 * file on day one must never silently overwrite the description somebody wrote
 * on day ten; `push --description` is the reviewed path for changing those.
 * Only `version` moves, and only when the bytes did.
 */

export type AdoptionAction = 'create' | 'update';

/** One artifact adoption would create or update. */
export interface AdoptionCandidate {
  id: string;
  action: AdoptionAction;
  /** Path of the original file, relative to the source root, forward-slashed.
   * Becomes `payload_path`, which is what makes this adopt-in-place: the file
   * is registered where it already lives rather than copied. */
  sourcePath: string;
  manifest: Manifest;
  /** True when the description had to be derived rather than read from the file
   * itself. Surfaced so a reviewer knows which ones to actually read. Always
   * false for an update, whose description is the catalog's own. */
  descriptionGuessed: boolean;
}

export interface RetiredArtifact {
  id: string;
  /** The file the manifest pointed at, which the source no longer has. */
  sourcePath: string;
}

export interface AdoptionPlan {
  /** Manifests to write: new artifacts and updated ones. */
  candidates: AdoptionCandidate[];
  /** Already in the catalog, pointing at the same file, bytes unchanged.
   * Nothing to write; reported so the count adds up. */
  unchanged: Array<{ id: string; sourcePath: string }>;
  /** Manifests to delete, because the file they pointed at is gone from the
   * source. Only ever computed when the caller says which files were removed. */
  retired: RetiredArtifact[];
  /** Files a rule matched but which could not become artifacts, with the
   * reason. Reported rather than silently dropped -- a file that vanishes
   * between "47 markdown files" and "45 artifacts" is a question nobody can
   * answer later. */
  skipped: Array<{ sourcePath: string; reason: string }>;
}

export interface PlanAdoptionOptions {
  /** The files to consider, relative to the source root and forward-slashed.
   * The mirror hands over exactly what it wrote, which is what makes the plan
   * a description of the copy rather than of a second walk of the disk a
   * moment later. Absent, the root is listed with the same filter the copy
   * applies. */
  files?: string[];
  /** Files whose bytes differ from the last mirror. An existing artifact whose
   * file is in here gets a patch bump; one whose file is not is unchanged.
   * Absent, every existing artifact's file is treated as changed -- the safe
   * direction when nothing recorded the previous state. */
  changed?: Iterable<string>;
  /** Files the last mirror had and the source no longer does. Existing
   * artifacts pointing at them are retired. */
  removed?: Iterable<string>;
}

/**
 * Every file under `root`, filtered the way a mirror filters: no sync debris,
 * none of the catalog's own bookkeeping. Not a fifth walker -- `diff.ts`'s,
 * which every push already trusts.
 */
function listSourceFiles(root: string): string[] {
  return listFilesRecursive(root).filter(
    (f) =>
      f.length > 0
      && !f.startsWith('artifacts/')
      && !/^\.deliveryos-[^/]*\.json$/.test(f)
      && !f.split('/').some((segment) => isSyncDetritus(segment)),
  );
}

/** The files a rule covers: under its folder (subfolders included), not
 * hidden at any level BELOW the folder, and carrying one of its extensions.
 *
 * The hidden check runs on the part after the folder, not the whole path. A
 * rule may legitimately name a dot-directory -- `.claude/rules` is exactly the
 * shape a Claude Code project keeps its rules in -- and a person who wrote that
 * folder into a profile meant it. What they did not mean is `.obsidian/` or
 * `.trash/` two levels down. */
function matchesForRule(files: string[], folder: string, extensions: string[]): string[] {
  const prefix = `${folder.replace(/\/+$/, '')}/`;
  return files
    .filter((f) => f.startsWith(prefix))
    .filter((f) => !f.slice(prefix.length).split('/').some((segment) => segment.startsWith('.')))
    .filter((f) => extensions.some((ext) => f.toLowerCase().endsWith(ext.toLowerCase())))
    .sort();
}

/**
 * Reads a description out of the file, or reports that it had to be derived.
 *
 * Frontmatter first, because that is what actually worked at scale: all 210
 * artifacts of the real import got specific, useful descriptions, and the
 * manifest text was byte-identical to the source file's own `description:`.
 *
 * The fallback is the first heading, which is weak and marked as such. What it
 * deliberately does NOT do is invent one -- `guessDescriptionFromFrontmatter`'s
 * own comment sets that rule: "this is a guess, not a guarantee", and the
 * caller must ask rather than assert.
 */
function describeFile(absolute: string): { description: string; guessed: boolean } | undefined {
  // Word, Excel and PowerPoint before the text path, because reading a ZIP as
  // UTF-8 produces binary noise that has neither frontmatter nor a heading --
  // which is why every Office file used to be skipped, and why a client's
  // actual template library could not be adopted at all.
  if (isOfficeFile(absolute)) {
    const office = describeOfficeFile(absolute);
    return office ?? undefined;
  }

  let content: string;
  try {
    content = fs.readFileSync(absolute, 'utf-8');
  } catch {
    return undefined;
  }

  const declared = guessDescriptionFromFrontmatter(content);
  if (declared && declared.trim().length > 0) {
    return { description: declared.trim(), guessed: false };
  }

  const heading = content.split(/\r?\n/).find((line) => /^#{1,3}\s+\S/.test(line));
  if (heading) {
    return { description: heading.replace(/^#+\s*/, '').trim(), guessed: true };
  }

  return undefined;
}

function candidateFor(
  root: string,
  sourcePath: string,
  rule: AdoptionRule,
  profile: AdoptionProfile,
  sourceRepo: string,
): { candidate: AdoptionCandidate } | { skip: string } {
  const filename = path.basename(sourcePath);
  const slug = slugify(filename);
  if (!slug) {
    return { skip: `"${filename}" has no usable id -- rename it, or exclude this folder` };
  }

  const id = rule.idPrefix ? `${rule.idPrefix}-${slug}` : slug;

  const described = describeFile(path.join(root, sourcePath));
  if (!described) {
    // Not a guess and not a crash. A file with no frontmatter and no heading
    // has nothing to say about itself, and a manifest needs a description --
    // so this is a question for a person, which is exactly what reporting it
    // as skipped makes it.
    return { skip: `"${sourcePath}" has no frontmatter description and no heading to fall back on` };
  }

  const parsed = ManifestSchema.safeParse({
    id,
    kind: rule.kind,
    description: described.description,
    owner: profile.owner,
    version: '1.0.0',
    tags: { ...rule.tags, componentTypes: [] },
    source_repo: sourceRepo,
    install_target: `${rule.installTarget.replace(/\/+$/, '')}/${filename}`,
    payload_path: sourcePath,
    review_required: false,
  });

  if (!parsed.success) {
    return {
      skip: `"${sourcePath}" would produce an invalid manifest: ${parsed.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
    };
  }

  return {
    candidate: {
      id,
      action: 'create',
      sourcePath,
      manifest: parsed.data,
      descriptionGuessed: described.guessed,
    },
  };
}

/**
 * Builds the plan.
 *
 * `existing` is the target catalog's current manifests for this remote -- pass
 * `buildCatalog()` filtered to the remote. An existing manifest pointing at the
 * same file is updated; one with the same id pointing elsewhere is a collision.
 * Collisions are fatal rather than suffixed, deliberately: `readme-3` is a
 * catalog entry nobody can find or refer to, and the fix is a real one (set an
 * `idPrefix`) that only a person can choose.
 */
export function planAdoption(
  sourceRoot: string,
  profile: AdoptionProfile,
  existing: Iterable<Manifest>,
  sourceRepo: string,
  options: PlanAdoptionOptions = {},
): AdoptionPlan {
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new AdoptionPlanError(`"${sourceRoot}" is not a folder on this machine.`);
  }

  const existingById = new Map<string, Manifest>();
  for (const manifest of existing) existingById.set(manifest.id, manifest);
  const changed = options.changed ? new Set(options.changed) : undefined;
  const removed = new Set(options.removed ?? []);

  const candidates: AdoptionCandidate[] = [];
  const unchanged: AdoptionPlan['unchanged'] = [];
  const skipped: AdoptionPlan['skipped'] = [];
  const seen = new Map<string, string>();
  const collisions: string[] = [];
  const files = options.files ?? listSourceFiles(sourceRoot);

  for (const rule of profile.rules) {
    const matches = matchesForRule(files, rule.folder, rule.extensions);
    if (matches.length === 0) {
      skipped.push({
        sourcePath: rule.folder,
        reason: `no ${rule.extensions.join('/')} files found here -- check the folder name`,
      });
      continue;
    }

    for (const sourcePath of matches) {
      const result = candidateFor(sourceRoot, sourcePath, rule, profile, sourceRepo);
      if ('skip' in result) {
        skipped.push({ sourcePath, reason: result.skip });
        continue;
      }

      const { candidate } = result;

      // Two collision checks, because they fail for different reasons and a
      // person fixes them differently.
      const previous = seen.get(candidate.id);
      if (previous) {
        collisions.push(
          `"${candidate.id}" would be created twice, from "${previous}" and "${candidate.sourcePath}"`,
        );
        continue;
      }
      seen.set(candidate.id, candidate.sourcePath);

      const current = existingById.get(candidate.id);
      if (!current) {
        candidates.push(candidate);
        continue;
      }
      if (current.payload_path !== candidate.sourcePath) {
        collisions.push(
          `"${candidate.id}" already exists in the catalog, pointing at "${current.payload_path ?? 'a payload directory'}" `
            + `rather than "${candidate.sourcePath}"`,
        );
        continue;
      }

      // Same artifact. Nothing recorded which files changed -> treat as changed.
      const bytesChanged = changed === undefined || changed.has(sourcePath);
      if (!bytesChanged) {
        unchanged.push({ id: candidate.id, sourcePath });
        continue;
      }
      candidates.push({
        id: candidate.id,
        action: 'update',
        sourcePath,
        manifest: { ...current, version: bumpVersion(current.version, 'patch') },
        descriptionGuessed: false,
      });
    }
  }

  const retired: RetiredArtifact[] = [];
  for (const manifest of existingById.values()) {
    if (manifest.payload_path !== undefined && removed.has(manifest.payload_path)) {
      retired.push({ id: manifest.id, sourcePath: manifest.payload_path });
    }
  }

  if (collisions.length > 0) {
    throw new AdoptionPlanError(
      `Adoption would create ${collisions.length} conflicting id(s):\n`
        + collisions.map((c) => `  - ${c}`).join('\n')
        + '\n\nSet an idPrefix on the rule that produced them, or exclude the folder. '
        + 'Ids are not auto-numbered on purpose: "readme-3" is an entry nobody can find.',
    );
  }

  if (candidates.length === 0 && unchanged.length === 0 && retired.length === 0) {
    throw new AdoptionPlanError(
      'Nothing to adopt: no file matched a rule and produced a usable artifact.\n'
        + skipped.map((s) => `  - ${s.sourcePath}: ${s.reason}`).join('\n'),
    );
  }

  return { candidates, unchanged, retired: retired.sort((a, b) => a.id.localeCompare(b.id)), skipped };
}
