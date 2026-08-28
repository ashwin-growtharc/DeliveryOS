import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertMedia,
  AlertTitle,
} from './Alert';
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

const TriangleAlertIcon = ({ className }: { className?: string }) => (
  <svg {...strokeProps} className={className}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);

const OctagonXIcon = ({ className }: { className?: string }) => (
  <svg {...strokeProps} className={className}>
    <path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z" />
    <path d="m15 9-6 6M9 9l6 6" />
  </svg>
);

const ClockIcon = ({ className }: { className?: string }) => (
  <svg {...strokeProps} className={className}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
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

/** All three variants, each with copy that genuinely matches its severity.
 *  Note the bare-child media path: a raw <svg> gets auto-wrapped in AlertMedia. */
export const Variants = () => (
  <Frame>
    <div className="space-y-3">
      <Alert>
        <InfoIcon className="size-4" />
        <AlertTitle>Sandbox snapshot restored</AlertTitle>
        <AlertDescription>
          Your workspace was rehydrated from the 14:02 snapshot. Files written after that point were
          not recovered.
        </AlertDescription>
      </Alert>

      <Alert variant="warning">
        <TriangleAlertIcon className="size-4" />
        <AlertTitle>Approaching your monthly run limit</AlertTitle>
        <AlertDescription>
          You have used 9,120 of 10,000 agent runs. New runs will be queued once the limit is
          reached.
        </AlertDescription>
      </Alert>

      <Alert variant="destructive">
        <OctagonXIcon className="size-4" />
        <AlertTitle>Deployment to production failed</AlertTitle>
        <AlertDescription>
          Migration 0142_add_run_authority could not acquire a lock on public.agent_runs. Nothing
          was applied — the previous revision is still live.
        </AlertDescription>
      </Alert>
    </div>
  </Frame>
);

/** With the icon-tile media variant, an explicit AlertContent wrapper, and
 *  AlertActions — the shape used for actionable banners in Settings. */
export const WithMediaTileAndActions = () => (
  <Frame>
    <div className="space-y-3">
      <Alert>
        <AlertMedia variant="icon">
          <ClockIcon />
        </AlertMedia>
        <AlertContent>
          <AlertTitle>Scheduled maintenance on 22 Aug, 02:00–03:00 UTC</AlertTitle>
          <AlertDescription>
            Sandboxes in eu-central-1 will be drained and restarted. Long-running agent runs will be
            checkpointed and resumed automatically.
          </AlertDescription>
        </AlertContent>
        <AlertActions>
          <GhostBtn>Dismiss</GhostBtn>
          <SolidBtn>View status page</SolidBtn>
        </AlertActions>
      </Alert>

      <Alert variant="warning">
        <AlertMedia variant="icon">
          <TriangleAlertIcon />
        </AlertMedia>
        <AlertContent>
          <AlertTitle>Slack token expires in 3 days</AlertTitle>
          <AlertDescription>
            Once it expires, the Release Notes Writer agent can no longer post to #eng-alerts.
          </AlertDescription>
        </AlertContent>
        <AlertActions>
          <SolidBtn>Reconnect Slack</SolidBtn>
        </AlertActions>
      </Alert>
    </div>
  </Frame>
);

/** Title-only and description-only — the two degenerate shapes Alert has to
 *  keep aligned (min-h-4 on the title keeps the row height stable). */
export const TitleOnlyAndDescriptionOnly = () => (
  <Frame>
    <div className="space-y-3">
      <Alert>
        <InfoIcon className="size-4" />
        <AlertTitle>All 6 agents are healthy</AlertTitle>
      </Alert>

      <Alert variant="destructive">
        <AlertDescription>
          API key sk_live_••••••4f2a was revoked by dharan.s@growtharc.com — 2 integrations are now
          failing to authenticate.
        </AlertDescription>
      </Alert>
    </div>
  </Frame>
);
