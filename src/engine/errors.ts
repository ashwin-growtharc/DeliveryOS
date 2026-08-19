/**
 * Base class for all DeliveryOS hard errors. Callers at the CLI boundary
 * catch this type, print `error.message`, and exit 1.
 */
export class DeliveryOsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when a manifest fails YAML parsing, schema validation, or the
 * id/folder-name and duplicate-id invariants enforced by the parser. */
export class ManifestValidationError extends DeliveryOsError {}

/** Thrown for remote registry problems: duplicate name on `remote add`,
 * unknown remote name referenced elsewhere, etc. */
export class RemoteRegistryError extends DeliveryOsError {}

/** Thrown when a git operation (clone, etc.) fails. */
export class GitOperationError extends DeliveryOsError {}

/** Thrown when `pull` cannot resolve exactly one manifest for the given id
 * (not found, or ambiguous across multiple remotes without --remote). */
export class ArtifactResolutionError extends DeliveryOsError {}

/** Thrown when a pulled artifact's post_install command exits non-zero. */
export class PostInstallError extends DeliveryOsError {}

/** Thrown when `gh auth token` (ambient GitHub CLI auth) can't be used to
 * obtain a token -- the command isn't available, isn't logged in, or
 * returned nothing. Message always points the user at `gh auth login`. */
export class GithubAuthError extends DeliveryOsError {}

/** Thrown when a GitHub REST API call (via Octokit) fails -- wraps
 * whatever Octokit threw with context about which call/repo it was. */
export class GithubApiError extends DeliveryOsError {}

/** Thrown when `push` is run in edit mode against a pulled artifact whose
 * local copy is byte-for-byte identical to its pristine snapshot -- there's
 * nothing to open a PR for. */
export class NoLocalChangesError extends DeliveryOsError {}

/** Thrown when `push --new` targets an id that already exists in the
 * target remote's (freshly-refreshed) catalog. */
export class IdCollisionError extends DeliveryOsError {}

/** Thrown when the combination of `--new` and the cwd's lockfile state
 * doesn't make sense: `--new` on an id that's already tracked, or no
 * `--new` on an id that isn't tracked yet (and isn't fully specified for
 * propose-new). Also covers a `--remote` that conflicts with the id's
 * lockfile-recorded remote in edit mode. */
export class PushModeConflictError extends DeliveryOsError {}

/** Thrown when a remote's git URL isn't a recognizable github.com URL.
 * Phase 1's GitHub API integration (branch/PR) is GitHub-only by design. */
export class UnsupportedRemoteError extends DeliveryOsError {}

/** Thrown when diffing a pulled artifact against its pristine snapshot, but
 * no snapshot exists on disk (e.g. it was pulled before pristine snapshots
 * were introduced). Tells the caller to re-pull rather than silently
 * treating everything as changed. */
export class PristineSnapshotMissingError extends DeliveryOsError {}

/** Thrown when a pulled artifact declares a `signature` but verification
 * fails -- payload doesn't match the recorded `content_digest`, no
 * signature bundle was found alongside the manifest, or the Sigstore
 * signature over that digest doesn't check out against the recorded
 * `certificate_identity`/`oidc_issuer`. Refuses the pull entirely, before
 * any files are written. Never thrown for the overwhelming majority of
 * artifacts, which declare no `signature` at all. */
export class SignatureVerificationError extends DeliveryOsError {}

/** Thrown when `suggestMetadata`'s real `claude` CLI subprocess call fails
 * outright (not on PATH, not logged in, times out) or returns something
 * that can't be parsed as the requested JSON shape. Never thrown for a
 * merely-empty suggestion (a model returning `{}` is a valid, if useless,
 * response) -- only for a genuine failure to get a real answer at all. */
export class SuggestionError extends DeliveryOsError {}

/** Thrown when Phase 10 item 2's build-fix flow fails outright: the real
 * `claude` CLI subprocess call fails (not on PATH, not logged in, times
 * out), returns something that can't be parsed as the requested JSON
 * shape, or a caller hands `applyBuildFix` a `filePath` that resolves
 * outside the target project (the same containment check
 * `applyDeterministicWiring` already relies on). Never thrown for an
 * honest "I can't determine a fix" response (`fixed_file: null` is a
 * valid, expected outcome) or for a fix that gets applied but doesn't
 * actually resolve the build -- that case is a real, reported rollback,
 * not an error. */
export class BuildFixError extends DeliveryOsError {}

/** Thrown when Phase 11 item 4's design-fix flow fails outright: the real
 * `claude` CLI subprocess call fails, returns something that can't be
 * parsed as the requested JSON shape, or a caller hands `applyAntiPatternFix`
 * a `file` that resolves outside the candidate's own payload directory --
 * same containment check `applyBuildFix` already relies on, just rooted at
 * the payload instead of a real project's `cwd`. Never thrown for an honest
 * "I can't determine a fix" response, or for a fix that gets applied but
 * doesn't actually keep the payload compiling -- that's a real, reported
 * rollback, not an error. */
export class DesignFixError extends DeliveryOsError {}

/** Thrown when `checkSourceDrift` is asked to check an artifact whose
 * payload has no `SOURCES.json` at its root -- there's nothing recorded
 * to check drift against, so this fails hard and loud rather than
 * silently reporting an empty result (same posture as
 * `PristineSnapshotMissingError`). */
export class SourcesFileMissingError extends DeliveryOsError {}

/** Thrown when a backend-plugin's Tier-2 "AI wiring merge" flow fails
 * outright: the real `claude` CLI subprocess call fails, returns
 * something that can't be parsed as the requested JSON shape, or a
 * caller hands `applyWiringMerge` a `targetFile` that resolves outside
 * the installing project's own `cwd` -- same containment check
 * `applyBuildFix` already relies on. Never thrown for an honest "I
 * can't determine a merge" response, or for a merge that gets applied
 * but doesn't actually keep the project building -- that's a real,
 * reported rollback, not an error. */
export class WiringMergeError extends DeliveryOsError {}
