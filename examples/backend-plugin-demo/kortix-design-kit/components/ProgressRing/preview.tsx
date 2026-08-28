import { ProgressRing } from './ProgressRing';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

/** Sandbox disk usage across a fleet — the ring at its real size, plus the
 *  large sizes the usage panel uses, and the tone overrides for "nearly full". */
export const DiskUsage = () => {
  const sandboxes = [
    { id: 'sbx-7f2a91', agent: 'research-agent', used: '1.4 GB of 12 GB', pct: 12 },
    { id: 'sbx-0c48de', agent: 'pr-reviewer', used: '5.8 GB of 12 GB', pct: 48 },
    { id: 'sbx-b31e05', agent: 'docs-indexer', used: '10.9 GB of 12 GB', pct: 91 },
    { id: 'sbx-49aa7c', agent: 'nightly-changelog', used: '12 GB of 12 GB', pct: 100 },
  ];

  const tone = (pct: number) =>
    pct >= 90
      ? 'text-destructive'
      : pct >= 60
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-muted-foreground';

  return (
    <Frame>
      <div className="border-border divide-border w-full max-w-xl divide-y rounded-md border">
        {sandboxes.map((sandbox) => (
          <div key={sandbox.id} className="flex items-center gap-3 px-4 py-3">
            <ProgressRing
              value={sandbox.pct}
              className="size-5"
              progressClassName={tone(sandbox.pct)}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{sandbox.agent}</p>
              <p className="text-muted-foreground truncate font-mono text-xs">{sandbox.id}</p>
            </div>
            <span className="text-muted-foreground text-xs tabular-nums">{sandbox.used}</span>
            <span className="w-9 text-right font-mono text-xs tabular-nums">{sandbox.pct}%</span>
          </div>
        ))}
      </div>
    </Frame>
  );
};

/** The whole scale in one line, so the geometry at each end is checkable —
 *  0% is a bare track, 100% is a closed ring. */
export const Scale = () => (
  <Frame>
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">
          Monthly run credits consumed, per workspace
        </p>
        <div className="flex flex-wrap items-end gap-6">
          {[0, 12, 25, 48, 67, 91, 100].map((pct) => (
            <div key={pct} className="flex flex-col items-center gap-1.5">
              <ProgressRing value={pct} className="size-8" />
              <span className="text-muted-foreground font-mono text-xs tabular-nums">{pct}%</span>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">
          Out-of-range values are clamped (−40 → 0%, 180 → 100%)
        </p>
        <div className="flex items-center gap-6">
          <ProgressRing value={-40} className="size-8" />
          <ProgressRing value={180} className="size-8" />
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">Ships at size-4 inline, beside a label</p>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="flex items-center gap-2">
            <ProgressRing value={12} />
            Seats used — 3 of 25
          </span>
          <span className="flex items-center gap-2">
            <ProgressRing value={48} progressClassName="text-kortix-blue" />
            Snapshot upload
          </span>
          <span className="flex items-center gap-2">
            <ProgressRing
              value={91}
              progressClassName="text-destructive"
              trackClassName="text-destructive/15"
            />
            Rate-limit budget
          </span>
        </div>
      </div>
    </div>
  </Frame>
);

/** The usage card the billing page renders it in. */
export const UsageCard = () => (
  <Frame>
    <div className="border-border grid w-full max-w-2xl grid-cols-3 gap-4 rounded-md border p-4">
      {[
        { label: 'Sandbox hours', ring: 12, detail: '18 h of 150 h', tone: 'text-kortix-blue' },
        {
          label: 'Tool calls',
          ring: 48,
          detail: '24,000 of 50,000',
          tone: 'text-muted-foreground',
        },
        { label: 'Storage', ring: 91, detail: '45.5 GB of 50 GB', tone: 'text-destructive' },
      ].map((stat) => (
        <div key={stat.label} className="flex items-center gap-3">
          <ProgressRing value={stat.ring} className="size-10" progressClassName={stat.tone} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{stat.label}</p>
            <p className="text-muted-foreground truncate text-xs tabular-nums">{stat.detail}</p>
          </div>
        </div>
      ))}
    </div>
  </Frame>
);
