import * as React from 'react';

import { Textarea, useAutosizeTextArea, type AutosizeTextAreaRef } from './Textarea';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

const SYSTEM_PROMPT = `You are Suna, an autonomous agent operating inside a Kortix sandbox.

Operating rules:
- Read the workspace before you write to it. Never guess a file path.
- Every shell command runs in the sandbox at /workspace. It has no network
  access unless the run was started with an egress allowlist.
- Prefer the smallest change that satisfies the request. Do not refactor code
  the user did not ask about.
- When a tool call fails twice with the same error, stop and report the error
  verbatim instead of retrying a third time.

Escalate to a human when: a migration would drop a column, a deployment would
touch production, or spend on this run would exceed the workspace limit.`;

/** State lives in inner components, never in the exported variant itself —
 *  the preview harness calls each export once outside React to read its
 *  element, so a hook at that level would never get a dispatcher. */
const SystemPromptField = () => {
  const [prompt, setPrompt] = React.useState(SYSTEM_PROMPT);

  return (
    <div className="max-w-2xl space-y-2">
      <div className="flex items-baseline justify-between">
        <label className="text-foreground text-xs font-medium">
          System prompt — Inbox triage agent
        </label>
        <span className="text-muted-foreground text-xs tabular-nums">
          {prompt.length} / 8000 characters
        </span>
      </div>
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        minHeight={52}
        maxHeight={340}
        placeholder="Describe how this agent should behave, and when it must stop and ask."
      />
      <p className="text-muted-foreground text-xs">
        Saved to every new run. Existing runs keep the prompt they started with.
      </p>
    </div>
  );
};

/** The real agent system-prompt editor: autosizes from 52px up to a 340px cap
 *  as the prompt grows, then scrolls inside. Type into it to watch it grow. */
export const SystemPromptEditor = () => (
  <Frame>
    <SystemPromptField />
  </Frame>
);

const VariantFields = () => {
  const [note, setNote] = React.useState(
    'Escalated by on-call: the nightly backup agent failed three runs in a row\nwith `FATAL: remaining connection slots are reserved`. Raising the pool size\nfrom 5 to 20 on the staging replica before the next scheduled run.',
  );
  const [reply, setReply] = React.useState('');

  return (
    <div className="max-w-2xl space-y-5">
      <div className="space-y-1.5">
        <label className="text-foreground text-xs font-medium">default — incident note</label>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          minHeight={72}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-foreground text-xs font-medium">
          secondary — borderless, inside a run detail card
        </label>
        <Textarea
          variant="secondary"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          minHeight={64}
          placeholder="Reply to the agent, or approve the pending tool call…"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-foreground text-xs font-medium">
          accent — tinted, for a read-only tool-call payload
        </label>
        <Textarea
          variant="accent"
          readOnly
          minHeight={96}
          value={
            '{\n  "tool": "supabase.query",\n  "sql": "select id, email from users where last_seen_at < now() - interval \'90 days\' limit 200",\n  "approved_by": null\n}'
          }
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-foreground text-xs font-medium">
          outline — disabled on the Free plan
        </label>
        <Textarea
          variant="outline"
          disabled
          minHeight={56}
          value="Custom guardrails are available on Team and Enterprise workspaces."
        />
      </div>
    </div>
  );
};

/** All four `variant`s, each on the surface it is actually used on. */
export const Variants = () => (
  <Frame>
    <VariantFields />
  </Frame>
);

const RawComposer = () => {
  const areaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const composerRef = React.useRef<AutosizeTextAreaRef>(null);
  const [task, setTask] = React.useState(
    'Audit every workspace API key created before June.\nRevoke the ones with no request in the last 30 days.\nPost the revoked list to #eng-security when done.',
  );

  useAutosizeTextArea({
    textAreaRef: areaRef,
    triggerAutoSize: task,
    minHeight: 48,
    maxHeight: 200,
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-1.5">
        <label className="text-foreground text-xs font-medium">
          useAutosizeTextArea on a raw textarea — min 48px, max 200px
        </label>
        <textarea
          ref={areaRef}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          className="border-border bg-input text-foreground placeholder:text-muted-foreground focus:border-kortix-blue w-full resize-none rounded-lg border px-3 py-2 text-sm font-medium outline-none focus:border focus:outline-none"
          placeholder="What should this run do?"
        />
        <p className="text-muted-foreground text-xs">
          {task.split('\n').length} lines — height recalculates 100ms after each change.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-foreground text-xs font-medium">
          Imperative ref — focus the composer
        </label>
        <Textarea
          ref={composerRef}
          minHeight={56}
          maxHeight={160}
          placeholder="Message the Nightly DB backup agent…"
        />
        <button
          type="button"
          onClick={() => composerRef.current?.focus()}
          className="border-border text-foreground hover:bg-foreground/5 cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium"
        >
          Focus composer
        </button>
      </div>
    </div>
  );
};

/** `useAutosizeTextArea` driven directly against a plain <textarea>, which is
 *  how Suna's chat composer uses it — plus the imperative ref's focus(). */
export const AutosizeHookDirect = () => (
  <Frame>
    <RawComposer />
  </Frame>
);
