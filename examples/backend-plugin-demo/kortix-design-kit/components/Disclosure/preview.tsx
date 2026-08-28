import * as React from 'react';

import {
  Disclosure,
  DisclosureBody,
  DisclosureContent,
  DisclosureTrigger,
} from './Disclosure';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

const Chevron = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className="text-muted-foreground size-4 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-180"
  >
    <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const TriggerRow = ({
  name,
  meta,
  tone,
  status,
}: {
  name: string;
  meta: string;
  tone: string;
  status: string;
}) => (
  <div className="hover:bg-foreground/3 flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors">
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{name}</p>
      <p className="text-muted-foreground truncate text-xs">{meta}</p>
    </div>
    <span className={`shrink-0 text-xs font-medium ${tone}`}>{status}</span>
    <Chevron />
  </div>
);

const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 py-1">
    <span className="text-muted-foreground text-xs">{label}</span>
    <span className="text-foreground text-right text-xs">{value}</span>
  </div>
);

/**
 * The canonical config-entity pattern: `variant="outline"`, a trigger row naming
 * the entity, and the entity's detail underneath. The first one is `defaultOpen`
 * so the pattern reads as a real settings list rather than a stack of shells.
 */
export const ConnectedIntegrations = () => (
  <Frame>
    <div className="max-w-lg space-y-2">
      <p className="text-muted-foreground text-xs">Integrations · growtharc workspace</p>

      <Disclosure variant="outline" defaultOpen>
        <DisclosureTrigger variant="outline">
          <TriggerRow
            name="Slack"
            meta="growtharc.slack.com · 3 channels"
            tone="text-kortix-green"
            status="Connected"
          />
        </DisclosureTrigger>
        <DisclosureContent variant="outline">
          <DisclosureBody className="border-border/60 space-y-0 border-t pt-3">
            <Field label="Authorised by" value="dharan.s@growtharc.com" />
            <Field label="Scopes" value="chat:write · channels:read · files:write" />
            <Field label="Posts to" value="#eng-alerts, #releases, #suna-runs" />
            <Field label="Last delivery" value="4 minutes ago · 200 OK" />
          </DisclosureBody>
        </DisclosureContent>
      </Disclosure>

      <Disclosure variant="outline">
        <DisclosureTrigger variant="outline">
          <TriggerRow
            name="Linear"
            meta="Team ENG · issue sync every 5m"
            tone="text-kortix-green"
            status="Connected"
          />
        </DisclosureTrigger>
        <DisclosureContent variant="outline">
          <DisclosureBody className="border-border/60 space-y-0 border-t pt-3">
            <Field label="Authorised by" value="ashwin@growtharc.com" />
            <Field label="Synced projects" value="Sandbox lifecycle, Release tooling" />
            <Field label="Creates issues as" value="Suna (bot)" />
            <Field label="Last sync" value="2 minutes ago · 14 issues updated" />
          </DisclosureBody>
        </DisclosureContent>
      </Disclosure>

      <Disclosure variant="outline" defaultOpen>
        <DisclosureTrigger variant="outline">
          <TriggerRow
            name="Notion"
            meta="Token expired 4 days ago"
            tone="text-kortix-yellow"
            status="Reauthorise"
          />
        </DisclosureTrigger>
        <DisclosureContent variant="outline">
          <DisclosureBody className="border-border/60 space-y-0 border-t pt-3">
            <Field label="Failing since" value="13 Aug, 02:11 UTC" />
            <Field label="Error" value="invalid_grant — refresh token revoked" />
            <Field label="Blocked runs" value="6 (docs-link-checker, usage-report-builder)" />
            <p className="text-muted-foreground pt-2 text-xs">
              Reconnect the workspace to resume the docs sync — queued runs will pick up
              automatically.
            </p>
          </DisclosureBody>
        </DisclosureContent>
      </Disclosure>
    </div>
  </Frame>
);

/**
 * Controlled + exclusive, the way the session transcript uses it: one tool call
 * expanded at a time, `open`/`onOpenChange` owned by the list. The hooks sit in
 * this nested component because the preview harness calls each exported variant
 * as a plain function to read its element — a variant body must stay a hook-free
 * JSX factory.
 */
const TranscriptList = () => {
  const [openId, setOpenId] = React.useState<string | null>('shell');

  const calls = [
    {
      id: 'shell',
      name: 'shell',
      meta: 'pnpm build --filter @kortix/web',
      tone: 'text-kortix-green',
      status: '18.2s',
      body: (
        <pre className="text-muted-foreground overflow-x-auto font-mono text-xs whitespace-pre">
          {'> 42 packages built\n> 0 errors, 3 warnings\n> .next/ 41.8 MB'}
        </pre>
      ),
    },
    {
      id: 'read_file',
      name: 'read_file',
      meta: 'apps/api/src/sandbox/lifecycle.py',
      tone: 'text-kortix-green',
      status: '0.4s',
      body: (
        <p className="text-muted-foreground text-xs">
          Read 214 lines. Renewal loop ticks every 30s while a turn is active; the lease is revoked
          on stop.
        </p>
      ),
    },
    {
      id: 'create_pr',
      name: 'github.create_pr',
      meta: 'kortix-ai/suna · sandbox-active-turn-renewal',
      tone: 'text-kortix-blue',
      status: 'Awaiting approval',
      body: (
        <p className="text-muted-foreground text-xs">
          Draft PR #6484 — “fix(sandbox): renew active turns on fast cadence”. Needs one reviewer
          before it can merge.
        </p>
      ),
    },
    {
      id: 'post_message',
      name: 'slack.post_message',
      meta: '#eng-alerts',
      tone: 'text-kortix-red',
      status: 'Rejected',
      body: (
        <p className="text-muted-foreground text-xs">
          Blocked at the tool gateway: this agent does not hold the{' '}
          <span className="text-foreground">chat:write</span> scope for #eng-alerts.
        </p>
      ),
    },
  ];

  return (
      <div className="max-w-lg space-y-2">
        <p className="text-muted-foreground text-xs">
          run_9f21c4 · release-notes-drafter · 4 tool calls
        </p>
        {calls.map((call) => (
          <Disclosure
            key={call.id}
            variant="outline"
            open={openId === call.id}
            onOpenChange={(next) => setOpenId(next ? call.id : null)}
          >
            <DisclosureTrigger variant="outline">
              <TriggerRow
                name={call.name}
                meta={call.meta}
                tone={call.tone}
                status={call.status}
              />
            </DisclosureTrigger>
            <DisclosureContent variant="outline">
              <DisclosureBody className="border-border/60 border-t pt-3">{call.body}</DisclosureBody>
            </DisclosureContent>
          </Disclosure>
        ))}
      </div>
  );
};

/** One tool call expanded at a time — the transcript's exclusive accordion. */
export const ToolCallTranscript = () => (
  <Frame>
    <TranscriptList />
  </Frame>
);
