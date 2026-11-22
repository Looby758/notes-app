/**
 * The file explorer tab: browse the whole computer (and the Google Drive folder) from inside
 * Notes. The main process lists folders (main/explorer.ts); these helpers are shared with the UI.
 */

export interface ExplorerEntry {
  name: string
  /** The full path on this computer. */
  path: string
  isDir: boolean
  size: number
  /** Last changed, in milliseconds. */
  modified: number
  /** Dot files and system files, shown only when asked. */
  hidden: boolean
  /** Its path inside the notes folder, when it's in there (so notes open as notes). */
  vaultPath: string | null
}

export interface ExplorerPlace {
  id: string
  label: string
  path: string
  kind: 'home' | 'desktop' | 'documents' | 'downloads' | 'pictures' | 'music' | 'videos' | 'drive' | 'google' | 'notes'
}

export type ExplorerSort = 'name' | 'modified' | 'size'

/** What the preview pane can show for a file. */
export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none'

const extOf = (name: string): string => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '')

const PREVIEWS: Record<Exclude<PreviewKind, 'none'>, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'],
  video: ['mp4', 'mov', 'm4v', 'ogv', 'webm'],
  audio: ['mp3', 'm4a', 'wav', 'ogg', 'oga', 'aac', 'flac', 'opus'],
  pdf: ['pdf'],
  text: [
    'txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'json', 'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf',
    'html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'java', 'c', 'h', 'cpp', 'cs', 'go',
    'rs', 'php', 'sh', 'bat', 'ps1', 'sql', 'lua', 'srt', 'canvas'
  ]
}

export function previewKind(name: string): PreviewKind {
  const ext = extOf(name)
  for (const [kind, exts] of Object.entries(PREVIEWS)) if (exts.includes(ext)) return kind as PreviewKind
  return 'none'
}

/** Files the main process will hand to the window to preview (pictures, video, sound, PDFs). */
export const isStreamable = (name: string): boolean => ['image', 'video', 'audio', 'pdf'].includes(previewKind(name))

/** The largest text file read for a preview: only the start is shown. */
export const TEXT_PREVIEW_BYTES = 64 * 1024

const SYSTEM_NAMES = new Set(['desktop.ini', 'thumbs.db', 'ntuser.dat', '$recycle.bin', 'system volume information', '$windows.~ws', 'pagefile.sys', 'hiberfil.sys', 'swapfile.sys', 'dumpstack.log.tmp', 'icon\r'])

export function isHiddenName(name: string): boolean {
  const lower = name.toLowerCase()
  return name.startsWith('.') || name.startsWith('~$') || SYSTEM_NAMES.has(lower) || lower.startsWith('ntuser.')
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Folders first, then by the chosen column (newest and biggest first). `folderSizes`: folders' sizes once they've been added up. */
export function sortEntries(entries: ExplorerEntry[], by: ExplorerSort, folderSizes?: ReadonlyMap<string, number>): ExplorerEntry[] {
  const sizeOf = (e: ExplorerEntry): number => (e.isDir ? (folderSizes?.get(e.path) ?? -1) : e.size)
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    if (by === 'modified' && a.modified !== b.modified) return b.modified - a.modified
    if (by === 'size' && sizeOf(a) !== sizeOf(b)) return sizeOf(b) - sizeOf(a)
    return collator.compare(a.name, b.name)
  })
}

/** Narrows a folder to the names containing every word typed. */
export function filterEntries(entries: ExplorerEntry[], query: string, showHidden: boolean): ExplorerEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter((e) => (showHidden || !e.hidden) && words.every((w) => e.name.toLowerCase().includes(w)))
}

