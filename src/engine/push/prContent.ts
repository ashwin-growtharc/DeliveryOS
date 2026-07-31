import * as path from 'path';
import { ChangedFile } from './diff';

export interface PrContent {
  title: string;
  body: string;
}

/** Params shared by both PR-content builders for describing a freshly
 * rendered preview.png (Phase E) -- see `buildPreviewSection`'s own doc
 * comment for why there are two separate fields here, not just one. */
export interface PreviewImageParams {
  // Fully-formed raw.githubusercontent.com URL, set ONLY when the remote
  // repo is confirmed public -- raw.githubusercontent.com does not serve
  // private-repo content to an unauthenticated request (confirmed by
  // hand: a real push against a real private remote produced a PR body
  // with a broken image link, a 404 on that exact URL, and GitHub's own
  // PR-body markdown sanitizer separately strips `data:` URI images
  // entirely -- confirmed by hand via a real test comment whose rendered
  // HTML came back with an empty `<img>` src -- so there is no way to
  // embed an image inline in a PR body for a private repo at all today).
  previewImageUrl?: string;
  // Git-relative path to the generated preview.png, set whenever one was
  // actually generated -- regardless of whether it can be embedded inline.
  // Lets the private-repo case still tell the reviewer a preview exists
  // and where to find it (the Files changed tab, which renders it
  // natively via GitHub's own authenticated page -- no external fetch
  // involved, so it works regardless of repo visibility), rather than
  // silently saying nothing at all.
  previewImageGitPath?: string;
}

/** Builds the `### Preview` section for a PR body: a real inline image
 * when embeddable (public repo), a pointer to the Files changed tab when
 * one was generated but can't be embedded (private repo -- see
 * `PreviewImageParams.previewImageUrl`'s own doc comment for why), or
 * nothing at all when no preview entry file existed for this artifact. */
function buildPreviewSection(params: PreviewImageParams): string {
  if (params.previewImageUrl) {
    return `\n### Preview\n![preview](${params.previewImageUrl})\n`;
  }
  if (params.previewImageGitPath) {
    return (
      `\n### Preview\nGenerated at \`${params.previewImageGitPath}\` -- view it in the Files changed ` +
      `tab (can't be embedded inline here for a private repo; GitHub does not serve private-repo raw ` +
      `content to an unauthenticated request, and strips \`data:\` URI images from PR bodies entirely).\n`
    );
  }
  return '';
}

export interface EditPrContentParams extends PreviewImageParams {
  id: string;
  kind: string;
  owner: string;
  version: string;
  // The version this edit is bumping FROM -- when present, the title/body
  // show "vOLD -> vNEW" instead of just the new version, so a reviewer can
  // see at a glance that a real version bump happened (Phase E), not just
  // that some files changed. Optional so existing callers/tests that never
  // bump (there are none left in push.ts itself, but this keeps the
  // function usable standalone) don't have to pass a redundant value.
  previousVersion?: string;
  gitUserName: string;
  gitUserEmail: string;
  changedFiles: ChangedFile[];
  // Git-relative root the changed files are reported under: `'payload'`
  // (the historical abbreviated form, dropping the `artifacts/<id>/`
  // prefix) by default, or the artifact's `payload_path` when set, so the
  // PR body names the real file/directory instead of a shadow path that
  // was never actually written to.
  payloadRoot?: string;
}

/** Builds the PR title/body for an edit-mode push (a diff against an
 * already-tracked artifact). One bullet per changed file, in the same
 * order `computeChangedFiles` returned them. */
export function buildEditPrContent(params: EditPrContentParams): PrContent {
  const { id, kind, owner, version, previousVersion, gitUserName, gitUserEmail, changedFiles, payloadRoot } = params;

  const versionDisplay = previousVersion && previousVersion !== version ? `v${previousVersion} -> v${version}` : `v${version}`;
  const title = `[DeliveryOS] Update ${id} (${versionDisplay})`;

  const root = payloadRoot ?? 'payload';
  const changedFilesLines = changedFiles
    .map((file) => `- ${file.status}: ${path.posix.join(root, file.relPath)}`)
    .join('\n');

  const previewSection = buildPreviewSection(params);

  const body = `## DeliveryOS push: update \`${id}\`

**Kind:** ${kind}   **Owner:** ${owner}   **Version:** ${versionDisplay}
**Pushed by:** ${gitUserName} <${gitUserEmail}>
${previewSection}
### Changed files
${changedFilesLines}

---
Opened automatically by \`deliveryos push\`. Review under this repo's normal rules.
`;

  return { title, body };
}

