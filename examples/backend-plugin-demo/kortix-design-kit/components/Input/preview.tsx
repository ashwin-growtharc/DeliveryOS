import { Input } from './Input';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

const Field = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <div className="space-y-1.5">
    <label className="text-foreground text-xs font-medium">{label}</label>
    {children}
    {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
  </div>
);

/** The real "Create API key" form — labels, defaults, and a rejected value. */
export const CreateApiKeyForm = () => (
  <Frame>
    <div className="max-w-md space-y-4">
      <Field
        label="Key name"
        hint="Shown in the audit log next to every request this key makes."
      >
        <Input
          placeholder="CI deploy pipeline"
          defaultValue="CI deploy pipeline"
        />
      </Field>
      <Field
        label="Allowed origin"
        hint="Must be an https origin. localhost is rejected on production keys."
      >
        <Input
          aria-invalid
          defaultValue="http://localhost:3000"
        />
      </Field>
      <Field label="Expires after (days)">
        <Input
          type="number"
          defaultValue={90}
        />
      </Field>
      <Field
        label="Secret"
        hint="Copied once at creation — Kortix never stores it in plain text."
      >
        <Input
          type="password"
          defaultValue="sk-kortix-2f81b0a94c7d"
          disabled
        />
      </Field>
      <Field label="Workspace owner">
        <Input
          type="email"
          defaultValue="dharan.s@growtharc.com"
          disabled
        />
      </Field>
    </div>
  </Frame>
);

/** All four `variant`s on the surfaces they belong to. */
export const Variants = () => (
  <Frame>
    <div className="max-w-md space-y-5">
      <Field
        label="default — on a settings page"
        hint="bg-input, visible border"
      >
        <Input defaultValue="acme-production" />
      </Field>
      <Field
        label="secondary — borderless, inside a card"
        hint="bg-input, no border"
      >
        <Input
          variant="secondary"
          placeholder="Search sandboxes by ID"
          type="search"
        />
      </Field>
      <Field
        label="transparent — inline rename on an agent row"
        hint="transparent until focus"
      >
        <Input
          variant="transparent"
          defaultValue="Inbox triage agent"
        />
      </Field>
      <div className="bg-popover border-border space-y-1.5 rounded-lg border p-3">
        <label className="text-foreground text-xs font-medium">
          popover — inside the ⌘K command palette
        </label>
        <Input
          variant="popover"
          placeholder="Jump to an agent, run, or deployment"
        />
      </div>
      <Field
        label="File upload — knowledge base ingest"
        hint="Accepts .pdf, .md, .csv up to 25 MB"
      >
        <Input
          type="file"
          size="md"
        />
      </Field>
    </div>
  </Frame>
);

/** Every `size`, labelled with where each is actually used. */
export const Sizes = () => (
  <Frame>
    <div className="max-w-md space-y-4">
      <Field label="xs — toolbar filter">
        <Input
          size="xs"
          placeholder="Filter tool calls"
        />
      </Field>
      <Field label="sm — default, dense settings forms">
        <Input
          size="sm"
          defaultValue="agent-runner-eu-west-1"
        />
      </Field>
      <Field label="md — dialog fields">
        <Input
          size="md"
          defaultValue="Nightly DB backup"
        />
      </Field>
      <Field label="lg — onboarding">
        <Input
          size="lg"
          placeholder="Name your first workspace"
        />
      </Field>
      <Field label="xl — hero / sign-in">
        <Input
          size="xl"
          type="email"
          placeholder="you@company.com"
        />
      </Field>
    </div>
  </Frame>
);
