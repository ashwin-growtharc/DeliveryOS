import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { planAdoption } from '../../src/engine/adopt/planAdoption';
import { AdoptionPlanError } from '../../src/engine/errors';
import { AdoptionProfileSchema, slugify } from '../../src/engine/adopt/profile';

/**
 * Turning a client's folder of documents into something a catalog can read.
 *
 * WHAT THESE ARE MOSTLY TESTING
 *
 * The refusals, not the happy path. Adoption's failure mode is not "it did not
 * work" -- it is "it worked, plausibly, and wrongly, two hundred times". The
 * real 210-artifact import needed two whole-catalog corrections afterwards, one
 * fixing 134 files and one fixing twenty artifacts whose tags were wrong, and
 * every one of those was a thing that looked fine at the time.
 *
 * So the interesting assertions are: it refuses colliding ids rather than
 * numbering them, it refuses a file that cannot describe itself rather than
 * inventing a description, and it validates every candidate before producing
 * any -- because `discoverManifests` treats one invalid manifest as fatal for
 * the whole catalog.
 */

let root: string;

function profile(overrides: Record<string, unknown> = {}) {
  return AdoptionProfileSchema.parse({
    remote: 'acme-catalog',
    owner: 'consultant',
    rules: [
      {
        folder: 'playbooks',
        kind: 'rule',
        installTarget: '.claude/rules/playbooks',
        ...overrides,
      },
    ],
  });
}

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-adopt-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('planning an adoption', () => {
  it('registers files where they already are, rather than copying them', () => {
    write('playbooks/escalation.md', '---\ndescription: How to escalate.\n---\n# Escalation\n');

    const plan = planAdoption(root, profile(), [], 'acme-shared');

    expect(plan.candidates).toHaveLength(1);
    const [c] = plan.candidates;
    // `payload_path` pointing at the original is the whole adopt-in-place idea:
    // nothing moves, nothing is duplicated, and editing the real file still
    // works. 131 of the live catalog's 230 artifacts are exactly this shape.
    expect(c.manifest.payload_path).toBe('playbooks/escalation.md');
    expect(c.manifest.install_target).toBe('.claude/rules/playbooks/escalation.md');
    expect(c.id).toBe('escalation');
  });

  it('lifts a description the file already declares, and says it did not guess', () => {
    // This is the mechanism that actually worked at scale: all 210 artifacts of
    // the real import got specific descriptions because their sources carried
    // their own, byte-identical.
    write('playbooks/handover.md', '---\ndescription: What to hand over, and to whom.\n---\n# Handover\n');

    const [c] = planAdoption(root, profile(), [], 'acme-shared').candidates;
    expect(c.manifest.description).toBe('What to hand over, and to whom.');
    expect(c.descriptionGuessed).toBe(false);
  });

  it('falls back to a heading, and flags that it did', () => {
    write('playbooks/kickoff.md', '# Running a kickoff\n\nSome prose.\n');

    const [c] = planAdoption(root, profile(), [], 'acme-shared').candidates;
    expect(c.manifest.description).toBe('Running a kickoff');
    // Flagged so a reviewer knows which ones to actually read, rather than
    // trusting all of them equally.
    expect(c.descriptionGuessed).toBe(true);
  });

  it('refuses to invent a description for a file that says nothing about itself', () => {
    // A describable file alongside it, deliberately: otherwise the plan is
    // empty and the "nothing to adopt" refusal fires first, which would make
    // this test pass for the wrong reason. Here the skip is the only thing
    // being asserted.
    write('playbooks/escalation.md', '# Escalation\n');
    write('playbooks/notes.md', 'just some text with no heading and no frontmatter\n');

    const plan = planAdoption(root, profile(), [], 'acme-shared');

    // Not a crash and not a guess. A description is required, nothing can
    // supply it, and that makes it a question for a person -- which is what
    // being reported as skipped turns it into.
    expect(plan.candidates.map((c) => c.id)).toEqual(['escalation']);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].sourcePath).toBe('playbooks/notes.md');
    expect(plan.skipped[0].reason).toMatch(/no frontmatter description and no heading/);
  });

  it('includes subfolders, because a client\'s folders have folders', () => {
    write('playbooks/2024/retro.md', '# Retro\n');
    write('playbooks/deep/er/still.md', '# Still\n');

    const ids = planAdoption(root, profile(), [], 'acme-shared').candidates.map((c) => c.id);
    expect(ids.sort()).toEqual(['retro', 'still']);
  });

  it('applies the rule\'s tags, which nothing can infer', () => {
    write('playbooks/x.md', '# X\n');

    const [c] = planAdoption(
      root,
      profile({ tags: { roles: ['delivery'], teams: ['acme'], stacks: [] } }),
      [],
      'acme-shared',
    ).candidates;

    // Optional in the schema, and the entire value of browsing a catalog. The
    // real import got twenty of these wrong, which is why they come from a
    // reviewed rule rather than a guess.
    expect(c.manifest.tags.roles).toEqual(['delivery']);
    expect(c.manifest.tags.teams).toEqual(['acme']);
  });
});

