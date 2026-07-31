import * as path from 'path';
import { ChangedFile } from './diff';

export interface PrContent {
  title: string;
  body: string;
}

export interface EditPrContentParams {
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
  // Fully-formed raw.githubusercontent.com URL for a freshly rendered
  // preview.png (Phase E), or undefined when no preview entry file exists
  // for this artifact (see push.ts's maybeRenderPreviewImage). GitHub
  // sanitizes PR bodies/diffs and strips <iframe>/<script> entirely -- a
  // plain markdown image tag is the only way to show a preview inline at
  // all, live or otherwise.
  previewImageUrl?: string;
}

/** Builds the PR title/body for an edit-mode push (a diff against an
 * already-tracked artifact). One bullet per changed file, in the same
 * order `computeChangedFiles` returned them. */
export function buildEditPrContent(params: EditPrContentParams): PrContent {
  const { id, kind, owner, version, previousVersion, gitUserName, gitUserEmail, changedFiles, payloadRoot, previewImageUrl } = params;

  const versionDisplay = previousVersion && previousVersion !== version ? `v${previousVersion} -> v${version}` : `v${version}`;
  const title = `[DeliveryOS] Update ${id} (${versionDisplay})`;

  const root = payloadRoot ?? 'payload';
  const changedFilesLines = changedFiles
    .map((file) => `- ${file.status}: ${path.posix.join(root, file.relPath)}`)
    .join('\n');

  const previewSection = previewImageUrl ? `\n### Preview\n![preview](${previewImageUrl})\n` : '';

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

export interface ProposeNewPrContentParams {
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
  // Fully-formed raw.githubusercontent.com URL for a freshly rendered
  // preview.png (Phase E), or undefined when no preview entry file exists
  // for this artifact -- see `buildEditPrContent`'s own doc comment for
  // why this has to be a static image, never a live embed.
  previewImageUrl?: string;
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
    previewImageUrl,
  } = params;

  const title = `[DeliveryOS] Propose new artifact: ${id}`;

  const root = payloadRoot ?? `artifacts/${id}/payload`;
  const newFilesLines = [
    `- artifacts/${id}/manifest.yaml`,
    ...payloadFiles.map((relPath) => `- ${path.posix.join(root, relPath)}`),
  ].join('\n');

  const previewSection = previewImageUrl ? `\n### Preview\n![preview](${previewImageUrl})\n` : '';

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
