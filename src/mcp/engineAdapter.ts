import {
  buildCatalogWithSkipped,
  annotateCatalog,
  refreshCatalog as refreshEngineCatalog,
} from '../engine/catalog/catalog';
import { resolveArtifact } from '../engine/pull/pull';
import { resolvePrimaryDoc } from '../engine/payload/primaryDoc';
import * as fs from 'fs';
import * as path from 'path';
import { ArtifactDetail, CatalogSnapshot, DeliveryOsReadPort } from './ports';

/**
 * The one file that binds the MCP driving port to the real DeliveryOS core.
 *
 * Everything here is translation, not logic: no filtering, no ranking, no
 * formatting. Those belong to `server.ts` (which is presentation) or to the
 * engine (which is domain). Keeping this file boring is what makes the seam
 * worth having -- when it starts making decisions, the fake port in the tests
 * stops resembling production and the tests quietly stop meaning anything.
 */
/**
 * `cwd` is a tool argument here, and `docs/agent-surface-plan.md` Stage 2 argues
 * it should instead be session-configured out-of-band, because "every
 * containment check in the engine validates paths WITHIN cwd while validating
 * cwd itself nowhere -- so an agent-supplied project path is a real escape."
 *
 * That reasoning is correct for the surface it was written about, which
 * included `pull`. Writing a payload into an agent-chosen directory is a
 * genuine escape. This surface writes nothing: `cwd` is used only to read the
 * lockfile and to compare install targets against their pristine snapshots, and
 * the tools return `localStatus` and `installTarget` -- never file contents,
 * which come from the remote cache. The residual exposure is an existence
 * oracle over paths the calling agent can almost always already stat itself.
 *
 * So the argument is kept -- an MCP client whose whole job is the project it is
 * open in should not need out-of-band registration to ask what is installed --
 * and the part of the rule that still applies is enforced: `cwd` must be an
 * absolute path to a directory that exists. When `pull` is reconsidered
 * (PLAN.md Stage 3), the session-scope rule applies to it in full.
 */
function assertUsableProjectDir(cwd: string): void {
  if (!path.isAbsolute(cwd)) {
    throw new Error(
      `cwd must be an absolute path to the project directory, got "${cwd}". A relative path `
        + 'would resolve against the MCP server process, which is not the project.',
    );
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(cwd);
  } catch {
    throw new Error(`cwd "${cwd}" does not exist.`);
  }
  if (!stat.isDirectory()) throw new Error(`cwd "${cwd}" is not a directory.`);
}

export function createEngineReadPort(): DeliveryOsReadPort {
  function snapshot(cwd: string, remote: string | undefined): CatalogSnapshot {
    assertUsableProjectDir(cwd);
    const { entries, skipped } = buildCatalogWithSkipped();
    return {
      entries: annotateCatalog(entries, cwd, remote),
      // Filtered to match, so `remote` means the same thing for both halves of
      // the response. Otherwise asking about one remote reports another's
      // broken manifests, which reads as a fault in the remote you asked about.
      skipped: remote ? skipped.filter((s) => s.remoteName === remote) : skipped,
    };
  }

  return {
    listCatalog({ cwd, remote }) {
      return snapshot(cwd, remote);
    },

    async refreshCatalog({ cwd, remote }) {
      // Deliberately discards the freshly-built entries and rebuilds via
      // `snapshot`: `refreshCatalog` returns unannotated `CatalogEntry[]`, and
      // an agent needs `localStatus`/`installTarget` to answer "do I already
      // have this?" -- which is most of why it would ask at all. The rebuild
      // is ~141ms against seconds of network fetch.
      await refreshEngineCatalog();
      return snapshot(cwd, remote);
    },

    readArtifact({ cwd, id, remote, maxDocBytes }) {
      assertUsableProjectDir(cwd);
      const { entries } = buildCatalogWithSkipped();
      // Throws on unknown or ambiguous ids. Both are propagated rather than
      // softened -- see the note on the port.
      const found = resolveArtifact(id, remote, entries);
      // Annotated with `undefined` rather than `remote`: the entry is already
      // resolved to one remote, and passing a filter here could only ever
      // return nothing.
      const [entry] = annotateCatalog([found], cwd, undefined);
      const doc = resolvePrimaryDoc(found.remoteName, found.manifest.id, {
        maxBytes: maxDocBytes,
        catalog: entries,
      });
      return { entry, doc } satisfies ArtifactDetail;
    },
  };
}
