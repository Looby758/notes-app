/**
 * Getting a video ready to publish on YouTube: title options, the description, tags and chapters,
 * kept per video in .notesapp/publishing.json (store/publishing.ts saves it).
 *
 * Each video's record is keyed by a video id. Until video projects exist the Publishing page makes
 * its own ids; a video project passes its own id instead, so its drafts live under that.
 */

export interface TitleOption {
  id: string
  text: string
}

export interface Chapter {
  id: string
  /** Where it starts, as typed: "0:00", "2:14", "1:02:03". */
  time: string
  name: string
}

export interface VideoDraft {
  id: string
  /** What the video is called in Orbit (its working name, not necessarily the YouTube title). */
  name: string
  created: number
  updated: number
  titles: TitleOption[]
  /** The title option you're going with. */
  chosenTitle: string | null
  description: string
  tags: string[]
  chapters: Chapter[]
  /** Put the chapter list at the end of the description when copying it. */
  chaptersInDescription: boolean
}

export interface PublishingData {
  videos: VideoDraft[]
}

// YouTube's own limits.
export const TITLE_MAX = 100
/** Search results and the home page cut titles off at about this many characters. */
export const TITLE_SHOWN = 70
export const DESCRIPTION_MAX = 5000
export const TAGS_MAX = 500
export const CHAPTERS_MIN = 3
export const CHAPTER_MIN_SECONDS = 10

export const newPublishingId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

export const emptyPublishing = (): PublishingData => ({ videos: [] })

