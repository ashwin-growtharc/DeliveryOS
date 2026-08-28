import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { ManifestSchema, Manifest } from './schema';

/** One manifest that could not be loaded, and why. */
export interface SkippedManifest {
  /** Absolute path of the manifest file. */
  path: string;
  /** Human-readable reason, already formatted for display. */
  reason: string;
}

/** Every manifest that loaded, plus every one that did not. */
export interface DiscoveredManifests {
  manifests: Manifest[];
  skipped: SkippedManifest[];
}

/**
 * Discovers and validates every artifact manifest under
 * `<remoteDir>/artifacts/<id>/manifest.yaml`.
 *
 * A manifest that fails to load is SKIPPED and reported, never fatal. Reasons
 * it can be skipped: YAML parse failure, schema validation failure,
 * `manifest.id` not matching its folder name, or a duplicate id.
 *
 * This used to throw on the first bad manifest, which meant **one broken
 * artifact took the entire catalog down for every user** -- a real outage was
 * caused by exactly that: a single manifest failing a newly-tightened
 * `install_target` rule blanked all 227 artifacts, and `deliveryos list`
 * returned nothing but the validation error.
 *
 * That is the wrong trade for a shared, multi-contributor catalog. One person
 * pushing a bad manifest must not stop everyone else browsing. The caller
 * decides how loudly to surface `skipped`; the artifacts that DID load are
 * always returned.
 */
export function discoverManifests(remoteDir: string): DiscoveredManifests {
  const artifactsDir = path.join(remoteDir, 'artifacts');
  if (!fs.existsSync(artifactsDir)) {
    return { manifests: [], skipped: [] };
  }

  const folders = fs
    .readdirSync(artifactsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const manifests: Manifest[] = [];
  const skipped: SkippedManifest[] = [];
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
      skipped.push({ path: manifestPath, reason: `not valid YAML: ${detail}` });
      continue;
    }

    const result = ManifestSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
      skipped.push({ path: manifestPath, reason: `failed validation: ${issues}` });
      continue;
    }

    const manifest = result.data;

    // Duplicate-id is checked ahead of the id/folder match check: it's the
    // more specific, more actionable error (it names the other file that
    // already claimed this id), and a duplicate is necessarily also an
    // id/folder mismatch for at least one of the two folders involved.
    const existing = seenIds.get(manifest.id);
    if (existing) {
      skipped.push({
        path: manifestPath,
        reason: `duplicate id "${manifest.id}" -- already defined in "${existing}"`,
      });
      continue;
    }

    if (manifest.id !== folder) {
      skipped.push({
        path: manifestPath,
        reason: `id "${manifest.id}" does not match its folder name "${folder}"`,
      });
      continue;
    }

    seenIds.set(manifest.id, manifestPath);

    manifests.push(manifest);
  }

  return { manifests, skipped };
}
