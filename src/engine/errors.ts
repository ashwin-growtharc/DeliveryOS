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