export function newDraft(name: string, id = newPublishingId(), now = Date.now()): VideoDraft {
  return { id, name, created: now, updated: now, titles: [], chosenTitle: null, description: '', tags: [], chapters: [], chaptersInDescription: true }
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

/** Reads publishing.json, keeping whatever is usable from a damaged or older file. */
export function readPublishing(raw: string | null): PublishingData {
  if (!raw) return emptyPublishing()
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return emptyPublishing()
  }
  const seen = new Set<string>()
  const videos: VideoDraft[] = []
  for (const item of arr(obj(data).videos)) {
    const v = obj(item)
    const id = str(v.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    const titles = arr(v.titles)
      .map((t) => obj(t))
      .filter((t) => str(t.id))
      .map((t) => ({ id: str(t.id), text: str(t.text) }))
    const chosen = str(v.chosenTitle)
    videos.push({
      id,
      name: str(v.name, 'Untitled video'),
      created: num(v.created, 0),
      updated: num(v.updated, 0),
      titles,
      chosenTitle: titles.some((t) => t.id === chosen) ? chosen : null,
      description: str(v.description),
      tags: arr(v.tags).filter((t): t is string => typeof t === 'string'),
      chapters: arr(v.chapters)
        .map((c) => obj(c))
        .filter((c) => str(c.id))
        .map((c) => ({ id: str(c.id), time: str(c.time), name: str(c.name) })),
      chaptersInDescription: v.chaptersInDescription !== false
    })
  }
  return { videos }
}

// ---------- titles ----------

/** The title you picked, or the first one you wrote. */
export function chosenTitleText(d: VideoDraft): string {
  return (d.titles.find((t) => t.id === d.chosenTitle) ?? d.titles.find((t) => t.text.trim()))?.text.trim() ?? ''
}

export type Level = 'ok' | 'warn' | 'error'

export function titleCheck(text: string): { level: Level; message: string } {
  const n = [...text.trim()].length
  if (!n) return { level: 'warn', message: 'Empty' }
  if (n > TITLE_MAX) return { level: 'error', message: `${n}/${TITLE_MAX}: too long for YouTube` }
  if (/[<>]/.test(text)) return { level: 'error', message: 'YouTube doesn’t allow < or > in titles' }
  if (n > TITLE_SHOWN) return { level: 'warn', message: `${n}/${TITLE_MAX}: cut off after about ${TITLE_SHOWN} in search` }
  return { level: 'ok', message: `${n}/${TITLE_MAX}` }
}

// ---------- tags ----------

/** Splits typed or pasted tags ("walking dead, rick grimes; twd") into a clean list, without repeats. */
export function parseTags(text: string): string[] {
  return dedupeTags(text.split(/[,;\n]/))
}

export function dedupeTags(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const tag = raw.trim().replace(/^#/, '').replace(/\s+/g, ' ').trim()
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

/** How YouTube counts tags towards its 500 limit: commas between them, and quotes round tags with spaces. */
export function tagsLength(tags: string[]): number {
  if (!tags.length) return 0
  return tags.reduce((sum, t) => sum + [...t].length + (t.includes(' ') ? 2 : 0), 0) + tags.length - 1
}

/** Tags as you paste them into YouTube Studio. */
export const tagsText = (tags: string[]): string => tags.join(', ')

// ---------- chapters ----------

/** "2:14" → 134, "1:02:03" → 3723; null if it isn't a time. */
export function parseTime(text: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{2})\s*$/.exec(text) ?? /^\s*()(\d+):(\d{2})\s*$/.exec(text)
  if (!m) return null
  const h = m[1] ? Number(m[1]) : 0
  const min = Number(m[2])
  const s = Number(m[3])
  if (s > 59 || (m[1] && min > 59)) return null
  return h * 3600 + min * 60 + s
}

/** 134 → "2:14", 3723 → "1:02:03". */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export interface ChapterProblem {
  /** The chapter it's about, or null for the list as a whole. */
  id: string | null
  message: string
}

/**
 * What would stop YouTube turning the list into chapters: it needs at least three, the first at
 * 0:00, in order, each at least ten seconds long.
 */
export function chapterProblems(chapters: Chapter[]): ChapterProblem[] {
  const problems: ChapterProblem[] = []
  if (!chapters.length) return problems
  let previous: { id: string; at: number } | null = null
  for (const [i, c] of chapters.entries()) {
    const at = parseTime(c.time)
    if (at === null) {
      problems.push({ id: c.id, message: c.time.trim() ? `“${c.time.trim()}” isn’t a time (use 2:14 or 1:02:03)` : 'Needs a time' })
      continue
    }
    if (!c.name.trim()) problems.push({ id: c.id, message: 'Needs a name' })
    if (i === 0 && at !== 0) problems.push({ id: c.id, message: 'The first chapter has to start at 0:00' })
    if (previous) {
      if (at <= previous.at) problems.push({ id: c.id, message: 'Comes before the chapter above it' })
      else if (at - previous.at < CHAPTER_MIN_SECONDS) problems.push({ id: previous.id, message: `Shorter than ${CHAPTER_MIN_SECONDS} seconds` })
    }
    previous = { id: c.id, at }
  }
  if (chapters.length < CHAPTERS_MIN) problems.push({ id: null, message: `YouTube needs at least ${CHAPTERS_MIN} chapters` })
  return problems
}

/** Sorts chapters by time; ones without a time go last, as they were. */
export function sortChapters(chapters: Chapter[]): Chapter[] {
  return chapters
    .map((c, i) => ({ c, i, at: parseTime(c.time) }))
    .sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.i - b.i)
    .map(({ c }) => c)
}

/** The chapter list as YouTube reads it in a description: "0:00 Intro". */
export function chaptersText(chapters: Chapter[]): string {
  return chapters
    .filter((c) => parseTime(c.time) !== null && c.name.trim())
    .map((c) => `${formatTime(parseTime(c.time)!)} ${c.name.trim()}`)
    .join('\n')
}

/**
 * Chapters from pasted text, one per line: "0:00 Intro", "2:14 - The prison", "(1:02:03) Negan".
 * Lines without a time are skipped.
 */
export function parseChapters(text: string, makeId: () => string = newPublishingId): Chapter[] {
  const out: Chapter[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*[[(]?((?:\d+:)?\d{1,2}:\d{2})[\])]?\s*[-–—:|.]?\s*(.*)$/.exec(line)
    if (!m || parseTime(m[1]) === null) continue
    out.push({ id: makeId(), time: formatTime(parseTime(m[1])!), name: m[2].trim() })
  }
  return out
}

// ---------- the description ----------

/** The description as it goes into YouTube, with the chapter list on the end if you want it there. */
export function fullDescription(d: VideoDraft): string {
  const text = d.description.trimEnd()
  const chapters = d.chaptersInDescription ? chaptersText(d.chapters) : ''
  if (!chapters) return text
  return text ? `${text}\n\n${chapters}` : chapters
}

export function descriptionCheck(d: VideoDraft): { level: Level; message: string } {
  const full = fullDescription(d)
  // YouTube's limit is 5000 bytes, so emoji and accented letters count for more than one.
  const bytes = new TextEncoder().encode(full).length
  if (/[<>]/.test(full)) return { level: 'error', message: 'YouTube doesn’t allow < or > in descriptions' }
  if (bytes > DESCRIPTION_MAX) return { level: 'error', message: `${bytes}/${DESCRIPTION_MAX}: too long for YouTube` }
  if (!full.trim()) return { level: 'warn', message: 'Empty' }
  return { level: bytes > DESCRIPTION_MAX * 0.9 ? 'warn' : 'ok', message: `${bytes}/${DESCRIPTION_MAX}` }
}

/** The first couple of lines show above "...more" on YouTube: roughly this many characters. */
export const DESCRIPTION_PREVIEW = 150

/** How many things are filled in, for the list of videos: title, description, tags, chapters. */
export function draftProgress(d: VideoDraft): { done: number; total: number } {
  const parts = [!!chosenTitleText(d), !!d.description.trim(), d.tags.length > 0, d.chapters.length >= CHAPTERS_MIN && !chapterProblems(d.chapters).length]
  return { done: parts.filter(Boolean).length, total: parts.length }
}
