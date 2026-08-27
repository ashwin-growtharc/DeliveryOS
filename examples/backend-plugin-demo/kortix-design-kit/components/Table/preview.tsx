import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './Table';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

type Tone = 'success' | 'warning' | 'destructive' | 'info' | 'neutral';

const TONE_BG: Record<Tone, string> = {
  success: 'bg-kortix-green/10',
  warning: 'bg-kortix-yellow/10',
  destructive: 'bg-destructive/10',
  info: 'bg-kortix-blue/10',
  neutral: 'bg-muted',
};

const TONE_TEXT: Record<Tone, string> = {
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  destructive: 'text-destructive',
  info: 'text-blue-600 dark:text-blue-400',
  neutral: 'text-muted-foreground',
};

const Chip = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => (
  <span
    className={`inline-flex w-fit items-center gap-1 rounded-2xl px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE_BG[tone]} ${TONE_TEXT[tone]}`}
  >
    {children}
  </span>
);

const Mono = ({ children }: { children: React.ReactNode }) => (
  <span className="text-muted-foreground font-mono text-xs">{children}</span>
);

const runs: {
  id: string;
  agent: string;
  status: string;
  tone: Tone;
  duration: string;
}[] = [
  { id: 'run_9f2a41c8', agent: 'Release Notes Writer', status: 'Succeeded', tone: 'success', duration: '38s' },
  { id: 'run_9f2a3b17', agent: 'Invoice Reconciler', status: 'Failed', tone: 'destructive', duration: '2m 14s' },
  { id: 'run_9f2a2e05', agent: 'Support Triage', status: 'Running', tone: 'info', duration: '1m 06s' },
  { id: 'run_9f2a1d9e', agent: 'Docs Crawler', status: 'Rate limited', tone: 'warning', duration: '11s' },
  { id: 'run_9f2a0c33', agent: 'Nightly Backup', status: 'Succeeded', tone: 'success', duration: '4m 52s' },
  { id: 'run_9f29ff7b', agent: 'Support Triage', status: 'Cancelled', tone: 'neutral', duration: '9s' },
];

/** /agents/runs — the workhorse shape: sticky-looking header on `bg-accent`,
 *  monospaced run ids, tone chips for status, right-aligned numerics. */
export const AgentRuns = () => (
  <Frame>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Run</TableHead>
          <TableHead>Agent</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Duration</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell>
              <Mono>{run.id}</Mono>
            </TableCell>
            <TableCell className="font-medium">{run.agent}</TableCell>
            <TableCell>
              <Chip tone={run.tone}>{run.status}</Chip>
            </TableCell>
            <TableCell className="text-muted-foreground text-right tabular-nums">
              {run.duration}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </Frame>
);

/** With a footer total, a caption, and a selected row — the usage/billing
 *  shape, where the last row is a rollup rather than data. */
export const UsageWithFooterAndCaption = () => (
  <Frame>
    <Table>
      <TableCaption>Tool calls billed for the cycle ending 31 Aug 2026.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Workspace</TableHead>
          <TableHead>Plan</TableHead>
          <TableHead className="text-right">Runs</TableHead>
          <TableHead className="text-right">Tool calls</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">growtharc-prod</TableCell>
          <TableCell>
            <Chip tone="info">Scale</Chip>
          </TableCell>
          <TableCell className="text-right tabular-nums">9,120</TableCell>
          <TableCell className="text-right tabular-nums">241,388</TableCell>
          <TableCell className="text-right tabular-nums">$1,842.60</TableCell>
        </TableRow>
        <TableRow data-state="selected">
          <TableCell className="font-medium">growtharc-staging</TableCell>
          <TableCell>
            <Chip tone="neutral">Team</Chip>
          </TableCell>
          <TableCell className="text-right tabular-nums">1,447</TableCell>
          <TableCell className="text-right tabular-nums">38,902</TableCell>
          <TableCell className="text-right tabular-nums">$286.40</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">suna-oss-sandbox</TableCell>
          <TableCell>
            <Chip tone="neutral">Free</Chip>
          </TableCell>
          <TableCell className="text-right tabular-nums">312</TableCell>
          <TableCell className="text-right tabular-nums">4,061</TableCell>
          <TableCell className="text-right tabular-nums">$0.00</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">dharan-scratch</TableCell>
          <TableCell>
            <Chip tone="warning">Over limit</Chip>
          </TableCell>
          <TableCell className="text-right tabular-nums">128</TableCell>
          <TableCell className="text-right tabular-nums">7,554</TableCell>
          <TableCell className="text-right tabular-nums">$61.20</TableCell>
        </TableRow>
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={2}>4 workspaces</TableCell>
          <TableCell className="text-right tabular-nums">11,007</TableCell>
          <TableCell className="text-right tabular-nums">291,905</TableCell>
          <TableCell className="text-right tabular-nums">$2,190.20</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  </Frame>
);

/** Wide content, to show the container's own horizontal scroll rather than
 *  letting the page body scroll — sandbox inventory with long digests. */
export const SandboxInventory = () => (
  <Frame>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Sandbox</TableHead>
          <TableHead>Region</TableHead>
          <TableHead>Template</TableHead>
          <TableHead>Image digest</TableHead>
          <TableHead>State</TableHead>
          <TableHead className="text-right">Idle</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>
            <Mono>sbx_7d41ac</Mono>
          </TableCell>
          <TableCell>us-east-1</TableCell>
          <TableCell className="font-medium">e2b-nodejs20</TableCell>
          <TableCell>
            <Mono>sha256:3f9c1ab7de40c2…</Mono>
          </TableCell>
          <TableCell>
            <Chip tone="success">Running</Chip>
          </TableCell>
          <TableCell className="text-muted-foreground text-right tabular-nums">0s</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>
            <Mono>sbx_7d3f18</Mono>
          </TableCell>
          <TableCell>eu-central-1</TableCell>
          <TableCell className="font-medium">e2b-python312</TableCell>
          <TableCell>
            <Mono>sha256:aa02f7714b9e88…</Mono>
          </TableCell>
          <TableCell>
            <Chip tone="neutral">Hibernated</Chip>
          </TableCell>
          <TableCell className="text-muted-foreground text-right tabular-nums">6h 12m</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>
            <Mono>sbx_7d2b90</Mono>
          </TableCell>
          <TableCell>us-west-2</TableCell>
          <TableCell className="font-medium">e2b-nodejs20</TableCell>
          <TableCell>
            <Mono>sha256:3f9c1ab7de40c2…</Mono>
          </TableCell>
          <TableCell>
            <Chip tone="warning">Renewal overdue</Chip>
          </TableCell>
          <TableCell className="text-muted-foreground text-right tabular-nums">14m</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>
            <Mono>sbx_7d1055</Mono>
          </TableCell>
          <TableCell>ap-south-1</TableCell>
          <TableCell className="font-medium">e2b-browser</TableCell>
          <TableCell>
            <Mono>sha256:c71d4e0aa5f312…</Mono>
          </TableCell>
          <TableCell>
            <Chip tone="destructive">Provision failed</Chip>
          </TableCell>
          <TableCell className="text-muted-foreground text-right tabular-nums">—</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Frame>
);