export interface MetadataFields {
  description: string;
  roles: string[];
  teams: string[];
  stacks: string[];
  componentTypes: string[];
}

export interface MetadataEditPrContentParams {
  id: string;
  kind: string;
  owner: string;
  version: string;
  gitUserName: string;
  gitUserEmail: string;
  before: MetadataFields;
  after: MetadataFields;
}

function formatTagList(values: string[]): string {
  return values.length > 0 ? `[${values.join(', ')}]` : '(none)';
}

/** Builds the PR title/body for a metadata-only edit (description/roles/
 * teams/stacks changed via Detail's Edit button -- the payload itself is
 * untouched). Only lists fields that actually changed, so a PR that just
 * added one role doesn't also claim description/stacks/teams changed. */
export function buildMetadataEditPrContent(params: MetadataEditPrContentParams): PrContent {
  const { id, kind, owner, version, gitUserName, gitUserEmail, before, after } = params;

  const title = `[DeliveryOS] Update ${id} metadata`;

  const lines: string[] = [];
  if (before.description !== after.description) {
    lines.push(`- **description**: "${before.description}" -> "${after.description}"`);
  }
  if (JSON.stringify(before.roles) !== JSON.stringify(after.roles)) {
    lines.push(`- **roles**: ${formatTagList(before.roles)} -> ${formatTagList(after.roles)}`);
  }
  if (JSON.stringify(before.teams) !== JSON.stringify(after.teams)) {
    lines.push(`- **teams**: ${formatTagList(before.teams)} -> ${formatTagList(after.teams)}`);
  }
  if (JSON.stringify(before.stacks) !== JSON.stringify(after.stacks)) {
    lines.push(`- **stacks**: ${formatTagList(before.stacks)} -> ${formatTagList(after.stacks)}`);
  }
  if (JSON.stringify(before.componentTypes) !== JSON.stringify(after.componentTypes)) {
    lines.push(`- **componentTypes**: ${formatTagList(before.componentTypes)} -> ${formatTagList(after.componentTypes)}`);
  }

  const body = `## DeliveryOS push: update \`${id}\` metadata

**Kind:** ${kind}   **Owner:** ${owner}   **Version:** ${version}
**Pushed by:** ${gitUserName} <${gitUserEmail}>

### Changed fields
${lines.join('\n')}

---
Only \`artifacts/${id}/manifest.yaml\` changed -- the artifact's payload is untouched.
Opened automatically by \`deliveryos push\`. Review under this repo's normal rules.
`;

  return { title, body };
}

export interface ProposeNewPrContentParams extends PreviewImageParams {
  id: string;
  kind: string;
  owner: string;
  version: string;
  installTarget: string;
  tags: { roles: string[]; teams: string[]; stacks: string[]; componentTypes: string[] };
  gitUserName: string;
  gitUserEmail: string;
  payloadFiles: string[];
  // Git-relative root the new payload files are reported under: the
  // historical `artifacts/<id>/payload` by default, or `files/<id>` for a
  // single-file payload (see push.ts's payload_path override), so the PR
  // body names the real committed path instead of a shadow one.
  payloadRoot?: string;
}

/** Builds the PR title/body for a propose-new-mode push (a brand-new
 * artifact with no prior lockfile entry). */
export function buildProposeNewPrContent(params: ProposeNewPrContentParams): PrContent {
  const {
    id,
    kind,
    owner,
    version,
    installTarget,
    tags,
    gitUserName,
    gitUserEmail,
    payloadFiles,
    payloadRoot,
  } = params;

  const title = `[DeliveryOS] Propose new artifact: ${id}`;

  const root = payloadRoot ?? `artifacts/${id}/payload`;
  const newFilesLines = [
    `- artifacts/${id}/manifest.yaml`,
    ...payloadFiles.map((relPath) => `- ${path.posix.join(root, relPath)}`),
  ].join('\n');

  const previewSection = buildPreviewSection(params);

  const body = `## DeliveryOS push: propose new artifact \`${id}\`

**Kind:** ${kind}   **Owner:** ${owner}   **Version:** ${version}
**Install target:** ${installTarget}
**Tags:** roles=[${tags.roles.join(', ')}], teams=[${tags.teams.join(', ')}], stacks=[${tags.stacks.join(', ')}], componentTypes=[${tags.componentTypes.join(', ')}]
**Pushed by:** ${gitUserName} <${gitUserEmail}>
${previewSection}
### New files
${newFilesLines}

---
This proposes \`${id}\` as a new artifact. Opened automatically by \`deliveryos push --new\`.
Review under this repo's normal rules.
`;

  return { title, body };
}
