import { DefinitionList, DefinitionRow } from './DefinitionList';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="bg-muted rounded-sm px-1.5 py-0.5 font-mono text-xs">{children}</code>
);

const Dot = ({ className }: { className: string }) => (
  <span className={`inline-block size-1.5 shrink-0 rounded-full ${className}`} />
);

/** Sandbox detail sidebar — the default flat, dividerless list at the default
 *  110px label column. Long values truncate and keep a `title` tooltip. */
export const SandboxDetails = () => (
  <Frame>
    <div className="border-border bg-popover max-w-md rounded-md border p-4">
      <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
        Sandbox
      </p>
      <DefinitionList>
        <DefinitionRow label="Sandbox ID">
          <Code>sbx_7d41ac9e02b1</Code>
        </DefinitionRow>
        <DefinitionRow label="Region">us-east-1 · Ashburn, VA</DefinitionRow>
        <DefinitionRow label="Template">e2b-nodejs20</DefinitionRow>
        <DefinitionRow
          label="Image digest"
          title="sha256:3f9c1ab7de40c2b8ff5e6a91cd77042b8e1c9a5f4d2e7b0c6a3948175fe2cbd0"
        >
          <Code>sha256:3f9c1ab7de40c2b8ff5e6a91cd77042b8e1c9a5f4d2e7b0c6a3948175fe2cbd0</Code>
        </DefinitionRow>
        <DefinitionRow label="Created">17 Aug 2026, 09:14 UTC · 3h 22m ago</DefinitionRow>
        <DefinitionRow label="Owner">dharan.s@growtharc.com</DefinitionRow>
        <DefinitionRow label="State">
          <span className="inline-flex items-center gap-1.5">
            <Dot className="bg-emerald-500 animate-pulse" />
            Running · renews every 90s
          </span>
        </DefinitionRow>
      </DefinitionList>
    </div>
  </Frame>
);

/** `dividers` on — a 1px rule between every row plus top/bottom edges. Used
 *  when the list is the whole panel and needs its own rhythm. */
export const DeploymentPropertiesWithDividers = () => (
  <Frame>
    <div className="max-w-md">
      <p className="mb-2 text-sm font-medium">Deployment v2.14.0</p>
      <DefinitionList dividers>
        <DefinitionRow label="Status">
          <span className="inline-flex items-center gap-1.5">
            <Dot className="bg-emerald-500" />
            Live on production
          </span>
        </DefinitionRow>
        <DefinitionRow label="Commit">
          <Code>e9331d6</Code> Merge pull request #6484 — sandbox-active-turn-renewal
        </DefinitionRow>
        <DefinitionRow label="Promoted by">dharan.s@growtharc.com</DefinitionRow>
        <DefinitionRow label="Duration">1m 12s</DefinitionRow>
        <DefinitionRow label="Migrations">0142_add_run_authority · applied</DefinitionRow>
        <DefinitionRow label="Rollback to">v2.13.4 (14 Aug 2026)</DefinitionRow>
      </DefinitionList>
    </div>
  </Frame>
);

/** A wider `labelWidth` for longer keys, next to the default — the two side by
 *  side is the only way to see that the column really is configurable. */
export const LabelWidths = () => (
  <Frame>
    <div className="grid gap-8 md:grid-cols-2">
      <div>
        <p className="text-muted-foreground mb-2 text-xs">labelWidth default (110px)</p>
        <DefinitionList dividers>
          <DefinitionRow label="Agent">Invoice Reconciler</DefinitionRow>
          <DefinitionRow label="Trigger">Cron · 0 6 * * 1-5 (UTC)</DefinitionRow>
          <DefinitionRow label="Model">claude-opus-4-6</DefinitionRow>
          <DefinitionRow label="Runs">1,447 all-time · 12 today</DefinitionRow>
        </DefinitionList>
      </div>
      <div>
        <p className="text-muted-foreground mb-2 text-xs">labelWidth={'{160}'}</p>
        <DefinitionList dividers>
          <DefinitionRow label="Max concurrent sandboxes" labelWidth={160}>
            4 of 8 in use
          </DefinitionRow>
          <DefinitionRow label="Tool-call allowlist" labelWidth={160}>
            <Code>http.request</Code>, <Code>fs.write</Code>
          </DefinitionRow>
          <DefinitionRow label="Idle hibernation after" labelWidth={160}>
            15 minutes
          </DefinitionRow>
          <DefinitionRow label="Per-run wall-clock cap" labelWidth={160}>
            30 minutes
          </DefinitionRow>
        </DefinitionList>
      </div>
    </div>
  </Frame>
);
