import { notify } from '../store/notify'
import { openFileTab } from './editorController'

/** What kind of file something in the notes folder is, and how Notes opens it. */

export type FileKind = 'image' | 'audio' | 'video' | 'pdf' | 'sheet' | 'board' | 'other'

export function fileKind(path: string): FileKind {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'].includes(ext)) return 'image'
  // .webm is how voice notes are saved.
  if (['mp3', 'm4a', 'wav', 'ogg', 'oga', 'aac', 'flac', 'opus', 'webm'].includes(ext)) return 'audio'
  if (['mp4', 'mov', 'm4v', 'ogv'].includes(ext)) return 'video'
  if (ext === 'pdf') return 'pdf'
  // Old binary .xls and .ods files still open in their usual app.
  // .gsheet is Google Drive's link to a Google Sheet; it's fetched from Google to show it.
  if (['xlsx', 'xlsm', 'csv', 'tsv', 'gsheet'].includes(ext)) return 'sheet'
  // Canvas boards made here (or in Obsidian).
  if (ext === 'canvas') return 'board'
  return 'other'
}

/** The address Notes serves a vault file at (see the vault: protocol in the main process). */
export const vaultUrl = (path: string): string => `vault://local/${path.split('/').map(encodeURIComponent).join('/')}`

/** Pictures, recordings, videos, PDFs, spreadsheets and boards open in a tab; anything else in its usual app. */
export function openAttachment(path: string, opts: { newTab?: boolean; pane?: string } = {}): void {
  if (fileKind(path) === 'other') openExternally(path)
  else openFileTab(path, opts)
}

export function openExternally(path: string): void {
  window.api.openFile(path).catch(notify)
}