describe('refusing rather than half-working', () => {
  it('refuses two files that would produce the same id, naming both', () => {
    // The one that actually bites. `README.md` appears in eight folders of a
    // typical repository, and ids are unique across a whole catalog.
    write('playbooks/a/README.md', '# A\n');
    write('playbooks/b/README.md', '# B\n');

    expect(() => planAdoption(root, profile(), [], 'acme-shared')).toThrow(AdoptionPlanError);
    try {
      planAdoption(root, profile(), [], 'acme-shared');
    } catch (err) {
      const message = (err as Error).message;
      // Both sources named, so the person can see what collided...
      expect(message).toContain('playbooks/a/README.md');
      expect(message).toContain('playbooks/b/README.md');
      // ...and told the fix, which only they can choose.
      expect(message).toContain('idPrefix');
    }
  });

  it('does NOT auto-number a collision away', () => {
    write('playbooks/a/README.md', '# A\n');
    write('playbooks/b/README.md', '# B\n');

    // The counterweight to the test above, stated separately because it is a
    // design decision rather than an implementation detail: "readme-2" is a
    // catalog entry nobody can find, refer to or search for. Silently
    // succeeding here would be the worst outcome available.
    expect(() => planAdoption(root, profile(), [], 'acme-shared')).toThrow(/conflicting id/i);
  });

  it('refuses an id the catalog already has, and says where it came from', () => {
    write('playbooks/escalation.md', '# Escalation\n');

    expect(() => planAdoption(root, profile(), ['escalation'], 'acme-shared')).toThrow(
      /already exists in the catalog/,
    );
  });

  it('separates its two collision kinds, because the fixes differ', () => {
    // In-batch versus already-in-catalog read the same to a machine and not to
    // a person: one means "your rule is too broad", the other means "somebody
    // already adopted this".
    write('playbooks/x.md', '# X\n');
    try {
      planAdoption(root, profile(), ['x'], 'acme-shared');
    } catch (err) {
      expect((err as Error).message).toContain('already exists in the catalog');
      expect((err as Error).message).not.toContain('would be created twice');
    }
  });

  it('refuses an empty result rather than reporting a successful no-op', () => {
    write('playbooks/notes.md', 'no heading, no frontmatter\n');

    // "Adopted 0 artifacts" reads as success and is the coercion shape this
    // codebase keeps finding. The refusal lists why each file was skipped.
    expect(() => planAdoption(root, profile(), [], 'acme-shared')).toThrow(/Nothing to adopt/);
  });

  it('reports a folder that matched nothing, instead of silently ignoring it', () => {
    write('playbooks/real.md', '# Real\n');

    const plan = planAdoption(
      root,
      AdoptionProfileSchema.parse({
        remote: 'r',
        owner: 'o',
        rules: [
          { folder: 'playbooks', kind: 'rule', installTarget: '.claude/rules' },
          { folder: 'typo-here', kind: 'doc', installTarget: 'docs' },
        ],
      }),
      [],
      'acme-shared',
    );

    // A mistyped folder name that produced nothing is the single most likely
    // profile error, and the easiest to miss in a summary that only counts
    // successes.
    expect(plan.candidates).toHaveLength(1);
    expect(plan.skipped.some((s) => s.sourcePath === 'typo-here')).toBe(true);
  });

  it('refuses a source root that is not there', () => {
    expect(() => planAdoption(path.join(root, 'nope'), profile(), [], 'r')).toThrow(
      /not a folder on this machine/,
    );
  });
});

describe('slugify', () => {
  it('makes an id out of a filename, or admits it cannot', () => {
    expect(slugify('Escalation Process.md')).toBe('escalation-process');
    expect(slugify('2024_Q1-review.md')).toBe('2024-q1-review');
    expect(slugify('README.md')).toBe('readme');

    // Returns undefined rather than something meaningless. An id becomes a
    // directory name and the thing people type -- there is no useful id for a
    // file called "##".
    expect(slugify('##.md')).toBeUndefined();
    expect(slugify('---.md')).toBeUndefined();
  });
});
