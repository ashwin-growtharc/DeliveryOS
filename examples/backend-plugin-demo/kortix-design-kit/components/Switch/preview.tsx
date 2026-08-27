import * as React from 'react';

import { Switch } from './Switch';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

/** `Switch` is controlled-only (`checked ?? false`), so a live preview has to
 *  own the state — same as every real call site in the app. */
const StatefulSwitch = ({
  label,
  initial = false,
  disabled = false,
}: {
  label: string;
  initial?: boolean;
  disabled?: boolean;
}) => {
  const [on, setOn] = React.useState(initial);
  return <Switch label={label} checked={on} onCheckedChange={setOn} disabled={disabled} />;
};

/** The labelled form the settings pages use — the switch owns the whole row. */
export const AgentSettings = () => (
  <Frame>
    <div className="border-border max-w-md divide-y divide-border/60 rounded-md border">
      <div className="p-1">
        <StatefulSwitch label="Auto-approve tool calls" initial />
      </div>
      <div className="p-1">
        <StatefulSwitch label="Keep sandbox warm between runs" initial />
      </div>
      <div className="p-1">
        <StatefulSwitch label="Stream partial output to Slack" />
      </div>
      <div className="p-1">
        <StatefulSwitch label="Allow outbound network from sandboxes" />
      </div>
      <div className="p-1">
        <StatefulSwitch label="Retry failed runs up to 3 times" initial />
      </div>
    </div>
  </Frame>
);

/** Hooks live in this nested component, not in the exported variant: the
 *  preview harness calls each variant as a plain function to read its element,
 *  so a variant body has to stay a hook-free JSX factory. */
const NotificationSettings = () => {
  const [notify, setNotify] = React.useState(true);
  const [webhooks, setWebhooks] = React.useState(false);

  return (
      <div className="max-w-md space-y-6">
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">On / off / disabled</p>
          <div className="border-border divide-border/60 divide-y rounded-md border">
            <div className="p-1">
              <StatefulSwitch label="Email me when a run fails" initial />
            </div>
            <div className="p-1">
              <StatefulSwitch label="Weekly usage digest" />
            </div>
            <div className="p-1">
              <StatefulSwitch label="SSO enforcement — Enterprise plan only" disabled />
            </div>
            <div className="p-1">
              <StatefulSwitch label="Audit log export — Enterprise plan only" initial disabled />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">Unlabelled control in a settings row</p>
          <div className="border-border divide-border/60 divide-y rounded-md border">
            <div className="flex items-center justify-between px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Run failure alerts</p>
                <p className="text-muted-foreground text-xs">
                  Posts to #eng-alerts within 30s of a failed run
                </p>
              </div>
              <Switch checked={notify} onCheckedChange={setNotify} />
            </div>
            <div className="flex items-center justify-between px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Outbound webhooks</p>
                <p className="text-muted-foreground text-xs">
                  POST every run transcript to your endpoint
                </p>
              </div>
              <Switch checked={webhooks} onCheckedChange={setWebhooks} />
            </div>
            <div className="flex items-center justify-between px-3 py-2.5 opacity-50">
              <div>
                <p className="text-sm font-medium">Bring your own model keys</p>
                <p className="text-muted-foreground text-xs">Requires a Team workspace</p>
              </div>
              <Switch checked={false} disabled />
            </div>
          </div>
        </div>
      </div>
  );
};

/** On / off / disabled side by side, plus the bare unlabelled control that sits
 *  at the end of a settings row. */
export const StatesAndBareControl = () => (
  <Frame>
    <NotificationSettings />
  </Frame>
);
