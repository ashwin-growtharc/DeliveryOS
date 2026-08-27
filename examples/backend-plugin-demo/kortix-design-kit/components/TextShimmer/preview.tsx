import { TextShimmer } from './TextShimmer';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

/** The streaming-status lines this actually ships on. */
export const StreamingStatus = () => (
  <Frame>
    <div className="space-y-4">
      <p className="text-muted-foreground text-xs">
        Live status while a turn streams — default duration, looping forever
      </p>
      <div className="flex flex-col items-start gap-2.5">
        <TextShimmer>Analysing repository…</TextShimmer>
        <TextShimmer>Reading apps/api/src/sandbox/renewal.ts</TextShimmer>
        <TextShimmer>Running 24 sandbox lifecycle tests</TextShimmer>
        <TextShimmer>Waiting for sandbox lease on sbx-7f2a91</TextShimmer>
      </div>
      <p className="text-muted-foreground text-xs">
        Faster sweep (duration=1) for short, rapidly-replaced tool labels
      </p>
      <div className="flex flex-col items-start gap-2.5">
        <TextShimmer duration={1}>Thinking</TextShimmer>
        <TextShimmer duration={1}>Editing file</TextShimmer>
        <TextShimmer duration={1}>Searching the web</TextShimmer>
      </div>
    </div>
  </Frame>
);

/** Bigger type, an `as` override, and the finite-repeat mode. */
export const HeadingAndModes = () => (
  <Frame>
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">
          as=&quot;h2&quot; with heading type — the burst header while it runs
        </p>
        <TextShimmer as="h2" className="text-2xl font-semibold" duration={2.2}>
          Deploying research-agent to production
        </TextShimmer>
      </div>
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">
          spread=1 — a tighter highlight band across the same copy
        </p>
        <TextShimmer className="text-lg" spread={1}>
          Indexing 412 documents from the Kortix workspace
        </TextShimmer>
      </div>
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">
          repeat=1 — one sweep, then holds (animationFillMode: forwards)
        </p>
        <TextShimmer repeat={1} className="text-base">
          Snapshot restored — resuming turn
        </TextShimmer>
      </div>
    </div>
  </Frame>
);

/** In situ: the chat's own busy line, inside the message surface. */
export const ChatBusyLine = () => (
  <Frame>
    <div className="border-border w-full max-w-xl space-y-4 rounded-md border p-4">
      <div className="flex items-start gap-3">
        <span className="bg-secondary text-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium">
          DS
        </span>
        <p className="text-sm leading-relaxed">
          Why did the sandbox drop its lease halfway through the nightly changelog run?
        </p>
      </div>
      <div className="flex items-start gap-3">
        <span className="bg-foreground text-background flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium">
          K
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <TextShimmer>Analysing repository…</TextShimmer>
          <div className="text-muted-foreground space-y-1 border-l pl-3 text-xs">
            <p>Read apps/api/src/sandbox/renewal.ts (142 lines)</p>
            <p>Read apps/api/src/sandbox/turn-authority.ts (88 lines)</p>
            <TextShimmer duration={1} className="text-xs">
              Grepping for revokeTurnAuthority
            </TextShimmer>
          </div>
        </div>
      </div>
    </div>
  </Frame>
);
