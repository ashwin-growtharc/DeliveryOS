import * as React from 'react';

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsListCompact,
  TabsTrigger,
  TabsTriggerCompact,
} from './Tabs';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-3">
    <p className="text-muted-foreground text-xs">{label}</p>
    {children}
  </div>
);

const RunRow = ({
  agent,
  trigger,
  duration,
  tone,
  status,
}: {
  agent: string;
  trigger: string;
  duration: string;
  tone: string;
  status: string;
}) => (
  <div className="border-border/60 flex items-center justify-between border-b py-2 last:border-b-0">
    <div className="min-w-0">
      <p className="text-foreground truncate text-sm font-medium">{agent}</p>
      <p className="text-muted-foreground truncate text-xs">{trigger}</p>
    </div>
    <div className="flex shrink-0 items-center gap-4">
      <span className="text-muted-foreground font-mono text-xs">{duration}</span>
      <span className={`text-xs font-medium ${tone}`}>{status}</span>
    </div>
  </div>
);

/** The workspace's primary tab bar: the default filled-pill `TabsList` with the
 *  sliding indicator (`animate="fluid"`), one panel of real content per tab. */
export const WorkspaceTabs = () => (
  <Frame>
    <Tabs defaultValue="runs" className="w-full">
      <TabsList>
        <TabsTrigger value="runs">Runs</TabsTrigger>
        <TabsTrigger value="sandboxes">Sandboxes</TabsTrigger>
        <TabsTrigger value="integrations">Integrations</TabsTrigger>
        <TabsTrigger value="api-keys">API keys</TabsTrigger>
      </TabsList>

      <TabsContent value="runs" className="pt-3">
        <RunRow
          agent="release-notes-drafter"
          trigger="Scheduled · daily 09:00 UTC"
          duration="1m 12s"
          tone="text-kortix-green"
          status="Succeeded"
        />
        <RunRow
          agent="pr-triage"
          trigger="Webhook · kortix-ai/suna #6484"
          duration="24s"
          tone="text-kortix-green"
          status="Succeeded"
        />
        <RunRow
          agent="migration-reviewer"
          trigger="Manual · dharan.s@growtharc.com"
          duration="3m 05s"
          tone="text-kortix-yellow"
          status="Needs review"
        />
        <RunRow
          agent="prod-incident-summariser"
          trigger="Alert · ECS task restart loop"
          duration="8s"
          tone="text-kortix-red"
          status="Failed"
        />
      </TabsContent>

      <TabsContent value="sandboxes" className="pt-3">
        <RunRow
          agent="sbx-4f2a91"
          trigger="suna/apps/web · node 22 · 2 vCPU"
          duration="14m idle"
          tone="text-kortix-green"
          status="Running"
        />
        <RunRow
          agent="sbx-0c77de"
          trigger="suna/apps/api · python 3.12 · 4 vCPU"
          duration="2h idle"
          tone="text-muted-foreground"
          status="Hibernated"
        />
        <RunRow
          agent="sbx-91bb04"
          trigger="packages/db migrations · node 22"
          duration="47s"
          tone="text-kortix-blue"
          status="Provisioning"
        />
      </TabsContent>

      <TabsContent value="integrations" className="pt-3">
        <RunRow
          agent="Slack"
          trigger="growtharc.slack.com · 3 channels"
          duration="OAuth"
          tone="text-kortix-green"
          status="Connected"
        />
        <RunRow
          agent="Linear"
          trigger="Team ENG · issue sync every 5m"
          duration="OAuth"
          tone="text-kortix-green"
          status="Connected"
        />
        <RunRow
          agent="Notion"
          trigger="Token expired 4 days ago"
          duration="OAuth"
          tone="text-kortix-yellow"
          status="Reauthorise"
        />
      </TabsContent>

      <TabsContent value="api-keys" className="pt-3">
        <RunRow
          agent="CI — GitHub Actions"
          trigger="sk_live_••••7c2d · created 12 Mar"
          duration="last used 4m ago"
          tone="text-kortix-green"
          status="Active"
        />
        <RunRow
          agent="Staging smoke tests"
          trigger="sk_test_••••10ab · created 2 Feb"
          duration="last used 6d ago"
          tone="text-kortix-green"
          status="Active"
        />
        <RunRow
          agent="Ashwin — local"
          trigger="sk_live_••••44f9 · created 30 Jan"
          duration="revoked 8 Aug"
          tone="text-kortix-red"
          status="Revoked"
        />
      </TabsContent>
    </Tabs>
  </Frame>
);

/** The other two list shapes: the flat `type="underline"` rule used on settings
 *  pages, and the bordered `variant="outline"` chip with `animate="none"`. */
