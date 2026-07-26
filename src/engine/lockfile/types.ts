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
}

export interface LockFile {
  version: 1;
  entries: LockEntry[];
}
