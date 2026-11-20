import { scriptStats } from './script'
import type { Cue } from './teleprompter'
import type { JoinPart } from '@shared/takes'

/**
 * Record by section (the teleprompter's "By section"): the script's sections, the takes of each,
 * and the plan for joining the chosen takes into one voiceover. Plain functions, so they can be
 * tested; the recording itself is in store/takes.ts.
 */

export interface TakeSection {
  /** Stays the same while you edit the script: the title, and which one it is if two share it. */
  key: string
  /** Its place in the script (0 = first). */
  index: number
  title: string
  /** Where it starts in the note (its [SECTION] marker, or the top for the part before the first). */
  from: number
  /** Where the next one starts (the note's length for the last). */
  to: number
  words: number
  seconds: number
}

export interface Take {
  key: string
  path: string
  /** Its number ("take 3"), from the file name. */
  n: number
  /** When it was recorded (ms). */
  at: number
  /** Where your words start in it, after the 3, 2, 1 (seconds). */
  start: number
  /** How long the recording ran (seconds). */
  length: number
  /** Teleprompter cues, in seconds from the start of the take. */
  cues: Cue[]
  /** Stopped before the end of the section. */
  early: boolean
  /** Thrown away with Quick retake (still on disk, just not used). */
  scrapped: boolean
}

/** The script's sections, ready to record one at a time. A script with no [SECTION] markers is one section. */
export function sectionsOf(text: string, wpm: number): TakeSection[] {
  const stats = scriptStats(text, wpm).sections
  const seen = new Map<string, number>()
  return stats.map((s, i) => {
    const title = s.title || (i === 0 && stats.length > 1 ? 'Opening' : stats.length === 1 ? 'Whole script' : `Section ${i + 1}`)
    const base = (s.title || '(opening)').trim().toLowerCase()
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return { key: `${base}#${n}`, index: i, title, from: s.from, to: stats[i + 1]?.from ?? text.length, words: s.words, seconds: s.seconds }
  })
}

/** The take number in a file name ("… - take 3.m4a" → 3). */
export const takeNumber = (path: string): number => Number(/ - take (\d+)\.\w+$/.exec(path)?.[1] ?? 1)

/** The take a section will use: the one you picked, otherwise its newest good one. */
export function chosenTake(key: string, takes: readonly Take[], chosen: Readonly<Record<string, string>>): Take | null {
  const mine = takes.filter((t) => t.key === key)
  const picked = chosen[key] ? mine.find((t) => t.path === chosen[key]) : undefined
  if (picked) return picked
  const good = mine.filter((t) => !t.scrapped).sort((a, b) => b.at - a.at)
  return good[0] ?? null
}

export interface JoinPlan {
  parts: JoinPart[]
  /** The cues, moved to where they land in the joined voiceover. */
  cues: Cue[]
  /** Sections with no take yet (left out of the join). */
  missing: TakeSection[]
  /** Roughly how long the joined voiceover is (seconds). */
  length: number
}

/** Each section's chosen take, in script order, starting where the words start. */
export function joinPlan(sections: readonly TakeSection[], takes: readonly Take[], chosen: Readonly<Record<string, string>>): JoinPlan {
  const parts: JoinPart[] = []
  const cues: Cue[] = []
  const missing: TakeSection[] = []
  let offset = 0
  for (const s of sections) {
    const t = chosenTake(s.key, takes, chosen)
    if (!t) {
      // Nothing to read in it (an empty opening): nothing missing.
      if (s.words > 0) missing.push(s)
      continue
    }
    const start = Math.max(0, Math.min(t.start, t.length))
    parts.push({ path: t.path, from: start, length: 0 })
    for (const c of t.cues) if (c.t >= start - 0.05) cues.push({ ...c, t: offset + Math.max(0, c.t - start) })
    offset += Math.max(0, t.length - start)
  }
  return { parts, cues, missing, length: offset }
}

/** "Opening, The prison and 2 more" — for saying which sections still need a take. */
export function listTitles(sections: readonly TakeSection[], max = 3): string {
  const names = sections.map((s) => `“${s.title}”`)
  if (names.length <= 1) return names.join('')
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${names.slice(0, max - 1).join(', ')} and ${names.length - max + 1} more`
}
