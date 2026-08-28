export interface LockEntry {
  id: string;
  version: string;
  remote: string;
  /** Set right after a successful edit-mode push, cleared once that PR is
   * resolved (merged or closed) by `resolvePendingPushes`. Lets the UI show
   * real transparency about a push's outcome instead of going silent the
   * moment the PR opens -- pushing doesn't change local state on its own
   * (the edit isn't accepted yet), so without this there's no way to later
   * tell "still open" from "merged" from "rejected". */
  pendingPr?: {
    number: number;
    url: string;
  };
  /** The real, resolved install_target path this artifact was actually
   * pulled to, recorded once at pull time -- lets a later `remove` find
   * the right directory even if the artifact's own remote/manifest is no
   * longer resolvable (removed from the catalog, the remote unregistered,
   * etc.). Absent on any lockfile entry written before this field existed. */
  installTarget?: string;
  /** Which files `applyDeterministicWiring` (Phase 10 item 1) created
   * FRESH for this artifact (AppliedWiringResult.applied) -- the only
   * files a later `remove` can safely delete automatically, since nothing
   * else in the project could have depended on content that didn't exist
   * before this pull. Recorded once, right after pullAndAutoWire's own
   * wiring step runs. Absent for any artifact with no wiring_actions, or
   * one pulled before this field existed. NEVER includes a file that was
   * merged via the "AI wiring merge" flow (requestWiringMerge.ts) -- a
   * merged file already had real pre-existing content before DeliveryOS
   * touched it, so it must never be a candidate for automatic deletion. */
  wiredFiles?: string[];
}

export interface LockFile {
  version: 1;
  entries: LockEntry[];
}
