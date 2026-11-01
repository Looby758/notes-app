import { notify } from '../store/notify'
import { openFileTab } from './editorController'
import { isVideoFile } from '@shared/videoPlayer'
import { queueVaultVideo } from '../store/videoPlayer'
import { isComicBookFile } from '@shared/comics'
import { shelveComicFile } from '../store/comics'
import { isArchiveFile } from '@shared/archive'
import { showInFiles } from '../store/filesReveal'

/** What kind of file something in the notes folder is, and how Notes opens it. */

export type FileKind = 'image' | 'audio' | 'video' | 'pdf' | 'sheet' | 'board' | 'other'

export function fileKind(path: string): FileKind {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'].includes(ext)) return 'image'
  // .webm is how voice notes are saved.
  if (['mp3', 'm4a', 'wav', 'ogg', 'oga', 'aac', 'flac', 'opus', 'webm'].includes(ext)) return 'audio'
  if (isVideoFile(path)) return 'video'
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

/**
 * What clicking a file in the notes folder does. It never kicks off something unexpected:
 * pictures, recordings, PDFs, spreadsheets and boards open in a tab (paused); videos go in the
 * video player's Up next (nothing starts playing); comics go on the comic shelf (unopened); zips
 * show what's inside in the Files tab;
 * anything else only opens in another app after Orbit asks.
 */
export function openAttachment(path: string, opts: { newTab?: boolean; pane?: string } = {}): void {
  if (isComicBookFile(path)) void shelveComicFile(path, true)
  else if (fileKind(path) === 'video') queueVaultVideo(path)
  // Zips, RARs and 7z files show what's inside in the Files tab; nothing is unpacked.
  else if (isArchiveFile(path)) window.api.videoInVault(path).then(showInFiles).catch(notify)
  else if (fileKind(path) === 'other') window.api.openFile(path, true).catch(notify)
  else openFileTab(path, opts)
}

/** Opens a file in its usual app straight away (for an "Open in its usual app" menu item, which says so). */
export function openExternally(path: string): void {
  window.api.openFile(path).catch(notify)
}
