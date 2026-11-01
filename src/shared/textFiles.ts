/**
 * Plain text files (other than .md notes) that Orbit opens and edits in a tab: .txt, .json,
 * config files, code and so on. Spreadsheets (.csv, .tsv), boards (.canvas) and pictures (.svg)
 * have their own views, so they aren't here.
 */
export const TEXT_FILE_EXTENSIONS = [
  'txt', 'text', 'log', 'markdown', 'mdx', 'rst', 'tex', 'srt', 'vtt',
  'json', 'jsonc', 'json5', 'geojson', 'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties',
  'html', 'htm', 'css', 'scss', 'less', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte',
  'py', 'rb', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'php', 'pl', 'r', 'lua', 'dart',
  'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'sql', 'graphql', 'diff', 'patch'
]

/** The biggest text file opened for editing; bigger ones still open in their usual app. */
export const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024

const extOf = (name: string): string => {
  const file = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const dot = file.lastIndexOf('.')
  return dot > 0 ? file.slice(dot + 1).toLowerCase() : ''
}

/** True for a .txt, .json or other plain text file that Orbit can edit (not a .md note). */
export const isTextFile = (name: string): boolean => TEXT_FILE_EXTENSIONS.includes(extOf(name))

/** Text with words wrapped (prose), as opposed to code and data, which keep their lines as they are. */
export const wrapsLines = (name: string): boolean => ['txt', 'text', 'log', 'markdown', 'mdx', 'rst', 'tex', 'srt', 'vtt'].includes(extOf(name))

/** True if `bytes` look like text rather than a binary file (no NUL bytes near the start). */
export function looksLikeText(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 8192)
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return false
  return true
}

/** How a text file's line endings and byte-order mark are kept, so saving doesn't change them. */
export interface TextFormat {
  bom: boolean
  crlf: boolean
}

/** Splits a file's text into what the editor shows and how to write it back. */
export function decodeText(raw: string): { text: string; format: TextFormat } {
  const bom = raw.startsWith('\uFEFF')
  const body = bom ? raw.slice(1) : raw
  // The editor works in \n line breaks; they're turned back into \r\n when saving.
  return { text: body.replace(/\r\n?/g, '\n'), format: { bom, crlf: body.includes('\r\n') } }
}

/** The editor's text (with \n line breaks) as it should be saved. */
export function encodeText(text: string, format: TextFormat): string {
  const body = format.crlf ? text.replace(/\r?\n/g, '\r\n') : text
  return (format.bom ? '\uFEFF' : '') + body
}

/** For a .json file: null if it's valid (or empty), otherwise what's wrong and on which line. */
export function jsonProblem(text: string): string | null {
  if (!text.trim()) return null
  try {
    JSON.parse(text)
    return null
  } catch (err) {
    const message = (err as Error).message
    const at = /position (\d+)/.exec(message)
    const line = at ? text.slice(0, Number(at[1])).split('\n').length : null
    const reason = message.replace(/^JSON\.parse: /, '').replace(/,?\s*(in JSON )?at position \d+.*$/, '')
    return line ? `${reason} (line ${line})` : reason
  }
}
