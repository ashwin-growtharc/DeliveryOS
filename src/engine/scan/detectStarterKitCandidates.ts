import * as fs from 'fs';
import * as path from 'path';
import { ScanCandidate } from './types';

// Directory names that never contain a real, standalone project worth
// flagging -- build output, dependency trees, VCS internals. Dot-directories
// are excluded unconditionally below (matches `.git`, `.next`, `.turbo`,
// `.output`, `.vercel`, `.cache`, `.svelte-kit`, `.nuxt`, ... for free,
// without having to name every framework's own build-output convention).
const EXCLUDED_DIR_NAMES = new Set(['node_modules', 'dist', 'build', 'coverage']);

// Real dependency name -> a human-readable framework label for the
// candidate's description. Deliberately a short, explicit allow-list
// (same "start small, extend reactively" posture as compile.ts's own
// VENDORED_LIBRARY_NAMES) -- a project using something not on this list
// still gets detected (routing evidence + a build script is what actually
// gates candidacy, this is only for a nicer description), just with a
// more generic "Real, buildable project" label instead of naming the
// framework.
const FRAMEWORK_DEPENDENCY_HINTS: Record<string, string> = {
  next: 'Next.js',
  vite: 'Vite',
  '@remix-run/react': 'Remix',
  'react-scripts': 'Create React App',
  vue: 'Vue',
  '@angular/core': 'Angular',
  svelte: 'Svelte',
  '@sveltejs/kit': 'SvelteKit',
};

interface RoutingEvidence {
  summary: string;
}

interface DirectoryEvaluation {
  description: string;
  warnings: string[];
}

/**
 * Walks `cwd` (and, for a monorepo, its real sub-packages) looking for a
 * real, standalone, buildable project worth proposing as a `kind: template`
 * artifact -- see the `starter-kit-extractor` skill (`.claude/skills/
 * starter-kit-extractor/SKILL.md`) for the actual (still human/AI-judgment-
 * driven) extraction process this only FLAGS candidates for; this detector
 * doesn't attempt any of that judgment itself, the same "cast a wide net
 * structurally, filter semantically" posture `detectUiComponentCandidates`
 * already established for single components (design doc §6) -- Review is
 * still required before anything is proposed, so a false positive here is
 * harmless, just unhelpful.
 *
 * Candidacy requires BOTH a real `package.json` with a `build` script
 * (evidence this is meant to be built for production, not just a bare
 * library/dev sandbox) AND real routing evidence (a `src/routes.*` file, or
 * a `src/pages/`/`src/app/`/`pages/` directory with 2+ real files) --
 * deliberately stricter than "any buildable package," which would flag
 * every internal library package in a real monorepo. `detectUiComponentCandidates`
 * tolerates broad false positives because a single mis-flagged component
 * costs a reviewer one glance; a whole mis-flagged project is a much
 * bigger thing to review, so this detector trades some recall for real
 * precision instead.
 *
 * Always an IN-PLACE candidate (`payloadPath` is the real directory, never
 * copied/staged) -- unlike `detectUiComponentCandidates`'s flat-convention
 * case, a whole project is inherently already self-contained; there's no
 * equivalent "no dedicated folder to give it" case to handle.
 *
 * Once a real candidate directory is found, this does NOT keep descending
 * into it looking for nested sub-projects (a `docs-site/`/`examples/`
 * subfolder with its own tiny `package.json` shouldn't also get flagged as
 * a SEPARATE candidate of the project that already contains it).
 */
export function detectStarterKitCandidates(cwd: string, isNew: (id: string) => boolean): ScanCandidate[] {
  const candidates: ScanCandidate[] = [];
  walkForCandidates(cwd, cwd, candidates, isNew);
  return candidates;
}

function walkForCandidates(
  dir: string,
  cwd: string,
  candidates: ScanCandidate[],
  isNew: (id: string) => boolean,
): void {
  const evaluated = evaluateDirectory(dir);
  if (evaluated) {
    const id = slugify(path.basename(dir));
    if (isNew(id)) {
      const installTarget = dir === cwd ? '.' : path.relative(cwd, dir).split(path.sep).join('/');
      candidates.push({
        id,
        kind: 'template',
        payloadPath: dir,
        installTarget,
        description: evaluated.description,
        warnings: evaluated.warnings.length > 0 ? evaluated.warnings : undefined,
      });
    }
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Unreadable directory (permissions, a broken symlink) -- skip, don't fail the whole scan.
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || EXCLUDED_DIR_NAMES.has(entry.name.toLowerCase())) {
      continue;
    }
    walkForCandidates(path.join(dir, entry.name), cwd, candidates, isNew);
  }
}

function evaluateDirectory(dir: string): DirectoryEvaluation | null {
  const packageJsonPath = path.join(dir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  let packageJson: {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  } catch {
    return null; // Malformed package.json isn't a scan error, just "not a candidate."
  }

  if (typeof packageJson.scripts?.build !== 'string') {
    return null;
  }

  const routing = findRoutingEvidence(dir);
  if (!routing) {
    return null;
  }

  const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const framework = Object.entries(FRAMEWORK_DEPENDENCY_HINTS).find(([dep]) => dep in allDeps)?.[1];
  const description = `${framework ? `${framework} project` : 'Real, buildable project'} with real routing (${routing.summary})`;

  const warnings: string[] = [];
  if (!fs.existsSync(path.join(dir, 'README.md'))) {
    warnings.push(
      'No README.md found in this project -- worth writing one describing what the template includes ' +
        '(and any required environment variables) before proposing it.',
    );
  }

  return { description, warnings };
}

const ROUTES_FILENAMES = ['routes.tsx', 'routes.ts', 'routes.jsx', 'routes.js'];
const PAGES_DIR_NAMES = ['pages', 'app'];
const MIN_PAGES_FILE_COUNT = 2;

/** Looks for real evidence this project has actual pages/routes, not just
 * a bare library entry point -- a dedicated routes file (this repo's own
 * `src/routes.tsx` convention, see `parseRoutesTree.ts`), or a real
 * `pages`/`app` directory (checked both directly under the project root and
 * under `src/`, covering both Next.js's classic and `src/`-rooted layouts)
 * with at least a couple of real files in it -- a single-file `pages/`
 * directory is more likely a stray fixture than real page structure. */
function findRoutingEvidence(dir: string): RoutingEvidence | null {
  for (const routesFile of ROUTES_FILENAMES) {
    const candidate = path.join(dir, 'src', routesFile);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return { summary: `src/${routesFile}` };
    }
  }

  for (const pagesDirName of PAGES_DIR_NAMES) {
    for (const base of [path.join(dir, 'src', pagesDirName), path.join(dir, pagesDirName)]) {
      if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
        continue;
      }
      const fileCount = countRealFiles(base);
      if (fileCount >= MIN_PAGES_FILE_COUNT) {
        const relBase = path.relative(dir, base).split(path.sep).join('/');
        return { summary: `${relBase}/ (${fileCount} files)` };
      }
    }
  }

  return null;
}

function countRealFiles(dir: string): number {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    if (entry.isFile()) {
      count += 1;
    } else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name.toLowerCase() !== 'node_modules') {
      count += countRealFiles(path.join(dir, entry.name));
    }
  }
  return count;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
