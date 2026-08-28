'use client';

/**
 * A staged email-first auth flow: enter an email, then either a password
 * step (mode-aware copy: "Welcome back" for an existing account, "Create
 * your account" for a new one) or a 6-digit emailed-code step -- your own
 * `onResolveEmail`/`onSubmitPassword`/`onSendCode`/`onVerifyCode` props
 * decide what "exists" and "succeeds" actually mean.
 *
 * Genericized from Suna's real `(auth)/auth/page.tsx` (`AuthCardForm`) --
 * every direct Supabase/`@kortix/sdk` call became a typed prop callback (see
 * `EmailAuthFormProps` below), and several genuinely Suna-specific branches
 * were dropped entirely rather than forced through a prop, because they're
 * not generic seams:
 *  - SAML/SSO home-realm discovery (`attemptSsoRedirect`, the 'sso' step) --
 *    a decision only Suna's own Supabase-SAML configuration can make.
 *  - Native mobile session handoff (`mobileCallbackState`, the
 *    `kortix://` deep link) -- specific to Suna's own mobile app.
 *  - The `NEXT_PUBLIC_AUTH_METHODS`/`NEXT_PUBLIC_AUTH_PROVIDERS` env-var
 *    gating -- replaced with plain `magicLinkEnabled`/`passwordEnabled`
 *    props and an `oauthButtons` slot; env vars are a Suna deployment
 *    detail, props are the generic equivalent.
 *  - The toast-on-error side effect (Suna's own `errorToast`) -- dropped in
 *    favor of the already-generic `ErrorStrip`/`InfoStrip` shown inline.
 *
 * What's genuinely generic and was kept: the two-part rise entrance, the
 * step machine itself (entry -> credentials -> code), the resend cooldown,
 * auto-verify-on-sixth-digit, and the "wrong password vs. brand-new email"
 * distinction in the credentials-step copy.
 */

import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import { Button } from './Button';
import { Input } from './Input';
import { PasswordInput } from './PasswordInput';
import { CodeInput, ErrorStrip, FieldLabel, InfoStrip, StepHeader } from './AuthPrimitives';

const RESEND_COOLDOWN_SECONDS = 30;
const EASE = [0.23, 1, 0.32, 1] as const;

export type EmailCredentialsMode = 'signin' | 'signup';
export type EmailAuthResult = { ok: true } | { ok: false; message: string };

export interface EmailAuthFormProps {
  /** Your own logo mark, threaded down to StepHeader. */
  mark?: React.ReactNode;
  /** Show the "email me a code" alternative. Default false. */
  magicLinkEnabled?: boolean;
  /** Show the password flow. Default true. At least one of
   * magicLinkEnabled/passwordEnabled must be true. */
  passwordEnabled?: boolean;
  /** Rendered above the email field on the entry step (your own OAuthButton(s)). */
  oauthButtons?: React.ReactNode;
  /** Resolve whether this email should sign in or register. Only called
   * when passwordEnabled. */
  onResolveEmail?: (email: string) => Promise<{ mode: EmailCredentialsMode }>;
  /** Submit password credentials against your own backend. */
  onSubmitPassword?: (input: {
    email: string;
    password: string;
    mode: EmailCredentialsMode;
  }) => Promise<EmailAuthResult>;
  /** Send a one-time code to the given email. */
  onSendCode?: (email: string) => Promise<EmailAuthResult>;
  /** Verify the 6-digit code. */
  onVerifyCode?: (input: { email: string; code: string }) => Promise<EmailAuthResult>;
  /** Called once the flow has established a real session. */
  onAuthenticated: () => void;
}

type Step = 'entry' | 'credentials' | 'code';

function credentialsCopy(mode: EmailCredentialsMode) {
  return mode === 'signup'
    ? {
        title: 'Create your account',
        passwordPlaceholder: 'Create a password',
        passwordAutoComplete: 'new-password',
      }
    : {
        title: 'Welcome back',
        passwordPlaceholder: 'Your password',
        passwordAutoComplete: 'current-password',
      };
}

