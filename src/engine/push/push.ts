import * as fs from 'fs';
import * as path from 'path';
import { stringify as stringifyYaml } from 'yaml';
import { readLockfile, upsertEntry } from '../lockfile/lockfile';
import { findRemote } from '../remote/remoteRegistry';
import { cachePath, withRemoteCacheLock } from '../remote/remoteCache';
import { resolveArtifact, ProgressCallback } from '../pull/pull';
import { buildCatalog } from '../catalog/catalog';
import { ManifestSchema, Manifest, InstallParam } from '../manifest/schema';
import { bumpVersion, VersionBumpKind } from '../manifest/version';
import { compareVersions } from '../sync/sync';
import { renderPreviewImage } from '../preview/renderPreviewImage';
import { findPreviewEntryFile } from '../preview/resolveArtifactPreview';
import {
  pristinePath,
  resolveContainedPath,
  isRootInstall,
  readPayloadFootprint,
  adaptSrcDirPath,
} from '../paths';
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
  StalePushError,
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
  // Phase 10 item 3: lets a caller (the app's Add New wizard, after
  // reviewing/correcting Scan's detected process.env.X proposals) author
  // install_params directly at propose-new time -- previously the only
  // way to add these was hand-editing manifest.yaml after the fact (see
  // Phase 7's own nextauth-credentials history).
  installParams?: InstallParam[];
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
  /** Push even though the artifact was edited against a version that is no
   * longer the remote's current one. Off by default: see `StalePushError` for
   * what it silently used to do. When set, the PR body says it was forced and
   * names the overlapping files, so the escape hatch leaves a trace. */
  force?: boolean;
}

