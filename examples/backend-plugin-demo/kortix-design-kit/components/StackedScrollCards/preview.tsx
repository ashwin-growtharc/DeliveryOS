import * as React from 'react';

import { StackedScrollCards, type StackedScrollCard } from './StackedScrollCards';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full font-sans">{children}</div>
  </>
);

function CodeBlock({ lines }: { lines: string[] }) {
  return (
    <div className="bg-background border-border h-full overflow-hidden rounded-md border p-3 font-mono text-[11px] leading-relaxed">
      {lines.map((line, i) => (
        <div key={i} className="text-muted-foreground whitespace-pre">
          {line}
        </div>
      ))}
    </div>
  );
}

function TerminalBlock({ lines }: { lines: { text: string; ok?: boolean }[] }) {
  return (
    <div className="bg-foreground/95 h-full overflow-hidden rounded-md p-3 font-mono text-[11px] leading-relaxed">
      {lines.map((line, i) => (
        <div key={i} className={line.ok === false ? 'text-red-400' : 'text-background/90'}>
          {line.text}
        </div>
      ))}
    </div>
  );
}

function ChecklistBlock({ items }: { items: string[] }) {
  return (
    <div className="bg-background border-border h-full overflow-hidden rounded-md border p-3">
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="flex items-center gap-2 text-[12px]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="text-kortix-green size-3.5 shrink-0">
              <path d="m5 12.5 4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-foreground">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Realistic content: DeliveryOS's own real pull pipeline (resolve, copy,
 *  post_install, snapshot, lockfile) — chosen instead of invented placeholder
 *  copy, and instead of reproducing Suna's own marketing narrative, which the
 *  ported mechanism was deliberately separated from (see this kit's README). */
const PULL_PIPELINE: StackedScrollCard[] = [
  {
    id: 'resolve',
    ordinal: '01',
    title: 'Resolve',
    description:
      "Find the exact artifact and version in the remote's git cache, and work out which install_params it still needs.",
    bullets: [
      "Reads manifest.yaml from the remote's local clone under ~/.deliveryos",
      'Checks .env.local for any install_params already on file',
      'Reports anything still missing — a hard failure only for required params',
    ],
    panel: (
      <CodeBlock
        lines={[
          '# manifest.yaml',
          'id: nextauth-credentials',
          'kind: backend-plugin',
          'version: 1.2.0',
          'install_params:',
          '  - AUTH_SECRET',
          '  - DATABASE_URL',
        ]}
      />
    ),
  },
  {
    id: 'copy',
    ordinal: '02',
    title: 'Copy',
    description:
      'The payload is copied verbatim from the remote cache into install_target — no transformation, no templating.',
    bullets: [
      'Recursive copy via fs.cpSync, preserving the payload’s own file layout',
      'install_target is created if it does not already exist',
      'Existing files at the destination are left alone unless a real edit forces an overwrite',
    ],
    panel: (
      <ChecklistBlock
        items={[
          'auth.config.ts copied',
          'password.ts copied',
          'prisma-schema-snippet.prisma copied',
          'README.md copied',
        ]}
      />
    ),
  },
  {
    id: 'post-install',
    ordinal: '03',
    title: 'Post-install',
    description:
      "If the manifest declares a post_install command, it runs inside install_target next — whatever setup the artifact actually needs.",
    bullets: [
      'Runs with a bounded timeout so one hung command can’t stall a pull forever',
      'stdout/stderr are captured and shown in the progress log, not swallowed',
      'Skipped entirely if the manifest declares no post_install step',
    ],
    panel: (
      <TerminalBlock
        lines={[
          { text: '$ npm install' },
          { text: 'added 4 packages in 1.2s' },
          { text: '✓ post_install finished' },
        ]}
      />
    ),
  },
  {
    id: 'snapshot',
    ordinal: '04',
    title: 'Snapshot',
    description:
      'A pristine copy of what was just installed is written to the lockfile’s snapshot store, byte-for-byte.',
    bullets: [
      'Lets a later check-updates tell a real local edit apart from an unmodified install',
      'Only ever compared against, never restored from automatically',
      'One snapshot per installed artifact, keyed by id and version',
    ],
    panel: (
      <ChecklistBlock
        items={[
          'Pristine snapshot written',
          'Ready to diff against a future edit',
          'Ready to diff against a future upstream version',
        ]}
      />
    ),
  },
  {
    id: 'lockfile',
    ordinal: '05',
    title: 'Lockfile',
    description:
      '.deliveryos/lock.json records exactly what was installed, so the next pull or update knows where things stand.',
    bullets: [
      'One entry per artifact: id, version, remote, and the params it was given',
      'The only file check-updates and config ever read to know current state',
      'Committed alongside the project, so a teammate’s pull matches yours',
    ],
    panel: (
      <CodeBlock
        lines={[
          '// .deliveryos/lock.json',
          '{',
          '  "nextauth-credentials": {',
          '    "version": "1.2.0",',
          '    "remote": "ai-helpers"',
          '  }',
          '}',
        ]}
      />
    ),
  },
  {
    id: 'done',
    ordinal: '06',
    title: 'Done',
    description: 'One command, five real steps, nothing left half-applied.',
    isClosing: true,
  },
];

export const Default = () => (
  <Frame>
    <StackedScrollCards
      eyebrow="Engine"
      title="What actually happens on deliveryos pull"
      description="Five real steps, every one of them visible in the progress log — not a black box."
      cards={PULL_PIPELINE}
    />
  </Frame>
);
