import { CatalogEntry } from '../engine/catalog/catalog';
import { ResolvedWiringAction } from '../engine/pull/wiring';

/**
 * Prints the catalog as a simple aligned table, or as JSON if `json` is
 * set. The JSON shape carries more than the table does (`tags`,
 * `installTarget`, `installParams`, `signed`) -- additive fields, never
 * breaking an existing consumer reading just `id`/`kind`/`version`/
 * `remote`/`description` -- so a caller (e.g. a Claude Code Skill checking
 * whether a candidate match actually fits, per Phase 8 item 1) can judge
 * fit and trust without needing to pull first just to inspect the
 * manifest.
 */
export function printCatalog(entries: CatalogEntry[], json: boolean): void {
  if (json) {
    const plain = entries.map((entry) => ({
      id: entry.manifest.id,
      kind: entry.manifest.kind,
      version: entry.manifest.version,
      remote: entry.remoteName,
      description: entry.manifest.description,
      tags: entry.manifest.tags,
      installTarget: entry.manifest.install_target,
      installParams: entry.manifest.install_params.map((param) => ({
        key: param.key,
        secret: param.secret,
        required: param.required,
        hasDefault: param.default !== undefined,
      })),
      signed: entry.manifest.signature !== undefined,
    }));
    console.log(JSON.stringify(plain));
    return;
  }

  if (entries.length === 0) {
    console.log('No artifacts found.');
    return;
  }

  const headers = ['id', 'kind', 'version', 'remote', 'description'];
  const rows = entries.map((entry) => [
    entry.manifest.id,
    entry.manifest.kind,
    entry.manifest.version,
    entry.remoteName,
    entry.manifest.description,
  ]);

  const widths = headers.map((header, colIndex) =>
    Math.max(header.length, ...rows.map((row) => row[colIndex].length)),
  );

  const formatRow = (cells: string[]): string =>
    cells.map((cell, i) => cell.padEnd(widths[i])).join('  ');

  console.log(formatRow(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

/** Prints resolved wiring actions (Phase 7 item 6 / Phase 8 item 2) as a
 * human-readable listing, or as JSON if `json` is set -- the same shape
 * the sidecar's `artifact.resolveWiringActions` command and Detail's own
 * Wiring section already render, so a Claude Code Skill invoking this CLI
 * command sees exactly the same cards a person does in the desktop app. */
export function printWiringActions(actions: ResolvedWiringAction[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify(actions));
    return;
  }

  if (actions.length === 0) {
    console.log('No wiring actions declared for this artifact.');
    return;
  }

  for (const action of actions) {
    console.log('');
    console.log(`${action.targetFile} -- ${action.targetFileExists ? 'EXISTS' : 'NOT FOUND'}`);
    console.log(action.description);
    console.log(action.instructions);
    if (action.snippet) {
      console.log('---');
      console.log(action.snippet.trimEnd());
      console.log('---');
    }
  }
}
