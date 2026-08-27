import * as React from 'react';

import Hint from './Hint';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

const IconButton = React.forwardRef<HTMLButtonElement, React.ComponentProps<'button'>>(
  ({ className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={`text-muted-foreground hover:bg-foreground/5 hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-md border border-transparent transition-colors ${className ?? ''}`}
      {...props}
    />
  ),
);
IconButton.displayName = 'IconButton';

/**
 * The real usage: a run-toolbar of icon-only buttons, each explained by a Hint.
 * Tooltips are hover-driven, so a static screenshot of this export shows the
 * triggers only — hover a button to see the label.
 */
export const RunToolbar = () => (
  <Frame>
    <div className="space-y-3">
      <p className="text-muted-foreground text-xs">
        Hover any control — the label appears on the side each Hint asks for.
      </p>
      <div className="border-border flex w-fit items-center gap-1 rounded-md border p-1">
        <Hint label="Re-run with the same inputs" side="bottom">
          <IconButton aria-label="Re-run">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4">
              <path d="M20 11a8 8 0 1 0-2.3 5.7" strokeLinecap="round" />
              <path d="M20 4v7h-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconButton>
        </Hint>
        <Hint label="Stop this run and release the sandbox" side="bottom">
          <IconButton aria-label="Stop run">
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
              <rect x="5" y="5" width="14" height="14" rx="2" />
            </svg>
          </IconButton>
        </Hint>
        <Hint label="Download the full transcript as JSON" side="bottom">
          <IconButton aria-label="Download transcript">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4">
              <path d="M12 4v11m0 0 4-4m-4 4-4-4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5 19h14" strokeLinecap="round" />
            </svg>
          </IconButton>
        </Hint>
        <Hint
          label={
            <span className="flex items-center gap-1.5">
              Copy run ID <kbd>⌘C</kbd>
            </span>
          }
          side="bottom"
        >
          <IconButton aria-label="Copy run ID">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M15 5H6a1 1 0 0 0-1 1v9" strokeLinecap="round" />
            </svg>
          </IconButton>
        </Hint>
      </div>

      <div className="text-muted-foreground pt-2 text-sm">
        Usage this cycle{' '}
        <Hint label="Tokens billed across every agent in this workspace since 1 August." side="right">
          <span className="text-foreground decoration-muted-foreground/50 cursor-help underline decoration-dotted underline-offset-4">
            18.4M tokens
          </span>
        </Hint>{' '}
        of a 25M limit.
      </div>
    </div>
  </Frame>
);

/**
 * `HintProps` spreads `...props` straight onto Radix `Tooltip.Root`, so `open`
 * is a genuine prop of the real API — used here to pin the surface visible so
 * the tooltip's own styling (and each `side`) is inspectable without hovering.
 */
export const PinnedOpen = () => (
  <Frame>
    <div className="space-y-3">
      <p className="text-muted-foreground text-xs">
        Forced visible via the underlying Tooltip's <code>open</code> prop.
      </p>
      <div className="grid grid-cols-2 gap-x-10 gap-y-16 px-8 py-14">
        <Hint open label="Deploys to production on merge" side="top">
          <span className="border-border w-fit cursor-help rounded-md border px-2.5 py-1.5 text-sm">
            main branch
          </span>
        </Hint>
        <Hint open label="Sandbox lease renews every 30s while a turn is active" side="right">
          <span className="border-border w-fit cursor-help rounded-md border px-2.5 py-1.5 text-sm">
            sbx-4f2a91
          </span>
        </Hint>
        <Hint open label="Rotated 6 days ago by dharan.s@growtharc.com" side="bottom">
          <span className="border-border w-fit cursor-help rounded-md border px-2.5 py-1.5 font-mono text-sm">
            sk_live_••••7c2d
          </span>
        </Hint>
        <Hint open label="3 of 5 seats used on the Team plan" side="left">
          <span className="border-border w-fit cursor-help rounded-md border px-2.5 py-1.5 text-sm">
            growtharc
          </span>
        </Hint>
      </div>
    </div>
  </Frame>
);
