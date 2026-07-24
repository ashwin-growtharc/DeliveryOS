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
  gitUserName: string;
  gitUserEmail: string;
  changedFiles: ChangedFile[];
}

/** Builds the PR title/body for an edit-mode push (a diff against an
 * already-tracked artifact). One bullet per changed file, in the same
 * order `computeChangedFiles` returned them. */
export function buildEditPrContent(params: EditPrContentParams): PrContent {
  const { id, kind, owner, version, gitUserName, gitUserEmail, changedFiles } = params;

  const title = `[DeliveryOS] Update ${id} (v${version})`;

  const changedFilesLines = changedFiles
    .map((file) => `- ${file.status}: payload/${file.relPath}`)
    .join('\n');

  const body = `## DeliveryOS push: update \`${id}\`

**Kind:** ${kind}   **Owner:** ${owner}   **Version:** ${version}
**Pushed by:** ${gitUserName} <${gitUserEmail}>

### Changed files
${changedFilesLines}

---
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
  tags: { roles: string[]; teams: string[]; stacks: string[] };
  gitUserName: string;
  gitUserEmail: string;
  payloadFiles: string[];
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
  } = params;

  const title = `[DeliveryOS] Propose new artifact: ${id}`;

  const newFilesLines = [
    `- artifacts/${id}/manifest.yaml`,
    ...payloadFiles.map((relPath) => `- artifacts/${id}/payload/${relPath}`),
  ].join('\n');

  const body = `## DeliveryOS push: propose new artifact \`${id}\`

**Kind:** ${kind}   **Owner:** ${owner}   **Version:** ${version}
**Install target:** ${installTarget}
**Tags:** roles=[${tags.roles.join(', ')}], teams=[${tags.teams.join(', ')}], stacks=[${tags.stacks.join(', ')}]
**Pushed by:** ${gitUserName} <${gitUserEmail}>

### New files
${newFilesLines}

---
This proposes \`${id}\` as a new artifact. Opened automatically by \`deliveryos push --new\`.
Review under this repo's normal rules.
`;

  return { title, body };
}
