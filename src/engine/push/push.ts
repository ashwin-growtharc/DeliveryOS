import * as fs from 'fs';
import * as path from 'path';
import { stringify as stringifyYaml } from 'yaml';
import { readLockfile, upsertEntry } from '../lockfile/lockfile';
import { findRemote } from '../remote/remoteRegistry';
import { cachePath } from '../remote/remoteCache';
import { resolveArtifact, ProgressCallback } from '../pull/pull';
import { buildCatalog } from '../catalog/catalog';
import { ManifestSchema, Manifest } from '../manifest/schema';
import { bumpVersion, VersionBumpKind } from '../manifest/version';
import { renderPreviewImage } from '../preview/renderPreviewImage';
import { findPreviewEntryFile } from '../preview/resolveArtifactPreview';
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
  fetchRepoInfo,
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
  componentTypes?: string[];
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
  componentTypes?: string[];
  postInstall?: string;
  // edit mode only, mutually exclusive with a payload-content diff push:
  // changes description/roles/teams/stacks on an already-tracked artifact's
  // manifest.yaml without touching its payload at all. See Detail's Edit
  // button in the app.
  metadataEdit?: MetadataEditOptions;
  // Payload edit-mode push ONLY (the `else` branch below) -- a metadata-
  // only edit never bumps version at all (its payload, and therefore its
  // real behavior, hasn't changed). Defaults to `'patch'` when omitted:
  // Phase E's fix for a real gap (edit-mode push never touched
  // `manifest.yaml` at all, so `checkForUpdates`/the preview cache could
  // never detect a real edit) is that a version bump just HAPPENS on any
  // real payload change, not something a person has to remember to ask
  // for -- this field only lets someone choose a bigger bump than the
  // default, never opt out of bumping entirely.
  bump?: VersionBumpKind;
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
 * Renders a fresh `preview.png` into `payloadDir` (a real, headless
 * screenshot of the compiled preview -- see `renderPreviewImage`'s own doc
 * comment) if it has a conventional preview entry file, and returns its
 * git-relative commit path -- or `undefined` if no preview entry file
 * exists at all. Gated purely on file-presence, never a `kind` check
 * (PLAN.md's Phase E note: "matching how `post_install` already works"),
 * so any future non-`ui-component` kind that adopts the same `preview.*`
 * convention gets this for free.
 *
 * A render failure (a real compile error in the component, no headless
 * browser installed on this machine, etc.) does NOT fail the whole push --
 * same "graceful degradation" principle PLAN.md's own Phase 6 end-to-end
 * test list already establishes for an unresolved import in the live
 * preview itself: an artifact whose preview can't be rendered should still
 * propose/push successfully, just without an image, not be blocked from
 * existing at all.
 */
async function maybeRenderPreviewImage(
  payloadDir: string,
  gitRoot: string,
  onProgress?: ProgressCallback,
): Promise<string | undefined> {
  let previewEntryPath: string;
  try {
    previewEntryPath = findPreviewEntryFile(payloadDir);
  } catch {
    return undefined;
  }

  onProgress?.('render-preview', 'Rendering preview.png...');
  try {
    const png = await renderPreviewImage(previewEntryPath);
    fs.writeFileSync(path.join(payloadDir, 'preview.png'), png);
    return path.posix.join(gitRoot, 'preview.png');
  } catch (err) {
    onProgress?.(
      'render-preview',
      `Could not render preview.png (continuing without one): ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
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
  // Constructing the client is local/free (no network call happens until
  // one of its methods is actually invoked) -- safe to do unconditionally
  // here. The actual `repos.get` call (`fetchRepoInfo`, needed for Phase
  // E's preview-image privacy check) is deliberately NOT made yet: each
  // branch below has its own local-only validation (NoLocalChangesError,
  // IdCollisionError) that must keep failing with ZERO GitHub API calls,
  // exactly as it did before Phase E -- so `fetchRepoInfo` is called once
  // inside each branch, only after that branch's own local-only checks
  // have already passed, and its `defaultBranch` is reused directly at
  // PR-open time below instead of fetching it a second time.
  const client = octokit ?? (await createOctokit(getGithubToken()));

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
  let defaultBranch: string;
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

    // Only fetched now, after the collision check -- see this function's
    // own comment above `client`'s construction for why.
    const repoInfo = await fetchRepoInfo(client, ghOwner, ghRepo);
    defaultBranch = repoInfo.defaultBranch;
    const isPrivateRepo = repoInfo.isPrivate;

    if (!fs.existsSync(options.payloadPath)) {
      throw new ManifestValidationError(`--path "${options.payloadPath}" does not exist`);
    }
    // `listFilesRecursive`/`listPayloadFiles` return [''] as a sentinel for a
    // single-file root (see its own doc comment) -- normalize that into the
    // file's real basename here, once, so every downstream use (the actual
    // copy below, the git commit path list, and the PR body's "new files"
    // list) refers to a real path instead of an empty string.
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

    // A single-file payload gets `payload_path` pointing at a real, stable
    // location (`files/<id>/<basename>`) instead of the standard
    // `artifacts/<id>/payload/` wrapper. This matters the moment
    // `install_target` is itself a file path (e.g. `.claude/agents/<id>.md`,
    // as `deliveryos scan` sets for a discovered agent): pullArtifact's
    // `fs.cpSync` creates `install_target` as a DIRECTORY when the payload
    // source is a directory, even one containing just a single file -- the
    // exact bug found and fixed for the growtharc-ai-helpers agent import.
    // Directory payloads keep the standard convention unchanged; a
    // directory-shaped `install_target` has no such mismatch to avoid.
    const payloadPathOverride = payloadIsFile ? `files/${id}/${payloadFiles[0]}` : undefined;

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
        componentTypes: options.componentTypes ?? [],
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
      ...(payloadPathOverride ? { payload_path: payloadPathOverride } : {}),
    };

    const result = ManifestSchema.safeParse(candidateManifest);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
      throw new ManifestValidationError(`Manifest built from --new flags failed validation: ${issues}`);
    }
    const manifest: Manifest = result.data;

    onProgress?.('stage', `Staging payload files for "${id}"...`);
    const artifactDir = path.join(cacheDir, 'artifacts', id);
    fs.mkdirSync(artifactDir, { recursive: true });
    // Single-file payloads (e.g. a lone `.md` skill) have no sibling
    // directory a preview.tsx could possibly live in -- preview.png
    // generation only ever applies to the directory-payload branch below.
    let previewImageGitPath: string | undefined;
    if (payloadIsFile) {
      const fileDestDir = path.join(cacheDir, 'files', id);
      fs.mkdirSync(fileDestDir, { recursive: true });
      fs.copyFileSync(options.payloadPath, path.join(fileDestDir, payloadFiles[0]));
    } else {
      const payloadDestDir = path.join(artifactDir, 'payload');
      fs.mkdirSync(payloadDestDir, { recursive: true });
      // Copied file-by-file (reusing the same helper edit-mode push already
      // uses) rather than one bulk `fs.cpSync` of the whole source
      // directory, so what's physically copied always matches `payloadFiles`
      // exactly -- a bulk recursive copy would re-introduce everything
      // `listPayloadFiles` just filtered out.
      for (const relPath of payloadFiles) {
        copyFileInto(options.payloadPath, payloadDestDir, relPath);
      }
      previewImageGitPath = await maybeRenderPreviewImage(payloadDestDir, `artifacts/${id}/payload`, onProgress);
    }
    fs.writeFileSync(path.join(artifactDir, 'manifest.yaml'), stringifyYaml(manifest), 'utf-8');

    const payloadGitRoot = payloadPathOverride ? `files/${id}` : `artifacts/${id}/payload`;
    filesToCommit = [
      `artifacts/${id}/manifest.yaml`,
      ...payloadFiles.map((relPath) => path.posix.join(payloadGitRoot, relPath)),
      ...(previewImageGitPath ? [previewImageGitPath] : []),
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
      payloadRoot: payloadPathOverride ? `files/${id}` : undefined,
      previewImageGitPath,
      previewImageUrl:
        previewImageGitPath && !isPrivateRepo
          ? `https://raw.githubusercontent.com/${ghOwner}/${ghRepo}/${branchName}/${previewImageGitPath}`
          : undefined,
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
      componentTypes: current.tags.componentTypes,
    };
    const after: MetadataFields = {
      description: options.metadataEdit.description ?? before.description,
      roles: options.metadataEdit.roles ?? before.roles,
      teams: options.metadataEdit.teams ?? before.teams,
      stacks: options.metadataEdit.stacks ?? before.stacks,
      componentTypes: options.metadataEdit.componentTypes ?? before.componentTypes,
    };

    if (JSON.stringify(before) === JSON.stringify(after)) {
      throw new NoLocalChangesError(
        `No metadata changes for "${id}" -- description/roles/teams/stacks/componentTypes are all identical to what's currently on the remote.`,
      );
    }

    // Only fetched now, after the no-op check -- see this function's own
    // comment above `client`'s construction for why. Metadata edits never
    // touch the preview image, so only `defaultBranch` is needed here.
    defaultBranch = (await fetchRepoInfo(client, ghOwner, ghRepo)).defaultBranch;

    const updatedManifest = {
      ...current,
      description: after.description,
      tags: { roles: after.roles, teams: after.teams, stacks: after.stacks, componentTypes: after.componentTypes },
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

    // Only fetched now, after the no-local-changes check -- see this
    // function's own comment above `client`'s construction for why.
    const repoInfo = await fetchRepoInfo(client, ghOwner, ghRepo);
    defaultBranch = repoInfo.defaultBranch;
    const isPrivateRepo = repoInfo.isPrivate;

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

    // Real payload content changed (guaranteed by the NoLocalChangesError
    // check above) -- bump the manifest's version and write it back, the
    // actual Phase E fix: edit-mode push never touched manifest.yaml at
    // all before this, so `checkForUpdates`/the preview cache (both keyed
    // on version) could never detect a real edit, silently forever. See
    // PushOptions.bump's own doc comment for why this defaults to 'patch'
    // rather than requiring an explicit choice.
    const previousVersion = manifest.version;
    const newVersion = bumpVersion(previousVersion, options.bump ?? 'patch');
    const updatedManifest = { ...manifest, version: newVersion };
    const validatedManifest = ManifestSchema.safeParse(updatedManifest);
    if (!validatedManifest.success) {
      const issues = validatedManifest.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
      throw new ManifestValidationError(`Version bump for "${id}" produced an invalid manifest: ${issues}`);
    }
    const manifestPath = path.join(cacheDir, 'artifacts', id, 'manifest.yaml');
    fs.writeFileSync(manifestPath, stringifyYaml(validatedManifest.data), 'utf-8');

    const previewImageGitPath = await maybeRenderPreviewImage(payloadDestDir, payloadDestGitRoot, onProgress);

    filesToCommit = [
      `artifacts/${id}/manifest.yaml`,
      ...changedFiles.map((change) => path.posix.join(payloadDestGitRoot, change.relPath)),
      ...(previewImageGitPath ? [previewImageGitPath] : []),
    ];
    commitMessage = `DeliveryOS push: update ${id}`;

    const content = buildEditPrContent({
      id,
      kind: manifest.kind,
      owner: manifest.owner,
      version: newVersion,
      previousVersion,
      gitUserName: identity.name,
      gitUserEmail: identity.email,
      changedFiles,
      payloadRoot: manifest.payload_path,
      previewImageGitPath,
      previewImageUrl:
        previewImageGitPath && !isPrivateRepo
          ? `https://raw.githubusercontent.com/${ghOwner}/${ghRepo}/${branchName}/${previewImageGitPath}`
          : undefined,
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
  const opened = await openPullRequest(client, {
    owner: ghOwner,
    repo: ghRepo,
    head: branchName,
    base: defaultBranch,
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
    await upsertEntry(cwd, { ...lockEntry, pendingPr: { number: opened.number, url: opened.url } });
  }

  return { url: opened.url, number: opened.number, branch: branchName };
}
