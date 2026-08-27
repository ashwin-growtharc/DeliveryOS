import { KortixLogo } from './KortixLogo';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

/** A real dark surface: `.dark` re-binds every token, exactly as the app does. */
const Surface = ({
  label,
  dark,
  children,
}: {
  label: string;
  dark?: boolean;
  children: React.ReactNode;
}) => (
  <div className={dark ? 'dark' : undefined}>
    <div className="border-border bg-background text-foreground space-y-4 rounded-xl border p-6">
      <p className="text-muted-foreground text-xs">{label}</p>
      {children}
    </div>
  </div>
);

/** Both variants, on both surfaces — the logo's whole job is holding up either way. */
export const OnLightAndDark = () => (
  <Frame>
    <div className="grid gap-4 sm:grid-cols-2">
      <Surface label="Light surface — brandmark + icon">
        <KortixLogo variant="brandmark" size={26} />
        <div className="flex items-center gap-4">
          <KortixLogo variant="icon" size={32} />
          <KortixLogo variant="icon" size={20} />
          <KortixLogo variant="icon" size={16} />
        </div>
      </Surface>

      <Surface label="Dark surface — brandmark + icon" dark>
        <KortixLogo variant="brandmark" size={26} />
        <div className="flex items-center gap-4">
          <KortixLogo variant="icon" size={32} />
          <KortixLogo variant="icon" size={20} />
          <KortixLogo variant="icon" size={16} />
        </div>
      </Surface>
    </div>
  </Frame>
);

/** Where each variant actually appears: sidebar rail, auth card, dark topbar. */
export const InProductChrome = () => (
  <Frame>
    <div className="space-y-4">
      <div className="border-border bg-sidebar flex w-64 flex-col gap-1 rounded-xl border p-3">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <KortixLogo variant="icon" size={18} />
          <span className="text-sidebar-foreground text-sm font-medium">Growth Arc</span>
          <span className="text-muted-foreground ml-auto text-xs">Pro</span>
        </div>
        <div className="text-sidebar-foreground/80 rounded-md px-2 py-1.5 text-sm">Agents</div>
        <div className="bg-sidebar-accent/60 text-sidebar-foreground rounded-md px-2 py-1.5 text-sm">
          Runs
        </div>
        <div className="text-sidebar-foreground/80 rounded-md px-2 py-1.5 text-sm">Sandboxes</div>
        <div className="text-sidebar-foreground/80 rounded-md px-2 py-1.5 text-sm">Integrations</div>
      </div>

      <div className="border-border mx-auto max-w-sm rounded-xl border p-8 text-center">
        <KortixLogo variant="brandmark" size={22} className="mx-auto" />
        <p className="text-foreground mt-6 text-sm font-medium">Sign in to your workspace</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Use your work email — SSO is enforced for growtharc.com
        </p>
        <button className="bg-foreground text-background hover:bg-foreground/90 mt-5 h-9 w-full rounded-md text-sm font-medium">
          Continue with SSO
        </button>
      </div>

      <div className="dark">
        <div className="bg-background text-foreground border-border flex items-center gap-3 rounded-xl border px-4 py-3">
          <KortixLogo variant="icon" size={20} />
          <span className="text-sm font-medium">Run #4821</span>
          <span className="text-muted-foreground text-xs">research-assistant · 3m 12s</span>
          <span className="text-muted-foreground ml-auto text-xs tabular-nums">$0.38</span>
        </div>
      </div>
    </div>
  </Frame>
);

/** Size ramp — the icon stays square, the brandmark scales width to height. */
export const SizeRamp = () => (
  <Frame>
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-muted-foreground text-xs">Icon — 16 / 20 / 24 / 32 / 48 / 64 px</p>
        <div className="flex items-end gap-6">
          {[16, 20, 24, 32, 48, 64].map((s) => (
            <div key={s} className="flex flex-col items-center gap-2">
              <KortixLogo variant="icon" size={s} />
              <span className="text-muted-foreground text-[10px] tabular-nums">{s}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-muted-foreground text-xs">Brandmark — 14 / 20 / 28 / 40 px tall</p>
        <div className="flex flex-col items-start gap-4">
          {[14, 20, 28, 40].map((s) => (
            <KortixLogo key={s} variant="brandmark" size={s} />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-muted-foreground text-xs">
          Inherits `currentColor` — tinted by the surrounding text colour
        </p>
        <div className="flex items-center gap-6">
          <KortixLogo variant="icon" size={28} className="text-kortix-blue" />
          <KortixLogo variant="icon" size={28} className="text-kortix-green" />
          <KortixLogo variant="icon" size={28} className="text-muted-foreground" />
          <KortixLogo variant="brandmark" size={20} className="text-kortix-blue" />
        </div>
      </div>
    </div>
  </Frame>
);