/** "C:\Users\me\Documents" → [C:\, Users, me, Documents] with the path to each, for the breadcrumbs. */
export function crumbsOf(path: string): { name: string; path: string }[] {
  const windows = /^[a-z]:/i.test(path) || path.startsWith('\\\\')
  const sep = windows ? '\\' : '/'
  const parts = path.split(/[\\/]+/).filter(Boolean)
  const crumbs: { name: string; path: string }[] = []
  if (!windows) crumbs.push({ name: '/', path: '/' })
  let at = windows ? '' : '/'
  parts.forEach((part, i) => {
    if (windows && i === 0) at = /^[a-z]:$/i.test(part) ? `${part}\\` : `\\\\${part}\\`
    else at = at.endsWith(sep) ? at + part : at + sep + part
    crumbs.push({ name: windows && i === 0 ? at.replace(/\\$/, '') : part, path: at })
  })
  return crumbs
}

/** The folder above, or null at the top of a drive. */
export function parentPath(path: string): string | null {
  const crumbs = crumbsOf(path)
  return crumbs.length > 1 ? crumbs[crumbs.length - 2].path : null
}

export function describeBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} bytes`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

/** "Today 14:05", "Yesterday", "3 Mar", "3 Mar 2023". */
export function describeModified(ms: number, now = Date.now()): string {
  const d = new Date(ms)
  const today = new Date(now)
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000)
  if (days === 0) return `Today ${time}`
  if (days === 1) return `Yesterday ${time}`
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }) })
}

/** The address the window loads a file's preview from (see the vault: protocol). */
export const explorerUrl = (path: string): string => `vault://explore/${encodeURIComponent(path)}`

/** How pasting (or dropping) files into a folder treats them. */
export type PasteMode = 'copy' | 'move'

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

/** Why a new name won't work as a file name on Windows or a Mac, or null when it's fine. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'A name can’t be empty.'
  if (trimmed === '.' || trimmed === '..') return 'That name is taken by the system.'
  if (/[\\/:*?"<>|\x00-\x1f]/.test(trimmed)) return 'A name can’t have any of these: \\ / : * ? " < > |'
  if (RESERVED.test(trimmed)) return 'Windows keeps that name for itself.'
  if (/[. ]$/.test(name)) return 'A name can’t end with a dot or a space.'
  if (trimmed.length > 255) return 'That name is too long.'
  return null
}

/** "Plan.txt" → "Plan (2).txt", the first one that isn't taken (names compared the way Windows does). */
export function uniqueName(name: string, taken: Iterable<string>, isDir = false): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()))
  if (!used.has(name.toLowerCase())) return name
  const dot = isDir || !name.includes('.') || name.startsWith('.') ? -1 : name.lastIndexOf('.')
  const stem = (dot < 0 ? name : name.slice(0, dot)).replace(/ \(\d+\)$/, '')
  const ext = dot < 0 ? '' : name.slice(dot)
  for (let n = 2; ; n++) {
    const next = `${stem} (${n})${ext}`
    if (!used.has(next.toLowerCase())) return next
  }
}

/** Whether `path` is `folder` or somewhere inside it (so a folder isn't moved into itself). */
export function isInside(path: string, folder: string): boolean {
  const norm = (p: string): string => p.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
  const a = norm(path)
  const b = norm(folder)
  return a === b || a.startsWith(`${b}/`)
}

/** The folder holding a file, shown under search results: "Documents › Work". */
export function whereIn(path: string, from: string): string {
  const all = crumbsOf(path)
  const start = crumbsOf(from).length
  return all.slice(start, -1).map((c) => c.name).join(' › ')
}

/** Searching subfolders stops after this many matches. */
export const SEARCH_LIMIT = 500

/** A folder's size as the Files tab shows it: "1.2 GB", or "1.2 GB+" when part of it couldn't be read. */
export const describeFolderSize = (size: { bytes: number; complete: boolean }): string => `${describeBytes(size.bytes)}${size.complete ? '' : '+'}`

/** Whole PC search shows at most this many (each one is looked up for its size and date). */
export const PC_SEARCH_LIMIT = 300

/** Whether a name contains every (lowercase) word. */
export const matchesWords = (name: string, words: string[]): boolean => {
  const lower = name.toLowerCase()
  return words.every((w) => lower.includes(w))
}

