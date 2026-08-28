'use server';

/**
 * Glue between the generic `EmailAuthForm` UI (src/features/kortix-auth-shell)
 * and the passwordless email-code backend-plugin (src/lib/auth). The form
 * only knows about `onSendCode`/`onVerifyCode` props that return
 * `{ ok: true } | { ok: false; message: string }` -- these two Server
 * Actions are exactly that shape, so they're passed straight through as
 * props from src/app/auth/page.tsx with no extra wrapping needed.
 */

import { AuthError } from 'next-auth';
import { signIn } from '@/auth';
import { generateLoginCode } from '@/lib/auth/email-code';
import { sendCodeEmail } from '@/lib/auth/send-code-email';

export type AuthActionResult = { ok: true } | { ok: false; message: string };

/** Generates a fresh code and emails it. Called from the entry step. */
export async function sendCode(email: string): Promise<AuthActionResult> {
  const trimmed = email.trim();
  if (!trimmed) {
    return { ok: false, message: 'Enter your email address.' };
  }

  const secret = process.env.AUTH_SECRET;
  const apiKey = process.env.RESEND_API_KEY;
  if (!secret || !apiKey) {
    return { ok: false, message: 'Sign-in is not configured on the server yet.' };
  }

  const code = await generateLoginCode(trimmed, secret);
  const result = await sendCodeEmail(trimmed, code, apiKey);
  if (!result.ok) {
    return { ok: false, message: result.message ?? 'Could not send the code. Please try again.' };
  }
  return { ok: true };
}

/**
 * Verifies the 6-digit code against the Credentials provider in
 * src/lib/auth/auth.config.ts, which re-derives the same HMAC code and
 * compares. On success, `signIn` sets the real session cookie; on
 * failure it throws an `AuthError` (a `CredentialsSignin` instance)
 * instead of returning a falsy value, since `redirect: false` still runs
 * the full Auth.js callback flow -- see auth.config.ts's `authorize`.
 */
export async function verifyCode({
  email,
  code,
}: {
  email: string;
  code: string;
}): Promise<AuthActionResult> {
  try {
    await signIn('credentials', { email: email.trim(), code, redirect: false });
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, message: 'That code is incorrect or has expired.' };
    }
    throw error;
  }
}
