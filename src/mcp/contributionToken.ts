import { createHash, randomBytes } from 'crypto';
import type { PushPlan } from '../engine/push/planPush';

/**
 * The argument-bound single-use grant that lets a preview authorise exactly one
 * push, and nothing else.
 *
 * `docs/agent-surface-plan.md:701-707` names this mechanism directly: *"For
 * `push` specifically, unbounded consent is the wrong default; the
 * argument-bound single-use grant is the one to copy."* The alternative an MCP
 * client offers is a per-tool-name "always allow" that is unbounded in time --
 * approve one push and you have approved every future push. For an operation
 * that publishes bytes to a shared remote, that is the wrong shape.
 *
 * TWO DIFFERENT THINGS, and conflating them is how this fails open:
 *
 *  - **Authorisation is stateless.** The token is a digest over the exact plan
 *    it was minted for. Verification is recomputation -- no lookup, no stored
 *    grant. A token that does not match the current state of the project is not
 *    a token for this push.
 *  - **Idempotency is stateful**, and has to be: a digest alone cannot tell a
 *    first presentation from a second. That is a small consumed-token set,
 *    scoped to this instance.
 *
 * THE NONCE IS WHY THE SET IS ENOUGH. Without it, the scheme fails OPEN across
 * a restart, in exactly the case the set exists for:
 *
 *   1. preview -> token
 *   2. push: `pushBranch` succeeds, `pulls.create` fails -> a branch is now on
 *      the shared remote and NOTHING deletes it (`push.ts:753` -> `:756`;
 *      `git.ts:76-82` documents the leftover as an expected condition), and no
 *      `pendingPr` is written because that happens only after the PR opens
 *   3. the token is consumed in memory -> a retry is refused
 *   4. the session restarts -- a crash, a reconnect, a new process
 *   5. the same token: the digest still recomputes identically and the consumed
 *      set is empty -> ACCEPTED -> a second orphaned branch
 *
 * `pendingPr` cannot cover step 5, because the PR never opened. Mixing a
 * per-instance nonce into the digest closes it: a new instance invalidates
 * every outstanding token, so verification fails and it genuinely refuses.
 * Restart is not hypothetical; agents retry by default, and a retry that fans
 * out branches across a shared remote is the failure this mechanism is for.
 *
 * A FACTORY RATHER THAN MODULE STATE, for a reason worth keeping. An earlier
 * draft made the nonce and the set module-level and offered a test hook to
 * clear the set. That hook was the fail-open case wearing a test's clothes: it
 * cleared the set while keeping the nonce, which is precisely the state that
 * makes a spent token valid again. With a factory, "a restart" is just a second
 * instance, so the test models the real thing instead of a hole punched in it.
 */
export interface ContributionTokens {
  /** Deterministic within this instance, meaningless outside it. */
  mint(cwd: string, plan: PushPlan): string;

  /** Verifies against the plan as it stands NOW and consumes in the same step,
   * before the caller attempts anything -- so a failed push cannot be retried
   * with the same grant. `null` means good. */
  consume(token: string, cwd: string, plan: PushPlan): TokenRejection | null;
}

export type TokenRejection = 'mismatch' | 'already-used';

export function createContributionTokens(): ContributionTokens {
  const nonce = randomBytes(32).toString('hex');
  const consumed = new Set<string>();

  /**
   * Covers everything a caller could change between previewing and pushing: the
   * project, the artifact, the exact file set and their statuses, and the
   * versions being bumped from and to. Editing a file after previewing changes
   * the digest, so the token stops matching and the push is refused -- which is
   * the point. The reviewer approved *that* diff, not whatever is there now.
   */
  function mint(cwd: string, plan: PushPlan): string {
    const shape = JSON.stringify({
      cwd,
      id: plan.id,
      remoteName: plan.remoteName,
      previousVersion: plan.previousVersion,
      newVersion: plan.newVersion,
      // Sorted, so the token does not depend on filesystem enumeration order --
      // otherwise the same working tree could mint two different tokens.
      files: plan.changedFiles.map((f) => `${f.status}:${f.relPath}`).sort(),
    });
    return createHash('sha256').update(`${nonce} ${shape}`).digest('hex').slice(0, 32);
  }

  return {
    mint,
    consume(token, cwd, plan) {
      if (consumed.has(token)) return 'already-used';
      if (token !== mint(cwd, plan)) return 'mismatch';
      consumed.add(token);
      return null;
    },
  };
}
