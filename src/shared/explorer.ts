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

/** Folders first, then by the chosen column (newest and biggest first). */
export function sortEntries(entries: ExplorerEntry[], by: ExplorerSort): ExplorerEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    if (by === 'modified' && a.modified !== b.modified) return b.modified - a.modified
    if (by === 'size' && !a.isDir && a.size !== b.size) return b.size - a.size
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
