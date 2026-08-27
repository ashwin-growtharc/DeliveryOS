import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Suna's own `cn` (apps/web/src/lib/utils.ts:5-7), verbatim. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
