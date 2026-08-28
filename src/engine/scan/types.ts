/**
 * `ScanCandidate` lives in its own file, split out of `scan.ts`, purely to
 * dodge a circular import: `scan.ts` will eventually import
 * `detectUiComponentCandidates` from `detectUiComponents.ts` to wire it
 * into `scanForNewArtifacts` (a separate, not-yet-done step), and
 * `detectUiComponents.ts` needs this same candidate shape to build its
 * results -- defining the interface in either of those two files would
 * make the other one import back from it. A third, dependency-free file
 * breaks that cycle before it exists.
 *
 * One agent/skill/command/rule/ui-component/template found on disk that isn't yet
 * tracked in this project's lockfile and doesn't already exist (by id) in
 * the target remote's catalog -- a candidate to propose as a new artifact
 * via `push --new`. `description` is a best-effort guess from the file's
 * own frontmatter (see `guessDescriptionFromFrontmatter`) for the
 * markdown-backed kinds, and always left `undefined` for `ui-component`
 * (there's no reliable way to guess a description from a component's code
 * -- left for the reviewer, same discipline as an agent/skill/command/rule
 * file with no frontmatter at all). Always a real, evidence-based summary
 * for `template` (e.g. the framework detected and which real routing
 * evidence was found -- see `detectStarterKitCandidates.ts`), never a
 * generic placeholder. Commands/rules commonly live in
 * category subfolders (`.claude/commands/java/foo.md`) -- `installTarget`
 * preserves whatever relative path was actually found, category subfolder
 * included, so a proposed command/rule pulls back to the exact same
 * place. Rule files in particular use a `paths: [glob, ...]` frontmatter
 * convention, never `description:` -- expect `description` to come back
 * undefined for those and need manual entry, same as any file with no
 * frontmatter at all.
 */
export interface ScanCandidate {
  id: string;
  kind: 'agent' | 'skill' | 'command' | 'rule' | 'ui-component' | 'template';
  payloadPath: string; // absolute path to the real file/folder on disk
  installTarget: string; // relative to cwd, e.g. '.claude/agents/foo.md'
  description?: string;
  /** Populated for `kind: 'ui-component'` candidates with two Scan-time-only,
   * non-fatal findings: (1) a relative import in the component file that
   * would resolve outside the payload directory Scan is about to construct
   * for it (see `detectUiComponents.ts`'s import-escape check) --
   * informational, not thrown, distinct from (and in addition to)
   * `compile.ts`'s `createDirectorySandboxPlugin`, which enforces the same
   * boundary for real at compile time but fails hard and opaquely; this is
   * meant to catch the same problem earlier and more legibly, not replace
   * that runtime guard. (2) a same-batch candidate-id collision that this
   * scan run resolved by disambiguating with a numeric suffix (see
   * `detectUiComponents.ts`'s dedupe logic) -- worth a human glance, not
   * worth failing the whole scan over. Also populated for `kind: 'template'`
   * candidates (e.g. no `README.md` found yet) -- see
   * `detectStarterKitCandidates.ts`. */
  warnings?: string[];
}
