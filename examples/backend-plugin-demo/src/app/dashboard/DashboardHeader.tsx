'use client';

import { KortixLogo } from '@design-kit/KortixLogo/KortixLogo';
import { UserAvatar } from '@design-kit/UserAvatar/UserAvatar';
import { Button } from '@design-kit/Button/Button';

import { signOutAction } from '@/app/dashboard/actions';

export function DashboardHeader({ email }: { email: string }) {
  return (
    <header className="border-border flex items-center justify-between border-b px-6 py-4">
      <div className="flex items-center gap-2">
        <KortixLogo variant="icon" size={22} className="text-foreground" />
        <span className="text-foreground font-medium">Sample Dashboard</span>
      </div>
      <div className="flex items-center gap-3">
        <UserAvatar email={email} size="sm" />
        <span className="text-muted-foreground text-sm">{email}</span>
        <form action={signOutAction}>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}
