import Credentials from 'next-auth/providers/credentials';
import type { NextAuthConfig } from 'next-auth';
import { verifyLoginCode } from './email-code';

/**
 * No database adapter -- `authorize` re-verifies the stateless code
 * itself (see email-code.ts), so there is nothing for an adapter to
 * persist. Session strategy defaults to `jwt` whenever no adapter is
 * configured (Auth.js's own default, not set explicitly here), which is
 * exactly what a no-database artifact needs.
 */
export const authConfig: NextAuthConfig = {
  // Auth.js's own default unauthenticated redirect target is its built-in
  // /api/auth/signin page, which this artifact never builds -- point it
  // at your own real sign-in page instead.
  pages: {
    signIn: '/auth',
  },
  // Auth.js enforces NOTHING by default -- `middleware.ts`'s exported
  // `auth` just makes the session available, it doesn't redirect anyone
  // on its own. This callback is what actually turns the matcher in
  // middleware.ts's `config.matcher` into a real guard: no session ->
  // `false` -> Auth.js redirects to the sign-in page for a matched path.
  // Confirmed the hard way -- without this, an unauthenticated visitor
  // could load /dashboard freely even with middleware.ts wired up.
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        code: { label: 'Code', type: 'text' },
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === 'string' ? credentials.email : null;
        const code = typeof credentials?.code === 'string' ? credentials.code : null;
        const secret = process.env.AUTH_SECRET;
        if (!email || !code || !secret) return null;
        if (!(await verifyLoginCode(email, code, secret))) return null;
        return { id: email, email };
      },
    }),
  ],
};
