import { Badge, badgeColors, type BadgeColor } from './Badge';
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

/** `variant="solid"` — the whole 17-entry `badgeColors` scale, then the same
 *  scale doing its real job: colour-coding connected integrations. */
export const SolidColorScale = () => (
  <Frame>
    <div className="space-y-5">
      <Row label="Full solid colour scale — color-mix(15%) over --background">
        {(Object.keys(badgeColors) as BadgeColor[]).map((color) => (
          <Badge
            key={color}
            variant="solid"
            color={color}
          >
            {color}
          </Badge>
        ))}
      </Row>
      <Row label="In use — integration labels on a workspace">
        <Badge
          variant="solid"
          color="violet"
        >
          Slack
        </Badge>
        <Badge
          variant="solid"
          color="emerald"
        >
          Supabase
        </Badge>
        <Badge
          variant="solid"
          color="blue"
        >
          Linear
        </Badge>
        <Badge
          variant="solid"
          color="orange"
        >
          HubSpot
        </Badge>
        <Badge
          variant="solid"
          color="cyan"
        >
          Google Drive
        </Badge>
        <Badge
          variant="solid"
          color="rose"
        >
          Gmail
        </Badge>
        <Badge
          variant="solid"
          color="gray"
        >
          No integrations
        </Badge>
      </Row>
      <Row label="Run status, colour-coded">
        <Badge
          variant="solid"
          color="green"
          size="sm"
        >
          Completed
        </Badge>
        <Badge
          variant="solid"
          color="amber"
          size="sm"
        >
          Waiting on approval
        </Badge>
        <Badge
          variant="solid"
          color="red"
          size="sm"
        >
          Failed after 3 retries
        </Badge>
        <Badge
          variant="solid"
          color="indigo"
          size="sm"
        >
          Queued
        </Badge>
      </Row>
    </div>
  </Frame>
);

/** Every semantic `variant`, each with copy that genuinely matches its tone. */
export const SemanticVariants = () => (
  <Frame>
    <div className="space-y-5">
      <Row label="Neutral surfaces">
        <Badge variant="default">Production</Badge>
        <Badge variant="secondary">Draft agent</Badge>
        <Badge variant="accent">Shared with team</Badge>
        <Badge variant="outline">Self-hosted sandbox</Badge>
        <Badge variant="muted">Archived 4 months ago</Badge>
        <Badge variant="transparent">Owned by you</Badge>
      </Row>
      <Row label="Status tones">
        <Badge variant="success">Deployment healthy</Badge>
        <Badge variant="badgeSuccess">Sandbox ready</Badge>
        <Badge variant="warning">92% of monthly run limit</Badge>
        <Badge variant="destructive">Credentials expired</Badge>
        <Badge variant="info">Read-only API key</Badge>
      </Row>
      <Row label="Product markers">
        <Badge variant="new">New</Badge>
        <Badge variant="beta">Beta</Badge>
        <Badge variant="highlight">Recommended</Badge>
        <Badge variant="update">Update available — v2.4.1</Badge>
        <Badge variant="kortix">Kortix Cloud</Badge>
      </Row>
    </div>
  </Frame>
);

/** The four `size`s, including `tabular` for aligned counts in list rows. */
export const SizesInContext = () => (
  <Frame>
    <div className="space-y-5">
      <Row label="Sizes">
        <Badge
          variant="secondary"
          size="default"
        >
          default — Scheduled daily
        </Badge>
        <Badge
          variant="secondary"
          size="sm"
        >
          sm — Running
        </Badge>
        <Badge
          variant="secondary"
          size="xs"
        >
          xs — v3
        </Badge>
        <Badge
          variant="secondary"
          size="tabular"
        >
          7
        </Badge>
      </Row>
      <div className="border-border divide-border w-full max-w-md divide-y rounded-lg border">
        {[
          { name: 'Inbox triage', runs: 128, tone: 'success' as const, status: 'Healthy' },
          { name: 'Lead enrichment', runs: 42, tone: 'warning' as const, status: 'Rate limited' },
          { name: 'Nightly DB backup', runs: 9, tone: 'destructive' as const, status: 'Failing' },
          { name: 'Changelog writer', runs: 3, tone: 'muted' as const, status: 'Paused' },
        ].map((agent) => (
          <div
            key={agent.name}
            className="flex items-center justify-between gap-3 px-3 py-2.5"
          >
            <span className="text-foreground truncate text-sm font-medium">{agent.name}</span>
            <div className="flex shrink-0 items-center gap-2">
              <Badge
                variant="accent"
                size="tabular"
              >
                {agent.runs}
              </Badge>
              <Badge
                variant={agent.tone}
                size="sm"
              >
                {agent.status}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  </Frame>
);
