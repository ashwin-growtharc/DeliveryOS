import * as fs from 'fs';
import * as path from 'path';
import ignore from 'ignore';
import { InstallParam } from '../manifest/schema';

/** Which of a manifest's declared install_params actually got a real value
 * (from what the caller provided, or the param's own `default`), and which
 * required ones still don't have one. Never a hard failure on its own --
 * see `applyInstallParams`'s own doc comment for why. */
export interface ResolvedInstallParams {
  values: Record<string, string>;
  missingRequired: string[];
}

/**
 * Resolves each declared `install_param` against what the caller actually
 * provided THIS call (`--set KEY=VALUE` from the CLI, or a collected-values
 * object from the app's own required-config checklist), falling back to
 * `existing` (whatever's already sitting in `.env.local` from an earlier
 * pull/configure call -- see `readExistingEnvValues`) and finally the
 * param's own `default`. A value provided THIS call always wins over
 * `existing`, which in turn always wins over `default` -- `default` only
 * exists for non-secret convenience values (the schema's own `.refine()`
 * forbids a `secret` param from declaring one at all), and an already-
 * configured real value is always more authoritative than either a fresh
 * blank-slate default or a previous configure call's value.
 *
 * Without folding `existing` in here, `artifact.applyInstallParams`
 * configuring one missing value later (without a re-pull) would otherwise
 * report every OTHER param as still "missing" too, even ones a previous
 * `artifact.pull`/`applyInstallParams` call already genuinely satisfied --
 * a real bug, not just a cosmetic one, caught by a sidecar e2e test
 * exercising exactly that pull-then-configure-the-rest sequence.
 */
export function resolveInstallParamValues(
  params: InstallParam[],
  provided: Record<string, string>,
  existing: Record<string, string> = {},
): ResolvedInstallParams {
  const values: Record<string, string> = {};
  const missingRequired: string[] = [];

  for (const param of params) {
    const value = provided[param.key] ?? existing[param.key] ?? param.default;
    if (value !== undefined) {
      values[param.key] = value;
    } else if (param.required) {
      missingRequired.push(param.key);
    }
  }

  return { values, missingRequired };
}

/** Parses a `.env`-shaped file's existing content into an ordered list of
 * lines, distinguishing real `KEY=VALUE` lines (which `applyInstallParams`
 * may update in place, and `readExistingEnvValues` reads from) from
 * everything else (comments, blank lines, lines that don't parse as a
 * plain identifier=value) -- preserved verbatim, in their original
 * position, never reordered or dropped. A trailing empty element from
 * splitting a file that ends with a newline (i.e. nothing after the final
 * `\n`) is dropped here, not treated as a real blank line --
 * `applyInstallParams` always re-adds exactly one trailing newline itself,
 * so keeping this one too would leave a stray blank line behind once new
 * keys get appended after it. */
function parseEnvLines(content: string): { key: string | null; value: string | null; line: string }[] {
  const rawLines = content.split(/\r?\n/);
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }
  return rawLines.map((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    return { key: match ? match[1] : null, value: match ? match[2] : null, line };
  });
}

/** Reads whatever real values `<cwd>/.env.local` already has (from an
 * earlier `artifact.pull`/`artifact.applyInstallParams` call) as a plain
 * key->value map -- `{}` if the file doesn't exist yet, which is the
 * common case for a project's very first pull of anything with
 * install_params. Used as `resolveInstallParamValues`'s `existing`
 * fallback, so re-configuring one value later never makes an
 * already-satisfied one look missing again. */
