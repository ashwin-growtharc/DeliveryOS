import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * `app.js` may not grow.
 *
 * WHY
 *
 * The desktop frontend is 7,605 lines in one IIFE: vanilla JS, 187 functions,
 * no types. It is linted with the recommended JS rules only -- there is no type
 * information behind it -- and its browser tests stub the sidecar with
 * hand-written fixtures, so a changed result shape passes everything. It is the
 * surface a non-technical person touches and the least protected thing in the
 * repository. PLAN.md's "What's next" item 4 says split it. Until that happens,
 * this stops it getting worse, which is the only thing a test can do here.
 *
 * A CEILING, NOT A TARGET
 *
 * The number is the line count on the day this was written. Lower it whenever
 * a move-out lands -- the second test below insists on it, which is what makes
 * this a ratchet and not a threshold that drifts. Raising it needs a reason in
 * the commit that raises it, and "the feature needed the lines" is not one: put
 * the feature in a new file and have `app.js` call it.
 *
 * WHY LINES AND NOT SOMETHING CLEVERER
 *
 * Function count, complexity scores, bundle size -- all gameable, all need
 * tooling, all invite an argument. A line count is the crudest measure and also
 * the one nobody disputes, and a blunt guard on an untyped file is about as
 * precise as the situation deserves.
 */

const APP_JS = path.join(__dirname, '..', '..', 'src-tauri', 'spike-ui', 'app.js');

/** Line count as `wc -l` reports it: newlines, not segments. */
const CEILING = 7605;

/** How far below the ceiling the file may sit before the ceiling must come
 * down to meet it. Small enough that a real move-out cannot land without
 * lowering the number in the same change. */
const SLACK = 50;

function lineCount(): number {
  const source = fs.readFileSync(APP_JS, 'utf-8');
  const lines = (source.match(/\n/g) ?? []).length;
  expect(lines, 'app.js read as (nearly) empty -- this guard is checking nothing').toBeGreaterThan(1000);
  return lines;
}

describe('the desktop frontend', () => {
  it('app.js does not grow past its ceiling', () => {
    const lines = lineCount();
    expect(
      lines,
      `app.js is ${lines} lines against a ceiling of ${CEILING}. It is frozen: new behaviour `
        + 'goes in a new file that app.js calls, not into app.js. If you have moved something '
        + 'out and this is still failing, something else grew -- find it.',
    ).toBeLessThanOrEqual(CEILING);
  });

  it('the ceiling follows the file down', () => {
    const lines = lineCount();
    expect(
      lines,
      `app.js is ${lines} lines, more than ${SLACK} below the ceiling of ${CEILING}. Good -- now `
        + `lower CEILING to ${lines} in this test so the room you made cannot be spent later.`,
    ).toBeGreaterThan(CEILING - SLACK);
  });
});
