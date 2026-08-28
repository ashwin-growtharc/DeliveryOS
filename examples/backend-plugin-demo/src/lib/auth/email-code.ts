/**
 * A stateless 6-digit login code: HMAC(secret, email + time-window),
 * truncated to 6 digits. No database, no stored token, no per-user
 * counter -- verifying is just recomputing the same HMAC and comparing.
 * The email itself never needs to be looked up anywhere; the code IS
 * the proof, scoped to a 5-minute window.
 *
 * This is the actual reason this artifact needs no database at all,
 * unlike Auth.js's own built-in Email provider (which requires an
 * adapter to persist a verification token between "email sent" and
 * "link clicked"). Trading a small amount of rigor (no single-use
 * enforcement -- the same code verifies again within its window) for a
 * genuinely simpler, fully explainable mechanism is a deliberate choice
 * for this artifact, not an oversight.
 *
 * Uses the Web Crypto API (`crypto.subtle`, a global -- no import),
 * NOT Node's `crypto` module: this file is reachable from
 * `src/middleware.ts` (via auth.config.ts's Credentials provider), which
 * runs in the Edge Runtime, where Node-only modules like `crypto`'s
 * `createHmac` fail to bundle. Confirmed the hard way -- an earlier
 * version using `createHmac` built fine but Next.js flagged a real
 * "Node.js module... not supported in the Edge Runtime" warning on the
 * exact import chain (email-code.ts -> auth.config.ts -> auth.ts ->
 * middleware.ts). `crypto.subtle` is available as a global in both the
 * Edge Runtime and Node, so this needs no import at all.
 */

const WINDOW_MS = 5 * 60 * 1000;

async function computeCode(email: string, secret: string, windowOffset: number): Promise<string> {
  const window = Math.floor(Date.now() / WINDOW_MS) + windowOffset;
  const data = `${email.trim().toLowerCase()}:${window}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const hex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const num = parseInt(hex.slice(0, 8), 16) % 1_000_000;
  return num.toString().padStart(6, '0');
}

export async function generateLoginCode(email: string, secret: string): Promise<string> {
  return computeCode(email, secret, 0);
}

/** Constant-time string compare -- no Node `timingSafeEqual` available
 * (same Edge-Runtime reason as above), so this is a small manual
 * equivalent: XOR every character and OR the results, so no single
 * mismatching character can return sooner than any other. */
function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Checks the current window AND the previous one -- a grace period so a
 * code doesn't go stale just because email delivery or typing took a
 * few minutes and crossed a window boundary.
 */
export async function verifyLoginCode(email: string, code: string, secret: string): Promise<boolean> {
  const trimmed = code.trim();
  if (trimmed.length !== 6) return false;
  for (const offset of [0, -1]) {
    const expected = await computeCode(email, secret, offset);
    if (timingSafeStringEqual(trimmed, expected)) return true;
  }
  return false;
}
