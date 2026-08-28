import { Separator } from './Separator';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

/** Horizontal: the seam between sections of a settings panel. */
export const PanelSeams = () => (
  <Frame>
    <div className="border-border max-w-xl rounded-xl border">
      <div className="space-y-1 p-5">
        <p className="text-foreground text-sm font-medium">Workspace</p>
        <p className="text-muted-foreground text-xs">
          Growth Arc · 12 teammates · created March 4, 2026
        </p>
      </div>

      <Separator />

      <div className="space-y-1 p-5">
        <p className="text-foreground text-sm font-medium">Default sandbox</p>
        <p className="text-muted-foreground text-xs">
          4 vCPU · 8 GB · us-east-1 · auto-stops after 15 minutes idle
        </p>
      </div>

      <Separator />

      <div className="space-y-1 p-5">
        <p className="text-foreground text-sm font-medium">Spend limit</p>
        <p className="text-muted-foreground text-xs">
          $250.00 / month · alerts at 80% · currently $186.40 used
        </p>
      </div>

      <Separator />

      <div className="flex items-center justify-between p-5">
        <p className="text-destructive text-sm font-medium">Delete workspace</p>
        <button className="border-destructive/40 text-destructive hover:bg-destructive/10 h-8 rounded-md border px-3 text-xs">
          Delete
        </button>
      </div>
    </div>
  </Frame>
);

/** Vertical: inline meta rows, where the rule separates facts on one line. */
export const InlineMetaRows = () => (
  <Frame>
    <div className="max-w-xl space-y-6">
      <div className="border-border rounded-xl border p-5">
        <p className="text-foreground text-sm font-medium">Research assistant</p>
        <div className="text-muted-foreground mt-2 flex h-4 items-center gap-3 text-xs">
          <span>Run #4821</span>
          <Separator orientation="vertical" />
          <span>3m 12s</span>
          <Separator orientation="vertical" />
          <span>41 tool calls</span>
          <Separator orientation="vertical" />
          <span className="tabular-nums">$0.38</span>
          <Separator orientation="vertical" />
          <span>sbx-7f2c9a</span>
        </div>
      </div>

      <div className="border-border flex items-stretch rounded-xl border">
        <div className="flex-1 p-5">
          <p className="text-muted-foreground text-xs">Runs this cycle</p>
          <p className="text-foreground mt-1 text-2xl font-semibold tabular-nums">4,821</p>
        </div>
        <Separator orientation="vertical" />
        <div className="flex-1 p-5">
          <p className="text-muted-foreground text-xs">Success rate</p>
          <p className="text-foreground mt-1 text-2xl font-semibold tabular-nums">97.2%</p>
        </div>
        <Separator orientation="vertical" />
        <div className="flex-1 p-5">
          <p className="text-muted-foreground text-xs">Spend</p>
          <p className="text-foreground mt-1 text-2xl font-semibold tabular-nums">$186.40</p>
        </div>
      </div>
    </div>
  </Frame>
);

/** A labelled seam and a non-decorative (semantic) rule. */
export const LabelledSeam = () => (
  <Frame>
    <div className="max-w-md space-y-5">
      <button className="border-border text-foreground hover:bg-foreground/5 h-9 w-full rounded-md border text-sm">
        Continue with Google
      </button>

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-muted-foreground text-xs">or use a work email</span>
        <Separator className="flex-1" />
      </div>

      <input
        className="border-border bg-input/30 text-foreground placeholder:text-muted-foreground h-9 w-full rounded-md border px-3 text-sm"
        placeholder="dharan.s@growtharc.com"
        readOnly
      />

      <Separator decorative={false} className="bg-border/60" />

      <p className="text-muted-foreground text-xs">
        By continuing you agree to the Kortix terms and the workspace admin policy.
      </p>
    </div>
  </Frame>
);
