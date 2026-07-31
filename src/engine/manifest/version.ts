/**
 * Bump kinds a manifest's `version` field can be advanced by -- matches
 * standard semver bump semantics (major resets minor+patch to 0, minor
 * resets patch to 0, patch only increments patch), scoped down to exactly
 * the `x.y.z` shape `ManifestSchema.version` enforces (no prerelease/build
 * metadata to reason about).
 */
export type VersionBumpKind = 'patch' | 'minor' | 'major';

/**
 * Advances a manifest `version` string (already known to match
 * `ManifestSchema`'s strict `/^\d+\.\d+\.\d+$/` regex -- see that schema's
 * own doc comment) by one `kind` step. Exists specifically to close the
 * Phase E gap described in PLAN.md: edit-mode push had no way to bump a
 * UI component's version at all, so `checkForUpdates` could never detect
 * a real edit and the preview cache (keyed on `id + version`) never
 * invalidated either -- see `pushArtifact`'s payload edit-mode branch,
 * the one real caller of this function.
 *
 * Deliberately NOT a general-purpose semver library: this only needs to
 * handle the exact shape this codebase's own schema already guarantees,
 * so a real semver dependency (handling prerelease tags, build metadata,
 * range comparisons, none of which this manifest format has) would be
 * more capability than this ever needs.
 */
export function bumpVersion(current: string, kind: VersionBumpKind): string {
  const match = current.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`bumpVersion: "${current}" is not a valid x.y.z version string`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  switch (kind) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
}
