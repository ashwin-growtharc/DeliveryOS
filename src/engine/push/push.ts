import * as fs from 'fs';
import * as path from 'path';
import { stringify as stringifyYaml } from 'yaml';
import { readLockfile, upsertEntry } from '../lockfile/lockfile';
import { findRemote } from '../remote/remoteRegistry';
import { cachePath } from '../remote/remoteCache';
import { resolveArtifact, ProgressCallback } from '../pull/pull';
import { buildCatalog } from '../catalog/catalog';
import { ManifestSchema, Manifest } from '../manifest/schema';
import { pristinePath } from '../paths';
import { computeChangedFiles, listPayloadFiles } from './diff';
import { buildBranchName } from './branchName';
import {
  buildEditPrContent,
  buildProposeNewPrContent,
  buildMetadataEditPrContent,
  MetadataFields,
} from './prContent';
import {
  fetchAndReset,
  createBranch,
  commitPaths,
  pushBranch,
  getCommitIdentity,
} from '../git/git';
import {
  parseGithubUrl,
  getDefaultBranch,
  openPullRequest,
  createOctokit,
  GithubClient,
} from '../github/github';
import { getGithubToken } from '../github/githubAuth';
import {
  PushModeConflictError,
  NoLocalChangesError,
  IdCollisionError,
  RemoteRegistryError,
  ManifestValidationError,
} from '../errors';

export interface MetadataEditOptions {
  description?: string;
  roles?: string[];
  teams?: string[];
  stacks?: string[];
}

export interface PushOptions {
  remote?: string;
  isNew?: boolean;
  // propose-new only:
  payloadPath?: string;
  kind?: string;
  owner?: string;
  description?: string;
  installTarget?: string;
  version?: string;
  reviewRequired?: boolean;
  roles?: string[];
  teams?: string[];
  stacks?: string[];
  postInstall?: string;
  // edit mode only, mutually exclusive with a payload-content diff push:
  // changes description/roles/teams/stacks on an already-tracked artifact's
  // manifest.yaml without touching its payload at all. See Detail's Edit
  // button in the app.
  metadataEdit?: MetadataEditOptions;
}

export interface PushResult {
  url: string;
  number: number;
  branch: string;
}

/** Copies a single file from `srcRoot/relPath` into `destRoot/relPath`,
 * creating any missing destination directories along the way. */
