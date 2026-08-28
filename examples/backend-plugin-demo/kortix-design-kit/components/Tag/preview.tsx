import { Tag } from './Tag';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

/** One instance per tone, each labelled with the copy that tone is for. */
export const Tones = () => (
  <Frame>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tag>Anthropic</Tag>
        <Tag variant="free">Free</Tag>
        <Tag variant="latest">Latest</Tag>
        <Tag variant="new">New</Tag>
        <Tag variant="custom">Custom endpoint</Tag>
        <Tag variant="warning">Rate limited</Tag>
      </div>
      <div className="text-muted-foreground space-y-1 text-xs">
        <p>
          <span className="text-foreground font-medium">default / custom</span> — provenance, no
          judgement: provider name, self-hosted model, BYO key.
        </p>
        <p>
          <span className="text-foreground font-medium">free</span> — costs nothing to run on the
          current plan.
        </p>
        <p>
          <span className="text-foreground font-medium">latest</span> — newest release in its
          family.
        </p>
        <p>
          <span className="text-foreground font-medium">new</span> — added since the user last
          looked.
        </p>
        <p>
          <span className="text-foreground font-medium">warning</span> — usable but degraded:
          throttled, deprecating, near a limit.
        </p>
      </div>
    </div>
  </Frame>
);

/** Where Tag actually lives: the model picker, tagging each row's status. */
export const ModelPicker = () => (
  <Frame>
    <div className="border-border divide-border max-w-md divide-y rounded-xl border">
      {[
        {
          name: 'Claude Opus 4.6',
          meta: '200K context · $15 / 1M in',
          tags: [
            { label: 'Latest', variant: 'latest' as const },
            { label: 'Recommended', variant: 'new' as const },
          ],
        },
        {
          name: 'Claude Sonnet 4.5',
          meta: '200K context · $3 / 1M in',
          tags: [{ label: 'Anthropic', variant: 'default' as const }],
        },
        {
          name: 'Claude Haiku 4.5',
          meta: '200K context · included in Team',
          tags: [{ label: 'Free', variant: 'free' as const }],
        },
        {
          name: 'Kimi K2 (self-hosted)',
          meta: 'Your vLLM endpoint · eu-west-1',
          tags: [
            { label: 'Custom endpoint', variant: 'custom' as const },
            { label: 'Rate limited', variant: 'warning' as const },
          ],
        },
        {
          name: 'GPT-4o mini',
          meta: 'Deprecating 30 Sep — migrate runs',
          tags: [{ label: 'Deprecating', variant: 'warning' as const }],
        },
      ].map((model) => (
        <div
          key={model.name}
          className="flex items-center justify-between gap-3 px-3 py-2.5"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-foreground truncate text-sm font-medium">{model.name}</span>
              {model.tags.map((t) => (
                <Tag
                  key={t.label}
                  variant={t.variant}
                >
                  {t.label}
                </Tag>
              ))}
            </div>
            <p className="text-muted-foreground truncate text-xs">{model.meta}</p>
          </div>
        </div>
      ))}
    </div>
  </Frame>
);

/** Inline in headings and nav — the density Tag is sized for (h≈18px). */
export const InlineInNav = () => (
  <Frame>
    <div className="max-w-xs space-y-5">
      <div className="space-y-1">
        <h3 className="text-foreground flex items-center gap-2 text-base font-semibold">
          Scheduled triggers
          <Tag variant="new">New</Tag>
        </h3>
        <p className="text-muted-foreground text-xs">
          Run an agent on a cron without keeping a sandbox warm.
        </p>
      </div>
      <nav className="space-y-0.5">
        {[
          { label: 'Agents', tag: null },
          { label: 'Runs', tag: null },
          { label: 'Sandboxes', tag: { label: 'Beta', variant: 'new' as const } },
          { label: 'Integrations', tag: { label: '3 need auth', variant: 'warning' as const } },
          { label: 'Usage & billing', tag: { label: 'Free plan', variant: 'free' as const } },
        ].map((item) => (
          <div
            key={item.label}
            className="hover:bg-foreground/5 flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5"
          >
            <span className="text-foreground text-sm">{item.label}</span>
            {item.tag ? <Tag variant={item.tag.variant}>{item.tag.label}</Tag> : null}
          </div>
        ))}
      </nav>
    </div>
  </Frame>
);
