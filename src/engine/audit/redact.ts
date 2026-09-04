/**
 * Redaction for the three append-only audit logs under `.deliveryos/`
 * (`wiring-merge-log.jsonl`, `build-fix-log.jsonl`, `design-fix-log.jsonl`).
 *
 * WHY THIS EXISTS. Each of those logs stores the FULL text of a real project
 * file, twice -- `before` (what was on disk) and `after` (what the model
 * proposed). That is genuinely the right payload for the Activity tab's diff
 * disclosure, but it means the single most sensitive file in a Next.js
 * project, `auth.ts`, gets copied verbatim into a plaintext JSONL the moment
 * a `wiring_action` merge touches it. Nothing gitignores `.deliveryos/`, so
 * a project that commits its working tree commits its own credentials --
 * one `git add -A` away, with no warning anywhere in the flow. Redacting at
 * the write is the only place that closes this for good: the logs are
 * append-only and never rewritten, so anything that lands in them is
 * permanent.
 *
 * THIS IS A PORT, NOT ORIGINAL CODE. Source:
 * `agent-native/packages/core/src/audit/redact.ts` (195 lines, zero
 * imports). Only the text-summary half is carried over -- `SENSITIVE_KEY`,
 * `REDACTED`, `MAX_STRING`, `MARKER_SLACK`, `looksSecret`,
 * `redactEmbeddedSecrets`, `redactTextToSummary`. The structural half
 * (`redact`, `redactArgsToJson`, `redactArgsToValue`, `RedactLimits`,
 * `redactString`, `__test`, and the `MAX_DEPTH`/`MAX_KEYS`/`MAX_ARRAY`/
 * `MAX_JSON` bounds only those use) is deliberately NOT ported: it exists
 * to bound arbitrary nested tool-call arguments, and nothing here logs
 * anything but flat strings. Porting it would have meant carrying dead code
 * that a future reader would reasonably assume was load-bearing.
 *
 * FOUR DELIBERATE DEVIATIONS FROM THE SOURCE, all in
 * `redactEmbeddedSecrets`. Deviations 3 and 4 were added after the first two,
 * when running the manual smoke-test runbook and an independent review of this
 * file turned up cases the port still leaked:
 *
 *  1. Added `(?!process\.env\.)` and `(?!import\.meta\.env\.)` lookaheads
 *     beside the source's existing `(?!bearer\b)`. Without them, the single
 *     most common line in the file this flow touches most often --
 *     `secret: process.env.AUTH_SECRET` in a NextAuth config -- redacts to
 *     `secret: [redacted]`, and the Activity diff goes blank at exactly the
 *     line a person opened it to read. An env *reference* is a variable
 *     name, not a credential; the credential lives in `.env`, which this
 *     never reads. A hardcoded literal on the same key
 *     (`secret: "hunter2"`) is unaffected and still redacts -- verified
 *     directly, not assumed, and pinned by
 *     `test/unit/redact.test.ts`.
 *
 *  2. Widened the key's leading word boundary from `\b` to `(?:\b|_)`.
 *     The source's `\b` cannot match a key like `AUTH_SECRET`, because
 *     `_` is a word character and so there is no boundary between `AUTH_`
 *     and `SECRET` -- meaning `const AUTH_SECRET = "hunter2";`, the exact
 *     literal this whole file exists to stop leaking, sailed through the
 *     ported redactor untouched. This was found by running the ported
 *     regex against real `auth.ts` shapes rather than by reading it. The
 *     `\b` AFTER the key is kept as-is, which is what stops the obvious
 *     false positives: `max_tokens = 100` and `user_token_count = 5` are
 *     both left alone, since `token` there is followed by another word
 *     character. Fixing this upstream instead of here would leave
 *     DeliveryOS leaking until that landed.
 *
  *  3. Added a pass for connection strings that carry their own password
 *     (`postgres://user:pw@host/db`), keyed on the VALUE's shape rather than
 *     the field name. `SENSITIVE_KEY` knows `webhook_url` but not a plain
 *     `url`, so `DATABASE_URL=postgres://user:pw@host/db` was untouched.
 *     Adding a bare `url` to that list instead would be worse: `AUTH_URL`,
 *     `API_URL` and `NEXT_PUBLIC_APP_URL` are ordinary non-secret config
 *     (`AUTH_URL` is a real install_param in this repo's own fixtures). Only
 *     the password is replaced -- scheme, host and path stay readable,
 *     because which database was configured is what an audit log is for.
 *     Its regex is anchored on `://` with a bounded lookbehind rather than
 *     the obvious `[a-z0-9+.-]*://`, which is quadratic: measured at 7.1 s
 *     for 128 KB and 11.5 minutes for 1 MB of one unbroken run of those
 *     characters. That matters because this function is the NON-truncating
 *     entry point -- `buildError`/`rebuildOutput` reach it at up to 10 MB.
 *
 *  4. Added a separate CASE-SENSITIVE pass for camelCase field names.
 *     Deviation 2 fixed SCREAMING_SNAKE but does nothing for a case
 *     transition, and camelCase is the dominant convention in exactly the
 *     TypeScript files this exists to protect -- `const jwtSecret =
 *     "hunter2"` leaked verbatim. It cannot be another alternative in the
 *     boundary group, because the main pattern carries the `i` flag, under
 *     which a `(?<=[a-z0-9])` lookbehind also matches after an uppercase
 *     letter and would redact `notasecret`. Its suffix list is deliberately
 *     narrower than SENSITIVE_KEY: bare `Key` is excluded, since `cacheKey`,
 *     `rowKey` and `sortKey` are ordinary identifiers.
 *
 * KNOWN LIMIT, stated rather than discovered later: this is a heuristic, not a
 * parser. It matches `<sensitive-key><:|=><value>`, `bearer <token>` and
 * credential-bearing URLs. A secret that reaches a log in any other shape --
 * assigned through an intermediate variable, say -- still passes. It reduces
 * exposure; it does not eliminate it, and it does NOT make `.deliveryos/` safe
 * to commit, since the logs still hold full file bodies.
 *
 * Everything else is byte-for-byte the source's behaviour. If the upstream
 * file changes, diff against it rather than re-deriving.
 */

