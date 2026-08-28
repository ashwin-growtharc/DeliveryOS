import { forwardRef } from 'react';
import type React from 'react';

/**
 * Minimal stand-in so this feature renders standalone. Swap for your own
 * design system's Input -- nothing here is auth-specific.
 */
export interface InputProps {
  id?: string;
  name?: string;
  type?: string;
  size?: 'md' | 'lg';
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  readOnly?: boolean;
  required?: boolean;
  autoComplete?: string;
  autoFocus?: boolean;
  tabIndex?: number;
  className?: string;
  'aria-invalid'?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', className = '', ...rest }: InputProps,
  ref: React.Ref<HTMLInputElement>,
) {
  const sizeCls = size === 'lg' ? 'h-11 px-3.5' : 'h-10 px-3';
  return (
    <input
      ref={ref}
      {...rest}
      className={`${sizeCls} w-full rounded-md border border-neutral-300 bg-white text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-500 aria-[invalid=true]:border-red-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500 ${className}`}
    />
  );
});