function copyFileInto(srcRoot: string, destRoot: string, relPath: string): void {
  const src = path.join(srcRoot, relPath);
  const dest = path.join(destRoot, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/**
 * Orchestrates `deliveryos push`: edit mode (diff a tracked artifact and
 * open a PR with the changes) or propose-new mode (scaffold a brand-new
 * artifact and open a PR proposing it). See ARCHITECTURE.md / PLAN.md
 * Phase 1 for the design this implements.
 *
 * `octokit`, if supplied, is used as-is instead of building a real client
 * via `getGithubToken()` + `createOctokit()` -- this is the seam tests use
 * to inject a fake client and guarantee zero real network/auth calls.
 */
export async function pushArtifact(
  id: string,
  options: PushOptions,
  cwd: string,
  octokit?: GithubClient,
  onProgress?: ProgressCallback,
): Promise<PushResult> {
  const lockfile = readLockfile(cwd);
  const lockEntry = lockfile.entries.find((e) => e.id === id);

  if (options.isNew) {
    if (lockEntry) {
      throw new PushModeConflictError(
        `"${id}" is already tracked (found in this project's lockfile) -- drop --new to push it as an edit instead.`,
      );
    }
  } else if (!lockEntry) {
    throw new PushModeConflictError(
      `"${id}" is not tracked (no lockfile entry in this project) -- pass --new along with --remote/--path/--kind/--owner/--description to propose it as a new artifact.`,
    );
  }

  let remoteName: string;
  if (options.isNew) {
    // Nothing at the CLI layer enforces --remote's presence for --new (no
    // Commander `.conflicts`/`.implies` wiring) -- this is the sole place
    // that requirement is actually enforced, for both CLI and direct
    // (non-CLI) callers.
    if (!options.remote) {
      throw new PushModeConflictError('--new requires --remote to say which remote to propose against.');
    }
    remoteName = options.remote;
  } else {
    remoteName = lockEntry!.remote;
    if (options.remote && options.remote !== remoteName) {
      throw new PushModeConflictError(
        `"${id}" is tracked against remote "${remoteName}", but --remote "${options.remote}" was passed. Drop --remote or pass the matching remote name.`,
      );
    }
  }

  const remoteEntry = findRemote(remoteName);
  if (!remoteEntry) {
    throw new RemoteRegistryError(`No remote named "${remoteName}" is registered`);
  }

  const { owner: ghOwner, repo: ghRepo } = parseGithubUrl(remoteEntry.url);

  // Refresh the local cache to the remote's current tip before branching,
  // diffing, or collision-checking against it.
  onProgress?.('fetch', `Fetching remote "${remoteName}"...`);
  await fetchAndReset(cachePath(remoteName));

  const branchName = buildBranchName(id);
  const cacheDir = cachePath(remoteName);
  const identity = await getCommitIdentity(cacheDir);

  let commitMessage: string;
  let filesToCommit: string[];
  let prTitle: string;
  let prBody: string;

  if (options.isNew) {
    if (!options.payloadPath || !options.kind || !options.owner || !options.description) {
      throw new PushModeConflictError(
        '--new requires --path, --kind, --owner, and --description.',
      );
    }

    // Collision check: the id must not already exist in this remote's
    // just-refreshed catalog.
    onProgress?.('diff', `Checking "${id}" is not already taken in remote "${remoteName}"...`);
    const catalog = buildCatalog();
    const collision = catalog.find(
      (entry) => entry.remoteName === remoteName && entry.manifest.id === id,
    );
    if (collision) {
      throw new IdCollisionError(
        `Artifact id "${id}" already exists in remote "${remoteName}" (owner: ${collision.manifest.owner}, version: ${collision.manifest.version}). Choose a different id, or drop --new to push an edit to the existing artifact.`,
      );
    }

    const candidateManifest = {
      id,
      kind: options.kind,
      description: options.description,
      owner: options.owner,
      version: options.version ?? '1.0.0',
      tags: {
        roles: options.roles ?? [],
        teams: options.teams ?? [],
        stacks: options.stacks ?? [],
      },
      source_repo: remoteEntry.url,
      install_target: options.installTarget ?? id,
      review_required: Boolean(options.reviewRequired),
      // Every project has its own setup step (pip/npm/cargo/none at all) --
      // DeliveryOS doesn't know or care which; it just runs whatever's here,
      // in install_target, after the payload lands. Omitted entirely (not
      // an empty string) when the proposer doesn't set one, so pull's
      // `if (manifest.post_install)` check skips it cleanly.
      ...(options.postInstall ? { post_install: options.postInstall } : {}),
    };

    const result = ManifestSchema.safeParse(candidateManifest);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
      throw new ManifestValidationError(`Manifest built from --new flags failed validation: ${issues}`);
    }
    const manifest: Manifest = result.data;

    if (!fs.existsSync(options.payloadPath)) {
      throw new ManifestValidationError(`--path "${options.payloadPath}" does not exist`);
    }
    // `listFilesRecursive`/`listPayloadFiles` return [''] as a sentinel for a
    // single-file root (see its own doc comment) -- normalize that into the
    // file's real basename here, once, so every downstream use (the actual
    // copy below, the git commit path list, and the PR body's "new files"
    // list) refers to a real path under payload/ instead of an empty string.
    const payloadIsFile = fs.statSync(options.payloadPath).isFile();
    // `listPayloadFiles` (not the raw `listFilesRecursive`) for a directory
    // payload: proposing a whole project folder (e.g. a template/scaffold,
    // not just a single doc) would otherwise copy EVERYTHING underneath it
    // verbatim, including a nested `.git/` (which git would try to treat as
    // an embedded repo/gitlink rather than plain files once committed here)
    // and whatever the project's own .gitignore excludes (node_modules/,
    // build output, caches). listFilesRecursive alone already skips `.git`
    // unconditionally at the walk level; listPayloadFiles adds the
    // .gitignore filtering on top.
    const payloadFiles = payloadIsFile
      ? [path.basename(options.payloadPath)]
      : listPayloadFiles(options.payloadPath);

    onProgress?.('stage', `Staging payload files for "${id}"...`);
    const artifactDir = path.join(cacheDir, 'artifacts', id);
    const payloadDestDir = path.join(artifactDir, 'payload');
    fs.mkdirSync(payloadDestDir, { recursive: true });
    if (payloadIsFile) {
      // fs.cpSync can't copy a single file onto a path that already exists
      // as a directory (payloadDestDir, just created above) -- it needs an
      // actual destination FILE path, not the directory itself.
      fs.copyFileSync(options.payloadPath, path.join(payloadDestDir, payloadFiles[0]));
    } else {
      // Copied file-by-file (reusing the same helper edit-mode push already
      // uses) rather than one bulk `fs.cpSync` of the whole source
      // directory, so what's physically copied always matches `payloadFiles`
      // exactly -- a bulk recursive copy would re-introduce everything
      // `listPayloadFiles` just filtered out.
      for (const relPath of payloadFiles) {
        copyFileInto(options.payloadPath, payloadDestDir, relPath);
      }
    }
    fs.writeFileSync(path.join(artifactDir, 'manifest.yaml'), stringifyYaml(manifest), 'utf-8');

    filesToCommit = [
      `artifacts/${id}/manifest.yaml`,
      ...payloadFiles.map((relPath) => `artifacts/${id}/payload/${relPath}`),
    ];
    commitMessage = `DeliveryOS push: propose new artifact ${id}`;

    const content = buildProposeNewPrContent({
      id,
      kind: manifest.kind,
      owner: manifest.owner,
      version: manifest.version,
      installTarget: manifest.install_target,
      tags: manifest.tags,
      gitUserName: identity.name,
      gitUserEmail: identity.email,
      payloadFiles,
    });
    prTitle = content.title;
    prBody = content.body;
  } else if (options.metadataEdit) {
    // Metadata-only edit: description/roles/teams/stacks changed via
    // Detail's Edit button, payload untouched entirely. `resolveArtifact`
    // reads from `buildCatalog()`, which reads the cache `fetchAndReset`
    // just refreshed above -- `entry.manifest` is already the remote's
    // current state, not a possibly-stale local read.
    const entry = resolveArtifact(id, remoteName);
    const { manifest: current } = entry;

    const before: MetadataFields = {
      description: current.description,
      roles: current.tags.roles,
      teams: current.tags.teams,
      stacks: current.tags.stacks,
    };
    const after: MetadataFields = {
      description: options.metadataEdit.description ?? before.description,
      roles: options.metadataEdit.roles ?? before.roles,
      teams: options.metadataEdit.teams ?? before.teams,
      stacks: options.metadataEdit.stacks ?? before.stacks,
    };

    if (JSON.stringify(before) === JSON.stringify(after)) {
      throw new NoLocalChangesError(
        `No metadata changes for "${id}" -- description/roles/teams/stacks are all identical to what's currently on the remote.`,
      );
    }

    const updatedManifest = {
      ...current,
      description: after.description,
      tags: { roles: after.roles, teams: after.teams, stacks: after.stacks },
    };
    const validated = ManifestSchema.safeParse(updatedManifest);
    if (!validated.success) {
      const issues = validated.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
      throw new ManifestValidationError(`Metadata edit for "${id}" failed validation: ${issues}`);
    }

    onProgress?.('stage', `Staging metadata changes for "${id}"...`);
    const manifestPath = path.join(cacheDir, 'artifacts', id, 'manifest.yaml');
    fs.writeFileSync(manifestPath, stringifyYaml(validated.data), 'utf-8');

    filesToCommit = [`artifacts/${id}/manifest.yaml`];
    commitMessage = `DeliveryOS push: update ${id} metadata`;

    const content = buildMetadataEditPrContent({
      id,
      kind: current.kind,
      owner: current.owner,
      version: current.version,
      gitUserName: identity.name,
      gitUserEmail: identity.email,
      before,
      after,
    });
    prTitle = content.title;
    prBody = content.body;
  } else {
    const entry = resolveArtifact(id, remoteName);
    const { manifest } = entry;
    const installTarget = path.resolve(cwd, manifest.install_target);
    const pristine = pristinePath(cwd, id);

    onProgress?.('diff', `Diffing "${id}" against its pristine snapshot...`);
    const changedFiles = computeChangedFiles(installTarget, pristine);
    if (changedFiles.length === 0) {
      throw new NoLocalChangesError(
        `No local changes detected for "${id}" -- its files are byte-for-byte identical to the pristine snapshot taken at pull time. Nothing to push.`,
      );
    }

    // If the manifest this was pulled from set `payload_path`, the real
    // file/directory lives there in the remote's repo, not under
    // artifacts/<id>/payload/ -- write the diff back to that same real
    // location so the resulting git diff lands on the real file, not a
    // shadow copy. Absent: unchanged (artifacts/<id>/payload/).
    const payloadDestDir = manifest.payload_path
      ? path.join(cacheDir, manifest.payload_path)
      : path.join(cacheDir, 'artifacts', id, 'payload');
    const payloadDestGitRoot = manifest.payload_path ?? `artifacts/${id}/payload`;
    onProgress?.('stage', `Staging ${changedFiles.length} changed file(s) for "${id}"...`);
    for (const change of changedFiles) {
      if (change.status === 'deleted') {
        fs.rmSync(path.join(payloadDestDir, change.relPath), { force: true });
      } else {
        copyFileInto(installTarget, payloadDestDir, change.relPath);
      }
    }

    filesToCommit = changedFiles.map((change) =>
      path.posix.join(payloadDestGitRoot, change.relPath),
    );
    commitMessage = `DeliveryOS push: update ${id}`;

    const content = buildEditPrContent({
      id,
      kind: manifest.kind,
      owner: manifest.owner,
      version: manifest.version,
      gitUserName: identity.name,
      gitUserEmail: identity.email,
      changedFiles,
      payloadRoot: manifest.payload_path,
    });
    prTitle = content.title;
    prBody = content.body;
  }

  onProgress?.('branch', `Creating branch "${branchName}"...`);
  await createBranch(cacheDir, branchName);
  onProgress?.('commit', 'Committing changes...');
  await commitPaths(cacheDir, filesToCommit, commitMessage, identity);
  onProgress?.('push', `Pushing branch "${branchName}"...`);
  await pushBranch(cacheDir, branchName);

  onProgress?.('pr-open', 'Opening pull request...');
  const client = octokit ?? (await createOctokit(getGithubToken()));
  const base = await getDefaultBranch(client, ghOwner, ghRepo);
  const opened = await openPullRequest(client, {
    owner: ghOwner,
    repo: ghRepo,
    head: branchName,
    base,
    title: prTitle,
    body: prBody,
  });

  // Record the opened PR against this artifact's lockfile entry so its real
  // outcome (still open / merged / closed-unmerged) can be checked later via
  // resolvePendingPushes -- pushing doesn't otherwise touch local state at
  // all (the edit isn't accepted upstream just because a PR was opened for
  // it), so without this there would be no way to later tell whether a push
  // was ever followed up on. Propose-new has no pre-existing lockfile entry
  // to attach this to -- out of scope here, tracked only for edit-mode.
  if (!options.isNew && lockEntry) {
    upsertEntry(cwd, { ...lockEntry, pendingPr: { number: opened.number, url: opened.url } });
  }

  return { url: opened.url, number: opened.number, branch: branchName };
}
