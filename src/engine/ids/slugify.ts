/**
 * The one rule for turning a name into an id fragment.
 *
 * Ids are cross-catalog identity: an artifact scanned out of a project and the
 * same file adopted later from a client's folder must agree on their id, or a
 * catalog ends up with two entries for one thing that collide with neither.
 * Until this file, the rule lived in three private copies -- `profile.ts`,
 * `detectUiComponents.ts`, `detectStarterKitCandidates.ts` -- that happened to
 * be identical. A change to any one of them would have silently split ids.
 *
 * Lowercase; every run of non-alphanumerics becomes one hyphen; leading and
 * trailing hyphens are trimmed. May return an empty string -- a name made
 * entirely of characters this strips has no slug, and callers decide what that
 * means for them (`profile.ts` refuses; the scanners never see such names).
 *
 * Not the same rule as `slugifyForRef` in `push/branchName.ts`, which keeps `.`
 * and `_` because git refs allow them. Ids are stricter than refs on purpose:
 * an id becomes a directory name and a URL fragment.
 */
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
