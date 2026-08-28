import { Button } from './button';
import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from './ButtonGroup';
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

/* ── Inline glyphs (no icon package in the sandbox) ─────────────────────── */
const svg = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" {...svg}>
    <path d="M7 4.5 19 12 7 19.5z" />
  </svg>
);
const PauseIcon = () => (
  <svg viewBox="0 0 24 24" {...svg}>
    <path d="M9 4.5v15M15 4.5v15" />
  </svg>
);
const StopIcon = () => (
  <svg viewBox="0 0 24 24" {...svg}>
    <rect x="5.5" y="5.5" width="13" height="13" rx="2" />
  </svg>
);
const RestartIcon = () => (
  <svg viewBox="0 0 24 24" {...svg}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.7-6.2" />
    <path d="M3.5 4.5V10h5.5" />
  </svg>
);
const TerminalIcon = () => (
  <svg viewBox="0 0 24 24" {...svg}>
    <path d="m5 8 3.5 3.5L5 15" />
    <path d="M12 16h7" />
  </svg>
);
const CopyIcon = () => (
  <svg viewBox="0 0 24 24" {...svg}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H5.5A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15" />
  </svg>
);
const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" {...svg}>
    <path d="M12 3.5v11" />
    <path d="m7.5 10.5 4.5 4 4.5-4" />
    <path d="M4 19.5h16" />
  </svg>
);
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" {...svg}>
    <path d="M4.5 7h15" />
    <path d="M9.5 7V4.5h5V7" />
    <path d="M6.5 7l1 12.5h9L17.5 7" />
  </svg>
);
const ChevronDownIcon = () => (
  <svg viewBox="0 0 24 24" {...svg}>
    <path d="m6 9.5 6 6 6-6" />
  </svg>
);

/** The run toolbar above a live sandbox: transport controls, then artifacts. */
export const RunToolbar = () => (
  <Frame>
    <div className="space-y-6">
      <Row label="Run #4821 · research-assistant · transport">
        <ButtonGroup>
          <Button variant="outline" size="icon-base" aria-label="Resume run">
            <PlayIcon />
          </Button>
          <Button variant="outline" size="icon-base" aria-label="Pause run">
            <PauseIcon />
          </Button>
          <Button variant="outline" size="icon-base" aria-label="Stop run">
            <StopIcon />
          </Button>
          <ButtonGroupSeparator />
          <Button variant="outline" size="icon-base" aria-label="Restart from step 1">
            <RestartIcon />
          </Button>
          <Button variant="outline" size="icon-base" aria-label="Attach terminal">
            <TerminalIcon />
          </Button>
        </ButtonGroup>

        <ButtonGroup>
          <Button variant="outline" size="icon-base" aria-label="Copy run ID">
            <CopyIcon />
          </Button>
          <Button variant="outline" size="icon-base" aria-label="Download transcript">
            <DownloadIcon />
          </Button>
          <ButtonGroupSeparator />
          <Button variant="outline" size="icon-base" aria-label="Delete run">
            <TrashIcon />
          </Button>
        </ButtonGroup>
      </Row>

      <Row label="Split action — deploy, or pick a target">
        <ButtonGroup>
          <Button>Deploy agent</Button>
          <ButtonGroupSeparator />
          <Button size="icon-md" aria-label="Choose deploy target">
            <ChevronDownIcon />
          </Button>
        </ButtonGroup>
        <ButtonGroup>
          <Button variant="outline">Run in sandbox</Button>
          <Button variant="outline" size="icon-md" aria-label="Sandbox options">
            <ChevronDownIcon />
          </Button>
        </ButtonGroup>
      </Row>
    </div>
  </Frame>
);

/** Segmented text groups — the usage-window and tab-ish pickers in Suna. */
export const SegmentedGroups = () => (
  <Frame>
    <div className="space-y-6">
      <Row label="Usage window">
        <ButtonGroup>
          <Button variant="outline" size="sm">
            Last 24h
          </Button>
          <Button variant="secondary-outline" size="sm">
            7 days
          </Button>
          <Button variant="outline" size="sm">
            30 days
          </Button>
          <Button variant="outline" size="sm">
            Billing cycle
          </Button>
        </ButtonGroup>
      </Row>

      <Row label="Run detail view">
        <ButtonGroup>
          <Button variant="secondary-outline" size="sm">
            Timeline
          </Button>
          <Button variant="outline" size="sm">
            Tool calls
          </Button>
          <Button variant="outline" size="sm">
            Logs
          </Button>
          <Button variant="outline" size="sm">
            Cost
          </Button>
        </ButtonGroup>
      </Row>

      <Row label="Sandbox size">
        <ButtonGroup>
          <Button variant="outline" size="sm">
            1 vCPU
          </Button>
          <Button variant="outline" size="sm">
            2 vCPU
          </Button>
          <Button variant="secondary-outline" size="sm">
            4 vCPU
          </Button>
          <Button variant="outline" size="sm" disabled>
            8 vCPU · Pro
          </Button>
        </ButtonGroup>
      </Row>
    </div>
  </Frame>
);

/** Text addons and the vertical orientation. */
export const AddonsAndVertical = () => (
  <Frame>
    <div className="flex flex-wrap items-start gap-10">
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">Webhook endpoint</p>
        <ButtonGroup>
          <ButtonGroupText>api.kortix.ai/v1/hooks/</ButtonGroupText>
          <Button variant="outline">research-assistant</Button>
          <Button variant="outline" size="icon-md" aria-label="Copy endpoint">
            <CopyIcon />
          </Button>
        </ButtonGroup>

        <p className="text-muted-foreground pt-4 text-xs">Spend limit</p>
        <ButtonGroup>
          <ButtonGroupText>USD</ButtonGroupText>
          <Button variant="outline">250.00 / month</Button>
          <ButtonGroupText>per workspace</ButtonGroupText>
        </ButtonGroup>
      </div>

      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">Integration actions (vertical)</p>
        <ButtonGroup orientation="vertical">
          <Button variant="outline">Reconnect Slack</Button>
          <Button variant="outline">Rotate signing secret</Button>
          <Button variant="outline">View delivery log</Button>
          <ButtonGroupSeparator orientation="horizontal" />
          <Button variant="outline">Disconnect integration</Button>
        </ButtonGroup>
      </div>
    </div>
  </Frame>
);
