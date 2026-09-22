import * as fs from 'fs';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { AdoptionPlanError } from '../errors';

/**
 * The reviewable object of an adoption: what a person decided about a client's
 * folders, written down.
 *
 * WHY RULES ARE SCOPED TO A FOLDER AND NOT A GLOB
 *
 * The shape enforces the decision the design rests on. Adopting a client's
 * library means answering, per artifact, "what kind of thing is this and where
 * should it land" -- and those are the two fields this codebase has always
 * refused to guess. At two hundred files that is two hundred judgement calls,
 * which is where quality collapses: the real 210-artifact import needed two
 * whole-catalog corrections afterwards, one fixing 134 files and one fixing
 * twenty wrong tag sets.
 *
 * Asking about a *directory* turns that into about eight decisions somebody can
 * hold in their head. A glob pattern would technically allow that and would
 * also allow per-file rules, and a schema that permits the failure mode is one
 * that will eventually see it. So `folder` it is.
 *
 * It is also what the live catalog already looks like -- `agents/` maps to
 * `.claude/agents/`, `rules/` to `.claude/rules/` -- which is the rule the hand
 * import discovered and never wrote down.
 */

/** Filename characters that cannot appear in an artifact id. Kept narrow: an id
 * becomes a directory name and a URL fragment, and `assertSafePathSegment`
 * rejects separators outright. */
const ID_SAFE = /^[a-z0-9][a-z0-9-]*$/;

export const AdoptionRuleSchema = z
  .object({
    /**
     * Directory, relative to the source root, whose files this rule covers.
     * Includes subdirectories -- a client's `playbooks/2024/` is still
     * playbooks.
     */
    folder: z.string().min(1),

    /** What these are. Free string, matching `manifest.kind`, which is
     * deliberately not an enum anywhere in this codebase. */
    kind: z.string().min(1),

    /**
     * Directory in a consuming project where these should land. Each artifact's
     * own install target is this plus its filename.
     *
     * This is the half of the judgement that no amount of reading the source
     * file can supply: it is a claim about the *consuming* project's layout.
     */
    installTarget: z.string().min(1),

    /**
     * Prepended to each id, so `playbooks/escalation.md` becomes
     * `playbooks-escalation` rather than `escalation`.
     *
     * Optional, and worth setting whenever a name might collide -- `README.md`
     * appears in eight folders of a typical repository, and ids are unique
     * across a whole catalog rather than per folder.
     */
    idPrefix: z.string().regex(ID_SAFE).optional(),

    /** File extensions to adopt. Defaults to markdown, which is what the first
     * slice supports: single-file, text, no build step. */
    extensions: z.array(z.string().min(1)).default(['.md']),

    /** Applied to every artifact from this rule. Optional in the manifest, but
     * the entire value of browsing a catalog, and the thing the real import got
     * wrong twenty times. */
    tags: z
      .object({
        roles: z.array(z.string()).default([]),
        teams: z.array(z.string()).default([]),
        stacks: z.array(z.string()).default([]),
      })
      .default({ roles: [], teams: [], stacks: [] }),
  })
  .strict();

export const AdoptionProfileSchema = z
  .object({
    /** The catalog these artifacts will be proposed to. */
    remote: z.string().min(1),

    /**
     * Recorded on every manifest. Asked once and reused, rather than derived:
     * nothing verifies `owner` against anything, and the real import used a
     * single literal for all 210 artifacts.
     */
    owner: z.string().min(1),

    rules: z.array(AdoptionRuleSchema).min(1),
  })
  .strict();

export type AdoptionRule = z.infer<typeof AdoptionRuleSchema>;
export type AdoptionProfile = z.infer<typeof AdoptionProfileSchema>;

/**
 * Turns a filename into an id fragment.
 *
 * Lowercase, non-alphanumerics collapsed to hyphens, leading and trailing
 * hyphens trimmed. Returns `undefined` when nothing usable survives -- a file
 * called `##.md` has no id, and inventing one would produce a catalog entry
 * nobody can find or refer to.
 */
export function slugify(filename: string): string | undefined {
  const stem = filename.replace(/\.[^.]+$/, '');
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ID_SAFE.test(slug) ? slug : undefined;
}

/**
 * A profile from a YAML file, validated, or an `AdoptionPlanError` that names
 * what is wrong with it.
 *
 * Issues are formatted the way `manifest/parser.ts` formats a manifest's --
 * `rules.0.kind: Required` -- because a person who has seen one of those
 * messages should recognise the other. `strict()` on the schemas means a typo
 * like `install_target` is reported as an unrecognised key rather than
 * silently ignored alongside a missing `installTarget`.
 */
export function readAdoptionProfile(filePath: string): AdoptionProfile {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    throw new AdoptionPlanError(`Cannot read the adoption profile at "${filePath}".`);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new AdoptionPlanError(`The adoption profile at "${filePath}" is not valid YAML: ${detail}`);
  }

  const result = AdoptionProfileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new AdoptionPlanError(`The adoption profile at "${filePath}" failed validation: ${issues}`);
  }
  return result.data;
}