/**
 * Paths the system's own search turns up that are only an app's workings (caches, AppData,
 * ~/Library, dot folders): left out of Whole PC results, like Orbit's own list leaves them out.
 */
export function looksLikeAppFiles(path: string, showHidden: boolean): boolean {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  const lower = parts.map((p) => p.toLowerCase())
  if (lower.some((p) => p === 'appdata' || p === 'node_modules' || p === '$recycle.bin' || p === 'caches' || p === 'cache')) return true
  // A Mac's system folders: /System, /Library, /private and the like, and ~/Library.
  if (lower[0] === 'system' || lower[0] === 'library' || lower[0] === 'private' || lower[0] === 'usr' || lower[0] === 'opt') return true
  if (lower[0] === 'users' && lower[2] === 'library') return true
  // Inside an app (Name.app/Contents/…).
  if (lower.slice(0, -1).some((p) => p.endsWith('.app'))) return true
  if (!showHidden && parts.some((p) => isHiddenName(p))) return true
  return false
}

/** How Whole PC search's list of files is getting on (see main/fileIndex). */
export interface PcIndexStatus {
  state: 'off' | 'loading' | 'building' | 'ready'
  /** Files and folders in the list. */
  count: number
  /** When the drives were last walked in full (ms), or 0. */
  builtAt: number
  /** While walking the drives: how many found so far. */
  progress: number
  /** Changes are being picked up as they happen. */
  live: boolean
  /** Where the list starts from (every drive on Windows). */
  roots: string[]
}

/** "1.2 million files", "48,210 files". */
export function describeCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} million`
  return n.toLocaleString('en-GB')
}

/** How full a drive is, from the system (main/explorer.ts reads it with statfs). */
export interface DriveSpace {
  /** The drive's size in bytes. */
  total: number
  /** Bytes still free for this user. */
  free: number
}

/** A drive's space from Node's statfs: blocks × block size, with the blocks this user may still fill as free. Null when it makes no sense (an empty or odd volume). */
export function driveSpaceFromStatfs(s: { bsize: number | bigint; blocks: number | bigint; bavail: number | bigint }): DriveSpace | null {
  const bsize = Number(s.bsize)
  const total = Number(s.blocks) * bsize
  const free = Number(s.bavail) * bsize
  if (!Number.isFinite(total) || !Number.isFinite(free) || total <= 0 || free < 0) return null
  return { total, free: Math.min(free, total) }
}

/**
 * A drive's size the way the computer's own file manager writes it: File Explorer counts in
 * 1024s ("476 GB" for a 512 GB drive), Finder in 1000s. Whole numbers from 100 up, one decimal below.
 */
export function describeDriveBytes(bytes: number, binary: boolean): string {
  const k = binary ? 1024 : 1000
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB']
  let n = Math.max(0, bytes)
  let i = 0
  while (n >= k && i < units.length - 1) {
    n /= k
    i++
  }
  if (i === 0) return `${Math.round(n)} bytes`
  const shown = n >= 100 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString()
  return `${shown} ${units[i]}`
}

/** Under a tenth of the drive free, its bar turns red (as File Explorer's does). */
export const isDriveLow = (space: DriveSpace): boolean => space.free < space.total * 0.1

/** What the Drives list shows under a drive: how full the bar is, "120 GB free of 476 GB", and the longer hover text. */
export function describeDriveSpace(space: DriveSpace, binary: boolean): { usedPercent: number; low: boolean; text: string; title: string } {
  const used = Math.max(0, space.total - space.free)
  const usedPercent = space.total > 0 ? Math.min(100, Math.max(0, (used / space.total) * 100)) : 0
  const fmt = (b: number): string => describeDriveBytes(b, binary)
  return {
    usedPercent,
    low: isDriveLow(space),
    text: `${fmt(space.free)} free of ${fmt(space.total)}`,
    title: `${fmt(used)} used · ${fmt(space.free)} free · ${fmt(space.total)} in all (${Math.round(usedPercent)}% full)`
  }
}
