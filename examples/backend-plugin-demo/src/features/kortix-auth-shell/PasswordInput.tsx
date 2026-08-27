'use client';

/**
 * A password field with a show/hide toggle. Ported from Suna's real
 * `page.tsx`-local `PasswordInput` helper -- already generic (it never
 * touched Supabase), the only change is `@phosphor-icons/react` ->
 * `lucide-react` (vendored by DeliveryOS's preview compiler; phosphor
 * isn't).
 */

import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

import { Input } from './Input';

export function PasswordInput({
  id,
  name,
  placeholder,
  autoComplete,
  autoFocus,
  invalid,
}: {
  id: string;
  name: string;
  placeholder: string;
  autoComplete: string;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={show ? 'text' : 'password'}
        size="md"
        placeholder={placeholder}
        required
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        className="pr-10"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s: boolean) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-200"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