const SENSITIVE_KEY =
  /(?:pass(?:word|phrase)?|secret|token|api[_-]?key|apikey|authorization|bearer|credential|cookie|session[_-]?(?:id|token)|private[_-]?key|client[_-]?secret|signing[_-]?secret|access[_-]?key|refresh[_-]?token|webhook[_-]?(?:url|secret))/i;

const REDACTED = '[redacted]';
const MAX_STRING = 2000;

/**
 * Head room reserved for the `…(N more chars)` marker so a truncated summary
 * still fits its caller's cap. Callers below this cannot carry a marker at all.
 */
const MARKER_SLACK = 32;

/**
 * The cap the audit logs pass for `before`/`after`. Deliberately set to the
 * SAME 8000 chars that `requestWiringMerge`/`requestBuildFix`/
 * `requestAntiPatternFix` already refuse to exceed (their own
 * `MAX_FILE_CHARS`): a file too big to be logged in full is a file this
 * flow already refused to touch, so in practice a real entry is never
 * truncated and the Activity diff never silently loses its tail. The cap is
 * kept anyway as a backstop -- `applyWiringMerge` re-reads the file at apply
 * time and does NOT re-check the size, so a file that grew between the
 * request and the apply can still arrive here oversized.
 */
export const MAX_LOG_FIELD_CHARS = 8000;

