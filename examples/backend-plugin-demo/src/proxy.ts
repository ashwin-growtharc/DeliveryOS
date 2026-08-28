// Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts`
// (functionality is identical -- only the file/export name changed; see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
// `auth`'s "wrap a route handler" overload is what actually turns the
// `matcher` below into a real guard, via auth.config.ts's `authorized`
// callback -- see that file for why this alone is what protects /dashboard.
export { auth as proxy } from '@/auth';

export const config = {
  matcher: ['/dashboard/:path*'],
};