export function EmailAuthForm({
  mark,
  magicLinkEnabled = false,
  passwordEnabled = true,
  oauthButtons,
  onResolveEmail,
  onSubmitPassword,
  onSendCode,
  onVerifyCode,
  onAuthenticated,
}: EmailAuthFormProps) {
  const prefersReducedMotion = useReducedMotion();
  const rise = (delay = 0) => ({
    initial: { opacity: 0, y: prefersReducedMotion ? 0 : 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, delay, ease: EASE },
  });

  const [step, setStep] = useState<Step>('entry');
  const [email, setEmail] = useState('');
  const [credMode, setCredMode] = useState<EmailCredentialsMode>('signin');
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const lastTriedCode = useRef('');

  useEffect(() => {
    if (step !== 'code' || resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((v: number) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [step, resendIn]);

  const clearError = () => setErrorMessage(null);

  const sendCode = async () => {
    if (!onSendCode) return;
    clearError();
    setPending(true);
    try {
      const result = await onSendCode(email.trim());
      if (result.ok) {
        setCode('');
        lastTriedCode.current = '';
        setResendIn(RESEND_COOLDOWN_SECONDS);
        setStep('code');
      } else {
        setErrorMessage(result.message);
      }
    } finally {
      setPending(false);
    }
  };

  const handleEntryContinue = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    clearError();
    setPending(true);
    try {
      if (magicLinkEnabled && !passwordEnabled) {
        await sendCode();
        return;
      }
      const resolved = onResolveEmail ? await onResolveEmail(trimmed) : { mode: 'signin' as const };
      setCredMode(resolved.mode);
      setStep('credentials');
    } finally {
      setPending(false);
    }
  };

  const handleCredentialsSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!onSubmitPassword) return;
    clearError();
    setPending(true);
    const formData = new FormData(e.currentTarget);
    const password = String(formData.get('password') || '');
    try {
      const result = await onSubmitPassword({ email: email.trim(), password, mode: credMode });
      if (result.ok) {
        onAuthenticated();
      } else {
        setErrorMessage(result.message);
      }
    } finally {
      setPending(false);
    }
  };

  const verifyCode = async () => {
    if (!onVerifyCode || code.length !== 6) return;
    clearError();
    setVerifying(true);
    try {
      const result = await onVerifyCode({ email: email.trim(), code });
      if (result.ok) {
        onAuthenticated();
      } else {
        setErrorMessage(result.message);
      }
    } finally {
      setVerifying(false);
    }
  };

  useEffect(() => {
    if (step === 'code' && code.length === 6 && !verifying && lastTriedCode.current !== code) {
      lastTriedCode.current = code;
      void verifyCode();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, step, verifying]);

  const goToEntry = () => {
    clearError();
    setCode('');
    setStep('entry');
  };

  if (step === 'code') {
    return (
      <>
        <motion.div {...rise(0)}>
          <StepHeader
            mark={mark}
            title="Check your email"
            description={<>We sent a code to <span className="font-medium text-neutral-900 dark:text-white">{email}</span></>}
          />
        </motion.div>
        <motion.div {...rise(0.06)}>
          {errorMessage && <ErrorStrip message={errorMessage} />}
          <CodeInput value={code} onChange={setCode} disabled={verifying} invalid={!!errorMessage} />
          <div className="mt-6 space-y-2 text-sm text-neutral-500 dark:text-neutral-400">
            {verifying ? (
              <span>Verifying...</span>
            ) : (
              <p>
                Didn't receive a code?{' '}
                {resendIn > 0 ? (
                  <span className="tabular-nums">Resend in {resendIn}</span>
                ) : (
                  <button type="button" onClick={sendCode} disabled={pending} className="text-neutral-900 underline-offset-4 hover:underline disabled:opacity-50 dark:text-white">
                    Resend
                  </button>
                )}
              </p>
            )}
            <p>
              <button type="button" onClick={goToEntry} className="hover:underline">
                Use a different email
              </button>
            </p>
          </div>
        </motion.div>
      </>
    );
  }

  if (step === 'credentials') {
    const copy = credentialsCopy(credMode);
    return (
      <>
        <motion.div {...rise(0)}>
          <StepHeader mark={mark} title={copy.title} />
        </motion.div>
        <motion.div {...rise(0.06)}>
          {errorMessage && <ErrorStrip message={errorMessage} />}
          <form onSubmit={handleCredentialsSubmit} className="space-y-5">
            <div className="space-y-3">
              <FieldLabel htmlFor="email-locked">Email</FieldLabel>
              <div className="relative">
                <Input id="email-locked" value={email} readOnly tabIndex={-1} size="md" className="pr-14 text-neutral-500" />
                <button type="button" onClick={goToEntry} aria-label="Change email" className="absolute inset-y-0 right-0 flex items-center px-3 text-sm font-medium text-neutral-500 transition-colors hover:text-neutral-900 dark:hover:text-white">
                  Edit
                </button>
              </div>
            </div>
            <div className="space-y-3">
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <PasswordInput
                id="password"
                name="password"
                placeholder={copy.passwordPlaceholder}
                autoComplete={copy.passwordAutoComplete}
                autoFocus
                invalid={!!errorMessage}
              />
            </div>
            <Button type="submit" size="lg" disabled={pending} className="w-full">
              Continue
            </Button>
          </form>
          {magicLinkEnabled && (
            <Button type="button" variant="secondary" size="lg" className="mt-3 w-full" onClick={sendCode} disabled={pending}>
              Email me a code instead
            </Button>
          )}
        </motion.div>
      </>
    );
  }

  return (
    <>
      <motion.div {...rise(0)}>
        <StepHeader mark={mark} title="Welcome back" tagline="Sign in to continue" />
      </motion.div>
      <motion.div {...rise(0.06)}>
        {errorMessage && <ErrorStrip message={errorMessage} />}
        {oauthButtons ? <div className="mb-8 space-y-3">{oauthButtons}</div> : null}
        <form onSubmit={handleEntryContinue} className="space-y-5">
          <div className="space-y-3">
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              size="md"
              placeholder="Your email address"
              value={email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                clearError();
                setEmail(e.target.value);
              }}
              required
              autoComplete="email"
              autoFocus
              aria-invalid={!!errorMessage || undefined}
            />
          </div>
          <Button type="submit" size="lg" disabled={pending} className="w-full">
            Continue
          </Button>
        </form>
        <p className="mt-8 text-sm text-neutral-500 dark:text-neutral-400">
          New here? Continue creates your account automatically.
        </p>
      </motion.div>
    </>
  );
}
