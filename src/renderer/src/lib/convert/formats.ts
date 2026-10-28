import type { SaveFormat } from '@shared/types'

/**
 * What the file converter takes, and what each kind of file can become. Everything converts on
 * this computer; nothing is uploaded.
 */

export type Kind = 'image' | 'audio' | 'document'

export interface Target {
  format: SaveFormat
  label: string
}

const IMAGE_OUT: Target[] = [
  { format: 'jpg', label: 'JPG' },
  { format: 'png', label: 'PNG' },
  { format: 'webp', label: 'WebP' }
]
const AUDIO_OUT: Target[] = [
  { format: 'mp3', label: 'MP3' },
  { format: 'wav', label: 'WAV' }
]
const PDF: Target = { format: 'pdf', label: 'PDF' }
const WORD: Target = { format: 'docx', label: 'Word' }
const MARKDOWN: Target = { format: 'md', label: 'Markdown' }
const TEXT: Target = { format: 'txt', label: 'Plain text' }
const WEB: Target = { format: 'html', label: 'Web page' }

const INPUTS: Record<string, { kind: Kind; targets: Target[] }> = {}
const add = (exts: string[], kind: Kind, targets: Target[]): void => {
  for (const e of exts) INPUTS[e] = { kind, targets }
}
add(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif', 'svg'], 'image', IMAGE_OUT)
add(['wav', 'mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'webm', 'weba'], 'audio', AUDIO_OUT)
add(['docx'], 'document', [PDF, MARKDOWN, TEXT])
add(['md', 'markdown'], 'document', [PDF, WORD, WEB])
add(['txt'], 'document', [PDF, WORD])
add(['html', 'htm'], 'document', [PDF, WORD, MARKDOWN])

/** A file name's extension, lower case ("" if none). */
export const extOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** The name without its extension. */
export const stemOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export const kindOf = (name: string): Kind | null => INPUTS[extOf(name)]?.kind ?? null

/** Formats a file can become (never its own format: a JPG isn't offered "JPG"). */
export function targetsFor(name: string): Target[] {
  const ext = extOf(name).replace('jpeg', 'jpg')
  return (INPUTS[extOf(name)]?.targets ?? []).filter((t) => t.format !== ext)
}

/** Why a file can't be converted, in plain words. */
export function whyNot(name: string): string {
  const ext = extOf(name)
  if (ext === 'doc') return 'Older Word files (.doc) can’t be converted. Open it in Word and save it as .docx first.'
  if (ext === 'pdf') return 'PDFs can’t be turned into other files here.'
  if (['mov', 'mp4', 'avi', 'mkv', 'm4v', 'wmv'].includes(ext)) return 'Videos can’t be converted here.'
  if (['pages', 'key', 'numbers'].includes(ext)) return 'Apple Pages, Keynote and Numbers files can’t be converted. Export them from the Apple app instead.'
  return ext ? `.${ext} files can’t be converted.` : 'This file has no type (like .jpg or .docx) on the end of its name.'
}

/** The converted file's name: "Photo.heic" → "Photo.jpg", or "Photo (2).jpg" if that's taken. */
export function outputName(name: string, format: SaveFormat, taken: Set<string>): string {
  const base = stemOf(name).replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Converted'
  let out = `${base}.${format}`
  for (let n = 2; taken.has(out.toLowerCase()); n++) out = `${base} (${n}).${format}`
  taken.add(out.toLowerCase())
  return out
}

/** Sizes in words: "820 KB", "3.4 MB". */
export function describeSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} bytes`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`
  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`
}
