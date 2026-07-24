export interface LockEntry {
  id: string;
  version: string;
  remote: string;
}

export interface LockFile {
  version: 1;
  entries: LockEntry[];
}
