# kortix-auth-shell

A generic, staged email-first auth flow -- entry (email) -> password or
emailed-code -> authenticated -- extracted from Suna's real `/auth` page
and `features/auth/` folder, with every Supabase call replaced by a typed
prop callback you implement against your own backend.

This is a `kind: ui-feature` artifact: several files that only make sense
together, pulled as one unit into `src/features/kortix-auth-shell/` (see
`manifest.yaml`), not a single dropdown component.

## What this includes

- **`AuthShell.tsx`** -- `AuthFrame` (page frame: mark, centered column,
  legal footer), `AuthCardShell` (a titled card variant), `AuthLegalFooter`,
  `BackToSignIn`.
- **`AuthPrimitives.tsx`** -- `StepHeader`, `FieldLabel`, `ErrorStrip`/
  `InfoStrip`/`SuccessStrip`, the six-box `CodeInput`, the `Rise` entrance
  animation, `AuthMobileMark`.
- **`PasswordInput.tsx`** -- a password field with a show/hide toggle.
- **`OAuthButton.tsx`** -- a generic "continue with &lt;provider&gt;"
  button; you supply the icon, label, and the real sign-in call.
- **`EmailAuthForm.tsx`** -- the composed flow itself: email entry, a
  mode-aware password step ("Welcome back" vs. "Create your account"),
  and an emailed 6-digit code step with auto-verify-on-sixth-digit and a
  30s resend cooldown.
- **`CodeInputLogic.ts`** -- the pure digit-editing model behind
  `CodeInput` (type / type-over / paste / autofill / backspace), unit-
  testable on its own.
- **`Button.tsx`/`Input.tsx`** -- minimal, generic stand-ins so this
  renders standalone. Swap for your own design system's equivalents; they
  carry no auth-specific behavior.

## What this deliberately does NOT include, and why

Extracted from Suna's real, much larger auth surface (`(auth)/auth/**`,
`features/auth/**`) -- these were left out because they're inseparable
from Suna's own product/backend decisions, not because they were missed:

- **SAML/SSO home-realm discovery** (probing a work email's domain for a
  registered SAML provider, the SSO interstitial step) -- only meaningful
  against Suna's own Supabase SAML configuration.
- **Native mobile session handoff** (`mobileCallbackState`, the
  `kortix://` deep link) -- specific to Suna's own mobile app.
- **CLI/Slack/Teams/tunnel-authorize consent screens** and **GitHub
  connect/setup** -- separate features sharing Suna's auth directory by
  convention, not part of the core email flow.
- **Phone verification / MFA step-up** -- a separate feature slice in its
  own right.
- Suna's own design tokens (`text-muted-foreground`, `border-border`, the
  Kortix brand colors) -- these are CSS custom properties defined in
  Suna's own `globals.css` and don't exist for an installing project.
  Replaced with plain Tailwind classes; swap in your own tokens.
- `next-intl` -- copy is hardcoded English. Wire your own i18n around
  these components the same way you would around any other plain string.

## Integration contract

`EmailAuthForm` takes five callbacks. None of them are wired to a real
backend -- that's the point: implement each against whatever auth
provider your project actually uses.

| Prop | Called when | Must resolve to |
|---|---|---|
| `onResolveEmail(email)` | Entry step's Continue, only if `passwordEnabled` | `{ mode: 'signin' \| 'signup' }` -- whether this address has an account |
| `onSubmitPassword({ email, password, mode })` | Credentials step submit | `{ ok: true }` or `{ ok: false, message }` -- `message` is shown to the user as-is |
| `onSendCode(email)` | Entry step (magic-link-only mode) or "Email me a code instead" | `{ ok: true }` or `{ ok: false, message }` |
| `onVerifyCode({ email, code })` | Auto-fires the moment the 6th digit lands | `{ ok: true }` or `{ ok: false, message }` |
| `onAuthenticated()` | Any of the above resolves `{ ok: true }` | Establish your own session / redirect. This component does no navigation itself. |

`OAuthButton.onSignIn()` is the same shape: perform the real OAuth call,
resolve on success (navigation/redirect is entirely up to you), or
throw/reject with an `Error` whose `message` is safe to show the user.

See `preview.tsx` for a full worked example (`Default`) wiring all five
callbacks against an in-memory demo "backend", and `MagicLinkOnly` for the
password-free variant.

## Assumed shared dependencies

None beyond what's in this payload -- `Button.tsx`/`Input.tsx` are
deliberately included as minimal stand-ins rather than assumed, since a
"just use your own Button" note with nothing to fall back on would leave
the artifact unable to render standalone. Swap them for your real design
system once you've pulled this in.
