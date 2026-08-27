'use client';

/**
 * A generic "continue with <provider>" button.
 *
 * Genericized from Suna's real `features/auth/google-signin.tsx`:
 *  - Every direct Supabase call (`createClient()`, `supabase.auth.signInWithOAuth`)
 *    is gone -- this component's only job is to show pending state and call
 *    `onSignIn`, which YOU implement against your own backend/provider.
 *  - The desktop-scheme callback URL construction (`authRedirectUrl`, Suna's
 *    own Tauri deep-link handling) is gone entirely -- that's a decision
 *    specific to Suna's own desktop app, not something a generic OAuth
 *    button should know about. If you need a redirect URL, build it inside
 *    your own `onSignIn` implementation.
 *  - The referral-code cookie side effect is gone for the same reason --
 *    Suna-specific product logic, not a generic OAuth concern.
 *  - `next-intl` was dropped -- copy is a plain `label`/`loadingLabel` prop.
 *
 * Integration contract: `onSignIn` should perform the real OAuth call and
 * either resolve (this component leaves the resulting navigation/redirect
 * entirely to you) or throw/reject with an Error whose `message` is safe to
 * show the user -- this component surfaces it via `onError`.
 */

import type React from 'react';
import { useState } from 'react';

import { Button } from './Button';

export interface OAuthButtonProps {
  /** e.g. "Google", "GitHub" -- used in the default label only. */
  provider: string;
  icon: React.ReactNode;
  label?: string;
  loadingLabel?: string;
  /** Perform the real sign-in against your own backend/provider. */
  onSignIn: () => Promise<void> | void;
  /** Called with a safe-to-display message if onSignIn throws/rejects. */
  onError?: (message: string) => void;
}

export function OAuthButton({
  provider,
  icon,
  label,
  loadingLabel,
  onSignIn,
  onError,
}: OAuthButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    setIsLoading(true);
    try {
      await onSignIn();
    } catch (error: any) {
      onError?.(error?.message || `Failed to sign in with ${provider}`);
      setIsLoading(false);
    }
  };

  return (
    <Button onClick={handleClick} disabled={isLoading} variant="secondary" size="lg" className="w-full">
      {isLoading ? (
        <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        icon
      )}
      <span>{isLoading ? (loadingLabel ?? 'Signing in...') : (label ?? `Continue with ${provider}`)}</span>
    </Button>
  );
}
