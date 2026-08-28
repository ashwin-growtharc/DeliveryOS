import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from './Field';
import { Input } from './input';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

/** The agent settings form — FieldSet / FieldLegend / FieldGroup with vertical
 *  Fields, a labelled FieldSeparator, and real values already filled in. */
export const AgentSettings = () => (
  <Frame>
    <FieldSet className="w-full max-w-xl">
      <FieldLegend>Agent configuration</FieldLegend>
      <FieldDescription>
        These settings apply to every run of this agent, including scheduled ones.
      </FieldDescription>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="agent-name">Agent name</FieldLabel>
          <Input id="agent-name" defaultValue="nightly-changelog" />
          <FieldDescription>
            Shown in the run list and used as the slug in webhook payloads.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="agent-model">Model</FieldLabel>
          <Input id="agent-model" defaultValue="claude-opus-4-6" />
          <FieldDescription>
            Falls back to the workspace default if the model is unavailable at run time.
          </FieldDescription>
        </Field>

        <FieldSeparator>Sandbox</FieldSeparator>

        <Field>
          <FieldLabel htmlFor="sandbox-timeout">Turn timeout</FieldLabel>
          <Input id="sandbox-timeout" defaultValue="15 minutes" />
          <FieldDescription>
            The sandbox lease renews every 30 s while a turn is active; this caps the whole turn.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="snapshot">Boot snapshot</FieldLabel>
          <Input id="snapshot" placeholder="sbx-snap-… (leave empty for a cold sandbox)" />
          <FieldDescription>
            A warm snapshot cuts first-tool-call latency from ~9 s to ~1.2 s.
          </FieldDescription>
        </Field>
      </FieldGroup>
    </FieldSet>
  </Frame>
);

/** orientation="horizontal" + variant="outline" — the permission rows, each a
 *  real toggle with its own description inside FieldContent. */
export const RunPermissions = () => {
  const permissions = [
    {
      id: 'perm-network',
      title: 'Outbound network access',
      description: 'Let tool calls reach the public internet from inside the sandbox.',
      checked: true,
    },
    {
      id: 'perm-write',
      title: 'Write to the repository',
      description: 'Allows file edits and commits on branches other than main.',
      checked: true,
    },
    {
      id: 'perm-push',
      title: 'Push and open pull requests',
      description: 'Requires a GitHub app installation on kortix-ai/suna.',
      checked: false,
    },
    {
      id: 'perm-secrets',
      title: 'Read workspace secrets',
      description: 'Exposes decrypted dotenvx values to the agent process.',
      checked: false,
    },
  ];

  return (
    <Frame>
      <FieldGroup className="max-w-xl">
        <FieldSet>
          <FieldLegend variant="label">Run permissions</FieldLegend>
          <FieldDescription>
            Applied to every sandbox this agent starts. Tightening a permission takes effect on the
            next run, not the one in flight.
          </FieldDescription>
          <div className="flex flex-col gap-3">
            {permissions.map((permission) => (
              <Field key={permission.id} orientation="horizontal" variant="outline">
                <FieldContent>
                  <FieldTitle>{permission.title}</FieldTitle>
                  <FieldDescription>{permission.description}</FieldDescription>
                </FieldContent>
                <input
                  id={permission.id}
                  type="checkbox"
                  defaultChecked={permission.checked}
                  className="accent-kortix-blue size-4 shrink-0 cursor-pointer"
                />
              </Field>
            ))}
          </div>
        </FieldSet>
      </FieldGroup>
    </Frame>
  );
};

/** The invalid state: `data-invalid` on the Field, `aria-invalid` on the input,
 *  and FieldError fed both a single message and a deduped multi-error array. */
export const InviteWithErrors = () => (
  <Frame>
    <FieldSet className="w-full max-w-xl">
      <FieldLegend>Invite a teammate</FieldLegend>
      <FieldGroup>
        <Field data-invalid>
          <FieldLabel htmlFor="invite-email">Work email</FieldLabel>
          <Input id="invite-email" aria-invalid defaultValue="dharan.s@growtharc" />
          <FieldError>That domain isn&apos;t verified for the Growtharc workspace.</FieldError>
        </Field>

        <Field data-invalid>
          <FieldLabel htmlFor="api-key-name">API key name</FieldLabel>
          <Input id="api-key-name" aria-invalid defaultValue="prod key!" />
          <FieldError
            errors={[
              { message: 'Name must be lowercase, digits and dashes only.' },
              { message: 'A key called “prod-key” already exists in this workspace.' },
              { message: 'Name must be lowercase, digits and dashes only.' },
            ]}
          />
          <FieldDescription>
            Three errors were passed in; the duplicate is deduped, so two are listed.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="seat-role">Role</FieldLabel>
          <Input id="seat-role" defaultValue="Developer — can deploy agents, cannot bill" />
          <FieldError />
          <FieldDescription>
            This field renders no error: FieldError with nothing to say returns null.
          </FieldDescription>
        </Field>
      </FieldGroup>
    </FieldSet>
  </Frame>
);
