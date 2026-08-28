'use server';

import { signOut } from '@/auth';

/**
 * Ends the real session created by src/app/auth/actions.ts's `verifyCode`
 * and sends the user back to the sign-in page. Exported from its own
 * 'use server' module (rather than declared inline) so the already-client
 * `DashboardHeader.tsx` can use it as a plain `<form action={signOutAction}>`.
 */
export async function signOutAction() {
  await signOut({ redirectTo: '/auth' });
}
