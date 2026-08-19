import { AutoWireResult } from './pullAndAutoWire';

/**
 * Cap on how much of a failed build's raw output gets embedded in the
 * summary -- long enough to show the actual error, short enough that a
 * build that dumps megabytes of webpack/tsc noise doesn't swallow the
 * whole toast/banner this feeds. Prefers the output's own first line
 * (usually the actual error message); falls back to a flat character
 * cap only when that first line is itself blank or absurdly long.
 */
const BUILD_OUTPUT_EXCERPT_CHARS = 200;

function buildOutputExcerpt(output: string | undefined): string {
  const trimmed = (output ?? '').trim();
  if (trimmed.length === 0) {
    return '';
  }
  const firstLine = trimmed.split('\n')[0].trim();
  const candidate = firstLine.length > 0 ? firstLine : trimmed;
  return candidate.length > BUILD_OUTPUT_EXCERPT_CHARS
    ? `${candidate.slice(0, BUILD_OUTPUT_EXCERPT_CHARS)}...`
    : candidate;
}

/**
 * PLAN.md Phase 12, "post-install health narrator": turns the four facts
 * an `AutoWireResult` already carries -- what wiring got applied for real,
 * what still needs a person's own review, whether the target project's
 * build still passes, and which install_params still have no real value --
 * into ONE coherent plain-language summary, replacing the hand-built
 * `parts.join('; ')` toast in app.js that silently never mentioned
 * `missingRequiredParams` at all (the real, confirmed gap this closes).
 *
 * Deliberately NOT an AI/Claude call: every input here is already a fully
 * known fact by the time this runs, not a judgment call -- the opposite
 * situation from `buildFixPrompt` (fixBuildFailure.ts), which hands off to
 * Claude precisely because deciding a fix genuinely requires judgment. A
 * plain deterministic function is the right tool for stating known facts
 * clearly, nothing more.
 */
export function buildPostInstallHealthSummary(result: AutoWireResult): string {
  const { applied, needsReview } = result.wiring;
  const { build } = result;
  const missingParams = result.pullResult.missingRequiredParams;

  const buildFailed = build.ran && build.success === false;
  const buildPassed = build.ran && build.success === true;

  const sentences: string[] = [];

  // Leads the whole summary when true -- a failed build is the single
  // most actionable fact here, so it's never buried behind wiring trivia
  // the way a plain concatenation would leave to chance.
  if (buildFailed) {
    const excerpt = buildOutputExcerpt(build.output);
    // Always ends with its own period, even when an excerpt is embedded --
    // without it, the next sentence below would visibly run straight into
    // the excerpt's own text with nothing separating them.
    sentences.push(`The build failed after this pull${excerpt ? `: ${excerpt}` : ''}.`);
  }

  if (applied.length > 0) {
    sentences.push(
      `Wiring was applied automatically to ${applied.length} file${applied.length === 1 ? '' : 's'}.`,
    );
  }

  if (needsReview.length > 0) {
    sentences.push(
      `${needsReview.length} file${needsReview.length === 1 ? '' : 's'} still `
      + `${needsReview.length === 1 ? 'needs' : 'need'} a manual look before wiring is `
      + `complete: ${needsReview.join(', ')}.`,
    );
  }

  // Only stated when the build didn't already fail above -- a passing
  // build or "nothing to verify" are both fine outcomes to report calmly
  // alongside whatever wiring/params news there is.
  if (!buildFailed) {
    sentences.push(
      buildPassed
        ? 'The build passes.'
        // Common and expected (a non-Node project, or no "build" script) --
        // phrased as a plain fact, never as an error.
        : 'No build command was found, so nothing could be verified automatically.',
    );
  }

  // The confirmed real gap this feature exists to close: named explicitly,
  // by key, regardless of how wiring/build above turned out -- never
  // silently dropped the way the old toast dropped it entirely.
  if (missingParams.length > 0) {
    sentences.push(
      `Before this feature actually works, ${missingParams.length === 1 ? 'a real value is' : 'real values are'} `
      + `still needed for: ${missingParams.join(', ')}.`,
    );
  }

  // Nothing left for a person to do -- say so plainly rather than leaving
  // silence where a confirmation belongs.
  if (needsReview.length === 0 && missingParams.length === 0 && !buildFailed) {
    sentences.push("There's nothing else to do.");
  }

  return sentences.join(' ');
}
