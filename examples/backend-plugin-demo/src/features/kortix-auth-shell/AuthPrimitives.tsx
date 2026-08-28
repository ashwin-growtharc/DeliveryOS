'use client';

/**
 * Shared building blocks for a quiet, flat auth dialect: a mark slot above a
 * left-aligned heading, slim notice strips, a six-box code input, and a
 * two-part rise entrance.
 *
 * Genericized from Suna's real `features/auth/auth-primitives.tsx`:
 *  - `motion/react` -> `framer-motion` (same API, this is the package
 *    DeliveryOS's preview compiler vendors -- see VENDORED_LIBRARY_NAMES
 *    in compile.ts).
 *  - `@phosphor-icons/react` -> `lucide-react` (also vendored; the source's
 *    icon choice isn't part of what's generic about this component).
 *  - The Kortix mark (`KortixLogo`) became a `mark` prop -- every consuming
 *    project has its own logo, not Kortix's.
 *  - Suna's own theme tokens (`text-muted-foreground`, `border-border`, ...)
 *    became plain Tailwind classes -- those tokens are defined in Suna's own
 *    globals.css and don't exist for an installing project. Swap these
 *    classes for your own design tokens once you have them.
 */

import { AlertTriangle, Info } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useRef } from 'react';
import type React from 'react';

import { applyBackspace, applyBoxInput, CODE_LENGTH, insertDigits } from './CodeInputLogic';

export const AUTH_EASE = [0.23, 1, 0.32, 1] as const;

/** Gentle entrance: header first, body ~60ms behind. Opacity-only under reduced motion. */
export function Rise({
  delay = 0,
  className,
  children,
}: {
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: AUTH_EASE }}
    >
      {children}
    </motion.div>
  );
}

/**
 * The mark on mobile, pinned to the top-left of the viewport instead of
 * riding above the heading -- the parent surface must be `relative`.
 * `mark` is your own logo mark (an icon, an <img>, whatever you use
 * elsewhere) -- this component only owns the positioning.
 */
export function AuthMobileMark({ mark }: { mark: React.ReactNode }) {
  return <div className="absolute top-6 left-6 z-10 md:hidden">{mark}</div>;
}

export function StepHeader({
  title,
  mark,
  tagline,
  description,
}: {
  title: string;
  /** Your own logo mark, shown above the title on desktop only (mobile uses AuthMobileMark). */
  mark?: React.ReactNode;
  /** Second line in the same size as the title, dimmed (entry step only). */
  tagline?: string;
  description?: React.ReactNode;
}) {
  return (
    <div className="mb-10">
      {mark ? <div className="hidden md:block">{mark}</div> : null}
      <h1 className="text-2xl font-medium tracking-tight text-neutral-900 md:mt-6 dark:text-white">
        {title}
      </h1>
      {tagline ? (
        <p className="text-2xl font-medium tracking-tight text-neutral-400 dark:text-neutral-500">
          {tagline}
        </p>
      ) : null}
      {description ? (
        <p className="mt-2 text-sm text-pretty text-neutral-500 dark:text-neutral-400">
          {description}
        </p>
      ) : null}
    </div>
  );
}

export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
      {children}
    </label>
  );
}

export function ErrorStrip({ message }: { message: string }) {
  return (
    <div className="mb-5 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      <AlertTriangle className="size-4 shrink-0" />
      <span className="text-sm">{message}</span>
    </div>
  );
}

export function InfoStrip({ message }: { message: string }) {
  return (
    <div className="mb-5 flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
      <Info className="size-4 shrink-0" />
      <span className="text-sm">{message}</span>
    </div>
  );
}

export function SuccessStrip({ message }: { message: string }) {
  return (
    <div className="mb-5 flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
      <Info className="size-4 shrink-0 text-green-600 dark:text-green-400" />
      <span className="text-sm">{message}</span>
    </div>
  );
}

/* --- Six-box code input --- */

export function CodeInput({
  value,
  onChange,
  disabled,
  autoFocus = true,
  invalid = false,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Marks the boxes destructive and replays the shake (row-level, once). */
  invalid?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  const focusBox = (i: number) => refs.current[Math.max(0, Math.min(CODE_LENGTH - 1, i))]?.focus();

  const applyEdit = (edit: { next: string; focus: number } | null) => {
    if (!edit) return;
    onChange(edit.next);
    focusBox(edit.focus);
  };

  return (
    <div className={`flex gap-2.5 ${invalid ? 'motion-safe:animate-shake' : ''}`}>
      {Array.from({ length: CODE_LENGTH }, (_, i) => (
        <input
          key={i}
          ref={(el: HTMLInputElement | null) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          value={value[i] ?? ''}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            applyEdit(applyBoxInput(value, i, e.target.value));
          }}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              applyEdit(applyBackspace(value, i));
            } else if (e.key === 'ArrowLeft') {
              focusBox(i - 1);
            } else if (e.key === 'ArrowRight') {
              focusBox(i + 1);
            }
          }}
          onPaste={(e: React.ClipboardEvent<HTMLInputElement>) => {
            e.preventDefault();
            const digits = e.clipboardData.getData('text').replace(/\D/g, '');
            if (digits) applyEdit(insertDigits(value, i, digits));
          }}
          onFocus={(e: React.FocusEvent<HTMLInputElement>) => e.currentTarget.select()}
          aria-invalid={invalid || undefined}
          className="size-12 rounded-md border border-neutral-300 bg-white text-center text-lg font-medium tabular-nums text-neutral-900 outline-none transition-[border-color] focus:border-blue-500 aria-[invalid=true]:border-red-500 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
        />
      ))}
    </div>
  );
}
