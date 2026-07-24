import { CatalogEntry } from '../engine/catalog/catalog';

/** Prints the catalog as a simple aligned table, or as JSON if `json` is set. */
export function printCatalog(entries: CatalogEntry[], json: boolean): void {
  if (json) {
    const plain = entries.map((entry) => ({
      id: entry.manifest.id,
      kind: entry.manifest.kind,
      version: entry.manifest.version,
      remote: entry.remoteName,
      description: entry.manifest.description,
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
