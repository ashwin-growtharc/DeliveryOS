import { InfoBanner } from './InfoBanner';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

const strokeProps = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const InfoIcon = ({ className }: { className?: string }) => (
  <svg {...strokeProps} className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);

const CircleCheckIcon = ({ className }: { className?: string }) => (
  <svg {...strokeProps} className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const TriangleAlertIcon = ({ className }: { className?: string }) => (
  <svg {...strokeProps} className={className}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);

const CircleXIcon = ({ className }: { className?: string }) => (
  <svg {...strokeProps} className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="m15 9-6 6M9 9l6 6" />
  </svg>
);

const BoxIcon = ({ className }: { className?: string }) => (
  <svg {...strokeProps} className={className}>
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
    <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
  </svg>
);

const ZapIcon = ({ className }: { className?: string }) => (
  <svg {...strokeProps} className={className}>
    <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
  </svg>
);

const GhostBtn = ({ children }: { children: React.ReactNode }) => (
  <button
    type="button"
    className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground h-7 shrink-0 rounded-sm px-2.5 text-xs font-medium"
  >
    {children}
  </button>
);

const SolidBtn = ({ children }: { children: React.ReactNode }) => (
  <button
    type="button"
    className="bg-foreground text-background hover:bg-foreground/90 h-7 shrink-0 rounded-sm px-2.5 text-xs font-medium"
  >
    {children}
  </button>
);

/** One banner per tone, each carrying copy that genuinely matches that
 *  severity. Icons are passed as elements (the `React.ReactElement` path). */
export const Tones = () => (
  <Frame>
    <div className="space-y-3">
      <InfoBanner tone="neutral" icon={<BoxIcon />} title="Sandbox is hibernated">
        This workspace has been idle for 6 hours. The next agent run will cold-start it in about 4
        seconds.
      </InfoBanner>

      <InfoBanner tone="info" icon={<InfoIcon />} title="Suna 2.14 is rolling out">
        Tool-call streaming is enabled for all new runs. Runs started before 14:00 UTC keep the old
        buffered behaviour.
      </InfoBanner>

      <InfoBanner
        tone="success"
        icon={<CircleCheckIcon />}
        title="Deployment succeeded in 1m 12s"
      >
        Release v2.14.0 is live on production. All 6 agents reconnected and 3 queued runs have
        resumed.
      </InfoBanner>

      <InfoBanner tone="warning" icon={<TriangleAlertIcon />} title="93% of your run quota used">
        9,300 of 10,000 runs consumed this cycle. Once the quota is exhausted, scheduled triggers
        will be skipped rather than queued.
      </InfoBanner>

      <InfoBanner tone="destructive" icon={<CircleXIcon />} title="Agent run failed after 3 retries">
        The Invoice Reconciler could not reach the Stripe API — every attempt returned 503. Nothing
        was written to your ledger.
      </InfoBanner>
    </div>
  </Frame>
);

/** With `action` — the interactive shape used at the top of Settings pages.
 *  The action sits in AlertActions, so it stays right-aligned as copy wraps. */
export const WithActions = () => (
  <Frame>
    <div className="space-y-3">
      <InfoBanner
        tone="warning"
        icon={<TriangleAlertIcon />}
        title="Slack token expires in 3 days"
        action={<SolidBtn>Reconnect Slack</SolidBtn>}
      >
        After it expires the Release Notes Writer can no longer post to #eng-alerts.
      </InfoBanner>

      <InfoBanner
        tone="destructive"
        icon={<CircleXIcon />}
        title="Payment method declined"
        action={<SolidBtn>Update card</SolidBtn>}
      >
        We could not charge •••• 4242 for the August invoice. Agents keep running for 7 more days.
      </InfoBanner>

      <InfoBanner
        tone="info"
        icon={<ZapIcon />}
        title="You are on the Free plan"
        action={<GhostBtn>Compare plans</GhostBtn>}
      >
        Concurrency is capped at 2 sandboxes and runs time out after 10 minutes.
      </InfoBanner>
    </div>
  </Frame>
);

/** The `React.ComponentType` icon path (pass the component, not an element),
 *  plus the icon-less and title-less degenerate shapes. */
export const IconFormsAndMinimalShapes = () => (
  <Frame>
    <div className="space-y-3">
      <InfoBanner tone="success" icon={CircleCheckIcon} title="Snapshot e2b-nodejs20 verified">
        Image digest matched the signed manifest — the template is safe to promote.
      </InfoBanner>

      <InfoBanner tone="neutral" title="No triggers are attached to this agent">
        It will only run when started manually or through the API.
      </InfoBanner>

      <InfoBanner tone="warning" icon={<TriangleAlertIcon />}>
        3 tool calls in this run were denied by the workspace allowlist.
      </InfoBanner>

      <InfoBanner tone="info" icon={<InfoIcon />} title="Read-only view — you are a Viewer" />
    </div>
  </Frame>
);
