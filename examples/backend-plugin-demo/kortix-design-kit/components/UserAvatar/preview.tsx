import { UserAvatar } from './UserAvatar';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

const MEMBERS = [
  { name: 'Dharan Sreenivasan', email: 'dharan.s@growtharc.com', role: 'Owner', self: true },
  { name: 'Ashwin Balaji', email: 'ashwin.b@growtharc.com', role: 'Admin' },
  { name: 'Priya Raghunathan', email: 'priya.r@growtharc.com', role: 'Member' },
  { name: 'Marcus Feld', email: 'marcus.feld@growtharc.com', role: 'Member' },
  { name: 'Lena Ostrowski', email: 'lena.o@growtharc.com', role: 'Billing' },
  { name: null, email: 'ops.oncall@growtharc.com', role: 'Invited' },
];

/** The workspace members list — the avatar's main home. Initials fallback only. */
export const WorkspaceMembers = () => (
  <Frame>
    <div className="border-border max-w-lg divide-border divide-y overflow-hidden rounded-xl border">
      <div className="bg-muted/30 px-4 py-3">
        <p className="text-foreground text-sm font-medium">Members · 6</p>
        <p className="text-muted-foreground text-xs">Growth Arc workspace</p>
      </div>
      {MEMBERS.map((m) => (
        <div key={m.email} className="flex items-center gap-3 px-4 py-2.5">
          <UserAvatar email={m.email} name={m.name} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-foreground truncate text-sm font-medium">
                {m.name ?? m.email}
              </span>
              {m.self ? (
                <span className="text-muted-foreground/80 text-[11px] font-medium">· you</span>
              ) : null}
            </div>
            {m.name ? (
              <p className="text-muted-foreground/80 truncate text-xs">{m.email}</p>
            ) : (
              <p className="text-muted-foreground/80 text-xs">Invitation sent 2 days ago</p>
            )}
          </div>
          <span className="text-muted-foreground text-xs">{m.role}</span>
        </div>
      ))}
    </div>
  </Frame>
);

/** Size ramp, the `ring` prop for overlapping stacks, and the primary variant. */
export const SizesAndStacks = () => (
  <Frame>
    <div className="space-y-7">
      <div className="space-y-3">
        <p className="text-muted-foreground text-xs">Sizes — xs / sm / md / lg / xl</p>
        <div className="flex items-end gap-4">
          {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((s) => (
            <div key={s} className="flex flex-col items-center gap-2">
              <UserAvatar email="priya.r@growtharc.com" name="Priya Raghunathan" size={s} />
              <span className="text-muted-foreground text-[10px]">{s}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-muted-foreground text-xs">
          Ran this deployment — overlapping stack uses `ring`
        </p>
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            <UserAvatar email="dharan.s@growtharc.com" name="Dharan Sreenivasan" size="sm" ring />
            <UserAvatar email="ashwin.b@growtharc.com" name="Ashwin Balaji" size="sm" ring />
            <UserAvatar email="priya.r@growtharc.com" name="Priya Raghunathan" size="sm" ring />
            <UserAvatar email="marcus.feld@growtharc.com" name="Marcus Feld" size="sm" ring />
          </div>
          <span className="text-muted-foreground text-xs">+2 others reviewed run #4821</span>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-muted-foreground text-xs">
          Identity without a display name — initials come from the email local part
        </p>
        <div className="flex items-center gap-4">
          <UserAvatar email="ops.oncall@growtharc.com" size="lg" />
          <UserAvatar email="ci-bot@kortix.ai" size="lg" />
          <UserAvatar email="billing@growtharc.com" size="lg" />
          <UserAvatar email="lena.o@growtharc.com" name="Lena Ostrowski" size="lg" variant="primary" />
        </div>
      </div>
    </div>
  </Frame>
);

/** In-context: the run header, a comment thread, and the account menu trigger. */
export const InContext = () => (
  <Frame>
    <div className="max-w-xl space-y-4">
      <div className="border-border flex items-center gap-3 rounded-xl border px-4 py-3">
        <UserAvatar email="dharan.s@growtharc.com" name="Dharan Sreenivasan" size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-foreground text-sm font-medium">Dharan Sreenivasan</p>
          <p className="text-muted-foreground text-xs">
            Triggered run #4821 · research-assistant · 2m ago
          </p>
        </div>
        <span className="text-kortix-green bg-kortix-green/15 rounded-sm px-1.5 py-0.5 text-[11px] font-medium">
          Running
        </span>
      </div>

      <div className="border-border space-y-4 rounded-xl border p-4">
        <div className="flex gap-3">
          <UserAvatar email="priya.r@growtharc.com" name="Priya Raghunathan" size="sm" />
          <div className="min-w-0">
            <p className="text-foreground text-xs font-medium">
              Priya Raghunathan <span className="text-muted-foreground font-normal">· 14m ago</span>
            </p>
            <p className="text-muted-foreground mt-0.5 text-sm">
              The browser tool timed out twice on the pricing page — raising the step budget to 40.
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <UserAvatar email="marcus.feld@growtharc.com" name="Marcus Feld" size="sm" />
          <div className="min-w-0">
            <p className="text-foreground text-xs font-medium">
              Marcus Feld <span className="text-muted-foreground font-normal">· 9m ago</span>
            </p>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Re-ran on a 4 vCPU sandbox and it finished in 3m 12s. Keeping that as the default.
            </p>
          </div>
        </div>
      </div>

      <button className="border-border hover:bg-foreground/5 flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left">
        <UserAvatar email="dharan.s@growtharc.com" name="Dharan Sreenivasan" size="sm" />
        <span className="text-foreground text-sm">dharan.s@growtharc.com</span>
        <span className="text-muted-foreground ml-auto text-xs">Pro · $186.40</span>
      </button>
    </div>
  </Frame>
);
