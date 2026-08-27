import * as React from 'react';

import { Checkbox } from './Checkbox';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

/** State lives in a nested component on purpose: the preview harness calls each
 *  exported variant as a plain function to read its element, so a variant body
 *  must stay a hook-free JSX factory. */
const ToolPermissionList = () => {
  const [granted, setGranted] = React.useState<Record<string, boolean>>({
    shell: true,
    read_file: true,
    edit_file: false,
    create_pr: false,
    post_message: true,
  });

  const toggle = (key: string) => (next: boolean | 'indeterminate') =>
    setGranted((prev) => ({ ...prev, [key]: next === true }));

  return (
    <div className="max-w-md space-y-3">
      <div>
        <p className="text-sm font-medium">Tools this agent may call</p>
        <p className="text-muted-foreground text-xs">
          Anything unchecked is rejected at the tool gateway, not just hidden.
        </p>
      </div>
      <div className="space-y-0.5">
        <Checkbox
          label="shell — run commands in the sandbox"
          checked={granted.shell}
          onCheckedChange={toggle('shell')}
        />
        <Checkbox
          label="read_file — read repo contents"
          checked={granted.read_file}
          onCheckedChange={toggle('read_file')}
        />
        <Checkbox
          label="edit_file — write repo contents"
          checked={granted.edit_file}
          onCheckedChange={toggle('edit_file')}
        />
        <Checkbox
          label="github.create_pr — open pull requests"
          checked={granted.create_pr}
          onCheckedChange={toggle('create_pr')}
        />
        <Checkbox
          label="slack.post_message — post to #eng-alerts"
          checked={granted.post_message}
          onCheckedChange={toggle('post_message')}
        />
        <Checkbox label="billing.charge — not available on this plan" checked={false} disabled />
      </div>
    </div>
  );
};

/** The labelled form — the whole row is the hit target and tints when checked. */
export const ToolPermissions = () => (
  <Frame>
    <ToolPermissionList />
  </Frame>
);

const RUNS = [
  { id: 'run_9f21c4', agent: 'release-notes-drafter', at: '09:00 UTC', status: 'Succeeded' },
  { id: 'run_9f21be', agent: 'pr-triage', at: '08:47 UTC', status: 'Succeeded' },
  { id: 'run_9f2199', agent: 'migration-reviewer', at: '08:31 UTC', status: 'Needs review' },
  { id: 'run_9f2170', agent: 'prod-incident-summariser', at: '07:58 UTC', status: 'Failed' },
];

const RunSelectionTable = () => {
  const [selected, setSelected] = React.useState<string[]>(['run_9f2199', 'run_9f2170']);

  const isOn = (id: string) => selected.includes(id);
  const toggle = (id: string) => (next: boolean | 'indeterminate') =>
    setSelected((prev) => (next === true ? [...prev, id] : prev.filter((r) => r !== id)));

  return (
    <div className="border-border max-w-lg rounded-md border">
      <div className="border-border/60 text-muted-foreground flex items-center gap-3 border-b px-3 py-2 text-xs">
        <Checkbox
          checked={selected.length === RUNS.length}
          onCheckedChange={(next) => setSelected(next === true ? RUNS.map((r) => r.id) : [])}
        />
        <span>{selected.length ? `${selected.length} runs selected` : 'Select runs to retry'}</span>
      </div>
      {RUNS.map((run) => (
        <div
          key={run.id}
          className="border-border/60 flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
        >
          <Checkbox checked={isOn(run.id)} onCheckedChange={toggle(run.id)} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{run.agent}</p>
            <p className="text-muted-foreground font-mono text-xs">{run.id}</p>
          </div>
          <span className="text-muted-foreground shrink-0 text-xs">{run.at}</span>
          <span className="text-muted-foreground w-24 shrink-0 text-right text-xs">
            {run.status}
          </span>
        </div>
      ))}
    </div>
  );
};

/** The bare unlabelled control, as used for row selection in a run table. */
export const RunSelection = () => (
  <Frame>
    <RunSelectionTable />
  </Frame>
);
