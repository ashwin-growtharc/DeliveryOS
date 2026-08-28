import { Skeleton } from './Skeleton';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

/** Shape-matched loading state for the /agents list: each row is the exact
 *  geometry of a real row — avatar circle, name line, subtitle line, status
 *  pill — so nothing shifts when the data lands. */
export const AgentListLoading = () => (
  <Frame>
    <div className="max-w-xl space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-28 py-0" />
        <Skeleton className="h-8 w-24 rounded-md py-0" />
      </div>
      <div className="border-border divide-border divide-y rounded-lg border">
        {[
          { name: 'w-[58%]', meta: 'w-[32%]' },
          { name: 'w-[44%]', meta: 'w-[40%]' },
          { name: 'w-[66%]', meta: 'w-[26%]' },
          { name: 'w-[38%]', meta: 'w-[48%]' },
        ].map((row) => (
          <div
            key={row.name}
            className="flex items-center gap-3 px-3 py-3"
          >
            <Skeleton className="size-9 shrink-0 rounded-full py-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className={`h-3.5 py-0 ${row.name}`} />
              <Skeleton className={`h-3 py-0 ${row.meta}`} />
            </div>
            <Skeleton className="h-5 w-16 shrink-0 rounded-full py-0" />
          </div>
        ))}
      </div>
    </div>
  </Frame>
);

/** The run detail panel while a run's trace streams in: header, three usage
 *  tiles, then ragged log lines that match the real tool-call transcript. */
export const RunDetailLoading = () => (
  <Frame>
    <div className="max-w-2xl space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-5 w-56 py-0" />
        <Skeleton className="h-3 w-40 py-0" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {['Duration', 'Tool calls', 'Tokens'].map((tile) => (
          <div
            key={tile}
            className="border-border space-y-2 rounded-lg border p-3"
          >
            <Skeleton className="h-3 w-16 py-0" />
            <Skeleton className="h-6 w-20 py-0" />
          </div>
        ))}
      </div>
      <div className="border-border space-y-2.5 rounded-lg border p-3">
        <Skeleton className="h-3 w-full py-0" />
        <Skeleton className="h-3 w-[92%] py-0" />
        <Skeleton className="h-3 w-[74%] py-0" />
        <Skeleton className="h-3 w-[86%] py-0" />
        <Skeleton className="h-3 w-[41%] py-0" />
      </div>
    </div>
  </Frame>
);

/** Billing page while usage is fetched — a heading, a meter bar, and two
 *  invoice rows, each keeping the height of the content it replaces. */
export const UsageCardLoading = () => (
  <Frame>
    <div className="border-border max-w-sm space-y-4 rounded-xl border p-4">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32 py-0" />
        <Skeleton className="h-7 w-24 py-0" />
      </div>
      <Skeleton className="h-2 w-full rounded-full py-0" />
      <div className="space-y-3 pt-1">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-4"
          >
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-24 py-0" />
              <Skeleton className="h-2.5 w-16 py-0" />
            </div>
            <Skeleton className="h-3 w-12 shrink-0 py-0" />
          </div>
        ))}
      </div>
    </div>
  </Frame>
);
