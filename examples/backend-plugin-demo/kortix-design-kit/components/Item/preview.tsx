import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from './Item';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

const svg = 'http://www.w3.org/2000/svg';
const strokeProps = {
  xmlns: svg,
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

const TerminalIcon = ({ className }: { className?: string }) => (
  <svg {...strokeProps} className={className}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" x2="20" y1="19" y2="19" />
  </svg>
);

const KeyIcon = ({ className }: { className?: string }) => (
  <svg {...strokeProps} className={className}>
    <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
    <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
  </svg>
);

const LinkIcon = ({ className }: { className?: string }) => (
  <svg {...strokeProps} className={className}>
    <path d="M9 17H7A5 5 0 0 1 7 7h2" />
    <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
    <line x1="8" x2="16" y1="12" y2="12" />
  </svg>
);

const GhostBtn = ({ children }: { children: React.ReactNode }) => (
  <button
    type="button"
    className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground h-7 rounded-sm px-2.5 text-xs font-medium"
  >
    {children}
  </button>
);

const SolidBtn = ({ children }: { children: React.ReactNode }) => (
  <button
    type="button"
    className="bg-foreground text-background hover:bg-foreground/90 h-7 rounded-sm px-2.5 text-xs font-medium"
  >
    {children}
  </button>
);

/** Settings → Integrations list: icon media, title + description, row actions,
 *  hairline separators between rows. */
export const IntegrationRows = () => (
  <Frame>
    <ItemGroup className="border-border bg-popover rounded-md border">
      <Item size="sm">
        <ItemMedia variant="icon">
          <LinkIcon />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Slack</ItemTitle>
          <ItemDescription>
            Connected to #eng-alerts as kortix-bot · last synced 4 minutes ago
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <GhostBtn>Disconnect</GhostBtn>
          <SolidBtn>Configure</SolidBtn>
        </ItemActions>
      </Item>
      <ItemSeparator />
      <Item size="sm">
        <ItemMedia variant="icon">
          <TerminalIcon />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>GitHub</ItemTitle>
          <ItemDescription>
            kortix-ai/suna · 3 repositories granted, push access on main
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <GhostBtn>Disconnect</GhostBtn>
          <SolidBtn>Configure</SolidBtn>
        </ItemActions>
      </Item>
      <ItemSeparator />
      <Item size="sm">
        <ItemMedia variant="icon">
          <KeyIcon />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Linear</ItemTitle>
          <ItemDescription>
            Not connected — agents cannot open or close issues yet
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <SolidBtn>Connect</SolidBtn>
        </ItemActions>
      </Item>
    </ItemGroup>
  </Frame>
);

/** All three variants × both sizes, on real agent-roster content. */
export const VariantsAndSizes = () => (
  <Frame>
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">variant="default" · size="default"</p>
        <Item>
          <ItemMedia variant="icon">
            <BotIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Release Notes Writer</ItemTitle>
            <ItemDescription>
              Runs on every tag push · 142 runs this month · avg 38s
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <GhostBtn>Run now</GhostBtn>
          </ItemActions>
        </Item>
      </div>

      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">variant="outline" · size="default"</p>
        <Item variant="outline">
          <ItemMedia variant="icon">
            <TerminalIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Sandbox us-east-1 · e2b-nodejs20</ItemTitle>
            <ItemDescription>
              Idle for 11 minutes — will hibernate automatically at 15 minutes
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <GhostBtn>Keep awake</GhostBtn>
          </ItemActions>
        </Item>
      </div>

      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">variant="muted" · size="sm"</p>
        <Item variant="muted" size="sm">
          <ItemMedia variant="icon">
            <KeyIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>sk_live_••••••4f2a</ItemTitle>
            <ItemDescription>Production key · created 12 Mar 2026 by dharan.s</ItemDescription>
          </ItemContent>
          <ItemActions>
            <GhostBtn>Revoke</GhostBtn>
          </ItemActions>
        </Item>
      </div>
    </div>
  </Frame>
);

/** Header + footer slots (both `basis-full`, so they wrap to their own line)
 *  and the `image` media variant, on a workspace-member card. */
export const HeaderFooterAndImageMedia = () => (
  <Frame>
    <Item variant="outline" className="max-w-md">
      <ItemHeader>
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Workspace owner
        </span>
        <span className="bg-kortix-green/10 text-kortix-green rounded-2xl px-2 py-0.5 text-xs font-medium">
          Active
        </span>
      </ItemHeader>
      <ItemMedia variant="image">
        <img
          alt="Dharan S"
          src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><rect width='40' height='40' fill='%234f46e5'/><text x='20' y='27' font-size='18' fill='white' text-anchor='middle' font-family='sans-serif'>DS</text></svg>"
        />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>Dharan S</ItemTitle>
        <ItemDescription>dharan.s@growtharc.com · joined 8 Jan 2026</ItemDescription>
      </ItemContent>
      <ItemActions>
        <GhostBtn>Change role</GhostBtn>
      </ItemActions>
      <ItemFooter>
        <span className="text-muted-foreground text-xs">
          Seat 1 of 5 · 12.4k tool calls this cycle
        </span>
        <span className="text-muted-foreground text-xs">Last active 2 min ago</span>
      </ItemFooter>
    </Item>
  </Frame>
);