export const UnderlineAndOutline = () => (
  <Frame>
    <div className="space-y-8">
      <Section label='type="underline" — agent detail header'>
        <Tabs defaultValue="prompt" className="w-full">
          <TabsList type="underline" className="w-full justify-start">
            <TabsTrigger value="prompt">System prompt</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="triggers">Triggers</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
          </TabsList>
          <TabsContent value="prompt" className="pt-3">
            <p className="text-muted-foreground text-sm">
              You are Suna, a release engineer for the kortix-ai/suna monorepo. Draft changelog
              entries from the git log since the last promote, one bullet per user-visible change.
            </p>
          </TabsContent>
          <TabsContent value="tools" className="text-muted-foreground pt-3 text-sm">
            4 tools enabled — <span className="text-foreground">shell</span>,{' '}
            <span className="text-foreground">read_file</span>,{' '}
            <span className="text-foreground">github.create_pr</span>,{' '}
            <span className="text-foreground">slack.post_message</span>.
          </TabsContent>
          <TabsContent value="triggers" className="text-muted-foreground pt-3 text-sm">
            Runs on <span className="text-foreground">push to main</span> and on a{' '}
            <span className="text-foreground">daily 09:00 UTC</span> schedule.
          </TabsContent>
          <TabsContent value="usage" className="text-muted-foreground pt-3 text-sm">
            <span className="text-foreground">18.4M</span> tokens this cycle ·{' '}
            <span className="text-foreground">$62.10</span> of a $250 limit.
          </TabsContent>
        </Tabs>
      </Section>

      <Section label='TabsTrigger variant="outline" + animate="none" — deployment target'>
        <Tabs defaultValue="staging" className="w-full">
          <TabsList animate="none">
            <TabsTrigger value="production" variant="outline">
              Production
            </TabsTrigger>
            <TabsTrigger value="staging" variant="outline">
              Staging
            </TabsTrigger>
            <TabsTrigger value="dev" variant="outline">
              Dev
            </TabsTrigger>
          </TabsList>
          <TabsContent value="production" className="text-muted-foreground pt-3 text-sm">
            v2.41.0 · promoted 3 days ago · 4 ECS tasks healthy in eu-west-1.
          </TabsContent>
          <TabsContent value="staging" className="text-muted-foreground pt-3 text-sm">
            v2.42.0-rc.2 · deployed 26 minutes ago · 2 ECS tasks healthy, migrations up to date.
          </TabsContent>
          <TabsContent value="dev" className="text-muted-foreground pt-3 text-sm">
            Tracks main on every push · 1 ECS task · seeded from the staging snapshot.
          </TabsContent>
        </Tabs>
      </Section>
    </div>
  </Frame>
);

/** `TabsListCompact` / `TabsTriggerCompact` — the smaller bar used inside panels
 *  and side rails, here filtering a run list. */
export const CompactRunFilter = () => (
  <Frame>
    <div className="space-y-8">
      <Section label="TabsListCompact — run filter inside a panel">
        <Tabs defaultValue="failed" className="w-full">
          <TabsListCompact>
            <TabsTriggerCompact value="all">All runs</TabsTriggerCompact>
            <TabsTriggerCompact value="failed">Failed</TabsTriggerCompact>
            <TabsTriggerCompact value="running">Running</TabsTriggerCompact>
            <TabsTriggerCompact value="queued">Queued</TabsTriggerCompact>
          </TabsListCompact>
          <TabsContent value="all" className="pt-3">
            <RunRow
              agent="release-notes-drafter"
              trigger="Scheduled · daily 09:00 UTC"
              duration="1m 12s"
              tone="text-kortix-green"
              status="Succeeded"
            />
            <RunRow
              agent="pr-triage"
              trigger="Webhook · kortix-ai/suna #6484"
              duration="24s"
              tone="text-kortix-green"
              status="Succeeded"
            />
          </TabsContent>
          <TabsContent value="failed" className="pt-3">
            <RunRow
              agent="prod-incident-summariser"
              trigger="Alert · ECS task restart loop"
              duration="8s"
              tone="text-kortix-red"
              status="Tool call timed out"
            />
            <RunRow
              agent="usage-report-builder"
              trigger="Scheduled · weekly Mon 07:00"
              duration="2m 41s"
              tone="text-kortix-red"
              status="Sandbox evicted"
            />
          </TabsContent>
          <TabsContent value="running" className="pt-3">
            <RunRow
              agent="migration-reviewer"
              trigger="Manual · dharan.s@growtharc.com"
              duration="1m 08s"
              tone="text-kortix-blue"
              status="Streaming"
            />
          </TabsContent>
          <TabsContent value="queued" className="pt-3">
            <RunRow
              agent="docs-link-checker"
              trigger="Waiting on sandbox capacity"
              duration="queued 12s"
              tone="text-muted-foreground"
              status="Queued"
            />
          </TabsContent>
        </Tabs>
      </Section>

      <Section label='TabsListCompact type="underline" — same bar, flat rule'>
        <Tabs defaultValue="stdout" className="w-full">
          <TabsListCompact type="underline">
            <TabsTriggerCompact value="stdout">stdout</TabsTriggerCompact>
            <TabsTriggerCompact value="stderr">stderr</TabsTriggerCompact>
            <TabsTriggerCompact value="tool-calls">Tool calls</TabsTriggerCompact>
          </TabsListCompact>
          <TabsContent value="stdout" className="text-muted-foreground pt-3 font-mono text-xs">
            pnpm build — 42 packages, 0 errors, 18.2s
          </TabsContent>
          <TabsContent value="stderr" className="text-kortix-red pt-3 font-mono text-xs">
            error: sandbox sbx-91bb04 lost its lease mid-turn
          </TabsContent>
          <TabsContent value="tool-calls" className="text-muted-foreground pt-3 font-mono text-xs">
            shell(3) · read_file(11) · github.create_pr(1)
          </TabsContent>
        </Tabs>
      </Section>
    </div>
  </Frame>
);
