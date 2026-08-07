import * as fs from 'fs';
import * as path from 'path';
import { detectInstallParams, DetectedInstallParam } from './detectInstallParams';
import { detectStacks } from './detectStacks';
import { extractLeadingComment } from './extractLeadingComment';
import { listFilesRecursively } from './listFiles';
import { guessDescriptionFromFrontmatter } from '../manifest/frontmatter';
import { parseComponentFile } from '../preview/docgen';

const COMPONENT_FILE_PATTERN = /\.(tsx|jsx)$/;
const MARKDOWN_KINDS = new Set(['agent', 'command', 'rule']);

export interface DetectedArtifactMetadata {
  installParams: DetectedInstallParam[];
  stacks: string[];
  description: string | undefined;
}

/** Real, author-written JSDoc on the first component that has one --
 * mirrors `detectUiComponents.ts`'s own `doc.description` wiring, but run
 * directly against a manually-picked Add New payload rather than a
 * scan-discovered candidate (scan's own materialized candidates already
 * carry this through their own `ScanCandidate.description`). */
function describeUiComponentPayload(payloadPath: string): string | undefined {
  const stat = fs.statSync(payloadPath);
  const files = stat.isFile() ? [payloadPath] : listFilesRecursively(payloadPath, COMPONENT_FILE_PATTERN);

  for (const file of files) {
    if (!COMPONENT_FILE_PATTERN.test(file)) {
      continue;
    }
    let docs;
    try {
      docs = parseComponentFile(file);
    } catch {
      // Not every .tsx/.jsx file in a payload is necessarily a parseable
      // component (helpers, types, tests) -- one unparsable sibling
      // shouldn't stop the search for the real component's own doc.
      continue;
    }
    const withDescription = docs.find((doc) => doc.description.trim().length > 0);
    if (withDescription) {
      return withDescription.description.trim();
    }
  }
  return undefined;
}

function describeMarkdownPayload(payloadPath: string, kind: string): string | undefined {
  const targetFile =
    kind === 'skill' ? path.join(payloadPath, 'SKILL.md') : payloadPath;
  if (!fs.existsSync(targetFile) || !fs.statSync(targetFile).isFile()) {
    return undefined;
  }
  return guessDescriptionFromFrontmatter(fs.readFileSync(targetFile, 'utf-8'));
}

function detectDescription(payloadPath: string, kind: string): string | undefined {
  if (kind === 'ui-component') {
    return describeUiComponentPayload(payloadPath);
  }
  if (kind === 'skill' || MARKDOWN_KINDS.has(kind)) {
    return describeMarkdownPayload(payloadPath, kind);
  }
  return extractLeadingComment(payloadPath);
}

/**
 * Phase 10 item 3 (extended): the single consolidated entry point Add New's
 * payload-pick step calls for every kind, replacing the earlier
 * install_params-only autofill. Every signal here is a real, mechanical
 * fact about the payload's own code -- a JSDoc comment, an import
 * statement, a frontmatter field, an env var reference -- never a
 * semantic guess. `componentTypes`/`roles`/`teams` are deliberately not
 * part of this: there is no equally reliable code signal for "what kind of
 * component is this" or "who owns this," and guessing wrong there silently
 * is worse than leaving it for a person to fill in (see `scan.ts`'s own
 * doc comment for the original version of this same argument).
 */
export function detectArtifactMetadata(payloadPath: string, kind: string): DetectedArtifactMetadata {
  return {
    installParams: detectInstallParams(payloadPath),
    stacks: detectStacks(payloadPath),
    description: detectDescription(payloadPath, kind),
  };
}
