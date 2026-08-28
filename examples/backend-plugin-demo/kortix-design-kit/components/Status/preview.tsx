import { DiffStat, StatusBadge, StatusDot } from './Status';
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
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </div>
);

/** Every tone once, with copy that genuinely matches that severity. */
export const Tones = () => (
  <Frame>
    <div className="space-y-5">
      <Row label="StatusBadge — one per tone">
        <StatusBadge tone="success">Run completed</StatusBadge>
        <StatusBadge tone="warning">Approaching usage limit</StatusBadge>
        <StatusBadge tone="destructive">Sandbox crashed</StatusBadge>
        <StatusBadge tone="info">Queued behind 3 runs</StatusBadge>
        <StatusBadge tone="neutral">Draft — never deployed</StatusBadge>
      </Row>
      <Row label="StatusDot — one per tone">
        <span className="flex items-center gap-1.5 text-sm">
          <StatusDot tone="success" />
          Healthy
        </span>
        <span className="flex items-center gap-1.5 text-sm">
          <StatusDot tone="warning" />
          Degraded
        </span>
        <span className="flex items-center gap-1.5 text-sm">
          <StatusDot tone="destructive" />
          Unreachable
        </span>
        <span className="flex items-center gap-1.5 text-sm">
          <StatusDot tone="info" />
          Provisioning
        </span>
        <span className="flex items-center gap-1.5 text-sm">
          <StatusDot tone="neutral" />
          Stopped
        </span>
      </Row>
      <Row label="StatusDot pulse — live activity">
        <span className="flex items-center gap-1.5 text-sm">
          <StatusDot tone="success" pulse />
          research-agent is running (4m 12s)
        </span>
        <span className="flex items-center gap-1.5 text-sm">
          <StatusDot tone="info" pulse />
          Streaming tool output
        </span>
      </Row>
    </div>
  </Frame>
);

/** The status family doing its real job: one row per agent run. */
export const RunList = () => {
  const runs = [
    {
      agent: 'pr-reviewer',
      trigger: 'Webhook · github/kortix-ai/suna#6484',
      tone: 'success' as const,
      label: 'Completed',
      dot: 'success' as const,
      pulse: false,
      duration: '1m 04s',
    },
    {
      agent: 'nightly-changelog',
      trigger: 'Schedule · 02:00 UTC',
      tone: 'warning' as const,
      label: 'Rate limited — retrying',
      dot: 'warning' as const,
      pulse: false,
      duration: '6m 41s',
    },
    {
      agent: 'migration-drift-check',
      trigger: 'Manual · dharan.s@growtharc.com',
      tone: 'destructive' as const,
      label: 'Failed — sandbox lost',
      dot: 'destructive' as const,
      pulse: false,
      duration: '22s',
    },
    {
      agent: 'research-agent',
      trigger: 'Chat · Sandbox renewal thread',
      tone: 'info' as const,
      label: 'Running',
      dot: 'success' as const,
      pulse: true,
      duration: '4m 12s',
    },
    {
      agent: 'docs-indexer',
      trigger: 'Never run',
      tone: 'neutral' as const,
      label: 'Draft',
      dot: 'neutral' as const,
      pulse: false,
      duration: '—',
    },
  ];

  return (
    <Frame>
      <div className="border-border divide-border w-full max-w-2xl divide-y rounded-md border">
        {runs.map((run) => (
          <div key={run.agent} className="flex items-center gap-3 px-4 py-3">
            <StatusDot tone={run.dot} pulse={run.pulse} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{run.agent}</p>
              <p className="text-muted-foreground truncate text-xs">{run.trigger}</p>
            </div>
            <span className="text-muted-foreground font-mono text-xs tabular-nums">
              {run.duration}
            </span>
            <StatusBadge tone={run.tone}>{run.label}</StatusBadge>
          </div>
        ))}
      </div>
    </Frame>
  );
};

/** DiffStat in its native habitat — the file-edit tool-call summary. */
export const FileEdits = () => {
  const files = [
    { path: 'apps/api/src/sandbox/renewal.ts', additions: 142, deletions: 37 },
    { path: 'apps/api/src/sandbox/__tests__/renewal.test.ts', additions: 96, deletions: 0 },
    { path: 'apps/web/src/components/ui/status.tsx', additions: 8, deletions: 8 },
    { path: 'packages/db/migrations/1755388800000_turn-authority.sql', additions: 0, deletions: 14 },
    { path: 'apps/web/src/app/globals.css', additions: 0, deletions: 0 },
  ];

  return (
    <Frame>
      <div className="w-full max-w-2xl space-y-3">
        <div className="flex items-center gap-2">
          <StatusBadge tone="success">5 files edited</StatusBadge>
          <DiffStat additions={246} deletions={59} className="text-xs" />
        </div>
        <div className="border-border divide-border divide-y rounded-md border">
          {files.map((file) => (
            <div key={file.path} className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">
                {file.path}
              </span>
              <DiffStat
                additions={file.additions}
                deletions={file.deletions}
                className="text-xs"
              />
              {!file.additions && !file.deletions ? (
                <StatusBadge tone="neutral">Unchanged</StatusBadge>
              ) : null}
            </div>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          The last row passes 0/0 — DiffStat renders nothing, by design.
        </p>
      </div>
    </Frame>
  );
};