export function readExistingEnvValues(cwd: string): Record<string, string> {
  const envPath = path.join(cwd, '.env.local');
  if (!fs.existsSync(envPath)) {
    return {};
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  const values: Record<string, string> = {};
  for (const { key, value } of parseEnvLines(content)) {
    if (key !== null && value !== null) {
      values[key] = value;
    }
  }
  return values;
}

/**
 * Writes `values` into `filePath`, a plain `.env`-shaped file -- the shared
 * core both `applyInstallParams` (`.env.local`, real secret values) and
 * `applyEnvExamplePlaceholders` (`.env.example`, blank/default placeholders)
 * upsert through, extracted here rather than duplicated so both inherit the
 * exact same idempotency/preservation guarantees for free instead of
 * re-earning them separately.
 *
 * A no-op when `values` is empty -- neither caller creates a file at all for
 * an artifact that declares no `install_params`.
 *
 * Existing content is preserved -- only the given keys are inserted/updated;
 * every other line (including comments and blank lines) survives untouched,
 * in place. Values are written literally, with no shell-style quoting beyond
 * what's already valid `.env` syntax (a caller supplying a value containing
 * a newline or `=` is a real edge case, not attempted here). Always exactly
 * one trailing newline on write, regardless of whether the original file had
 * one, didn't exist yet, or ended mid-line.
 */
export function upsertEnvFile(filePath: string, values: Record<string, string>): void {
  const keys = Object.keys(values);
  if (keys.length === 0) {
    return;
  }

  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  const lines = existing.length > 0 ? parseEnvLines(existing) : [];

  const remaining = new Set(keys);
  const updatedLines = lines.map(({ key, line }) => {
    if (key && remaining.has(key)) {
      remaining.delete(key);
      return `${key}=${values[key]}`;
    }
    return line;
  });

  for (const key of remaining) {
    updatedLines.push(`${key}=${values[key]}`);
  }

  fs.writeFileSync(filePath, `${updatedLines.join('\n')}\n`, 'utf-8');
}

/**
 * Checks whether `<cwd>/.env.local` -- the file `applyInstallParams` is
 * about to write real secret values into -- is actually covered by
 * `<cwd>/.gitignore`. Same library/pattern as `loadIgnoreFilter` in
 * `../push/diff.ts` (read the `.gitignore` if present, build an `ignore()`
 * instance, ask it), but rooted at the PROJECT root's own `.gitignore`
 * against one specific fixed path, not an artifact's `installTarget`
 * against arbitrary payload files -- a different question with the same
 * underlying tool.
 *
 * Returns `undefined` when `.env.local` is safely covered -- the expected
 * case for any reasonably-configured project (most `.gitignore` templates
 * already exclude `.env.local`/`.env*.local`). Returns a plain, actionable
 * warning string otherwise, whether that's because no `.gitignore` exists
 * at `cwd` at all, or one exists but simply doesn't happen to cover this
 * file. Never throws: this is an advisory check, not a hard failure -- a
 * project with no gitignore setup at all still needs to keep working, just
 * warned clearly, since the real secret value has already been written by
 * the time this is called either way.
 */
export function checkEnvLocalGitignoreCoverage(cwd: string): string | undefined {
  const gitignorePath = path.join(cwd, '.gitignore');
  const warning =
    'DeliveryOS just wrote a real secret value into .env.local, but it does not look like '
      + '.gitignore covers that file -- if this project is committed to git, that secret could '
      + 'get pushed to a shared remote. Add ".env.local" (or ".env*.local") to .gitignore.';

  if (!fs.existsSync(gitignorePath)) {
    return warning;
  }

  const ig = ignore().add(fs.readFileSync(gitignorePath, 'utf-8'));
  return ig.ignores('.env.local') ? undefined : warning;
}

/**
 * Writes resolved install-time values into `<cwd>/.env.local` -- a
 * project-ROOT file, deliberately never anything under an artifact's own
 * `install_target`. This is the real reason it lives in its own module
 * rather than inline in `pull.ts`: `pullArtifact`'s pristine-snapshot step
 * (`fs.cpSync(installTarget, pristineTarget, ...)`) runs specifically to
 * capture what a fresh pull looks like, and anything written inside
 * `installTarget` would be swept into that snapshot -- a real secret value
 * baked into a "pristine reference copy" on disk. Writing to the project
 * root instead sidesteps that risk entirely, by construction, not by
 * convention someone has to remember.
 *
 * Never a hard error on missing required values -- resolveInstallParamValues
 * already reports those separately (`missingRequired`) so a caller can
 * still complete the pull and configure the rest later (via the app's own
 * required-config checklist, or a follow-up `--set`), rather than losing an
 * otherwise-successful pull over one missing value.
 */
export interface ApplyInstallParamsResult {
  /** Set only when this call actually wrote a real secret value AND that
   * value doesn't look covered by the project's own .gitignore -- see
   * `checkEnvLocalGitignoreCoverage`. Absent (not just falsy) whenever
   * nothing was written this call, so a caller can `if (result.gitignoreWarning)`
   * without needing to separately track "did we even attempt the check". */
  gitignoreWarning?: string;
}

export function applyInstallParams(
  cwd: string,
  values: Record<string, string>,
): ApplyInstallParamsResult {
  upsertEnvFile(path.join(cwd, '.env.local'), values);

  // Only worth checking when something was actually written THIS call --
  // `upsertEnvFile` itself no-ops entirely (never touches the file) when
  // `values` is empty, which is true for the overwhelming majority of
  // artifacts (no install_params declared at all). Checking unconditionally
  // would mean every plain pull ever gets a pointless gitignore nag even
  // when nothing was written.
  if (Object.keys(values).length === 0) {
    return {};
  }
  return { gitignoreWarning: checkEnvLocalGitignoreCoverage(cwd) };
}

/**
 * Tier 1 of Phase 7's wiring agent (see `WiringActionSchema`'s own doc
 * comment for Tiers 2/3): generates `.env.example` placeholder lines
 * directly from a manifest's `install_params`, with NO separate declared
 * action and no new schema field -- the same three keys redeclared a
 * second time in a `wiring_actions`-shaped entry would just be a real drift
 * risk (the two lists could disagree) for no benefit, since the mapping
 * from an install_param to its placeholder is always the same deterministic
 * rule: `secret` params get a blank placeholder (never their own default,
 * which doesn't exist for a secret param anyway per the schema's own
 * `.refine()`); non-secret params get their declared `default` if any, else
 * blank too.
 *
 * Also project-ROOT, never `install_target` -- same reasoning as
 * `applyInstallParams`, though `.env.example` never holds a real secret
 * value (only placeholders), so the pristine-snapshot risk that motivated
 * that choice doesn't apply here as urgently; kept in the same place anyway
 * for consistency, since both files describe the SAME install_params from
 * the SAME project root.
 */
export function applyEnvExamplePlaceholders(cwd: string, installParams: InstallParam[]): void {
  const placeholders: Record<string, string> = {};
  for (const param of installParams) {
    placeholders[param.key] = param.secret ? '' : (param.default ?? '');
  }
  upsertEnvFile(path.join(cwd, '.env.example'), placeholders);
}
