import { Button } from './Button';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-2">
    <p className="text-muted-foreground text-xs">{label}</p>
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </div>
);

export const Variants = () => (
  <Frame>
    <div className="space-y-5">
      <Row label="Core">
        <Button>Deploy agent</Button>
        <Button variant="secondary">Duplicate</Button>
        <Button variant="outline">Configure</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="link">View run history</Button>
        <Button variant="muted">Rename</Button>
      </Row>
      <Row label="Brand">
        <Button variant="brand">Upgrade plan</Button>
        <Button variant="blue">Connect Slack</Button>
        <Button variant="blue-secondary">Invite teammate</Button>
        <Button variant="blue-ghost">Browse templates</Button>
      </Row>
      <Row label="Status">
        <Button variant="success">Mark resolved</Button>
        <Button variant="warning">Retry with limits</Button>
        <Button variant="info">View logs</Button>
        <Button variant="error">Force stop</Button>
      </Row>
      <Row label="Destructive">
        <Button variant="destructive">Delete workspace</Button>
        <Button variant="danger">Revoke all keys</Button>
      </Row>
    </div>
  </Frame>
);

export const SizesAndStates = () => (
  <Frame>
    <div className="space-y-5">
      <Row label="Sizes">
        <Button size="xl">Extra large</Button>
        <Button size="lg">Large</Button>
        <Button size="default">Default</Button>
        <Button size="sm">Small</Button>
        <Button size="xs">Extra small</Button>
        <Button size="toolbar" variant="muted">
          Toolbar
        </Button>
      </Row>
      <Row label="States">
        <Button disabled>Publishing…</Button>
        <Button variant="outline" disabled>
          Unavailable on Free
        </Button>
        <Button variant="secondary">Save changes</Button>
      </Row>
      <Row label="Surface pairings — one primary per view">
        <Button variant="destructive">Archive project</Button>
        <Button variant="outline">Keep it</Button>
      </Row>
    </div>
  </Frame>
);
