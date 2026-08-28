/**
 * Bump kinds a manifest's `version` field can be advanced by -- matches
 * standard semver bump semantics (major resets minor+patch to 0, minor
 * resets patch to 0, patch only increments patch), scoped down to exactly
 * the `x.y.z` shape `ManifestSchema.version` enforces (no prerelease/build
 * metadata to reason about).
 */
export type VersionBumpKind = 'patch' | 'minor' | 'major';

const VALID_BUMP_KINDS: readonly VersionBumpKind[] = ['patch', 'minor', 'major'];

/** Validates a raw `--bump`/RPC-arg string against the real
 * `VersionBumpKind` union -- shared by the CLI's `push` command and the
 * sidecar's `artifact.push` handler so both fail the same way on a typo
 * (e.g. `--bump pathc`) instead of the sidecar silently letting a bad
 * value fall all the way through to `bumpVersion`'s own runtime guard,
 * surfacing many calls later as an unrelated `"version: Required"` schema
 * error once the resulting `undefined` version fails manifest validation. */
export function parseBumpKind(value?: string): VersionBumpKind | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!VALID_BUMP_KINDS.includes(value as VersionBumpKind)) {
    throw new Error(`bump must be one of ${VALID_BUMP_KINDS.join(', ')} (got "${value}")`);
  }
  return value as VersionBumpKind;
}

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
    default:
      // TypeScript's own exhaustiveness check considers this unreachable
      // for a genuinely-VersionBumpKind-typed `kind` -- but the sidecar's
      // `artifact.push` handler casts `args.options` without validating it
      // first (unlike the CLI's own `parseBumpKind`), so a bad value from
      // there reaches this function as a plain string at runtime. Failing
      // loud here with a clear message beats silently returning `undefined`,
      // which used to surface many calls later as an unrelated
      // "version: Required" schema error.
      throw new Error(`bumpVersion: "${kind}" is not a valid bump kind (expected patch, minor, or major)`);
  }
}
