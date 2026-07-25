import * as fs from 'fs';
import * as path from 'path';
import { remotesRegistryPath, deliveryOsHome } from '../paths';
import { RemoteRegistryError } from '../errors';

export interface RemoteEntry {
  name: string;
  url: string;
  addedAt: string;
}

export interface RemoteRegistry {
  remotes: RemoteEntry[];
}

function ensureHomeDir(): void {
  const home = deliveryOsHome();
  if (!fs.existsSync(home)) {
    fs.mkdirSync(home, { recursive: true });
  }
}

export function readRegistry(): RemoteRegistry {
  const registryPath = remotesRegistryPath();
  if (!fs.existsSync(registryPath)) {
    return { remotes: [] };
  }
  const raw = fs.readFileSync(registryPath, 'utf-8');
  try {
    const parsed = JSON.parse(raw) as RemoteRegistry;
    if (!parsed.remotes || !Array.isArray(parsed.remotes)) {
      return { remotes: [] };
    }
    return parsed;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new RemoteRegistryError(
      `Failed to parse remote registry "${registryPath}": ${detail}`,
    );
  }
}

function writeRegistry(registry: RemoteRegistry): void {
  ensureHomeDir();
  const registryPath = remotesRegistryPath();
  const tmpPath = path.join(
    path.dirname(registryPath),
    `.remotes.json.${process.pid}.${Date.now()}.tmp`,
  );
  fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmpPath, registryPath);
}

export function findRemote(name: string): RemoteEntry | undefined {
  return readRegistry().remotes.find((r) => r.name === name);
}

/** Derives a remote name from the last path segment of a git URL or path,
 * stripping a trailing `.git` suffix if present. Single shared
 * implementation used by both the CLI's `remote add` command
 * (`src/cli/commands/remoteAdd.ts`) and the Tauri sidecar's `remote.add`
 * command (`src/sidecar.ts`) -- never duplicated. */
export function deriveNameFromUrl(url: string): string {
  const normalized = url.replace(/[/\\]+$/, ''); // trim trailing slashes
  const segments = normalized.split(/[/\\]/).filter((s) => s.length > 0);
  const last = segments[segments.length - 1] ?? normalized;
  return last.endsWith('.git') ? last.slice(0, -4) : last;
}

/**
 * Adds a new remote entry to the registry. Throws RemoteRegistryError
 * (without mutating the existing registry) if `name` is already
 * registered.
 */
export function addRemoteEntry(entry: RemoteEntry): void {
  const registry = readRegistry();
  if (registry.remotes.some((r) => r.name === entry.name)) {
    throw new RemoteRegistryError(
      `A remote named "${entry.name}" is already registered`,
    );
  }
  registry.remotes.push(entry);
  writeRegistry(registry);
}

export function listRemotes(): RemoteEntry[] {
  return readRegistry().remotes;
}
