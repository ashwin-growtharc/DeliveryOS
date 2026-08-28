import { AuthFrame } from './AuthShell';
import { EmailAuthForm } from './EmailAuthForm';
import { OAuthButton } from './OAuthButton';

/** A tiny inline mark so the preview doesn't depend on any real logo asset --
 * swap for your own product mark when you wire this in for real. */
function DemoMark() {
  return (
    <div className="flex size-6 items-center justify-center rounded-md bg-neutral-900 text-xs font-bold text-white dark:bg-white dark:text-neutral-900">
      A
    </div>
  );
}

/** A recognizable four-color "G" so the OAuth button reads as a real
 * provider button in the preview, not an unlabeled placeholder. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-4 shrink-0" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.9 0 7.4 1.5 10.1 4l6.9-6.9C36.5 2.6 30.6 0 24 0 14.9 0 7 5.4 3.2 13.2l8 6.2C13.1 13 18.1 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.6c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7c4.2-3.9 6.7-9.6 6.7-17.4z"
      />
      <path
        fill="#FBBC05"
        d="M11.2 19.4a14.5 14.5 0 000 9.2l-8 6.2a24 24 0 010-21.6z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 12-2.1 16-5.8l-7.3-5.7c-2.1 1.4-4.9 2.3-8.7 2.3-5.9 0-10.9-3.5-12.8-9.4l-8 6.2C7 42.6 14.9 48 24 48z"
      />
    </svg>
  );
}

/** In-memory demo "backend" so the composed flow is really exercised, not
 * just rendered once -- a fixed password unlocks 'demo@example.com', any
 * other address falls through the sign-up + code path. This is stand-in
 * data for the preview only; a real integration wires these five callbacks
 * to a real backend (see the payload README's integration contract). */
const KNOWN_ACCOUNT = 'demo@example.com';
const KNOWN_PASSWORD = 'correct-horse';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const Default = () => (
  <AuthFrame mark={<DemoMark />}>
    <EmailAuthForm
      mark={<DemoMark />}
      passwordEnabled
      oauthButtons={
        <OAuthButton
          provider="Google"
          icon={<GoogleMark />}
          onSignIn={async () => {
            await delay(600);
          }}
        />
      }
      onResolveEmail={async (email) => {
        await delay(400);
        return { mode: email.toLowerCase() === KNOWN_ACCOUNT ? 'signin' : 'signup' };
      }}
      onSubmitPassword={async ({ email, password, mode }) => {
        await delay(500);
        if (mode === 'signin') {
          return password === KNOWN_PASSWORD
            ? { ok: true }
            : { ok: false, message: 'Wrong password. Try again.' };
        }
        return { ok: true };
      }}
      onSendCode={async () => {
        await delay(400);
        return { ok: true };
      }}
      onVerifyCode={async ({ code }) => {
        await delay(400);
        return code === '123456' ? { ok: true } : { ok: false, message: 'Invalid or expired code.' };
      }}
      onAuthenticated={() => {
        // eslint-disable-next-line no-console
        console.log('authenticated');
      }}
    />
  </AuthFrame>
);

/** Magic-link-only variant -- no password step at all, entry goes straight
 * to the code step. */
export const MagicLinkOnly = () => (
  <AuthFrame mark={<DemoMark />}>
    <EmailAuthForm
      mark={<DemoMark />}
      magicLinkEnabled
      passwordEnabled={false}
      onSendCode={async () => {
        await delay(400);
        return { ok: true };
      }}
      onVerifyCode={async ({ code }) => {
        await delay(400);
        return code === '123456' ? { ok: true } : { ok: false, message: 'Invalid or expired code.' };
      }}
      onAuthenticated={() => {
        // eslint-disable-next-line no-console
        console.log('authenticated');
      }}
    />
  </AuthFrame>
);
