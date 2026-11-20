/**
 * Recording a voiceover one section at a time (the Studio's teleprompter, "By section"): every
 * take is its own file in a "<script> sections" folder beside your recordings, and the takes you
 * pick are joined into one voiceover at the end. The names and the ffmpeg join live here, so the
 * main process and the tests share them.
 */

/** Characters Windows and macOS don't allow in a file name (and control characters). */
const unsafe = (s: string): string =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')

/** A section or script title made safe for a file name. */
export function safeName(s: string, fallback: string, max = 60): string {
  const out = unsafe(s).slice(0, max).trim()
  return out || fallback
}

/** "Script - Rick and Morty" from "Videos/Script - Rick and Morty.md". */
export const scriptName = (scriptPath: string): string => safeName((scriptPath.split(/[\\/]/).pop() ?? '').replace(/\.md$/i, ''), 'Script', 80)

/** The folder a script's takes go in, inside your recordings folder. */
export const takesFolderName = (scriptPath: string): string => `${scriptName(scriptPath)} sections`

/** "02 The prison - take 3.m4a": the section's place in the script, its title and the take. */
export function takeFileName(index: number, title: string, take: number, ext: string): string {
  return `${String(index + 1).padStart(2, '0')} ${safeName(title, index === 0 ? 'Opening' : 'Section')} - take ${take}.${ext}`
}

/** What a take file looks like (so only these can be played back or joined). */
export const TAKE_FILE = /^\d{2,3} .+ - take \d+\.(m4a|webm|mp4)$/

export function isTakePath(path: string): boolean {
  const parts = path.split(/[\\/]/)
  const file = parts.pop() ?? ''
  const dir = parts.pop() ?? ''
  return TAKE_FILE.test(file) && / sections$/.test(dir)
}

/** "Script - Rick and Morty voiceover (joined).wav". */
export const joinedFileName = (scriptPath: string, n = 1): string => `${scriptName(scriptPath)} voiceover (joined${n > 1 ? ` ${n}` : ''}).wav`

export interface JoinPart {
  path: string
  /** Where the words start in the take (after the 3, 2, 1), seconds. */
  from: number
  /** How long the part used is, seconds (0 = to the end). */
  length: number
}

const sec = (n: number): string => String(Math.round(Math.max(0, n) * 1000) / 1000)

/**
 * Joins the takes, in order, into one WAV. Each one starts where its words start, and gets a
 * very short fade in and out so there's never a click where two takes meet.
 */
export function joinArgs(parts: readonly JoinPart[], output: string): string[] {
  const inputs: string[] = []
  const chains: string[] = []
  parts.forEach((p, i) => {
    inputs.push('-ss', sec(p.from))
    if (p.length > 0) inputs.push('-t', sec(p.length))
    inputs.push('-i', p.path)
    const fadeOut = p.length > 0.2 ? `,afade=t=out:st=${sec(p.length - 0.03)}:d=0.03` : ''
    chains.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,afade=t=in:d=0.01${fadeOut}[a${i}]`)
  })
  const mix = `${parts.map((_p, i) => `[a${i}]`).join('')}concat=n=${parts.length}:v=0:a=1[out]`
  return [...inputs, '-filter_complex', [...chains, mix].join(';'), '-map', '[out]', '-c:a', 'pcm_s16le', output]
}
