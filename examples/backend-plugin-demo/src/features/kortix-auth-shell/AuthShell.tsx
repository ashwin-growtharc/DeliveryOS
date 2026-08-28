'use client';

/**
 * The quiet page frame every auth surface shares: mark, centered column,
 * optional legal footer.
 *
 * Genericized from Suna's real `features/auth/auth-card-shell.tsx`:
 *  - `KortixLogo` became a `mark` prop (your own logo, an icon or <img>).
 *  - The desktop-shell-aware external-link handling (`openExternalRoute`,
 *    only relevant to Suna's own Tauri desktop build) was dropped -- these
 *    are plain links.
 *  - `next-intl`'s `useTranslations` was dropped -- copy is hardcoded
 *    English; wire your own i18n system around these components if you
 *    need it, the same way you'd wire one around any other plain string.
 *  - `next/link` became a plain `<a>` -- swap for your router's Link
 *    component if you have one; this stays framework-agnostic.
 *  - Terms/privacy hrefs and copy are now props (`termsHref`/`privacyHref`),
 *    not hardcoded Suna routes.
 */

import { ChevronLeft } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import type React from 'react';

import { AuthMobileMark } from './AuthPrimitives';

const EASE = [0.23, 1, 0.32, 1] as const;

export type AuthLegalFooterVariant = 'default' | 'signup' | 'continue';

/** Tiny legal line pinned to the bottom of every auth surface. */
export function AuthLegalFooter({
  variant = 'default',
  termsHref = '/terms',
  privacyHref = '/privacy',
}: {
  variant?: AuthLegalFooterVariant;
  termsHref?: string;
  privacyHref?: string;
}) {
  const terms = (
    <a href={termsHref} className="underline-offset-4 transition-colors hover:underline">
      Terms of Service
    </a>
  );
  const privacy = (
    <a href={privacyHref} className="underline-offset-4 transition-colors hover:underline">
      Privacy Policy
    </a>
  );

  return (
    <footer className="mx-auto max-w-[380px] px-6 pb-10 text-center text-sm text-balance text-neutral-400 dark:text-neutral-500">
      {variant === 'continue' ? (
        <>By continuing, you agree to the {terms} and {privacy}</>
      ) : variant === 'signup' ? (
        <>By creating an account, you agree to the {terms} and {privacy}</>
      ) : (
        <>{terms} and {privacy}</>
      )}
    </footer>
  );
}

/** The quiet page frame every auth surface shares: mark, centered column, legal footer. */
export function AuthFrame({
  children,
  mark,
  footerVariant = 'default',
}: {
  children: React.ReactNode;
  /** Your own logo mark -- shown top-left on mobile via AuthMobileMark. */
  mark?: React.ReactNode;
  /** `none` drops the legal line -- reserve it for a frame whose resolved
   * screen isn't an auth surface, so the page doesn't jump when the column
   * above it swaps. */
  footerVariant?: AuthLegalFooterVariant | 'none';
}) {
  return (
    <div className="relative flex min-h-svh flex-col bg-white dark:bg-neutral-950">
      {mark ? <AuthMobileMark mark={mark} /> : null}
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
        <div className="w-full max-w-[380px]">{children}</div>
      </main>
      {footerVariant === 'none' ? null : <AuthLegalFooter variant={footerVariant} />}
    </div>
  );
}

export function AuthCardShell({
  title,
  description,
  mark,
  children,
  footer,
}: {
  title: string;
  description: string;
  mark?: React.ReactNode;
  children: React.ReactNode;
  /** Optional footer below the content (e.g. a "Back to sign in" link). */
  footer?: React.ReactNode;
}) {
  const prefersReducedMotion = useReducedMotion();
  const rise = (delay = 0) => ({
    initial: { opacity: 0, y: prefersReducedMotion ? 0 : 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, delay, ease: EASE },
  });

  return (
    <AuthFrame mark={mark}>
      <motion.div {...rise(0)}>
        <div className="mb-10">
          {mark ? <div className="hidden md:block">{mark}</div> : null}
          <h1 className="text-2xl font-medium tracking-tight text-balance text-neutral-900 md:mt-6 dark:text-white">
            {title}
          </h1>
          <p className="mt-2 text-sm text-pretty text-neutral-500 dark:text-neutral-400">
            {description}
          </p>
        </div>
      </motion.div>

      <motion.div {...rise(0.06)}>
        {children}
        {footer ? <div className="mt-8">{footer}</div> : null}
      </motion.div>
    </AuthFrame>
  );
}

/** Consistent "Back to sign in" link used across auth sub-flows. */
export function BackToSignIn({ href = '/auth', label = 'Back to sign in' }: { href?: string; label?: string }) {
  return (
    <a
      href={href}
      className="-m-2 inline-flex items-center gap-1 rounded-sm p-2 text-sm text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
    >
      <ChevronLeft className="size-4" />
      {label}
    </a>
  );
}
