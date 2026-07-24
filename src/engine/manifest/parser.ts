import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { ManifestSchema, Manifest } from './schema';
import { ManifestValidationError } from '../errors';

/**
 * Discovers and validates every artifact manifest under
 * `<remoteDir>/artifacts/<id>/manifest.yaml`.
 *
 * Hard-errors (throws ManifestValidationError naming the offending file
 * path) rather than silently skipping malformed manifests, on:
 *  - YAML parse failure
 *  - zod schema validation failure
 *  - manifest.id !== folder name
 *  - duplicate id across two artifact folders in the same remote
 */
export function discoverManifests(remoteDir: string): Manifest[] {
  const artifactsDir = path.join(remoteDir, 'artifacts');
  if (!fs.existsSync(artifactsDir)) {
    return [];
  }

  const folders = fs
    .readdirSync(artifactsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const manifests: Manifest[] = [];
  const seenIds = new Map<string, string>(); // id -> manifest file path

  for (const folder of folders) {
    const manifestPath = path.join(artifactsDir, folder, 'manifest.yaml');
    if (!fs.existsSync(manifestPath)) {
      continue;
    }

    const raw = fs.readFileSync(manifestPath, 'utf-8');

    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new ManifestValidationError(
        `Failed to parse YAML in manifest "${manifestPath}": ${detail}`,
      );
    }

    const result = ManifestSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
      throw new ManifestValidationError(
        `Manifest "${manifestPath}" failed validation: ${issues}`,
      );
    }

    const manifest = result.data;

    // Duplicate-id is checked ahead of the id/folder match check: it's the
    // more specific, more actionable error (it names the other file that
    // already claimed this id), and a duplicate is necessarily also an
    // id/folder mismatch for at least one of the two folders involved.
    const existing = seenIds.get(manifest.id);
    if (existing) {
      throw new ManifestValidationError(
        `Duplicate manifest id "${manifest.id}" found in "${manifestPath}" (already defined in "${existing}")`,
      );
    }

    if (manifest.id !== folder) {
      throw new ManifestValidationError(
        `Manifest "${manifestPath}" has id "${manifest.id}" which does not match its folder name "${folder}"`,
      );
    }

    seenIds.set(manifest.id, manifestPath);

    manifests.push(manifest);
  }

  return manifests;
}
