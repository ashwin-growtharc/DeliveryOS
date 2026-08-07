import * as fs from 'fs';
import * as path from 'path';
import { listFilesRecursively } from './listFiles';

const SOURCE_FILE_PATTERN = /\.(ts|tsx|js|jsx|prisma|json)$/;
// Matches `from '...'`/`require('...')` (the common cases) as well as a
// bare side-effect import (`import '...'`, no `from` clause at all --
// real, valid syntax, e.g. `import 'react';` or a stylesheet import).
const IMPORT_PATTERN = /(?:from\s+|require\(\s*|import\s+)["']([^"']+)["']/g;

/** A real package specifier -> the exact stack tag string already used
 * across the real, shipped catalog (verified against `nextauth-credentials`
 * (`nextjs`/`typescript`/`prisma`), `react-analyser` (`react`/`javascript`),
 * `build-error-resolver` (`javascript`/`typescript`)) -- never an invented
 * slug, only ones already in real use. Matched against both `import`
 * specifiers and `package.json` dependency names, so `next/link` and
 * `next/navigation` both still resolve to the bare `next` entry below via
 * a startsWith check. */
const PACKAGE_STACK_TABLE: Array<{ specifier: string; tag: string }> = [
  { specifier: 'next', tag: 'nextjs' },
  { specifier: 'react', tag: 'react' },
  { specifier: '@prisma/client', tag: 'prisma' },
  { specifier: 'express', tag: 'express' },
];

function tagForSpecifier(specifier: string): string | undefined {
  const match = PACKAGE_STACK_TABLE.find(
    (entry) => specifier === entry.specifier || specifier.startsWith(`${entry.specifier}/`),
  );
  return match?.tag;
}

/**
 * Phase 10 item 3 (extended): proposes `stacks` tags for a new artifact by
 * reading its own payload for real, mechanical facts -- an actual `import`/
 * `require` specifier, an actual `package.json` dependency, or an actual
 * `.prisma` schema file present -- never a semantic guess about what the
 * code "is for" (that's `componentTypes`'s job, and it's deliberately left
 * manual precisely because no such reliable signal exists for it).
 *
 * `typescript`/`javascript` are inferred from real file extensions present
 * in the payload (`.ts`/`.tsx` anywhere -> `typescript`; otherwise
 * `.js`/`.jsx` present -> `javascript`) rather than a package dependency,
 * since a project can use TypeScript without ever importing a package
 * literally named "typescript".
 */
export function detectStacks(payloadPath: string): string[] {
  const stat = fs.statSync(payloadPath);
  const files = stat.isFile() ? [payloadPath] : listFilesRecursively(payloadPath, SOURCE_FILE_PATTERN);
  const tags = new Set<string>();

  let hasTsFile = false;
  let hasJsFile = false;

  for (const file of files) {
    if (/\.tsx?$/.test(file)) {
      hasTsFile = true;
    } else if (/\.jsx?$/.test(file)) {
      hasJsFile = true;
    }

    if (path.basename(file) === 'package.json') {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const deps = { ...parsed.dependencies, ...parsed.devDependencies };
        for (const depName of Object.keys(deps ?? {})) {
          const tag = tagForSpecifier(depName);
          if (tag) {
            tags.add(tag);
          }
        }
      } catch {
        // Malformed package.json: skip it, same "one bad file doesn't stop
        // the rest of detection" principle used elsewhere in this codebase.
      }
      continue;
    }

    if (file.endsWith('.prisma')) {
      tags.add('prisma');
    }

    let content: string;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    for (const match of content.matchAll(IMPORT_PATTERN)) {
      const tag = tagForSpecifier(match[1]);
      if (tag) {
        tags.add(tag);
      }
    }
  }

  if (hasTsFile) {
    tags.add('typescript');
  } else if (hasJsFile) {
    tags.add('javascript');
  }

  return Array.from(tags).sort();
}
