import { DashboardHeader } from './DashboardHeader';
import { Badge } from '@design-kit/Badge/Badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@design-kit/Table/Table';

/**
 * Before email-code-auth is pulled, this page has no guard at all -- that
 * absence is the demo's own opening beat ("right now, anyone can hit
 * this"). Once it's wired up (src/proxy.ts's matcher covers
 * /dashboard/:path*), this same file becomes protected with zero changes
 * of its own -- the `auth()` call below just starts actually returning a
 * real session instead of null.
 */

const ROWS: Array<{ artifact: string; kind: string; status: 'success' | 'warning' | 'info'; when: string }> = [
  { artifact: 'kortix-auth-shell', kind: 'ui-feature', status: 'success', when: '2 min ago' },
  { artifact: 'email-code-auth', kind: 'backend-plugin', status: 'success', when: 'just now' },
  { artifact: 'kortix-design-kit', kind: 'template', status: 'info', when: '5 min ago' },
];

const STATUS_LABEL: Record<string, string> = {
  success: 'Wired',
  warning: 'Needs review',
  info: 'Reference only',
};

export default async function DashboardPage() {
  let email: string | null = null;
  try {
    // Imported lazily so this page still renders before src/auth.ts
    // exists at all (the pre-pull starting state) -- a static import
    // would fail to even build without it.
    const { auth } = await import('@/auth');
    const session = await auth();
    email = session?.user?.email ?? null;
  } catch {
    // src/auth.ts doesn't exist yet -- the pre-pull state.
  }

  if (!email) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-24">
        <h1 className="text-foreground text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Not signed in yet -- this page has no guard at all right now.
        </p>
      </main>
    );
  }

  return (
    <div className="flex min-h-svh flex-col">
      <DashboardHeader email={email} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <h1 className="text-foreground text-xl font-semibold">Recently pulled</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          What this sample app pulled to build this exact page.
        </p>

        <div className="mt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Artifact</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROWS.map((row) => (
                <TableRow key={row.artifact}>
                  <TableCell className="font-medium">{row.artifact}</TableCell>
                  <TableCell className="text-muted-foreground">{row.kind}</TableCell>
                  <TableCell>
                    <Badge variant={row.status === 'success' ? 'success' : row.status === 'warning' ? 'warning' : 'info'}>
                      {STATUS_LABEL[row.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right">{row.when}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </main>
    </div>
  );
}
