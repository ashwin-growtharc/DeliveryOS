import { SpotlightCard } from './SpotlightCard';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

/** The pricing-style tier grid. The radial glow only paints while the pointer
 *  is inside a card (isHovered), so at rest these are plain bordered cards. */
export const PlanTiers = () => {
  const tiers = [
    {
      name: 'Free',
      price: '$0',
      cadence: 'forever',
      blurb: '2 agents, 5 sandbox hours a month.',
      features: ['2 concurrent agents', '5 sandbox hours', 'Community support'],
      cta: 'Current plan',
      primary: false,
    },
    {
      name: 'Pro',
      price: '$40',
      cadence: 'per seat / month',
      blurb: 'Unlimited agents and 150 sandbox hours.',
      features: ['Unlimited agents', '150 sandbox hours', 'Scheduled runs', 'Slack + GitHub'],
      cta: 'Upgrade to Pro',
      primary: true,
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      cadence: 'annual',
      blurb: 'Self-hosted sandboxes, SSO, audit log.',
      features: ['Dedicated sandbox pool', 'SAML SSO', 'Audit log export', 'Priority support'],
      cta: 'Talk to sales',
      primary: false,
    },
  ];

  return (
    <Frame>
      <div className="grid w-full gap-4 md:grid-cols-3">
        {tiers.map((tier) => (
          <SpotlightCard
            key={tier.name}
            className="border-border bg-popover border p-5"
            spotlightColor={tier.primary ? 'rgba(59, 130, 246, 0.1)' : undefined}
          >
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {tier.name}
                </p>
                <p className="text-2xl font-semibold">
                  {tier.price}{' '}
                  <span className="text-muted-foreground text-xs font-normal">{tier.cadence}</span>
                </p>
                <p className="text-muted-foreground text-sm">{tier.blurb}</p>
              </div>
              <ul className="space-y-1.5 text-sm">
                {tier.features.map((feature) => (
                  <li key={feature} className="text-muted-foreground flex items-center gap-2">
                    <span className="bg-kortix-green inline-block size-1.5 shrink-0 rounded-full" />
                    {feature}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={
                  tier.primary
                    ? 'bg-foreground text-background flex h-9 w-full cursor-pointer items-center justify-center rounded-md text-sm font-medium'
                    : 'border-border text-foreground hover:bg-foreground/5 flex h-9 w-full cursor-pointer items-center justify-center rounded-md border bg-transparent text-sm font-medium'
                }
              >
                {tier.cta}
              </button>
            </div>
          </SpotlightCard>
        ))}
      </div>
    </Frame>
  );
};

/** Integration cards — the other place this shape shows up, with an explicit
 *  per-card `spotlightColor` (the prop the default branch skips). */
export const IntegrationGrid = () => {
  const integrations = [
    {
      name: 'Slack',
      status: 'Connected · #eng-alerts',
      colour: 'rgba(74, 21, 75, 0.1)',
      initials: 'SL',
    },
    {
      name: 'GitHub',
      status: 'Connected · kortix-ai/suna',
      colour: 'rgba(110, 84, 148, 0.1)',
      initials: 'GH',
    },
    {
      name: 'Linear',
      status: 'Not connected',
      colour: 'rgba(94, 106, 210, 0.1)',
      initials: 'LI',
    },
    {
      name: 'Notion',
      status: 'Token expired — reconnect',
      colour: 'rgba(0, 0, 0, 0.1)',
      initials: 'NO',
    },
  ];

  return (
    <Frame>
      <div className="grid w-full gap-3 sm:grid-cols-2">
        {integrations.map((integration) => (
          <SpotlightCard
            key={integration.name}
            className="border-border bg-popover border p-4"
            spotlightColor={integration.colour}
          >
            <div className="flex items-center gap-3">
              <span className="bg-secondary text-foreground flex size-9 shrink-0 items-center justify-center rounded-md text-xs font-semibold">
                {integration.initials}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{integration.name}</p>
                <p className="text-muted-foreground truncate text-xs">{integration.status}</p>
              </div>
              <button
                type="button"
                className="border-border text-foreground hover:bg-foreground/5 flex h-7 shrink-0 cursor-pointer items-center justify-center rounded-sm border bg-transparent px-2.5 text-xs font-medium"
              >
                Manage
              </button>
            </div>
          </SpotlightCard>
        ))}
      </div>
    </Frame>
  );
};

/** One wide card, the shape the workspace hero uses. */
export const WorkspaceHero = () => (
  <Frame>
    <SpotlightCard className="border-border bg-popover w-full border p-6">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 space-y-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Growtharc workspace
          </p>
          <h2 className="text-xl font-semibold">7 agents, 3 running right now</h2>
          <p className="text-muted-foreground max-w-md text-sm">
            Sandbox leases renew every 30 seconds while a turn is active. Nothing has expired mid-run
            since the 17 Aug fix.
          </p>
        </div>
        <div className="flex gap-6">
          <div>
            <p className="font-mono text-2xl tabular-nums">18h</p>
            <p className="text-muted-foreground text-xs">Sandbox hours used</p>
          </div>
          <div>
            <p className="font-mono text-2xl tabular-nums">24,081</p>
            <p className="text-muted-foreground text-xs">Tool calls this month</p>
          </div>
        </div>
      </div>
    </SpotlightCard>
  </Frame>
);