/** Heuristic: does a bare string value look like a secret? */
function looksSecret(value: string): boolean {
  if (/^bearer\s+\S/i.test(value)) return true;
  // Long, unbroken, high-entropy-ish opaque token (hex/base64url, no spaces).
  if (value.length >= 32 && /^[A-Za-z0-9_\-+/=.]+$/.test(value)) return true;
  // Common secret prefixes (Stripe, GitHub, OpenAI, Slack, AWS, …).
  if (/^(sk|pk|rk|ghp|gho|xox[baprs]|AKIA|AIza|ya29)[-_]/i.test(value)) {
    return true;
  }
  // Webhook URLs carry their secret in the path — redact regardless of the key
  // they arrive under (e.g. a generic `value` field holding a Slack webhook).
  if (
    /^https?:\/\/(hooks\.slack\.com\/|[^/]*\.webhook\.office\.com\/|(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\/|hooks\.zapier\.com\/|maker\.ifttt\.com\/|discord\.com\/api\/webhooks\/)/i.test(
      value,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Replaces credential-looking VALUES inside an otherwise ordinary block of
 * text, leaving the surrounding text intact. This is the non-truncating
 * half: callers that must not change a field's length (a build error shown
 * verbatim in the Activity panel) use this directly rather than
 * `redactTextToSummary`.
 *
 * See this file's header for the two documented deviations from the
 * upstream version of this regex.
 */
export function redactEmbeddedSecrets(value: string): string {
  const bearer = value.replace(/\b(bearer\s+)([^\s"',}]+)/gi, `$1${REDACTED}`);
  // A connection string carrying its own password: postgres://user:pw@host/db,
  // mongodb+srv://..., redis://..., amqp://... Deviation 3 from the ported
  // source, and it is keyed on the VALUE's shape rather than on the field name
  // for a specific reason: SENSITIVE_KEY knows `webhook_url` but not a plain
  // `url`, so DATABASE_URL=postgres://user:pw@host/db passed through
  // completely untouched. Adding a bare `url` to that list instead would be
  // far worse -- AUTH_URL, API_URL and NEXT_PUBLIC_APP_URL are ordinary
  // non-secret config (AUTH_URL is a real install_param in this repo's own
  // fixtures), and blanking them would gut the Activity diff for no gain.
  // Only the credentials are replaced; the scheme, host and path stay
  // readable, because knowing WHICH database was configured is exactly the
  // sort of thing an audit log exists to record.
  const credentialUrl = bearer.replace(
    // Anchored on `://` rather than on the scheme, and the scheme is matched
    // BACKWARDS from there with a bounded, non-backtracking lookbehind.
    //
    // The obvious spelling -- /\b([a-z][a-z0-9+.-]*:\/\/)...` -- is quadratic:
    // `[a-z0-9+.-]*` is unanchored and must be followed by `://`, so every
    // position inside a long run of those characters consumes the whole run,
    // fails, and gives back one character at a time. Measured on this engine:
    // 8 KB took 25 ms, 32 KB took 375 ms, 128 KB took 7.1 s. That mattered
    // because `redactEmbeddedSecrets` is deliberately the NON-truncating entry
    // point -- `buildError` and `rebuildOutput` reach it at up to
    // POST_INSTALL_MAX_BUFFER_BYTES (10 MB), and a build failure echoing a long
    // run of chained semvers is an ordinary way to produce one.
    //
    // The username may be EMPTY -- `redis://:password@host` is a real and
    // common form -- so `*` not `+` on that group.
    /(?<=^|[^A-Za-z0-9+.-])([a-z][a-z0-9+.-]{0,31}:\/\/)([^\s:/@"']*):([^\s@"']+)@/gi,
    `$1$2:${REDACTED}@`,
  );
  // Deviation 4: camelCase field names.
  //
  // Deviation 2 widened the leading `\b` to `(?:\b|_)`, which fixed
  // SCREAMING_SNAKE (`AUTH_SECRET`) but does nothing for a case transition --
  // and camelCase is the dominant convention in exactly the TypeScript files
  // this module exists to protect. `const jwtSecret = "hunter2"` in an auth.ts
  // touched by a wiring merge leaked verbatim. (`clientSecret` happened to
  // work, but only by coincidence: `client[_-]?secret` is a whole alternative
  // in SENSITIVE_KEY, so it spans the boundary on its own.)
  //
  // A separate, CASE-SENSITIVE pass rather than another alternative in the
  // boundary group: the main pattern carries the `i` flag, under which a
  // `(?<=[a-z0-9])` lookbehind also matches after an uppercase letter, so it
  // would fire in the middle of any word and redact `notasecret`.
  //
  // The suffix list is deliberately narrower than SENSITIVE_KEY. Bare `Key` is
  // excluded because `cacheKey`, `rowKey`, `sortKey` and `objectKey` are all
  // ordinary non-secret identifiers; only the qualified forms are listed.
  const camelCredentialField = credentialUrl.replace(
    /(?<=[a-z0-9])(Secret|Passphrase|Password|Token|Credential|ApiKey|PrivateKey|AccessKey|SecretKey|SigningKey)(["']?\s*[:=]\s*)(["']?)(?!bearer\b)(?!process\.env\.)(?!import\.meta\.env\.)([^"'\s,}]+)\3/g,
    `$1$2$3${REDACTED}$3`,
  );
  const credentialField = new RegExp(
    `(["']?(?:\\b|_)${SENSITIVE_KEY.source}\\b["']?\\s*[:=]\\s*)(["']?)`
    + `(?!bearer\\b)(?!process\\.env\\.)(?!import\\.meta\\.env\\.)([^"'\\s,}]+)\\2`,
    'gi',
  );
  return camelCredentialField.replace(credentialField, `$1$2${REDACTED}$2`);
}

/**
 * Bounded, redacted plain-text summary of a captured file body or tool
 * result. Oversized text keeps its head and gains an explicit
 * `…(N more chars)` marker, so a reader can always tell a short result from
 * a clipped one -- silently clipping would make the Activity diff quietly
 * lie about what was on disk.
 *
 * Returns `null` for empty input, which is the upstream contract. Callers
 * writing a typed `string` log field must coalesce (`?? ''`): a `before` of
 * `''` is the completely ordinary "this wiring action created the file"
 * case, not an absent value.
 */
export function redactTextToSummary(
  text: string,
  maxChars = MAX_STRING,
): string | null {
  if (!text) return null;
  // Only ever walk a bounded head: a multi-megabyte tool result must not be
  // scanned in full just to produce a preview of it.
  const head = text.slice(0, maxChars + MARKER_SLACK);
  const redactedHead = redactEmbeddedSecrets(head);
  if (looksSecret(redactedHead.trim())) return REDACTED;
  if (text.length <= maxChars && redactedHead.length <= maxChars) {
    return redactedHead;
  }
  const keep = Math.max(0, maxChars - MARKER_SLACK);
  return `${redactedHead.slice(0, keep)}…(${text.length - keep} more chars)`;
}
