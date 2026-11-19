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

/** A card on a video's thumbnail board: an idea written down, or a picture (a frame, a mock-up, a reference). */
export interface ThumbnailCard {
  id: string
  kind: 'idea' | 'picture'
  /** The idea, or a caption for the picture. */
  text: string
  /** The picture, by its place in the notes folder ("attachments/maggie frame 2m14s.png"). */
  file?: string
  created: number
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
  /** The thumbnail board, in the order you arranged it. */
  thumbnails: ThumbnailCard[]
  /** The picture you're going with. */
  chosenThumbnail: string | null
  /** Upload checklist steps you've ticked, by step id, with when. */
  ticked: Record<string, number>
  /** Steps that don't apply to this video (no chapters on a short one, say). */
  skipped: string[]
  /** Steps of your own for this video. */
  extraSteps: { id: string; text: string }[]
  /** When it went up, and its link. */
  uploaded: { on: string; url: string } | null
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
  return {
    id,
    name,
    created: now,
    updated: now,
    titles: [],
    chosenTitle: null,
    description: '',
    tags: [],
    chapters: [],
    chaptersInDescription: true,
    thumbnails: [],
    chosenThumbnail: null,
    ticked: {},
    skipped: [],
    extraSteps: [],
    uploaded: null
  }
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
    const thumbnails: ThumbnailCard[] = arr(v.thumbnails)
      .map((t) => obj(t))
      .filter((t) => str(t.id) && (t.kind === 'idea' || (t.kind === 'picture' && str(t.file))))
      .map((t) => ({ id: str(t.id), kind: t.kind as ThumbnailCard['kind'], text: str(t.text), ...(t.kind === 'picture' ? { file: str(t.file) } : {}), created: num(t.created, 0) }))
    const chosenThumb = str(v.chosenThumbnail)
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
      chaptersInDescription: v.chaptersInDescription !== false,
      thumbnails,
      chosenThumbnail: thumbnails.some((t) => t.id === chosenThumb && t.kind === 'picture') ? chosenThumb : null,
      ticked: Object.fromEntries(Object.entries(obj(v.ticked)).filter(([, at]) => typeof at === 'number')) as Record<string, number>,
      skipped: arr(v.skipped).filter((s): s is string => typeof s === 'string'),
      extraSteps: arr(v.extraSteps)
        .map((s) => obj(s))
        .filter((s) => str(s.id))
        .map((s) => ({ id: str(s.id), text: str(s.text) })),
      uploaded: obj(v.uploaded).on && typeof obj(v.uploaded).on === 'string' ? { on: str(obj(v.uploaded).on), url: str(obj(v.uploaded).url) } : null
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

/** How far through the upload checklist a video is, for the list of videos. */
export function draftProgress(d: VideoDraft): { done: number; total: number } {
  const steps = checklist(d).filter((s) => !s.skipped)
  return { done: steps.filter((s) => s.done).length, total: steps.length }
}

// ---------- thumbnails ----------

/** What YouTube asks for: 1280×720 (16:9), at least 640 wide, under 2 MB, JPG, PNG or GIF. */
export const THUMB_WIDTH = 1280
export const THUMB_HEIGHT = 720
export const THUMB_MIN_WIDTH = 640
export const THUMB_MAX_BYTES = 2 * 1024 * 1024
const THUMB_TYPES = new Set(['jpg', 'jpeg', 'png', 'gif'])

export const extOf = (file: string): string => /\.([^./\\]+)$/.exec(file)?.[1]?.toLowerCase() ?? ''

export interface ThumbProblem {
  level: Level
  message: string
}

/** Whether a picture will do as a YouTube thumbnail. Width, height and bytes are left out when not known yet. */
export function thumbnailProblems(file: string, size?: { width: number; height: number }, bytes?: number): ThumbProblem[] {
  const out: ThumbProblem[] = []
  const ext = extOf(file)
  if (!THUMB_TYPES.has(ext)) out.push({ level: 'error', message: `YouTube takes JPG, PNG or GIF${ext ? `, not .${ext}` : ''}` })
  if (bytes !== undefined && bytes > THUMB_MAX_BYTES) out.push({ level: 'error', message: `${(bytes / 1024 / 1024).toFixed(1)} MB: YouTube’s limit is 2 MB (save it as a JPG)` })
  if (size) {
    if (size.width < THUMB_MIN_WIDTH) out.push({ level: 'error', message: `${size.width}×${size.height}: YouTube needs at least ${THUMB_MIN_WIDTH} wide` })
    else if (size.width < THUMB_WIDTH) out.push({ level: 'warn', message: `${size.width}×${size.height}: ${THUMB_WIDTH}×${THUMB_HEIGHT} looks sharper` })
    const ratio = size.width / size.height
    if (Math.abs(ratio - 16 / 9) > 0.02) out.push({ level: 'warn', message: `Not 16:9, so YouTube adds black bars (crop it to ${THUMB_WIDTH}×${THUMB_HEIGHT})` })
  }
  return out
}

/** The picture you picked, or null. */
export const chosenThumbnailCard = (d: VideoDraft): ThumbnailCard | null => d.thumbnails.find((t) => t.id === d.chosenThumbnail && t.kind === 'picture') ?? null

/** A name for a grabbed frame: "Maggie 2m14s.png". */
export function frameFileName(video: string, seconds: number): string {
  const base =
    video
      .split(/[\\/]/)
      .pop()!
      .replace(/\.[^.]+$/, '')
      .replace(/[<>:"|?*]+/g, '')
      .trim() || 'Frame'
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${base} ${h ? `${h}h` : ''}${m}m${String(s % 60).padStart(2, '0')}s.png`
}

/** Keeps the board's pictures pointing at the right files after a rename or move in the notes folder. */
export function remapThumbnails(videos: VideoDraft[], from: string, to: string): VideoDraft[] | null {
  const within = (p: string): boolean => p === from || p.startsWith(`${from}/`)
  if (!videos.some((v) => v.thumbnails.some((t) => t.file && within(t.file)))) return null
  return videos.map((v) =>
    v.thumbnails.some((t) => t.file && within(t.file)) ? { ...v, thumbnails: v.thumbnails.map((t) => (t.file && within(t.file) ? { ...t, file: to + t.file.slice(from.length) } : t)) } : v
  )
}

// ---------- the upload checklist ----------

export type StepGroup = 'ready' | 'drafts' | 'studio'

export const STEP_GROUPS: { id: StepGroup; label: string }[] = [
  { id: 'ready', label: 'Get the video ready' },
  { id: 'drafts', label: 'Before you upload' },
  { id: 'studio', label: 'In YouTube Studio' }
]

/** Which part of the page an automatic step is about, so its "Go to it" can scroll there. */
export type DraftSection = 'titles' | 'board' | 'description' | 'tags' | 'chapters'

export interface ChecklistStep {
  id: string
  group: StepGroup
  label: string
  /** A line of help under it. */
  hint?: string
  /** Ticked by Orbit from the drafts, not by hand. */
  auto?: DraftSection
  done: boolean
  /** For an automatic step that isn't done: what's missing. */
  missing?: string
  skipped: boolean
  /** Can be marked "not needed for this video". */
  skippable: boolean
  /** One you added. */
  extra?: boolean
}

interface StepDef {
  id: string
  group: StepGroup
  label: string
  hint?: string
  skippable?: boolean
  /** For automatic steps: null when it's done, or what's missing. */
  check?: (d: VideoDraft) => string | null
  auto?: DraftSection
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/** The set workflow every video goes through, ending with YouTube's own boxes. */
export const STEPS: StepDef[] = [
  { id: 'exported', group: 'ready', label: 'Final video exported', hint: 'The finished edit, rendered at full quality.' },
  { id: 'watched', group: 'ready', label: 'Watched it all the way through', hint: 'Audio levels, pauses, images in the right places, nothing left in by mistake.' },
  {
    id: 'thumbnail',
    group: 'drafts',
    label: 'Thumbnail picked',
    auto: 'board',
    check: (d) => {
      const card = chosenThumbnailCard(d)
      if (!card?.file) return d.thumbnails.some((t) => t.kind === 'picture') ? 'Star a picture on the thumbnail board' : 'Add a picture to the thumbnail board and star it'
      const bad = thumbnailProblems(card.file).find((p) => p.level === 'error')
      return bad ? bad.message : null
    }
  },
  {
    id: 'title',
    group: 'drafts',
    label: 'Title chosen',
    auto: 'titles',
    check: (d) => {
      const title = chosenTitleText(d)
      if (!title) return 'Write a title option'
      const c = titleCheck(title)
      return c.level === 'error' ? c.message : null
    }
  },
  {
    id: 'description',
    group: 'drafts',
    label: 'Description written',
    auto: 'description',
    check: (d) => {
      if (!d.description.trim()) return 'Write the description'
      const c = descriptionCheck(d)
      return c.level === 'error' ? c.message : null
    }
  },
  {
    id: 'tags',
    group: 'drafts',
    label: 'Tags added',
    auto: 'tags',
    skippable: true,
    check: (d) => (!d.tags.length ? 'Add a few tags' : tagsLength(d.tags) > TAGS_MAX ? `Over YouTube’s ${TAGS_MAX} limit` : null)
  },
  {
    id: 'chapters',
    group: 'drafts',
    label: 'Chapters ready',
    auto: 'chapters',
    skippable: true,
    check: (d) => {
      if (!d.chapters.length) return 'Add chapters (or mark them not needed)'
      const problems = chapterProblems(d.chapters)
      if (problems.length) return `${plural(problems.length, 'thing')} to fix`
      return d.chaptersInDescription ? null : 'Tick “put the chapters at the end” so YouTube finds them'
    }
  },
  { id: 'details', group: 'studio', label: 'Title, description and tags pasted in', hint: 'Use the Copy buttons above.' },
  { id: 'thumbnail-up', group: 'studio', label: 'Thumbnail uploaded' },
  { id: 'end-screen', group: 'studio', label: 'End screen added', hint: 'Point to another video or a playlist, plus Subscribe, in the last 5–20 seconds.' },
  {
    id: 'synthetic',
    group: 'studio',
    label: 'Answered the “altered or synthetic content” box',
    hint: 'Under Details. Say Yes if a realistic person, place or event was made or changed with AI (an AI voice, say). Your own voice, real clips and edits are No.'
  },
  { id: 'audience', group: 'studio', label: '“Made for kids” answered', hint: 'Under Audience: almost always No for this kind of video.' },
  { id: 'visibility', group: 'studio', label: 'Visibility set or scheduled', hint: 'Public, Unlisted, or a time to go live.' }
]

/** Every step for this video, with whether it's done. */
export function checklist(d: VideoDraft): ChecklistStep[] {
  const out: ChecklistStep[] = STEPS.map((s) => {
    const skipped = !!s.skippable && d.skipped.includes(s.id)
    const missing = s.check ? s.check(d) : null
    return {
      id: s.id,
      group: s.group,
      label: s.label,
      hint: s.hint,
      auto: s.auto,
      done: s.check ? !missing : !!d.ticked[s.id],
      missing: s.check && missing ? missing : undefined,
      skipped,
      skippable: !!s.skippable
    }
  })
  // Your own steps go at the end of getting the video ready.
  const extras: ChecklistStep[] = d.extraSteps.map((e) => ({ id: e.id, group: 'ready', label: e.text, done: !!d.ticked[e.id], skipped: false, skippable: false, extra: true }))
  out.splice(out.filter((s) => s.group === 'ready').length, 0, ...extras)
  return out
}

/** Whether everything that applies is done. */
export const readyToUpload = (d: VideoDraft): boolean => checklist(d).every((s) => s.skipped || s.done)
