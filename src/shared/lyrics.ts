/**
 * Song lyrics for the full-screen player. They come from a .lrc or .txt file next to the song (same
 * name), or from the lyrics saved inside the MP3. A .lrc file has a time on each line
 * ("[01:23.45] words"), so the line being sung can be lit up as the song plays.
 */

export interface LyricLine {
  /** When the line starts, in ms; null for lyrics without times. */
  at: number | null
  text: string
}

export interface Lyrics {
  lines: LyricLine[]
  /** Every line has a time. */
  synced: boolean
  /** Where they came from, for the "Edit" note: 'lrc' / 'txt' next to the song, or 'tag' inside it. */
  source: 'lrc' | 'txt' | 'tag'
}

const TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

/** Reads lyrics text: timed .lrc lines if it has them, otherwise plain lines. */
export function parseLyrics(text: string, source: Lyrics['source']): Lyrics | null {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const timed: LyricLine[] = []
  const plain: LyricLine[] = []
  for (const raw of clean.split('\n')) {
    // Lines like [ar: Artist] or [offset: 100] are about the file, not words to show.
    if (/^\s*\[[a-z]+:[^\]]*\]\s*$/i.test(raw)) continue
    const times: number[] = []
    TIME.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = TIME.exec(raw))) {
      const frac = m[3] ? Number(m[3].padEnd(3, '0').slice(0, 3)) : 0
      times.push((Number(m[1]) * 60 + Number(m[2])) * 1000 + frac)
    }
    const words = raw.replace(TIME, '').trim()
    if (times.length) for (const at of times) timed.push({ at, text: words })
    else plain.push({ at: null, text: raw.trim() })
  }
  if (timed.length) {
    timed.sort((a, b) => a.at! - b.at!)
    return { lines: timed, synced: true, source }
  }
  // No more than one empty line in a row, and none at the start or end.
  const lines = plain.filter((l, i) => l.text || (i > 0 && plain[i - 1].text))
  while (lines.length && !lines[lines.length - 1].text) lines.pop()
  return lines.length ? { lines, synced: false, source } : null
}

/** Which timed line is being sung at `ms` (-1 before the first). */
export function activeLine(lyrics: Lyrics, ms: number): number {
  if (!lyrics.synced) return -1
  let lo = 0
  let hi = lyrics.lines.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lyrics.lines[mid].at! <= ms) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

/** The .lrc / .txt file next to a song ("Albums/Song.mp3" → "Albums/Song.lrc"). */
export const lyricsPathFor = (songPath: string, ext: 'lrc' | 'txt'): string => songPath.replace(/\.[^./\\]+$/, '') + `.${ext}`

/** Whether pasted lyrics have times on their lines (so they're saved as .lrc rather than .txt). */
export const looksTimed = (text: string): boolean => /^\s*\[\d{1,3}:\d{1,2}([.:]\d{1,3})?\]/m.test(text)
