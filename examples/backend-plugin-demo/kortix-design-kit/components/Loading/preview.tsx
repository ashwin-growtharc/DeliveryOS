import Loading from './Loading';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-2">
    <p className="text-muted-foreground text-xs">{label}</p>
    <div className="flex flex-wrap items-center gap-3">{children}</div>
  </div>
);

/** Both variants, at the sizes callers actually use them. */
export const Variants = () => (
  <Frame>
    <div className="space-y-5">
      <Row label='variant="orbit" (default) — arc on a faint track'>
        <Loading />
        <Loading className="size-5" />
        <Loading className="size-8" />
        <Loading className="text-kortix-blue size-8" />
      </Row>
      <Row label='variant="spokes" — eight spokes on a fading ramp'>
        <Loading variant="spokes" />
        <Loading variant="spokes" className="size-5" />
        <Loading variant="spokes" className="size-8" />
        <Loading variant="spokes" className="text-kortix-blue size-8" />
      </Row>
      <Row label="Beside text — the size it ships at in a status line">
        <span className="flex items-center gap-2 text-sm">
          <Loading variant="spokes" className="size-3.5" />
          Restoring sandbox snapshot…
        </span>
        <span className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loading className="size-3.5" />
          Waiting on tool call
        </span>
      </Row>
    </div>
  </Frame>
);

/** The `in-[button]:` colour variants only resolve inside a real button
 *  surface, so this exercises each one Loading's class list handles. */
export const InsideButtons = () => (
  <Frame>
    <div className="space-y-5">
      <Row label="Solid button (bg-foreground) — spinner flips to text-background">
        <button
          type="button"
          data-slot="button"
          className="bg-foreground text-background flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium whitespace-nowrap"
        >
          <Loading className="size-4" />
          Deploying agent…
        </button>
        <button
          type="button"
          data-slot="button"
          className="bg-foreground text-background flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap"
        >
          <Loading variant="spokes" className="size-3.5" />
          Saving
        </button>
      </Row>
      <Row label="Secondary button (bg-secondary) — forced back to text-foreground">
        <button
          type="button"
          data-slot="button"
          className="bg-secondary text-foreground flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium whitespace-nowrap"
        >
          <Loading className="size-4" />
          Duplicating workspace…
        </button>
      </Row>
      <Row label="Ghost button (bg-transparent) — stays text-foreground">
        <button
          type="button"
          data-slot="button"
          className="text-foreground hover:bg-foreground/10 flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md bg-transparent px-4 py-2 text-sm font-medium whitespace-nowrap"
        >
          <Loading variant="spokes" className="size-4" />
          Revoking API key…
        </button>
      </Row>
    </div>
  </Frame>
);

/** In situ: the run list while a burst is mid-flight. */
export const RunProgress = () => {
  const rows = [
    { agent: 'research-agent', step: 'Analysing repository structure', variant: 'spokes' as const },
    { agent: 'pr-reviewer', step: 'Reading apps/api/src/sandbox/renewal.ts', variant: 'orbit' as const },
    { agent: 'docs-indexer', step: 'Embedding 412 chunks', variant: 'spokes' as const },
    { agent: 'nightly-changelog', step: 'Waiting for sandbox lease', variant: 'orbit' as const },
  ];

  return (
    <Frame>
      <div className="border-border divide-border w-full max-w-xl divide-y rounded-md border">
        {rows.map((row) => (
          <div key={row.agent} className="flex items-center gap-3 px-4 py-3">
            <Loading variant={row.variant} className="text-muted-foreground size-4" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{row.agent}</p>
              <p className="text-muted-foreground truncate text-xs">{row.step}</p>
            </div>
            <button
              type="button"
              data-slot="button"
              className="border-border text-foreground hover:bg-foreground/5 flex h-7 shrink-0 cursor-pointer items-center justify-center rounded-sm border bg-transparent px-2.5 text-xs font-medium whitespace-nowrap"
            >
              Stop
            </button>
          </div>
        ))}
      </div>
    </Frame>
  );
};
