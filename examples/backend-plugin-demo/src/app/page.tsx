import { KortixLogo } from '@design-kit/KortixLogo/KortixLogo';
import { Button } from '@design-kit/Button/Button';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col items-start justify-center px-6">
      <KortixLogo variant="icon" size={28} className="text-foreground mb-4" />
      <h1 className="text-foreground text-2xl font-semibold">Demo App</h1>
      <p className="text-muted-foreground mt-2">
        A small sample app for demoing DeliveryOS's backend plug-and-play lifecycle.
      </p>
      <div className="mt-6 flex gap-3">
        <Button asChild>
          <a href="/dashboard">Go to Dashboard</a>
        </Button>
        <Button asChild variant="outline">
          <a href="/auth">Sign in</a>
        </Button>
      </div>
    </main>
  );
}
