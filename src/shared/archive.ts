/**
 * Archives (zip, RAR, 7z): what kind a file is, and safe names for what comes out of one. The
 * main process reads them (main/archive); the comic reader is the first user, and the zip / RAR
 * opener in the file explorer will use the same code.
 */

export type ArchiveKind = 'zip' | 'rar' | '7z'

/** One file or folder inside an archive. */
export interface ArchiveEntry {
  /** Its path inside the archive, with forward slashes ("Issue 1/page 01.jpg"). */
  name: string
  /** Size once extracted, in bytes. */
  size: number
  /** Size inside the archive, in bytes. */
  packedSize: number
  isDir: boolean
  /** Needs a password. */
  encrypted: boolean
}

/** What a file is from its first bytes, whatever its name says (a .cbr is often really a zip). */
export function archiveKindOf(head: Uint8Array): ArchiveKind | null {
  const at = (i: number, ...bytes: number[]): boolean => bytes.every((b, j) => head[i + j] === b)
  // PK\3\4 (a normal zip) or PK\5\6 (an empty one).
  if (at(0, 0x50, 0x4b, 0x03, 0x04) || at(0, 0x50, 0x4b, 0x05, 0x06)) return 'zip'
  // Rar!\x1a\x07 (RAR 4 is followed by 00, RAR 5 by 01 00).
  if (at(0, 0x52, 0x61, 0x72, 0x21, 0x1a, 0x07)) return 'rar'
  if (at(0, 0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)) return '7z'
  return null
}

/** What a file is from its name, when it can't be opened to look. */
export function archiveKindOfName(name: string): ArchiveKind | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  if (ext === 'zip' || ext === 'cbz') return 'zip'
  if (ext === 'rar' || ext === 'cbr') return 'rar'
  if (ext === '7z' || ext === 'cb7') return '7z'
  return null
}

// Characters Windows won't have in a file name, and the names it keeps for itself.
const FORBIDDEN = /[<>:"|?*\u0000-\u001f]/g
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i

/**
 * A path from inside an archive made safe to write under a folder: forward slashes, no "..", no
 * drive letters or leading slashes, nothing Windows refuses. '' when nothing's left.
 */
export function safeRelative(name: string): string {
  return name
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.replace(FORBIDDEN, '_').replace(/[. ]+$/, ''))
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => (RESERVED.test(part) ? `_${part}` : part))
    .join('/')
}
