import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from './Empty';
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

const BotIcon = ({ className }: { className?: string }) => (
  <svg {...strokeProps} className={className}>
    <path d="M12 8V4H8" />
    <rect width="16" height="12" x="4" y="8" rx="2" />
    <path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
  </svg>
);

const SearchIcon = ({ className }: { className?: string }) => (
  <svg {...strokeProps} className={className}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

const KeyIcon = ({ className }: { className?: string }) => (
  <svg {...strokeProps} className={className}>
    <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
    <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
  </svg>
);

const PlusIcon = ({ className }: { className?: string }) => (
  <svg {...strokeProps} className={className}>
    <path d="M5 12h14M12 5v14" />
  </svg>
);

const SolidBtn = ({ children }: { children: React.ReactNode }) => (
  <button
    type="button"
    className="bg-foreground text-background hover:bg-foreground/90 flex h-9 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium [&_svg]:size-4"
  >
    {children}
  </button>
);

const OutlineBtn = ({ children }: { children: React.ReactNode }) => (
  <button
    type="button"
    className="border-border text-foreground hover:bg-foreground/5 flex h-8 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium [&_svg]:size-4"
  >
    {children}
  </button>
);

/** The canonical first-run empty state: `variant="icon"` media tile, specific
 *  copy, one primary action. This is what /agents shows on a fresh workspace. */
export const NoAgentsYet = () => (
  <Frame>
    <Empty className="border-border border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BotIcon />
        </EmptyMedia>
        <EmptyTitle>No agents yet</EmptyTitle>
        <EmptyDescription>
          No agents yet — deploy your first one to start automating. Agents run in their own sandbox
          and can be triggered on a schedule, by webhook, or from Slack.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <SolidBtn>
          <PlusIcon />
          Deploy an agent
        </SolidBtn>
        <p className="text-muted-foreground text-xs">
          Or start from a template — <a href="#">browse 24 prebuilt agents</a>
        </p>
      </EmptyContent>
    </Empty>
  </Frame>
);

/** Filtered-to-nothing state — the "your search matched nothing" variant, with
 *  a secondary escape hatch rather than a primary create action. */
export const NoRunsMatchFilters = () => (
  <Frame>
    <Empty className="border-border bg-popover border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchIcon />
        </EmptyMedia>
        <EmptyTitle>No runs match these filters</EmptyTitle>
        <EmptyDescription>
          Nothing for status <span className="text-foreground/90 font-medium">failed</span> on
          Invoice Reconciler in the last 24 hours. Try widening the time range to 7 days.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <OutlineBtn>Clear all filters</OutlineBtn>
      </EmptyContent>
    </Empty>
  </Frame>
);

/** `variant="default"` media (no tile) inside a dashed container — the inline
 *  panel shape used inside Settings cards, where a full page state is too loud. */
export const NoApiKeys = () => (
  <Frame>
    <Empty className="border-border border border-dashed p-6 md:p-8">
      <EmptyHeader>
        <EmptyMedia className="text-muted-foreground">
          <KeyIcon className="size-8" />
        </EmptyMedia>
        <EmptyTitle>No API keys</EmptyTitle>
        <EmptyDescription>
          Create a key to call the Suna API from CI or your own backend. Keys are shown once at
          creation and are scoped to this workspace.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <SolidBtn>
          <PlusIcon />
          Create API key
        </SolidBtn>
      </EmptyContent>
    </Empty>
  </Frame>
);
