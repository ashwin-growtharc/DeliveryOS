import { List, ListRow } from './List';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="border-border overflow-hidden rounded-xl border">
    <div className="border-border bg-muted/30 border-b px-6 py-3">
      <p className="text-foreground text-sm font-medium">{title}</p>
    </div>
    {children}
  </div>
);

/* Small local presentational bits so the rows read like the real product
   without importing across component folders. */
const Pill = ({ tone, children }: { tone: string; children: React.ReactNode }) => (
  <span
    className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${tone}`}
  >
    {children}
  </span>
);
const Dot = ({ tone }: { tone: string }) => (
  <span className={`inline-block size-1.5 rounded-full ${tone}`} />
);
const Sub = ({ children }: { children: React.ReactNode }) => (
  <span className="text-muted-foreground text-xs">{children}</span>
);
const Meta = ({ children }: { children: React.ReactNode }) => (
  <span className="text-muted-foreground text-xs tabular-nums">{children}</span>
);
const Tile = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-md text-xs font-semibold">
    {children}
  </div>
);

/** Agents index — interactive rows, leading tile, status badge, trailing meta. */
export const AgentRows = () => (
  <Frame>
    <Card title="Agents · 5 deployed">
      <List>
        <ListRow
          leading={<Tile>RA</Tile>}
          title="Research assistant"
          badges={
            <Pill tone="bg-kortix-green/15 text-kortix-green">
              <Dot tone="bg-kortix-green" />
              <span className="ml-1">Running</span>
            </Pill>
          }
          subtitle={<Sub>Run #4821 · started 2m ago · 41 tool calls</Sub>}
          trailing={<Meta>$0.38</Meta>}
          onClick={() => {}}
        />
        <ListRow
          leading={<Tile>SD</Tile>}
          title="Sales digest"
          badges={<Pill tone="bg-muted text-muted-foreground">Scheduled</Pill>}
          subtitle={<Sub>Next run today at 17:00 UTC · daily</Sub>}
          trailing={<Meta>$1.24 / wk</Meta>}
          onClick={() => {}}
        />
        <ListRow
          leading={<Tile>IT</Tile>}
          title="Invoice triage"
          badges={
            <Pill tone="bg-kortix-yellow/15 text-kortix-yellow">Rate limited</Pill>
          }
          subtitle={<Sub>Paused after 3 retries · Gmail quota exceeded</Sub>}
          trailing={<Meta>18 queued</Meta>}
          onClick={() => {}}
        />
        <ListRow
          leading={<Tile>CS</Tile>}
          title="Competitor scan"
          badges={<Pill tone="bg-kortix-red/15 text-kortix-red">Failed</Pill>}
          subtitle={<Sub>Run #4809 · tool call `browser.navigate` timed out</Sub>}
          trailing={<Meta>4h ago</Meta>}
          onClick={() => {}}
        />
        <ListRow
          leading={<Tile>OB</Tile>}
          title="Onboarding bot"
          badges={<Pill tone="bg-muted text-muted-foreground">Draft</Pill>}
          subtitle={<Sub>Never deployed · edited by dharan.s 3 days ago</Sub>}
          trailing={<Meta>—</Meta>}
          onClick={() => {}}
        />
      </List>
    </Card>
  </Frame>
);

/** Compact rows — the dense variant used for API keys and sandboxes. */
export const CompactRows = () => (
  <Frame>
    <div className="space-y-6">
      <Card title="API keys">
        <List>
          <ListRow
            compact
            title="Production — server"
            badges={<Pill tone="bg-kortix-blue/15 text-kortix-blue">live</Pill>}
            subtitle={<Sub>sk_live_·····9f2c · last used 6 min ago</Sub>}
            trailing={<Meta>created Mar 4</Meta>}
          />
          <ListRow
            compact
            title="Staging — CI"
            badges={<Pill tone="bg-muted text-muted-foreground">test</Pill>}
            subtitle={<Sub>sk_test_·····41ab · last used yesterday</Sub>}
            trailing={<Meta>created Feb 19</Meta>}
          />
          <ListRow
            compact
            title="Zapier integration"
            badges={<Pill tone="bg-kortix-red/15 text-kortix-red">revoked</Pill>}
            subtitle={<Sub>sk_live_·····c07d · revoked by dharan.s</Sub>}
            trailing={<Meta>created Jan 8</Meta>}
          />
          <ListRow
            compact
            title="Local dev — dharan"
            badges={<Pill tone="bg-muted text-muted-foreground">test</Pill>}
            subtitle={<Sub>sk_test_·····2e55 · never used</Sub>}
            trailing={<Meta>created 2 days ago</Meta>}
          />
        </List>
      </Card>

      <Card title="Active sandboxes">
        <List>
          <ListRow
            compact
            title="sbx-7f2c9a"
            subtitle={<Sub>4 vCPU · 8 GB · us-east-1 · up 12m</Sub>}
            trailing={<Meta>research-assistant</Meta>}
          />
          <ListRow
            compact
            title="sbx-31d0e4"
            subtitle={<Sub>2 vCPU · 4 GB · eu-west-1 · up 1h 04m</Sub>}
            trailing={<Meta>sales-digest</Meta>}
          />
          <ListRow
            compact
            title="sbx-a90b17"
            subtitle={<Sub>1 vCPU · 2 GB · us-east-1 · idle 9m, stops in 6m</Sub>}
            trailing={<Meta>invoice-triage</Meta>}
          />
          <ListRow
            compact
            title="sbx-c4e8f2"
            subtitle={<Sub>2 vCPU · 4 GB · ap-south-1 · draining</Sub>}
            trailing={<Meta>competitor-scan</Meta>}
          />
        </List>
      </Card>
    </div>
  </Frame>
);

/** Non-interactive rows carrying their own trailing controls. */
export const IntegrationRows = () => (
  <Frame>
    <Card title="Integrations">
      <List>
        <ListRow
          leading={<Tile>SL</Tile>}
          title="Slack"
          badges={<Pill tone="bg-kortix-green/15 text-kortix-green">Connected</Pill>}
          subtitle={<Sub>kortix.slack.com · 3 channels · 14 tools exposed</Sub>}
          trailing={
            <button className="border-border text-foreground hover:bg-foreground/5 h-7 rounded-sm border px-2.5 text-xs">
              Manage
            </button>
          }
        />
        <ListRow
          leading={<Tile>GH</Tile>}
          title="GitHub"
          badges={<Pill tone="bg-kortix-green/15 text-kortix-green">Connected</Pill>}
          subtitle={<Sub>kortix-ai/suna · read + write on 2 repos</Sub>}
          trailing={
            <button className="border-border text-foreground hover:bg-foreground/5 h-7 rounded-sm border px-2.5 text-xs">
              Manage
            </button>
          }
        />
        <ListRow
          leading={<Tile>GM</Tile>}
          title="Gmail"
          badges={<Pill tone="bg-kortix-yellow/15 text-kortix-yellow">Needs re-auth</Pill>}
          subtitle={<Sub>dharan.s@growtharc.com · token expired 2 days ago</Sub>}
          trailing={
            <button className="bg-foreground text-background hover:bg-foreground/90 h-7 rounded-sm px-2.5 text-xs">
              Reconnect
            </button>
          }
        />
        <ListRow
          leading={<Tile>NO</Tile>}
          title="Notion"
          subtitle={<Sub>Not connected · needed by 1 agent</Sub>}
          trailing={
            <button className="border-border text-foreground hover:bg-foreground/5 h-7 rounded-sm border px-2.5 text-xs">
              Connect
            </button>
          }
        />
      </List>
    </Card>
  </Frame>
);
