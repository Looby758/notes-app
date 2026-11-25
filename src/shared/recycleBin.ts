/** One thing in the Recycle Bin / Bin, as the Files tab shows it (see main/recycleBin.ts). */
export interface BinItem {
  id: string
  /** Its name before it was deleted. */
  name: string
  /** Where it was, when that's known (a Mac's Bin only tells Finder). */
  from: string | null
  /** Where it is now, in the bin (previews are loaded from here). */
  at: string
  deletedAt: number
  /** Bytes (0 for folders when the system doesn't say). */
  size: number
  isDir: boolean
  /** Deleted in Orbit a moment ago (still in Orbit's own undo bin), or in the system's bin. */
  kind: 'orbit' | 'system'
}

export interface BinListing {
  items: BinItem[]
  /** Items can be put back from here (on a Mac only Finder can). */
  canRestore: boolean
  /** macOS needs Full Disk Access before Orbit can look in the Bin. */
  blocked: boolean
}