export interface PushResult {
  url: string;
  number: number;
  branch: string;
  /** Set only when the PR opened successfully but the local cache clone could
   * NOT be reset back to the remote's tip afterwards. Until something else
   * fetches, every read that doesn't fetch first -- `list`, `pull`, `config`,
   * `wiring`, `catalog.list`, every preview compile -- sees this push's
   * UNMERGED branch as if it were the remote's real state. That is the
   * incident the reset exists to prevent: a `pull` immediately after a `push`
   * installed the user's own unreviewed PR content. Absent on every ordinary
   * push. */
  cacheResetWarning?: string;
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
  // Everything below mutates the shared remote cache clone at
  // ~/.deliveryos/remotes/<name>, so it runs under an exclusive
  // inter-process lock. Without it, the desktop app's 20-minute auto-sync
  // tick landing between the staging step and the commit ran a
  // `git reset --hard` and silently discarded the staged edit -- a lost
  // update, not a crash. See withRemoteCacheLock's own doc comment.
  return withRemoteCacheLock(remoteName, async () => {
    let result: PushResult | undefined;
    try {
    const client = octokit ?? (await createOctokit(getGithubToken()));

    // Refresh the local cache to the remote's current tip before branching,
    // diffing, or collision-checking against it.
    onProgress?.('fetch', `Fetching remote "${remoteName}"...`);
    // Direct call, not refreshRemoteCache: this already runs inside
    // withRemoteCacheLock above, and proper-lockfile is not reentrant.
    await fetchAndReset(cachePath(remoteName));

    const branchName = buildBranchName(id);
    const cacheDir = cachePath(remoteName);
    const identity = await getCommitIdentity(cacheDir);

    let commitMessage: string;
    let filesToCommit: string[];
    let prTitle: string;
    let defaultBranch: string;
    // Set only when --force pushed over a stale version, so the PR body can
    // say so. Undefined on every ordinary push.
    let stalePushWarning: { editedAgainst: string; upstreamVersion: string; overlap: string[] } | undefined;
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
        ...(options.installParams && options.installParams.length > 0
          ? { install_params: options.installParams }
          : {}),
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
      // manifest.install_target is untrusted (the artifact author's own
      // manifest, not something DeliveryOS controls) -- same containment
      // check pull.ts already applies before ever writing there, and the
      // same reasoning this file's own payload_path check below already
      // documents: an unchecked value here would let a crafted manifest
      // point a routine edit-mode push's diff/pristine-comparison at a
      // location outside the project entirely.
      // allowRoot stays TRUE: a root install_target is a legitimate scaffold
      // shape, and refusing it here meant such an artifact could be pulled but
      // never contributed back. Nothing here deletes -- this path only diffs --
      // so the fix is to narrow the diff, not to refuse. See isRootInstall.
      // The lockfile's recorded target wins whenever there is one, because it
      // is where the payload ACTUALLY landed. Re-deriving it from the manifest
      // here was destructive, not merely wrong: in a project without a `src/`
      // directory -- where pullArtifact's adaptSrcDirPath shortened
      // `src/lib/x` to `lib/x` -- this pointed at a directory that does not
      // exist. listFilesRecursive returns [] for a missing root, so
      // computeChangedFiles below reported EVERY pristine file as `deleted`,
      // the only guard (`changedFiles.length === 0`) passed, and the staging
      // loop then rmSync'd every payload file in the cache and opened a PR
      // DELETING the artifact's whole payload upstream, on a shared remote.
      // `lockEntry.installTarget` is an ABSOLUTE path, so it is only meaningful
      // for the machine and the directory it was written on. `.deliveryos/` now
      // carries its own .gitignore (ensureProjectDeliveryOsDir), so a lockfile
      // should no longer travel to other clones -- but it is still re-validated
      // against THIS cwd before use, exactly as removeArtifact re-validates the
      // same field. A project that was committed before that landed, or whose
      // .gitignore someone removed, still exists.
      const recorded = lockEntry?.installTarget;
      const recordedIsUsable = recorded !== undefined && resolveContainedPath(cwd, recorded) === recorded;
      const installTarget = recordedIsUsable
        ? recorded
        : resolveContainedPath(cwd, adaptSrcDirPath(cwd, manifest.install_target) ?? manifest.install_target);
      if (!installTarget) {
        throw new ManifestValidationError(
          `Artifact "${id}"'s install_target ("${manifest.install_target}") resolves outside the project -- `
            + `refusing to push.`,
        );
      }
      // The whole bug class this function keeps re-learning: `listFilesRecursive`
      // returns [] for a directory that does not exist (diff.ts), so diffing a
      // missing install target reports EVERY pristine file as `deleted` -- a
      // changeset that sails past the `length === 0` guard below and makes the
      // staging loop rmSync the cache and open a PR deleting the artifact's whole
      // payload upstream. Refusing here is the one check that closes it for good,
      // whatever produced the wrong path.
      if (!fs.existsSync(installTarget)) {
        throw new ManifestValidationError(
          `Artifact "${id}"'s files are not at "${installTarget}" -- nothing there to push. If this project `
            + `moved or was cloned from somewhere else, re-pull it once so its recorded location matches `
            + `where the files actually are.`,
        );
      }
      const pristine = pristinePath(cwd, id);
      // At the project root, only the top-level entries the payload provided
      // are this artifact's -- without that scope a push would propose the
      // user's entire project as the new payload.
      const rootInstall = isRootInstall(cwd, installTarget);
      const topLevelScope = rootInstall ? readPayloadFootprint(pristine) : undefined;
      if (rootInstall && !topLevelScope) {
        throw new ManifestValidationError(
          `Artifact "${id}" installs at the project root, and its pristine snapshot is missing, so there `
            + `is no record of which files belong to it -- refusing to push rather than guess at the whole `
            + `project. Re-pull it (\`deliveryos pull ${id}\`) to rebuild the snapshot, then push.`,
        );
      }

      onProgress?.('diff', `Diffing "${id}" against its pristine snapshot...`);
      const changedFiles = computeChangedFiles(installTarget, pristine, { topLevelScope });
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
      //
      // `payload_path` is untrusted (the manifest's own author wrote it, not
      // something DeliveryOS controls) -- containment-checked against
      // `cacheDir` for the same reason `pull.ts` checks it before reading:
      // an unchecked value here would let a crafted manifest turn a routine
      // edit-mode push into writes/deletes (a few lines below) anywhere
      // `fs.rmSync`/`copyFileInto` can reach outside the remote's own clone.
      let payloadDestDir: string;
      if (manifest.payload_path) {
        const contained = resolveContainedPath(cacheDir, manifest.payload_path);
        if (!contained) {
          throw new ManifestValidationError(
            `Artifact "${id}"'s payload_path ("${manifest.payload_path}") resolves outside the remote's `
              + `own directory -- refusing to push.`,
          );
        }
        payloadDestDir = contained;
      } else {
        payloadDestDir = path.join(cacheDir, 'artifacts', id, 'payload');
      }
      const payloadDestGitRoot = manifest.payload_path ?? `artifacts/${id}/payload`;

      // Did someone else merge a change to this artifact since you pulled it?
      //
      // `manifest` here is the remote's CURRENT default-branch state (the
      // fetchAndReset above refreshed the cache), and `lockEntry.version` is
      // what this project actually pulled and edited against. Nothing used to
      // compare them, and the consequence was silent: the staging loop below
      // does a whole-file copy of YOUR files -- which are the version you
      // pulled, plus your edits -- over whatever is upstream now. The commit is
      // made off the current tip, so for any file you both touched, your push
      // REVERTS theirs as an ordinary forward diff. Git flags nothing, and the
      // PR body just says "modified: foo.ts".
      //
      // The overlap is the part worth naming: files changed both upstream and
      // locally are the ones that actually lose work. Computed against the same
      // pristine snapshot both comparisons already use.
      // A pending PR of your own is the one case this guard must NOT fire on.
      //
      // `push` records `pendingPr` and never advances `lockEntry.version` --
      // only resolvePendingPushes does, and that is a manual command plus a
      // 20-minute background tick. So the most ordinary flow there is (push,
      // merge, push again) leaves your lockfile on the old version while your
      // working copy already contains the merged change, and the guard accused
      // you of reverting your own work.
      //
      // Content comparison cannot rescue this: your second edit legitimately
      // differs from upstream while still CONTAINING it, and bytes cannot tell
      // "builds on" from "overwrites" without a real three-way merge. But
      // `pendingPr` is only ever set by push, so its presence means the change
      // upstream is very likely yours. Skipping the refusal here trades a rare
      // miss (someone else merged while your own PR was also open) for not
      // blocking the single most common workflow -- and the miss is exactly
      // what the PR review this opens is for.
      const hasOwnPushInFlight = lockEntry?.pendingPr !== undefined;
      if (lockEntry && !hasOwnPushInFlight && compareVersions(manifest.version, lockEntry.version) > 0) {
        const upstreamChanged = computeChangedFiles(payloadDestDir, pristine, { topLevelScope });
        // Overlap is CONTENT-aware, not just path-aware.
        //
        // A file that changed upstream and whose local copy is now byte-identical
        // to upstream cannot be reverted by pushing it -- there is nothing to
        // revert. The path-only version got this badly wrong in the single most
        // common case there is: your OWN push merging. `push` records
        // `pendingPr` but never advances `lockEntry.version` (only
        // resolvePendingPushes does), so after your PR merges your lockfile
        // still says the old version while your working copy already contains
        // the merged content. Comparing paths alone then accused you of being
        // about to revert your own merged change.
        const localVsUpstream = new Set(
          computeChangedFiles(installTarget, payloadDestDir, { topLevelScope }).map((c) => c.relPath),
        );
        const localPaths = new Set(changedFiles.map((c) => c.relPath));
        const overlap = upstreamChanged
          .map((c) => c.relPath)
          .filter((p) => localPaths.has(p) && localVsUpstream.has(p));

        if (!options.force) {
          const overlapDetail = overlap.length > 0
            ? `\n\n${overlap.length} file(s) you changed also changed upstream -- pushing would revert `
              + `those changes:\n${overlap.slice(0, 10).map((p) => `  ${p}`).join('\n')}`
              + (overlap.length > 10 ? `\n  ...and ${overlap.length - 10} more` : '')
            : '\n\nNone of the files you changed would revert an upstream change, so a merge would '
              + 'likely be clean -- but the version you edited against is no longer current.';
          // Deliberately surface-neutral. This message reaches the desktop app
          // too, where telling someone to "re-run with --force" names a flag
          // they have no way to pass -- the app has no force affordance for
          // push, and that is on purpose: a one-click force over a colleague's
          // merged change is exactly the operation that should stay hard. The
          // safe resolution the app CAN offer is the one described first.
          throw new StalePushError(
            `You edited "${id}" against v${lockEntry.version}, but remote "${remoteName}" is now at `
              + `v${manifest.version}.`
              + overlapDetail
              + `\n\nTo resolve: commit your work somewhere safe, take the current version of the `
              + `artifact (discarding your local copy), and re-apply your change on top of it. `
              + `In the CLI that is \`deliveryos pull ${id} --force\`, then push again; in the app it `
              + `is Detail's "discard local edit and re-sync".`
              + `\n\nThe CLI can also push anyway with --force, which stamps the overlap into the `
              + `pull request so a reviewer sees it.`,
          );
        }
        // Forced: proceed, but make it visible to whoever reviews the PR.
        // Unblocking someone is a fair reason for the flag; hiding what the
        // push did is not.
        stalePushWarning = {
          editedAgainst: lockEntry.version,
          upstreamVersion: manifest.version,
          overlap,
        };
      }

      // Only fetched now, after the no-local-changes check -- see this
      // function's own comment above `client`'s construction for why.
      const repoInfo = await fetchRepoInfo(client, ghOwner, ghRepo);
      defaultBranch = repoInfo.defaultBranch;
      const isPrivateRepo = repoInfo.isPrivate;

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
        // Undefined on every ordinary push; set only when --force pushed over a
        // version that had already moved upstream.
        stalePush: stalePushWarning,
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

    // Captured rather than returned directly, so the `finally` below can
    // still attach a warning to it: `finally` runs after the return value is
    // evaluated, and this is the same object reference the caller receives.
    result = { url: opened.url, number: opened.number, branch: branchName };
    return result;
    } finally {
      // Leave the cache on the remote's real tip, never parked on the
      // branch this push just created.
      //
      // Without this, a successful push left the cache checked out on
      // `deliveryos/<id>/<ts>` with the UNMERGED payload committed, and
      // nothing ever reset it. Every subsequent read that doesn't fetch
      // first -- `list`, `pull`, `config`, `wiring`, `catalog.list`, every
      // preview compile -- then read that unmerged branch as if it were
      // the remote's real state. A `pull` immediately after a `push`
      // installed the user's own unreviewed PR content.
      //
      // Best-effort in the sense that it must not mask the real outcome of
      // the push (the PR is already open at this point) -- but NOT silent.
      // Swallowing this left exactly the state described above with nothing
      // anywhere saying so, and "the next fetchAndReset would recover it" is
      // not a guarantee: pullArtifact never fetches. This is also the most
      // likely reset to fail, since it runs straight after the push's own
      // network I/O.
      try {
        await fetchAndReset(cachePath(remoteName));
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const warning =
          `The pull request was opened, but this machine's local cache of remote "${remoteName}" could not `
          + `be reset back to its tip afterwards (${detail}). Until something fetches that remote again, a `
          + `pull, list or preview from it may read THIS push's unmerged branch as if it were the remote's `
          + `real state. Run "deliveryos list" (or the app's Refresh) against it before pulling.`;
        // Reported through BOTH channels deliberately: onProgress is the only
        // one available when the push itself threw, since no PushResult exists
        // on that path at all.
        onProgress?.('fetch', warning);
        if (result) {
          result.cacheResetWarning = warning;
        }
      }
    }
  });
}
