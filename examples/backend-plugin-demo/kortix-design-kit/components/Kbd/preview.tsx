import { Kbd, KbdGroup } from './Kbd';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

const SHORTCUTS: { action: string; keys: string[] }[] = [
  { action: 'Open command palette', keys: ['⌘', 'K'] },
  { action: 'Run the current agent', keys: ['⌘', '⏎'] },
  { action: 'Cancel the running turn', keys: ['Esc'] },
  { action: 'New chat', keys: ['⌘', '⇧', 'O'] },
  { action: 'Toggle the sandbox file tree', keys: ['⌘', 'B'] },
  { action: 'Jump to run logs', keys: ['⌘', '⇧', 'L'] },
];

/** The Keyboard shortcuts sheet: one row per real Suna binding. */
export const ShortcutSheet = () => (
  <Frame>
    <div className="border-border max-w-sm rounded-xl border">
      <div className="border-border border-b px-4 py-3">
        <p className="text-foreground text-sm font-medium">Keyboard shortcuts</p>
        <p className="text-muted-foreground text-xs">Workspace-wide, on any agent screen.</p>
      </div>
      <div className="divide-border divide-y">
        {SHORTCUTS.map((s) => (
          <div
            key={s.action}
            className="flex items-center justify-between gap-4 px-4 py-2.5"
          >
            <span className="text-foreground text-sm">{s.action}</span>
            <KbdGroup>
              {s.keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </KbdGroup>
          </div>
        ))}
      </div>
    </div>
  </Frame>
);

/** Inline in product chrome: a palette trigger, a composer send hint, and the
 *  cancel affordance shown while a turn is streaming. */
export const InlineInProductChrome = () => (
  <Frame>
    <div className="max-w-lg space-y-4">
      <button
        type="button"
        className="border-border bg-input text-muted-foreground hover:bg-foreground/5 flex w-full cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
      >
        <span>Jump to an agent, run, or sandbox…</span>
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </button>

      <div className="border-border bg-input rounded-lg border p-3">
        <p className="text-muted-foreground text-sm">
          Summarise last night's failed runs and open a Linear issue for each.
        </p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-muted-foreground text-xs">Suna 1.5 · Sandbox eu-west-1</span>
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>⏎</Kbd>
            </KbdGroup>
            to run
          </span>
        </div>
      </div>

      <div className="border-border flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
        <span className="text-foreground text-sm">Running — 14 tool calls so far</span>
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Kbd>Esc</Kbd>
          to cancel
        </span>
      </div>
    </div>
  </Frame>
);

/** Sequences and chords — the `g`-prefixed navigation Suna uses, plus a
 *  destructive confirm that deliberately needs two modifiers. */
export const SequencesAndChords = () => (
  <Frame>
    <div className="max-w-md space-y-4">
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">Sequences — press in order</p>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <KbdGroup>
              <Kbd>G</Kbd>
              <span className="text-muted-foreground text-xs">then</span>
              <Kbd>A</Kbd>
            </KbdGroup>
            <span className="text-foreground text-sm">Go to Agents</span>
          </div>
          <div className="flex items-center gap-2">
            <KbdGroup>
              <Kbd>G</Kbd>
              <span className="text-muted-foreground text-xs">then</span>
              <Kbd>R</Kbd>
            </KbdGroup>
            <span className="text-foreground text-sm">Go to Runs</span>
          </div>
          <div className="flex items-center gap-2">
            <KbdGroup>
              <Kbd>G</Kbd>
              <span className="text-muted-foreground text-xs">then</span>
              <Kbd>S</Kbd>
            </KbdGroup>
            <span className="text-foreground text-sm">Go to Sandboxes</span>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">Chords — held together</p>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>⇧</Kbd>
              <Kbd>⌫</Kbd>
            </KbdGroup>
            <span className="text-foreground text-sm">Delete this workspace</span>
          </div>
          <div className="flex items-center gap-2">
            <KbdGroup>
              <Kbd>⌥</Kbd>
              <Kbd>⇧</Kbd>
              <Kbd>F</Kbd>
            </KbdGroup>
            <span className="text-foreground text-sm">Format the sandbox file</span>
          </div>
        </div>
      </div>
    </div>
  </Frame>
);
