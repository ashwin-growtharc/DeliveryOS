import { describe, it, expect } from 'vitest';
import { createContributionTokens } from '../../src/mcp/contributionToken';
import type { PushPlan } from '../../src/engine/push/planPush';

/**
 * The consent mechanism, tested for the property it actually has to hold:
 * **one preview authorises exactly one push, and nothing else.**
 *
 * The interesting cases are all failure-shaped. A token that works is easy; a
 * token that stops working at the right moments is the whole point.
 */

function plan(over: Partial<PushPlan> = {}): PushPlan {
  return {
    id: 'risk-register',
    remoteName: 'arcos',
    mode: 'edit',
    installTarget: 'C:/proj/.claude/skills/risk-register',
    changedFiles: [
      { relPath: 'README.md', status: 'modified' },
      { relPath: 'notes.md', status: 'added' },
    ],
    previousVersion: '1.0.0',
    newVersion: '1.0.1',
    stale: false,
    ...over,
  };
}

const CWD = 'C:/proj';

describe('contribution tokens', () => {
  it('accepts the token it minted, for the plan it minted it for', () => {
    const tokens = createContributionTokens();
    const p = plan();
    expect(tokens.consume(tokens.mint(CWD, p), CWD, p)).toBeNull();
  });

  it('refuses a second presentation, even when nothing changed', () => {
    // Single-use is the property; "the diff is still the same" is not a reason
    // to allow a second push.
    const tokens = createContributionTokens();
    const p = plan();
    const token = tokens.mint(CWD, p);
    expect(tokens.consume(token, CWD, p)).toBeNull();
    expect(tokens.consume(token, CWD, p)).toBe('already-used');
  });

  it('refuses once a file has changed since the preview', () => {
    // The reviewer approved THAT diff. This is the case the digest exists for.
    const tokens = createContributionTokens();
    const token = tokens.mint(CWD, plan());
    const afterAnEdit = plan({
      changedFiles: [
        { relPath: 'README.md', status: 'modified' },
        { relPath: 'notes.md', status: 'added' },
        { relPath: 'client-data.md', status: 'added' },
      ],
    });
    expect(tokens.consume(token, CWD, afterAnEdit)).toBe('mismatch');
  });

  it('refuses when the version bump changed', () => {
    const tokens = createContributionTokens();
    const token = tokens.mint(CWD, plan());
    expect(tokens.consume(token, CWD, plan({ newVersion: '1.1.0' }))).toBe('mismatch');
  });

  it('refuses when pointed at a different project', () => {
    // The token binds the directory too, so a token minted for one project
    // cannot authorise publishing from another.
    const tokens = createContributionTokens();
    const token = tokens.mint(CWD, plan());
    expect(tokens.consume(token, 'C:/somewhere-else', plan())).toBe('mismatch');
  });

  it('does not depend on the order files were enumerated in', () => {
    // Otherwise the same working tree could mint two different tokens
    // depending on filesystem iteration order, and a valid token would
    // intermittently fail to verify.
    const tokens = createContributionTokens();
    const forward = plan();
    const reversed = plan({ changedFiles: [...plan().changedFiles].reverse() });
    expect(tokens.mint(CWD, forward)).toBe(tokens.mint(CWD, reversed));
  });

  it('refuses a token minted by a DIFFERENT instance -- the restart case', () => {
    // THE TEST THAT MATTERS, and the one an earlier design would have failed.
    //
    // The token is a derived digest: recomputable from its inputs with no
    // stored grant. So the consumed set is the only thing making it
    // single-use -- and a restart empties that set while the digest still
    // recomputes identically. Without a per-instance nonce this is ACCEPTED,
    // which is fail-OPEN in exactly the scenario the set exists for:
    //
    //   push -> pushBranch succeeds -> pulls.create fails -> orphaned branch,
    //   no pendingPr written -> token consumed -> session restarts ->
    //   same token accepted -> a SECOND orphaned branch.
    //
    // `pendingPr` cannot cover it, because the PR never opened.
    const first = createContributionTokens();
    const second = createContributionTokens();
    const p = plan();

    const tokenFromFirst = first.mint(CWD, p);
    expect(second.consume(tokenFromFirst, CWD, p)).toBe('mismatch');

    // And the first instance still honours its own, so the nonce is
    // discriminating between instances rather than breaking minting outright.
    expect(first.consume(tokenFromFirst, CWD, p)).toBeNull();
  });

  it('never returns the same token from two instances for the same plan', () => {
    // Anti-vacuity for the test above: if the nonce were dropped from the
    // digest, these would be equal and the restart test would be passing for
    // the wrong reason.
    const p = plan();
    expect(createContributionTokens().mint(CWD, p)).not.toBe(
      createContributionTokens().mint(CWD, p),
    );
  });
});
