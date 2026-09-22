import * as fs from 'fs';
import { AdoptionPlanError } from '../errors';
import * as path from 'path';
import { Manifest, ManifestSchema } from '../manifest/schema';
import { guessDescriptionFromFrontmatter } from '../manifest/frontmatter';
import { AdoptionProfile, AdoptionRule, slugify } from './profile';
import { describeOfficeFile, isOfficeFile } from './officeText';

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
 */

/** One artifact adoption would create. */
export interface AdoptionCandidate {
  id: string;
  /** Path of the original file, relative to the source root, forward-slashed.
   * Becomes `payload_path`, which is what makes this adopt-in-place: the file
   * is registered where it already lives rather than copied. */
  sourcePath: string;
  manifest: Manifest;
  /** True when the description had to be derived rather than read from the file
   * itself. Surfaced so a reviewer knows which ones to actually read. */
  descriptionGuessed: boolean;
}

export interface AdoptionPlan {
  candidates: AdoptionCandidate[];
  /** Files a rule matched but which could not become artifacts, with the
   * reason. Reported rather than silently dropped -- a file that vanishes
   * between "47 markdown files" and "45 artifacts" is a question nobody can
   * answer later. */
  skipped: Array<{ sourcePath: string; reason: string }>;
}


/** Every file under `dir` matching one of `extensions`, relative to `root`. */
function filesUnder(root: string, dir: string, extensions: string[]): string[] {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return [];

  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (extensions.some((ext) => entry.name.toLowerCase().endsWith(ext.toLowerCase()))) {
        found.push(path.relative(root, full).split(path.sep).join('/'));
      }
    }
  };
  walk(abs);
  return found.sort();
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
    return office ? { description: office.description, guessed: !office.declared } : undefined;
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
      sourcePath,
      manifest: parsed.data,
      descriptionGuessed: described.guessed,
    },
  };
}

/**
 * Builds the plan.
 *
 * `existingIds` is the ids already in the target catalog -- pass
 * `buildCatalog()` filtered to the remote. Collisions are fatal rather than
 * suffixed, deliberately: `readme-3` is a catalog entry nobody can find or
 * refer to, and the fix is a real one (set an `idPrefix`) that only a person
 * can choose.
 */
export function planAdoption(
  sourceRoot: string,
  profile: AdoptionProfile,
  existingIds: Iterable<string>,
  sourceRepo: string,
): AdoptionPlan {
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new AdoptionPlanError(`"${sourceRoot}" is not a folder on this machine.`);
  }

  const candidates: AdoptionCandidate[] = [];
  const skipped: AdoptionPlan['skipped'] = [];
  const seen = new Map<string, string>();
  const taken = new Set(existingIds);
  const collisions: string[] = [];

  for (const rule of profile.rules) {
    const matches = filesUnder(sourceRoot, rule.folder, rule.extensions);
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
      if (taken.has(candidate.id)) {
        collisions.push(`"${candidate.id}" already exists in the catalog (from "${candidate.sourcePath}")`);
        continue;
      }

      seen.set(candidate.id, candidate.sourcePath);
      candidates.push(candidate);
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

  if (candidates.length === 0) {
    throw new AdoptionPlanError(
      'Nothing to adopt: no file matched a rule and produced a usable artifact.\n'
        + skipped.map((s) => `  - ${s.sourcePath}: ${s.reason}`).join('\n'),
    );
  }

  return { candidates, skipped };
}
