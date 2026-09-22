import * as fs from 'fs';
import { RemoteBackend, RemoteBackendKind } from './types';
import { gitBackend } from './gitBackend';
import { folderBackend } from './folderBackend';

export { RemoteBackend, RemoteBackendCapabilities, RemoteBackendKind } from './types';
export { gitBackend } from './gitBackend';
export { folderBackend, isSyncDetritus, copyTree } from './folderBackend';

const BACKENDS: Record<RemoteBackendKind, RemoteBackend> = {
  git: gitBackend,
  folder: folderBackend,
};

/**
 * The backend for a registry entry.
 *
 * `kind` is optional on `RemoteEntry`, and absent means `git`. That is what
 * makes this change need no migration: every registry already written to disk
 * has no `backend` field, and every one of those remotes IS a git remote,
 * because git is all DeliveryOS could do until now.
 */
export function backendFor(kind: RemoteBackendKind | undefined): RemoteBackend {
  return BACKENDS[kind ?? 'git'];
}

/**
 * Which backend a source string needs, decided once when a remote is added.
 *
 * Deliberately a filesystem question rather than a syntactic one. "Is this a
 * directory that exists on this machine?" is checkable and unambiguous;
 * pattern-matching a string is not, and would have to keep up with every shape
 * `git clone` accepts -- SSH, `git://`, `file://`, bare hostnames, Windows drive
 * paths and plain relative paths, which the entire e2e suite depends on.
 *
 * A directory that is itself a git repository is still treated as `git`: that is
 * how every e2e fixture works, and cloning it preserves history that copying
 * would throw away.
 */
export function detectBackendKind(source: string): RemoteBackendKind {
  try {
    if (!fs.statSync(source).isDirectory()) return 'git';
  } catch {
    // Not a path on this machine at all -- a URL, then.
    return 'git';
  }
  return fs.existsSync(`${source}/.git`) ? 'git' : 'folder';
}
