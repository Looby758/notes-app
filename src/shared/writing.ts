/**
 * The Writing Studio: a full-screen place for writing stories, kept completely apart from notes.
 * Stories are never notes: each one is a JSON file in the notes folder's hidden .notesapp folder
 * (so it syncs with Google Drive like the money tracker does), and nothing in here reads or
 * changes a note.
 *
 * A story is chapters of scenes. Each scene has one or more takes (the same scene written
 * different ways) and one of them is the one in use. Around the writing sits the story brain: a
 * page for every character, location, item, group and event, relationships that change over
 * the story, and everything worked out from the text itself (who's in each scene, who has met
 * who, where things happen, when).
 *
 * This file is the part that needs no app: the data, counting, finding names in the text, the
 * brain, the story calendar, continuity checks, pacing, the time-lapse history and the offline
 * AI's prompts and how its replies are read.
 */

// ---------- the data ----------

export type EntityKind = 'character' | 'location' | 'item' | 'group' | 'event'

export const ENTITY_KINDS: readonly { id: EntityKind; label: string; plural: string; emoji: string }[] = [
  { id: 'character', label: 'Character', plural: 'Characters', emoji: '🧑' },
  { id: 'location', label: 'Location', plural: 'Locations', emoji: '📍' },
  { id: 'item', label: 'Item', plural: 'Items', emoji: '🗝️' },
  { id: 'group', label: 'Group', plural: 'Groups', emoji: '🛡️' },
  { id: 'event', label: 'Event', plural: 'Events', emoji: '⚡' }
]

export interface Fact {
  id: string
  /** What it's about, e.g. "Eye colour". */
  label: string
  /** e.g. "brown". */
  value: string
}

export interface Entity {
  id: string
  kind: EntityKind
  name: string
  /** Other names the text uses for them: nicknames, titles, a surname on its own. */
  aliases: string[]
  /** Anything you want to remember about them. */
  about: string
  facts: Fact[]
  /** Characters: the scene they die in, so turning up alive later gets flagged. */
  diesIn?: string
}

/** One point in a relationship's history: from this scene on, they're `label`. */
export interface RelationshipStep {
  id: string
  scene: string
  /** e.g. "Friends", "Enemies", "Dating". */
  label: string
  note: string
}

export interface Relationship {
  id: string
  a: string
  b: string
  steps: RelationshipStep[]
}

/** What happens between two characters in one scene, in a line. */
export interface HowNote {
  text: string
  /** Written by the offline AI (rather than typed). */
  ai: boolean
  /** You've read it and it's right. */
  checked: boolean
  /** The scene's text when it was written (a short fingerprint), to tell when the scene has changed since. */
  of: string
}

export interface Take {
  id: string
  name: string
  text: string
  created: number
}

export interface Scene {
  id: string
  title: string
  takes: Take[]
  /** The take in use: the one that counts, gets exported and is read by the brain. */
  take: string
  /** When it happens in the story: a date (YYYY-MM-DD) or "Day 12". Empty if not set. */
  date: string
  /** HH:MM, optional. */
  time: string
  /** A location's id, or '' to work it out from the text. */
  place: string
  /** Characters in the scene that the text doesn't name, and ones it names who aren't really there. */
  castAdd: string[]
  castRemove: string[]
  /** What happens between each pair of characters (pairKey). */
  hows: Record<string, HowNote>
}

export interface Chapter {
  id: string
  title: string
  scenes: Scene[]
}

/** A first-time reader's reaction to a bit of a chapter (the ghost reader). */
export interface GhostNote {
  id: string
  /** The words it's reacting to, copied from the chapter. */
  quote: string
  reaction: string
}

/** A bit of a scene: which scene, and the words picked out in it. */
export interface Anchor {
  scene: string
  quote: string
}

/** Setups and payoffs: something planted (a gun in a drawer, a promise) and where it comes back. */
export interface PlotThread {
  id: string
  label: string
  setup: Anchor
  payoffs: Anchor[]
  /** You've decided it doesn't need paying off. */
  dropped: boolean
}

/** Who knows what: `who` finds the secret out in `scene` ('' for "knew from the start"). */
export interface SecretLearn {
  id: string
  /** A character's id, or READER for the reader. */
  who: string
  scene: string
}

export interface Secret {
  id: string
  /** What the secret is, e.g. "Rick was bitten". */
  text: string
  /** Words that show it's coming up in a scene, e.g. "bite", "bitten". */
  cues: string[]
  learns: SecretLearn[]
}

/** The reader, in a secret's list of who finds out. */
export const READER = 'reader'

/** A fact from the source a fanfic is based on, e.g. Rick's eye colour, or that Glenn is dead. */
export interface CanonFact {
  id: string
  /** A character's id, or '' for the world in general. */
  entity: string
  label: string
  value: string
  /** Changed in your story on purpose, so it's not flagged. */
  changed: boolean
}

export interface Canon {
  /** What it's fanfic of, e.g. "The Walking Dead (TV)". */
  source: string
  /** The scene where the story breaks from canon ('' if it doesn't, or not set). */
  splitAt: string
  splitNote: string
  facts: CanonFact[]
}

/** A reader's comment on a chapter, pasted in from AO3 or Wattpad. */
export interface ReaderComment {
  id: string
  text: string
  at: number
}

/** A bit of writing you deleted, kept on the cutting room floor. */
export interface Cut {
  id: string
  text: string
  scene: string
  /** The scene's name when it was cut (the scene may be gone since). */
  from: string
  at: number
}

/** The AO3 tag helper's choices (the rest is worked out from the story). */
export interface Ao3Tags {
  fandom: string
  rating: string
  warnings: string[]
  /** Extra freeform tags you typed. */
  extra: string[]
  /** Suggested tags you took off. */
  hidden: string[]
}

export interface LeftOff {
  text: string
  scene: string
  at: number
}

export interface Story {
  v: 1
  id: string
  title: string
  /** The name on the e-book's cover. */
  author: string
  created: number
  updated: number
  /** Words the whole story is aiming for (0: none). */
  goal: number
  /** Words a day (0: none). */
  dailyGoal: number
  chapters: Chapter[]
  entities: Entity[]
  relationships: Relationship[]
  /** The line you left yourself last time. */
  leftOff: LeftOff | null
  /** The story's word count when each day's writing started, and words written on each day. */
  dayStart: { date: string; words: number } | null
  days: Record<string, number>
  /** The ghost reader's reactions, by chapter id. */
  ghost: Record<string, GhostNote[]>
  threads: PlotThread[]
  secrets: Secret[]
  canon: Canon
  /** Readers' comments, by chapter id. */
  comments: Record<string, ReaderComment[]>
  /** The cutting room floor, newest first. */
  cuts: Cut[]
  /** Where each location is on the story map, as 0–1 across and down. The picture is in its own file (mapFile). */
  pins: Record<string, { x: number; y: number }>
  /** The tension you want across the story (Draw the shape), 0–1 at evenly spaced points; empty if not drawn. */
  shape: number[]
  tags: Ao3Tags
}

/** The studio's list of stories (writing-studio.json), so the library shows without opening every story. */
export interface StoryListing {
  id: string
  title: string
  updated: number
  words: number
  chapters: number
}

export const LIBRARY_FILE = 'writing-studio.json'
export const storyFile = (id: string): string => `writing-story-${id}.json`
export const historyFile = (id: string): string => `writing-history-${id}.json`
export const mapFile = (id: string): string => `writing-map-${id}.json`
export const emptyCanon = (): Canon => ({ source: '', splitAt: '', splitNote: '', facts: [] })
export const emptyTags = (): Ao3Tags => ({ fandom: '', rating: '', warnings: [], extra: [], hidden: [] })

export function newId(): string {
  const bytes = new Uint8Array(8)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function newTake(name = 'Take 1', text = ''): Take {
  return { id: newId(), name, text, created: Date.now() }
}

export function newScene(title = 'Scene 1'): Scene {
  const take = newTake()
  return { id: newId(), title, takes: [take], take: take.id, date: '', time: '', place: '', castAdd: [], castRemove: [], hows: {} }
}

export function newChapter(title = 'Chapter 1'): Chapter {
  return { id: newId(), title, scenes: [newScene()] }
}

export function newStory(title: string): Story {
  const now = Date.now()
  return {
    v: 1,
    id: newId(),
    title: title.trim().slice(0, 120) || 'Untitled story',
    author: '',
    created: now,
    updated: now,
    goal: 0,
    dailyGoal: 0,
    chapters: [newChapter()],
    entities: [],
    relationships: [],
    leftOff: null,
    dayStart: null,
    days: {},
    ghost: {},
    threads: [],
    secrets: [],
    canon: emptyCanon(),
    comments: {},
    cuts: [],
    pins: {},
    shape: [],
    tags: emptyTags()
  }
}

export function newEntity(kind: EntityKind, name: string): Entity {
  return { id: newId(), kind, name: name.trim().slice(0, 80), aliases: [], about: '', facts: [] }
}

const str = (v: unknown, max = 200_000): string => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const ids = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string')
const goodId = (v: unknown): string => (typeof v === 'string' && /^[a-z0-9]{1,40}$/.test(v) ? v : newId())

/** A story read back from its file, with anything missing or broken filled in, so a half-synced file never crashes the studio. */
export function readStory(raw: unknown): Story {
  const o = obj(raw)
  const kinds = new Set(ENTITY_KINDS.map((k) => k.id))
  const chapters = arr(o.chapters).map((c): Chapter => {
    const co = obj(c)
    const scenes = arr(co.scenes).map((s): Scene => {
      const so = obj(s)
      const takes = arr(so.takes).map((t): Take => {
        const to = obj(t)
        return { id: goodId(to.id), name: str(to.name, 80) || 'Take', text: str(to.text, 5_000_000), created: num(to.created) }
      })
      if (!takes.length) takes.push(newTake())
      const hows: Record<string, HowNote> = {}
      for (const [k, h] of Object.entries(obj(so.hows))) {
        const ho = obj(h)
        if (str(ho.text)) hows[k] = { text: str(ho.text, 300), ai: ho.ai === true, checked: ho.checked === true, of: str(ho.of, 40) }
      }
      const take = takes.some((t) => t.id === so.take) ? (so.take as string) : takes[0].id
      return {
        id: goodId(so.id),
        title: str(so.title, 120) || 'Scene',
        takes,
        take,
        date: str(so.date, 40),
        time: /^\d{2}:\d{2}$/.test(str(so.time)) ? str(so.time) : '',
        place: str(so.place, 40),
        castAdd: ids(so.castAdd),
        castRemove: ids(so.castRemove),
        hows
      }
    })
    return { id: goodId(co.id), title: str(co.title, 120) || 'Chapter', scenes }
  })
  if (!chapters.length) chapters.push(newChapter())
  const entities = arr(o.entities).map((e): Entity => {
    const eo = obj(e)
    return {
      id: goodId(eo.id),
      kind: kinds.has(eo.kind as EntityKind) ? (eo.kind as EntityKind) : 'character',
      name: str(eo.name, 80) || 'Unnamed',
      aliases: ids(eo.aliases).map((a) => a.slice(0, 80)).filter(Boolean),
      about: str(eo.about, 50_000),
      facts: arr(eo.facts).map((f) => {
        const fo = obj(f)
        return { id: goodId(fo.id), label: str(fo.label, 80), value: str(fo.value, 200) }
      }),
      ...(typeof eo.diesIn === 'string' && eo.diesIn ? { diesIn: eo.diesIn } : {})
    }
  })
  const relationships = arr(o.relationships)
    .map((r): Relationship => {
      const ro = obj(r)
      return {
        id: goodId(ro.id),
        a: str(ro.a, 40),
        b: str(ro.b, 40),
        steps: arr(ro.steps).map((s) => {
          const so = obj(s)
          return { id: goodId(so.id), scene: str(so.scene, 40), label: str(so.label, 60), note: str(so.note, 2000) }
        })
      }
    })
    .filter((r) => r.a && r.b && r.a !== r.b)
  const lo = obj(o.leftOff)
  const ds = obj(o.dayStart)
  const days: Record<string, number> = {}
  for (const [k, v] of Object.entries(obj(o.days))) if (/^\d{4}-\d{2}-\d{2}$/.test(k)) days[k] = num(v)
  const ghost: Record<string, GhostNote[]> = {}
  for (const [k, list] of Object.entries(obj(o.ghost)))
    ghost[k] = arr(list).map((g) => {
      const go = obj(g)
      return { id: goodId(go.id), quote: str(go.quote, 400), reaction: str(go.reaction, 300) }
    })
  const anchor = (v: unknown): Anchor => {
    const ao = obj(v)
    return { scene: str(ao.scene, 40), quote: str(ao.quote, 400) }
  }
  const threads = arr(o.threads).map((t): PlotThread => {
    const to = obj(t)
    return { id: goodId(to.id), label: str(to.label, 120) || 'Setup', setup: anchor(to.setup), payoffs: arr(to.payoffs).map(anchor).filter((a) => a.scene), dropped: to.dropped === true }
  })
  const secrets = arr(o.secrets).map((x): Secret => {
    const so = obj(x)
    return {
      id: goodId(so.id),
      text: str(so.text, 300),
      cues: ids(so.cues).map((c) => c.slice(0, 60)).filter(Boolean).slice(0, 30),
      learns: arr(so.learns).map((l) => {
        const lo = obj(l)
        return { id: goodId(lo.id), who: str(lo.who, 40), scene: str(lo.scene, 40) }
      })
    }
  })
  const co = obj(o.canon)
  const canon: Canon = {
    source: str(co.source, 200),
    splitAt: str(co.splitAt, 40),
    splitNote: str(co.splitNote, 1000),
    facts: arr(co.facts).map((f) => {
      const fo = obj(f)
      return { id: goodId(fo.id), entity: str(fo.entity, 40), label: str(fo.label, 80), value: str(fo.value, 300), changed: fo.changed === true }
    })
  }
  const comments: Record<string, ReaderComment[]> = {}
  for (const [k, list] of Object.entries(obj(o.comments)))
    comments[k] = arr(list)
      .map((c) => {
        const cmo = obj(c)
        return { id: goodId(cmo.id), text: str(cmo.text, 20_000), at: num(cmo.at) }
      })
      .filter((c) => c.text.trim())
  const cuts = arr(o.cuts)
    .map((c): Cut => {
      const cuo = obj(c)
      return { id: goodId(cuo.id), text: str(cuo.text, 200_000), scene: str(cuo.scene, 40), from: str(cuo.from, 120), at: num(cuo.at) }
    })
    .filter((c) => c.text.trim())
    .slice(0, MAX_CUTS)
  const pins: Record<string, { x: number; y: number }> = {}
  const unit = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5)
  for (const [k, v] of Object.entries(obj(o.pins))) pins[k] = { x: unit(obj(v).x), y: unit(obj(v).y) }
  const tg = obj(o.tags)
  const tags: Ao3Tags = {
    fandom: str(tg.fandom, 200),
    rating: str(tg.rating, 60),
    warnings: ids(tg.warnings).slice(0, 10),
    extra: ids(tg.extra).map((t) => t.slice(0, 150)).slice(0, 75),
    hidden: ids(tg.hidden).map((t) => t.slice(0, 150)).slice(0, 200)
  }
  return {
    threads,
    secrets,
    canon,
    comments,
    cuts,
    pins,
    shape: arr(o.shape).map(unit).slice(0, 200),
    tags,
    v: 1,
    id: goodId(o.id),
    title: str(o.title, 120) || 'Untitled story',
    author: str(o.author, 120),
    created: num(o.created),
    updated: num(o.updated),
    goal: num(o.goal),
    dailyGoal: num(o.dailyGoal),
    chapters,
    entities,
    relationships,
    leftOff: str(lo.text) ? { text: str(lo.text, 500), scene: str(lo.scene, 40), at: num(lo.at) } : null,
    dayStart: /^\d{4}-\d{2}-\d{2}$/.test(str(ds.date)) ? { date: str(ds.date), words: num(ds.words) } : null,
    days,
    ghost
  }
}

/** How many cuts the cutting room floor keeps (the oldest go first). */
export const MAX_CUTS = 300

export function readLibrary(raw: unknown): StoryListing[] {
  return arr(obj(raw).stories)
    .map((s) => {
      const so = obj(s)
      return { id: str(so.id, 40), title: str(so.title, 120) || 'Untitled story', updated: num(so.updated), words: num(so.words), chapters: num(so.chapters) }
    })
    .filter((s) => /^[a-z0-9]{1,40}$/.test(s.id))
}

export function listingOf(story: Story): StoryListing {
  return { id: story.id, title: story.title, updated: story.updated, words: storyWords(story), chapters: story.chapters.length }
}

// ---------- finding things ----------

export function activeTake(scene: Scene): Take {
  return scene.takes.find((t) => t.id === scene.take) ?? scene.takes[0]
}

export const sceneText = (scene: Scene): string => activeTake(scene).text

/** Every scene in story order, with where it is. */
export interface PlacedScene {
  scene: Scene
  chapter: Chapter
  chapterIndex: number
  /** Position in the whole story, from 0. */
  order: number
}

export function allScenes(story: Story): PlacedScene[] {
  const out: PlacedScene[] = []
  story.chapters.forEach((chapter, chapterIndex) => {
    for (const scene of chapter.scenes) out.push({ scene, chapter, chapterIndex, order: out.length })
  })
  return out
}

export function findScene(story: Story, id: string): PlacedScene | null {
  return allScenes(story).find((p) => p.scene.id === id) ?? null
}

export const entityById = (story: Story, id: string): Entity | undefined => story.entities.find((e) => e.id === id)

/** A pair of characters, the same whichever way round. */
export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

// ---------- counting ----------

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu

export function countWords(text: string): number {
  let n = 0
  WORD.lastIndex = 0
  while (WORD.exec(text)) n++
  return n
}

export const sceneWords = (scene: Scene): number => countWords(sceneText(scene))
export const chapterWords = (chapter: Chapter): number => chapter.scenes.reduce((n, s) => n + sceneWords(s), 0)
export const storyWords = (story: Story): number => story.chapters.reduce((n, c) => n + chapterWords(c), 0)

/** YYYY-MM-DD on this computer's calendar. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Keeps "words today" up to date after a change: today's words are how far the story's count has
 * grown since the day's first change (cutting words never takes you below zero).
 */
export function trackDay(story: Story, before: number, after: number, now: Date): Pick<Story, 'dayStart' | 'days'> {
  const today = dayKey(now)
  const dayStart = story.dayStart?.date === today ? story.dayStart : { date: today, words: before }
  const days = { ...story.days, [today]: Math.max(0, after - dayStart.words) }
  // Only the last few months are kept.
  const keys = Object.keys(days).sort()
  for (const k of keys.slice(0, Math.max(0, keys.length - 120))) delete days[k]
  return { dayStart, days }
}

export function wordsToday(story: Story, now: Date): number {
  return story.days[dayKey(now)] ?? 0
}

/** Days in a row (up to today) with at least one word written. Today not written yet doesn't break it. */
export function writingStreak(story: Story, now: Date): number {
  let n = 0
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (!story.days[dayKey(d)]) d.setDate(d.getDate() - 1)
  while (story.days[dayKey(d)]) {
    n++
    d.setDate(d.getDate() - 1)
  }
  return n
}

// ---------- names in the text ----------

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** All the names an entity goes by. A character called "Mara Quinn" is also found as "Mara" (unless someone else is called that too). */
export function namesOf(entity: Entity, all: Entity[]): string[] {
  const names = [entity.name, ...entity.aliases].map((n) => n.trim()).filter((n) => n.length >= 2)
  if (entity.kind === 'character') {
    const first = entity.name.trim().split(/\s+/)[0]
    const shared = all.some((o) => o.id !== entity.id && (o.name.trim().split(/\s+/)[0] === first || o.aliases.includes(first)))
    if (first && first.length >= 3 && first !== entity.name.trim() && !shared) names.push(first)
  }
  return [...new Set(names)]
}

export interface Mention {
  entity: string
  start: number
  end: number
}

/**
 * Every place an entity is named in the text, longest names first so "Mara Quinn" is one mention
 * not two. Names are matched as whole words with their capitals ("Will" the person, not "will").
 */
export function findMentions(text: string, entities: Entity[]): Mention[] {
  const all: { name: string; entity: string }[] = []
  for (const e of entities) for (const name of namesOf(e, entities)) all.push({ name, entity: e.id })
  if (!all.length || !text) return []
  all.sort((a, b) => b.name.length - a.name.length)
  const byName = new Map<string, string>()
  for (const n of all) if (!byName.has(n.name)) byName.set(n.name, n.entity)
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...byName.keys()].map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'gu')
  const out: Mention[] = []
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ entity: byName.get(m[0])!, start: m.index, end: m.index + m[0].length })
  return out
}

// ---------- the brain ----------

const MENTION_CUES = new Set(
  `about of remember remembered remembers remembering miss missed misses missing thought thinking think thinks wonder wondered wondering
  dream dreamt dreamed dreaming mention mentioned heard without since reminded memory memories grave photo picture letter news rumour rumours
  rumor rumors how where whether`.split(/\s+/)
)

/**
 * A name used in passing rather than someone being there: in someone else's speech ("“Where's
 * Daryl?”"), or just after words like "thinking about", "remembered", "missed", "since". Someone
 * spoken to ("“Daryl, get down!”") is there. Rough on purpose; you can always move people by hand.
 */
export function isJustMention(text: string, m: Mention): boolean {
  const paraStart = text.lastIndexOf('\n', m.start - 1) + 1
  const before = text.slice(paraStart, m.start)
  const opens = (before.match(/“/g) ?? []).length
  const closes = (before.match(/”/g) ?? []).length
  const straight = (before.match(/"/g) ?? []).length
  const inQuote = opens > closes || straight % 2 === 1
  if (inQuote) {
    const after = text.slice(m.end, m.end + 3)
    // Spoken to: right after the opening quote and followed by a comma, or ", Daryl." at the end.
    const spokenTo = (/[“"]\s*$/.test(before) && /^[,!]/.test(after)) || (/,\s*$/.test(before) && /^[.!?]?[”"]/.test(after))
    return !spokenTo
  }
  const words = before.toLowerCase().match(/[a-z’']+/g) ?? []
  const sentenceBreak = /[.!?]["”’)]*\s*$/.test(before)
  if (sentenceBreak) return false
  return words.slice(-3).some((w) => MENTION_CUES.has(w))
}

/** "1" or "Day 1" reads as "Day 1"; a date stays as written. */
export function dateLabel(date: string): string {
  const d = date.trim()
  return /^-?\d{1,5}$/.test(d) ? `Day ${d}` : d
}

export interface SceneFacts {
  id: string
  chapter: string
  chapterIndex: number
  order: number
  title: string
  words: number
  /** Characters in the scene (named in it, plus any you added, minus any you took out). */
  cast: string[]
  /** Where it happens: a location's id, or null. */
  place: string | null
  /** How often each entity is named. */
  mentions: Record<string, number>
  /** Characters only talked or thought about here, not in the scene themselves. */
  mentioned: string[]
  date: string
  time: string
  /** For putting scenes in story order on the calendar, or null if it has no date. */
  dateKey: number | null
}

/** Turns "2026-03-14" or "Day 12" into something sortable (null for anything else). */
export function storyDateKey(date: string): number | null {
  const d = date.trim()
  const iso = /^(-?\d{1,6})-(\d{2})-(\d{2})$/.exec(d)
  if (iso) {
    const t = Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return Number.isFinite(t) ? Math.round(t / 86_400_000) : null
  }
  const day = /^(?:day\s*)?(-?\d{1,5})$/i.exec(d)
  if (day) return Number(day[1])
  return null
}

export function sceneFacts(story: Story, placed: PlacedScene, mentions = findMentions(sceneText(placed.scene), story.entities)): SceneFacts {
  const { scene } = placed
  const counts: Record<string, number> = {}
  for (const m of mentions) counts[m.entity] = (counts[m.entity] ?? 0) + 1
  const kind = new Map(story.entities.map((e) => [e.id, e.kind]))
  const text = sceneText(scene)
  // In the scene: named at least once other than in passing ("thinking about Daryl", or in someone's speech).
  const here = new Set(mentions.filter((m) => kind.get(m.entity) === 'character' && !isJustMention(text, m)).map((m) => m.entity))
  const cast = [...new Set([...here, ...scene.castAdd.filter((id) => kind.get(id) === 'character')])].filter((id) => !scene.castRemove.includes(id))
  const mentioned = Object.keys(counts).filter((id) => kind.get(id) === 'character' && !cast.includes(id))
  let place: string | null = scene.place && kind.get(scene.place) === 'location' ? scene.place : null
  if (!place) {
    // The location named most, the first one named on a tie.
    let best = 0
    for (const m of mentions) {
      if (kind.get(m.entity) !== 'location') continue
      if (counts[m.entity] > best) {
        best = counts[m.entity]
        place = m.entity
      }
    }
  }
  return {
    id: scene.id,
    chapter: placed.chapter.id,
    chapterIndex: placed.chapterIndex,
    order: placed.order,
    title: scene.title,
    words: countWords(sceneText(scene)),
    cast,
    mentioned,
    place,
    mentions: counts,
    date: scene.date,
    time: scene.time,
    dateKey: storyDateKey(scene.date)
  }
}

export interface Brain {
  scenes: SceneFacts[]
  /** Scenes each pair of characters shares, in story order (by pairKey). */
  pairs: Map<string, string[]>
  /** Scenes each entity is named in or (characters) appears in, in story order. */
  appearances: Map<string, string[]>
}

/**
 * Everything worked out from the text. With `upTo` (a chapter index), only that far: the
 * "as of chapter X" view, where nothing later counts yet.
 */
export function buildBrain(story: Story, upTo = Infinity): Brain {
  const scenes = allScenes(story)
    .filter((p) => p.chapterIndex <= upTo)
    .map((p) => sceneFacts(story, p))
  const pairs = new Map<string, string[]>()
  const appearances = new Map<string, string[]>()
  const add = (map: Map<string, string[]>, key: string, scene: string): void => {
    const list = map.get(key)
    if (list) list.push(scene)
    else map.set(key, [scene])
  }
  for (const s of scenes) {
    const seen = new Set([...Object.keys(s.mentions), ...s.cast])
    if (s.place) seen.add(s.place)
    for (const id of seen) add(appearances, id, s.id)
    for (let i = 0; i < s.cast.length; i++) for (let j = i + 1; j < s.cast.length; j++) add(pairs, pairKey(s.cast[i], s.cast[j]), s.id)
  }
  return { scenes, pairs, appearances }
}

/** The pairs of characters who haven't shared a scene (yet). */
export function neverMet(story: Story, brain: Brain): [string, string][] {
  const chars = story.entities.filter((e) => e.kind === 'character')
  const out: [string, string][] = []
  for (let i = 0; i < chars.length; i++)
    for (let j = i + 1; j < chars.length; j++) if (!brain.pairs.has(pairKey(chars[i].id, chars[j].id))) out.push([chars[i].id, chars[j].id])
  return out
}

/** Where a relationship stands at a point in the story (a scene's order), or null before it starts. */
export function relationshipAt(story: Story, rel: Relationship, order = Infinity): RelationshipStep | null {
  const orderOf = new Map(allScenes(story).map((p) => [p.scene.id, p.order]))
  let best: RelationshipStep | null = null
  let bestOrder = -1
  for (const step of rel.steps) {
    const o = orderOf.get(step.scene)
    if (o === undefined || o > order) continue
    if (o >= bestOrder) {
      best = step
      bestOrder = o
    }
  }
  return best
}

/** A relationship's steps in story order (steps on deleted scenes go last). */
export function stepsInOrder(story: Story, rel: Relationship): RelationshipStep[] {
  const orderOf = new Map(allScenes(story).map((p) => [p.scene.id, p.order]))
  return [...rel.steps].sort((a, b) => (orderOf.get(a.scene) ?? 1e9) - (orderOf.get(b.scene) ?? 1e9))
}

/** The last scene of a chapter, as an order: what "as of chapter X" means. */
export function lastOrderOf(story: Story, chapterIndex: number): number {
  let last = -1
  for (const p of allScenes(story)) if (p.chapterIndex <= chapterIndex) last = p.order
  return last
}

/** A short fingerprint of a text, to tell when a scene changed after a note was written about it. */
export function fingerprint(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36) + text.length.toString(36)
}

// ---------- the story calendar ----------

export interface CalendarClash {
  character: string
  date: string
  /** The two scenes, in story order, and where each is. */
  scenes: [string, string]
  places: [string, string]
}

/**
 * Characters in two places at once: two scenes on the same story day in different locations.
 * If both scenes have a time and the times differ, there's no clash (they had time to travel).
 */
export function calendarClashes(brain: Brain): CalendarClash[] {
  const out: CalendarClash[] = []
  const dated = brain.scenes.filter((s) => s.dateKey !== null && s.place)
  for (let i = 0; i < dated.length; i++)
    for (let j = i + 1; j < dated.length; j++) {
      const a = dated[i]
      const b = dated[j]
      if (a.dateKey !== b.dateKey || a.place === b.place) continue
      if (a.time && b.time && a.time !== b.time) continue
      for (const c of a.cast) if (b.cast.includes(c)) out.push({ character: c, date: a.date, scenes: [a.id, b.id], places: [a.place!, b.place!] })
    }
  return out
}

/** Scenes with a date, in story-time order (then by time, then by where they are in the book). */
export function calendarOrder(brain: Brain): SceneFacts[] {
  return brain.scenes
    .filter((s) => s.dateKey !== null)
    .sort((a, b) => a.dateKey! - b.dateKey! || (a.time || '99').localeCompare(b.time || '99') || a.order - b.order)
}

/** Scenes told out of order: a scene set earlier in story time than the one before it in the book (flashbacks, or a mistake). */
export function flashbacks(brain: Brain): string[] {
  const out: string[] = []
  let latest: number | null = null
  for (const s of brain.scenes) {
    if (s.dateKey === null) continue
    if (latest !== null && s.dateKey < latest) out.push(s.id)
    else latest = s.dateKey
  }
  return out
}

// ---------- continuity ----------

export interface ContinuityIssue {
  start: number
  end: number
  entity: string
  message: string
}

const COLOURS = [
  'amber', 'auburn', 'black', 'blond', 'blonde', 'blue', 'brown', 'brunette', 'chestnut', 'copper', 'crimson', 'dark', 'ginger',
  'golden', 'green', 'grey', 'gray', 'hazel', 'honey', 'jet', 'pink', 'platinum', 'purple', 'red', 'silver', 'violet', 'white', 'yellow'
]
const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** "seventeen" → 17, "forty-two" → 42, "17" → 17. */
export function readNumber(word: string): number | null {
  const w = word.toLowerCase().trim()
  if (/^\d+$/.test(w)) return Number(w)
  const small = NUMBER_WORDS.indexOf(w)
  if (small >= 0) return small
  const m = /^([a-z]+)(?:[- ]([a-z]+))?$/.exec(w)
  if (!m) return null
  const t = TENS.indexOf(m[1])
  if (t < 2) return null
  if (!m[2]) return t * 10
  const u = NUMBER_WORDS.indexOf(m[2])
  return u >= 1 && u <= 9 ? t * 10 + u : null
}

type FactKind = { kind: 'colour'; topic: RegExp } | { kind: 'age' }

/** What sort of fact it is, if it's one the studio can check in the text. */
export function factKind(label: string): FactKind | null {
  const l = label.toLowerCase()
  if (/\beyes?\b|eye ?col/.test(l)) return { kind: 'colour', topic: /^eyes?$/i }
  if (/\bhair\b/.test(l)) return { kind: 'colour', topic: /^hair$/i }
  if (/\bage\b|how old|years old/.test(l)) return { kind: 'age' }
  return null
}

/** Sentences with where they start, for checking a fact against the right name. */
export function sentences(text: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = []
  const re = /[^.!?\n]+[.!?]*["”’)]*/g
  for (let m = re.exec(text); m; m = re.exec(text)) if (m[0].trim()) out.push({ start: m.index, text: m[0] })
  return out
}

/**
 * Things in a scene that go against a character's page: "green eyes" when their page says brown,
 * "sixteen years old" when it says 17, and a character who died earlier turning up again. In a
 * sentence naming more than one character, a fact belongs to the name closest to it.
 */
export function checkContinuity(
  story: Story,
  sceneId: string,
  text: string,
  /** For the canon drawer: other facts to check against (canon's), and how a mismatch is described. */
  opts: { factsOf?: (e: Entity) => Fact[]; where?: (e: Entity, f: Fact) => string; deaths?: boolean } = {}
): ContinuityIssue[] {
  const factsOf = opts.factsOf ?? ((e: Entity) => e.facts)
  const where = opts.where ?? ((e: Entity, f: Fact) => `${e.name}’s ${f.label.toLowerCase()}: ${f.value} on their page.`)
  const issues: ContinuityIssue[] = []
  const placed = findScene(story, sceneId)
  const mentions = findMentions(text, story.entities)
  const chars = new Map(story.entities.filter((e) => e.kind === 'character').map((e) => [e.id, e]))
  const charMentions = mentions.filter((m) => chars.has(m.entity))

  // Back from the dead.
  if (placed && opts.deaths !== false) {
    const orderOf = new Map(allScenes(story).map((p) => [p.scene.id, p.order]))
    for (const c of chars.values()) {
      if (!c.diesIn) continue
      const died = orderOf.get(c.diesIn)
      if (died === undefined || placed.order <= died) continue
      const first = charMentions.find((m) => m.entity === c.id)
      if (first) {
        const where = findScene(story, c.diesIn)!
        issues.push({ start: first.start, end: first.end, entity: c.id, message: `${c.name} died in “${where.scene.title}” (${where.chapter.title}).` })
      }
    }
  }

  const checkable = [...chars.values()].filter((c) => factsOf(c).some((f) => f.value.trim() && factKind(f.label)))
  if (!checkable.length) return issues
  const wordRe = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu
  for (const sentence of sentences(text)) {
    const end = sentence.start + sentence.text.length
    const here = charMentions.filter((m) => m.start >= sentence.start && m.end <= end)
    if (!here.length) continue
    const words: { w: string; start: number; end: number }[] = []
    wordRe.lastIndex = 0
    for (let m = wordRe.exec(sentence.text); m; m = wordRe.exec(sentence.text)) words.push({ w: m[0], start: sentence.start + m.index, end: sentence.start + m.index + m[0].length })
    const nearest = (pos: number): string => {
      let best = here[0]
      // Measured from the end of a name before it ("Carol’s green eyes") and the start of one after.
      const gap = (m: { start: number; end: number }): number => (m.end <= pos ? pos - m.end : m.start - pos)
      for (const m of here) if (gap(m) < gap(best)) best = m
      return best.entity
    }
    for (const c of checkable) {
      for (const fact of factsOf(c)) {
        const kind = factKind(fact.label)
        if (!kind || !fact.value.trim()) continue
        if (kind.kind === 'colour') {
          const expected = fact.value.toLowerCase().split(/[^a-z]+/).filter(Boolean)
          words.forEach((word, i) => {
            if (!kind.topic.test(word.w)) return
            if (nearest(word.start) !== c.id) return
            // "her green eyes", "eyes were green", "eyes, green as".
            const near = [...words.slice(Math.max(0, i - 3), i), ...words.slice(i + 1, i + 4)]
            for (const n of near) {
              const lw = n.w.toLowerCase()
              const base = lw.replace(/(ish|y)$/, '')
              const colour = COLOURS.includes(lw) ? lw : COLOURS.includes(base) ? base : null
              if (!colour) continue
              const same = expected.some((e) => e === colour || (e.startsWith('blond') && colour.startsWith('blond')) || (['grey', 'gray'].includes(e) && ['grey', 'gray'].includes(colour)))
              if (!same) issues.push({ start: n.start, end: n.end, entity: c.id, message: where(c, fact) })
            }
          })
        } else {
          const want = readNumber(fact.value.replace(/[^0-9a-z -]/gi, '').trim())
          if (want === null) continue
          const re = /(\d+|[a-z]+(?:-[a-z]+)?)[- ]years?[- ]old/gi
          for (let m = re.exec(sentence.text); m; m = re.exec(sentence.text)) {
            const got = readNumber(m[1])
            const at = sentence.start + m.index
            if (got === null || got === want || nearest(at) !== c.id) continue
            issues.push({ start: at, end: at + m[1].length, entity: c.id, message: opts.where ? where(c, fact) : `${c.name} is ${fact.value} on their page.` })
          }
        }
      }
    }
  }
  return issues.sort((a, b) => a.start - b.start)
}

// ---------- pacing ----------

export interface Pacing {
  dialogue: number
  action: number
  description: number
}

const ACTION = new Set(
  `ran run runs running sprinted sprint raced dashed rushed charged lunged leapt leaped jumped jump dove dived ducked dodged rolled
  grabbed grab seized snatched yanked pulled pushed shoved threw hurled tossed caught swung swing slashed stabbed struck strike hit hits
  punched kicked slammed smashed crashed broke shattered fired shot aimed fought fight wrestled tackled tripped fell fall slipped
  climbed scrambled crawled spun whirled turned twisted ripped tore burst exploded blasted chased fled escaped hurried bolted
  slapped shook stumbled staggered sliced drew drawn unsheathed sheathed loaded reloaded pounced sprang darted flung dragged hauled
  kicks punches grabs throws runs jumps falls races charges swings fires shoots`.split(/\s+/)
)

/**
 * How much of a text is dialogue (inside quotes), action (sentences with things like ran, grabbed,
 * slammed) and description (the rest), as parts of 1 by length. Rough on purpose: it's for
 * spotting a chapter that's all talking at a glance, not for grading.
 */
export function pacing(text: string): Pacing {
  let dialogue = 0
  let action = 0
  let description = 0
  for (const para of text.split(/\n+/)) {
    // Text inside “curly” or "straight" quotes.
    const quoted = /“[^”]*”?|"[^"\n]*"?/g
    let rest = ''
    let last = 0
    for (let m = quoted.exec(para); m; m = quoted.exec(para)) {
      dialogue += m[0].length
      rest += para.slice(last, m.index) + ' '
      last = m.index + m[0].length
    }
    rest += para.slice(last)
    for (const s of sentences(rest)) {
      const len = s.text.trim().length
      if (!len) continue
      const words = s.text.toLowerCase().match(/[a-z]+/g) ?? []
      if (words.some((w) => ACTION.has(w)) || /!\s*$/.test(s.text.trim())) action += len
      else description += len
    }
  }
  const total = dialogue + action + description
  if (!total) return { dialogue: 0, action: 0, description: 0 }
  return { dialogue: dialogue / total, action: action / total, description: description / total }
}

// ---------- time-lapse ----------

/** One change to a take's text: at `at`, `del` characters went and `ins` came in. */
export interface Revision {
  t: number
  at: number
  del: number
  ins: string
}

export interface TakeHistory {
  /** The text before the first revision kept. */
  base: string
  revs: Revision[]
}

/** The change from one text to the next, as one edit (what's the same at both ends is left out). */
export function diffText(before: string, after: string, t: number): Revision | null {
  if (before === after) return null
  let start = 0
  const max = Math.min(before.length, after.length)
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++
  let endB = before.length
  let endA = after.length
  while (endB > start && endA > start && before.charCodeAt(endB - 1) === after.charCodeAt(endA - 1)) {
    endB--
    endA--
  }
  return { t, at: start, del: endB - start, ins: after.slice(start, endA) }
}

export function applyRevision(text: string, rev: Revision): string {
  return text.slice(0, rev.at) + rev.ins + text.slice(rev.at + rev.del)
}

/** The text after the first `count` revisions. */
export function textAt(history: TakeHistory, count: number): string {
  let text = history.base
  for (let i = 0; i < Math.min(count, history.revs.length); i++) text = applyRevision(text, history.revs[i])
  return text
}

export const MAX_REVISIONS = 4000

/** Adds a change to a take's history; the oldest are folded into the starting text once there are too many. */
export function addRevision(history: TakeHistory | undefined, before: string, after: string, t: number): TakeHistory {
  const h = history ?? { base: before, revs: [] }
  const rev = diffText(before, after, t)
  if (!rev) return h
  let { base, revs } = h
  revs = [...revs, rev]
  if (revs.length > MAX_REVISIONS) {
    const fold = revs.length - MAX_REVISIONS
    for (let i = 0; i < fold; i++) base = applyRevision(base, revs[i])
    revs = revs.slice(fold)
  }
  return { base, revs }
}

/** Reads a history file: take id → history. */
export function readHistory(raw: unknown): Record<string, TakeHistory> {
  const out: Record<string, TakeHistory> = {}
  for (const [k, v] of Object.entries(obj(raw))) {
    const vo = obj(v)
    out[k] = {
      base: str(vo.base, 5_000_000),
      revs: arr(vo.revs)
        .map((r) => {
          const ro = obj(r)
          return { t: num(ro.t), at: num(ro.at), del: num(ro.del), ins: str(ro.ins, 5_000_000) }
        })
    }
  }
  return out
}

// ---------- the offline AI ----------

/** How much story the offline AI is given at once (it can only read so much). */
export const AI_BUDGET = 18_000

export const GHOST_SYSTEM = `You are a reader seeing this story for the very first time. You read a part of one chapter and react to it the way a real reader would while reading: confused, surprised, suspicious, delighted, worried, bored.
Write between 4 and 10 reactions, in the order they happen in the text.
Each reaction is one line in exactly this form:
"<3 to 8 words copied exactly from the text>" | <your reaction, at most 14 words, casual, first person>
Examples:
"a stranger with a silver ring" | wait, who is this? have we met him?
"she never opened the letter" | ooh, I bet that comes back later
Only react to what's actually in the text. Don't summarise, don't give writing advice, don't write anything else.`

export function ghostPrompt(storyTitle: string, chapterTitle: string, part: string, known: string[], partNo: number, parts: number): string {
  const who = known.length ? `Characters you've already met earlier in the story: ${known.join(', ')}.` : 'This is the start of the story: you have met nobody yet.'
  const which = parts > 1 ? ` (part ${partNo} of ${parts})` : ''
  return `Story: ${storyTitle}\nChapter: ${chapterTitle}${which}\n${who}\n\nThe text:\n${part}`
}

const squash = (s: string): string => s.toLowerCase().replace(/[“”"‘’']/g, '').replace(/\s+/g, ' ').trim()

/** Reads the ghost reader's lines, keeping only the reactions whose words really are in the chapter. */
export function parseGhost(reply: string, chapterText: string): { quote: string; reaction: string }[] {
  const hay = squash(chapterText)
  const out: { quote: string; reaction: string }[] = []
  for (const line of reply.split('\n')) {
    const m = /^\s*[-*\d.)\s]*["“]([^"”]{3,200})["”]\s*[|:–—-]\s*(.+)$/.exec(line)
    if (!m) continue
    const quote = m[1].trim()
    const reaction = m[2].trim().replace(/^["“]|["”]$/g, '')
    if (!reaction || !hay.includes(squash(quote))) continue
    if (out.some((o) => squash(o.quote) === squash(quote))) continue
    out.push({ quote, reaction: reaction.slice(0, 200) })
  }
  return out
}

/** Where a quote is in the text (ignoring quote marks and spacing), or null. */
export function findQuote(text: string, quote: string): { start: number; end: number } | null {
  const want = squash(quote)
  if (!want) return null
  // Build the squashed text with a map back to positions in the real one.
  let flat = ''
  const pos: number[] = []
  let space = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (/[“”"‘’']/.test(ch)) continue
    if (/\s/.test(ch)) {
      if (space || !flat) continue
      space = true
      flat += ' '
      pos.push(i)
      continue
    }
    space = false
    flat += ch.toLowerCase()
    pos.push(i)
  }
  const at = flat.indexOf(want)
  if (at < 0) return null
  return { start: pos[at], end: pos[at + want.length - 1] + 1 }
}

/** Splits a long chapter into parts the offline AI can read, at paragraph ends. */
export function splitForAi(text: string, budget = AI_BUDGET): string[] {
  if (text.length <= budget) return text.trim() ? [text] : []
  const parts: string[] = []
  let cur = ''
  for (const para of text.split(/(?<=\n)/)) {
    if (cur.length + para.length > budget && cur) {
      parts.push(cur)
      cur = ''
    }
    // A single paragraph longer than the budget is cut.
    for (let i = 0; i < para.length; i += budget) {
      const piece = para.slice(i, i + budget)
      if (cur.length + piece.length > budget && cur) {
        parts.push(cur)
        cur = ''
      }
      cur += piece
    }
  }
  if (cur.trim()) parts.push(cur)
  return parts
}

export const HOWS_SYSTEM = `You help a writer keep track of their own story. You're given one scene and a list of pairs of characters who are both in it.
For each pair, say in one short line (at most 14 words) what happens between those two in this scene, e.g. "first meet at the market", "argue about the letter", "she saves him from the guards".
If those two don't actually interact in this scene, write "no direct interaction".
Reply with one line per pair, in exactly this form, and nothing else:
<number>. <what happens>`

export function howsPrompt(sceneTitle: string, text: string, pairs: [string, string][], budget = AI_BUDGET): string {
  return `Scene: ${sceneTitle}\n\n${text.slice(0, budget)}\n\nPairs:\n${pairs.map(([a, b], i) => `${i + 1}. ${a} and ${b}`).join('\n')}`
}

/** Reads "1. first meet at the market" lines back into one note per pair (by position in the list). */
export function parseHows(reply: string, count: number): (string | null)[] {
  const out: (string | null)[] = Array.from({ length: count }, () => null)
  for (const line of reply.split('\n')) {
    const m = /^\s*(\d+)[.):]\s*(.+)$/.exec(line)
    if (!m) continue
    const i = Number(m[1]) - 1
    if (i < 0 || i >= count || out[i]) continue
    // A model that repeats the names first ("Mara and Theo: ...") has them taken off.
    const text = m[2].replace(/^[^:]{1,60}:\s*/, (x) => (/\band\b|&|\+/.test(x) ? '' : x)).trim().replace(/^["“]|["”.]$/g, '')
    if (text) out[i] = text.slice(0, 160)
  }
  return out
}

export const STUCK_SYSTEM = `You help a writer who is stuck on a scene of their own story. You never write any of the story for them.
Ask exactly three short, sharp questions that would help them work out what happens next. Make each question about this story: its characters, what they want, what they know, what's at stake, what's been set up. No generic writing advice.
Reply with exactly three lines, in this form, and nothing else:
1. <question>
2. <question>
3. <question>`

export function stuckPrompt(chapterTitle: string, sceneTitle: string, context: string, text: string): string {
  return `Chapter: ${chapterTitle}\nScene: ${sceneTitle}\n\nWhat the story notes say about this scene:\n${context || '(nothing yet)'}\n\nThe scene so far${text.trim() ? '' : ' (empty: they have not started it)'}:\n${text}`
}

/** The three questions from the stuck button's reply. */
export function parseStuck(reply: string): string[] {
  const out: string[] = []
  for (const line of reply.split('\n')) {
    const m = /^\s*(?:\d+[.):]|[-*•])\s*(.+)$/.exec(line)
    const q = m?.[1].trim().replace(/^["“]|["”]$/g, '')
    if (q && q.length > 8 && !out.includes(q)) out.push(q.slice(0, 300))
  }
  return out.slice(0, 3)
}

export const ASK_SYSTEM = `You answer questions about a writer's own story, using only the story notes and scenes you're given.
Scenes are labelled like [S4]. When you mention something that happens in a scene, put its label right after, e.g. "They first meet at the market [S2]."
If the notes don't say, say you can't tell from what's written so far. Never make up events. Keep answers short: a few sentences or a short list.`

/** The story brain written out as text, for the offline AI: who's who, relationships, and every scene in brief. */
export function brainSummary(story: Story, brain: Brain, labels: Map<string, string>, limitOrder = Infinity): string {
  const name = (id: string): string => entityById(story, id)?.name ?? 'someone'
  const lines: string[] = [`Story: ${story.title}`, '']
  for (const kind of ENTITY_KINDS) {
    const list = story.entities.filter((e) => e.kind === kind.id)
    if (!list.length) continue
    lines.push(`${kind.plural}:`)
    for (const e of list) {
      const died = e.diesIn ? findScene(story, e.diesIn) : null
      const death = died && died.order <= limitOrder ? `dies in ${labels.get(died.scene.id) ?? ''} ${died.chapter.title} – ${died.scene.title}`.replace(/\s+/g, ' ') : ''
      const extra = [e.aliases.length ? `also called ${e.aliases.join(', ')}` : '', ...e.facts.filter((f) => f.label && f.value).map((f) => `${f.label}: ${f.value}`), death]
        .filter(Boolean)
        .join('; ')
      const about = e.about.trim().replace(/\s+/g, ' ').slice(0, 300)
      lines.push(`- ${e.name}${extra ? ` (${extra})` : ''}${about ? `: ${about}` : ''}`)
    }
    lines.push('')
  }
  const rels = story.relationships.filter((r) => r.steps.length)
  if (rels.length) {
    lines.push('Relationships over the story:')
    for (const r of rels) {
      const steps = stepsInOrder(story, r).filter((s) => {
        const o = findScene(story, s.scene)?.order
        return o !== undefined && o <= limitOrder
      })
      if (steps.length) lines.push(`- ${name(r.a)} & ${name(r.b)}: ${steps.map((s) => `${s.label}${labels.get(s.scene) ? ` ${labels.get(s.scene)}` : ''}${s.note ? ` (${s.note})` : ''}`).join(' → ')}`)
    }
    lines.push('')
  }
  // Secrets, setups and canon: things the text alone may not say.
  const at = (scene: string): number | undefined => findScene(story, scene)?.order
  const tag = (scene: string): string => {
    const p = findScene(story, scene)
    return p ? `${labels.get(scene) ?? ''} ${p.chapter.title} – ${p.scene.title}`.trim() : 'a deleted scene'
  }
  const secrets = story.secrets.filter((x) => x.text.trim())
  if (secrets.length) {
    lines.push('Secrets (who knows, and when they find out):')
    for (const x of secrets) {
      const who = x.learns
        .filter((l) => !l.scene || (at(l.scene) ?? Infinity) <= limitOrder)
        .map((l) => `${l.who === READER ? 'the reader' : name(l.who)} ${l.scene ? `finds out in ${tag(l.scene)}` : 'knows from the start'}`)
      lines.push(`- ${x.text}${who.length ? `: ${who.join('; ')}` : ' (true in the story; nobody is listed as knowing yet)'}`)
    }
    lines.push('')
  }
  const threads = story.threads.filter((t) => (at(t.setup.scene) ?? Infinity) <= limitOrder)
  if (threads.length) {
    lines.push('Setups and payoffs:')
    for (const t of threads) {
      const paid = t.payoffs.filter((p) => (at(p.scene) ?? Infinity) <= limitOrder)
      lines.push(`- ${t.label}, set up in ${tag(t.setup.scene)}${paid.length ? `, paid off in ${paid.map((p) => tag(p.scene)).join(', ')}` : t.dropped ? ' (let go)' : ' (not paid off yet)'}`)
    }
    lines.push('')
  }
  const canon = story.canon
  if (canon.source || canon.facts.length) {
    lines.push(`Canon${canon.source ? ` (fanfic of ${canon.source})` : ''}:`)
    if (canon.splitAt) lines.push(`- The story breaks from canon in ${tag(canon.splitAt)}${canon.splitNote ? `: ${canon.splitNote}` : ''}`)
    for (const f of canon.facts.filter((f) => f.label && f.value))
      lines.push(`- ${f.entity ? `${name(f.entity)}: ` : ''}${f.label}: ${f.value} in canon${f.changed ? ' (changed in this story)' : ''}`)
    lines.push('')
  }
  lines.push('Scenes in order:')
  for (const s of brain.scenes) {
    const placed = findScene(story, s.id)
    if (!placed) continue
    const bits = [
      `${labels.get(s.id)} ${placed.chapter.title} – ${s.title}`,
      s.date ? `when: ${s.date}${s.time ? ` ${s.time}` : ''}` : '',
      s.place ? `where: ${name(s.place)}` : '',
      s.cast.length ? `who: ${s.cast.map(name).join(', ')}` : ''
    ].filter(Boolean)
    lines.push(bits.join(' | '))
    for (const [k, how] of Object.entries(placed.scene.hows)) {
      const [a, b] = k.split('|')
      if (how.text && how.text !== 'no direct interaction') lines.push(`   ${name(a)} & ${name(b)}: ${how.text}`)
    }
  }
  return lines.join('\n')
}

/** Scenes most likely to answer a question: the ones naming what it names, then sharing its words. */
export function rankScenesFor(question: string, story: Story, brain: Brain): string[] {
  const asked = new Set(findMentions(question, story.entities).map((m) => m.entity))
  const words = new Set((question.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !['what', 'when', 'where', 'which', 'does', 'did', 'have', 'they', 'with', 'their', 'there', 'about', 'last', 'first'].includes(w)))
  const scored = brain.scenes.map((s) => {
    const placed = findScene(story, s.id)!
    const text = sceneText(placed.scene).toLowerCase()
    let score = 0
    for (const id of asked) if (s.mentions[id] || s.cast.includes(id)) score += 10
    if (asked.size > 1 && [...asked].every((id) => s.cast.includes(id) || s.mentions[id])) score += 15
    for (const w of words) if (text.includes(w)) score += 1
    return { id: s.id, score }
  })
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).map((s) => s.id)
}

export function askPrompt(question: string, summary: string, excerpts: { label: string; title: string; text: string }[]): string {
  const ex = excerpts.map((e) => `${e.label} ${e.title}\n${e.text}`).join('\n\n')
  return `${summary}\n\n${ex ? `The text of the scenes that look most useful:\n\n${ex}\n\n` : ''}Question: ${question}`
}

/** Splits an answer into text and [S4] scene links. */
export function answerLinks(answer: string, labels: Map<string, string>): ({ text: string } | { scene: string; label: string })[] {
  const byLabel = new Map([...labels].map(([id, label]) => [label, id]))
  const out: ({ text: string } | { scene: string; label: string })[] = []
  const re = /\[S\d+\]/g
  let last = 0
  for (let m = re.exec(answer); m; m = re.exec(answer)) {
    const scene = byLabel.get(m[0])
    if (!scene) continue
    if (m.index > last) out.push({ text: answer.slice(last, m.index) })
    out.push({ scene, label: m[0] })
    last = m.index + m[0].length
  }
  if (last < answer.length) out.push({ text: answer.slice(last) })
  return out
}

/** [S1], [S2]… for each scene, in story order. */
export function sceneLabels(story: Story): Map<string, string> {
  return new Map(allScenes(story).map((p) => [p.scene.id, `[S${p.order + 1}]`]))
}

// ---------- export ----------

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** *italic*, _italic_ and **bold** in a line of story, as HTML. */
export function inlineHtml(line: string): string {
  return esc(line)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\p{L}\p{N}])\*([^*\n]+)\*(?![\p{L}\p{N}*])/gu, '$1<em>$2</em>')
    .replace(/(^|[^_\p{L}\p{N}])_([^_\n]+)_(?![\p{L}\p{N}_])/gu, '$1<em>$2</em>')
}

const paragraphs = (text: string): string[] =>
  text
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean)

/** A scene break written in the text on its own line. */
const isBreak = (p: string): boolean => /^(\*\s*){3,}$|^(-\s*){3,}$|^#$/.test(p)

/** A chapter as HTML paragraphs, scenes separated by a centred "* * *". `xhtml` closes empty tags (for e-books). */
export function chapterHtml(chapter: Chapter, xhtml = false): string {
  const hr = xhtml ? '<p class="break">* * *</p>' : '<p align="center">* * *</p>'
  return chapter.scenes
    .map((s) => sceneText(s))
    .filter((t) => t.trim())
    .map((t) =>
      paragraphs(t)
        .map((p) => (isBreak(p) ? hr : `<p>${inlineHtml(p)}</p>`))
        .join('\n')
    )
    .join(`\n${hr}\n`)
}

/** A chapter as plain text, ready to paste into Wattpad (and most other sites). */
export function chapterPlain(chapter: Chapter): string {
  return chapter.scenes
    .map((s) => sceneText(s))
    .filter((t) => t.trim())
    .map((t) =>
      paragraphs(t)
        .map((p) => (isBreak(p) ? '* * *' : p.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/(^|[^*\p{L}\p{N}])\*([^*\n]+)\*(?![\p{L}\p{N}*])/gu, '$1$2')))
        .join('\n\n')
    )
    .join('\n\n* * *\n\n')
}

export function storyPlain(story: Story): string {
  return [story.title, '', ...story.chapters.flatMap((c) => [c.title, '', chapterPlain(c), ''])].join('\n').trim() + '\n'
}

/** A safe file name for a story. */
export function fileNameFor(title: string): string {
  return title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Story'
}

export interface EpubFile {
  path: string
  text: string
}

/** The files of an EPUB 3 e-book (with an EPUB 2 table of contents too, for older readers). `mimetype` comes first and must be stored uncompressed. */
export function epubFiles(story: Story, author: string, modified: Date): EpubFile[] {
  const uid = `urn:orbit:story:${story.id}`
  const stamp = modified.toISOString().replace(/\.\d+Z$/, 'Z')
  const chapters = story.chapters.map((c, i) => ({ c, file: `chapter-${i + 1}.xhtml`, id: `ch${i + 1}` }))
  const page = (title: string, body: string): string =>
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">\n<head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>\n<body>\n${body}\n</body>\n</html>\n`
  const files: EpubFile[] = [
    { path: 'mimetype', text: 'application/epub+zip' },
    {
      path: 'META-INF/container.xml',
      text: `<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n</container>\n`
    },
    {
      path: 'OEBPS/style.css',
      text: `body { font-family: serif; line-height: 1.5; margin: 0 5%; }\nh1 { text-align: center; margin: 2em 0 1.5em; }\np { margin: 0; text-indent: 1.4em; }\nh1 + p, p.break + p { text-indent: 0; }\np.break { text-align: center; text-indent: 0; margin: 1em 0; }\n.title { text-align: center; margin-top: 30%; }\n`
    },
    {
      path: 'OEBPS/title.xhtml',
      text: page(story.title, `<div class="title"><h1>${esc(story.title)}</h1>${author ? `<p class="break">${esc(author)}</p>` : ''}</div>`)
    },
    ...chapters.map(({ c, file }) => ({ path: `OEBPS/${file}`, text: page(c.title, `<h1>${esc(c.title)}</h1>\n${chapterHtml(c, true)}`) })),
    {
      path: 'OEBPS/nav.xhtml',
      text: page(
        'Contents',
        `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>\n${chapters.map(({ c, file }) => `<li><a href="${file}">${esc(c.title)}</a></li>`).join('\n')}\n</ol></nav>`
      )
    },
    {
      path: 'OEBPS/toc.ncx',
      text: `<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n<head><meta name="dtb:uid" content="${uid}"/></head>\n<docTitle><text>${esc(story.title)}</text></docTitle>\n<navMap>\n${chapters
        .map(({ c, file, id }, i) => `<navPoint id="${id}" playOrder="${i + 1}"><navLabel><text>${esc(c.title)}</text></navLabel><content src="${file}"/></navPoint>`)
        .join('\n')}\n</navMap>\n</ncx>\n`
    },
    {
      path: 'OEBPS/content.opf',
      text: `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="en">\n<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n<dc:identifier id="uid">${uid}</dc:identifier>\n<dc:title>${esc(story.title)}</dc:title>\n${author ? `<dc:creator>${esc(author)}</dc:creator>\n` : ''}<dc:language>en</dc:language>\n<meta property="dcterms:modified">${stamp}</meta>\n</metadata>\n<manifest>\n<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n<item id="css" href="style.css" media-type="text/css"/>\n<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>\n${chapters
        .map(({ file, id }) => `<item id="${id}" href="${file}" media-type="application/xhtml+xml"/>`)
        .join('\n')}\n</manifest>\n<spine toc="ncx">\n<itemref idref="title"/>\n${chapters.map(({ id }) => `<itemref idref="${id}"/>`).join('\n')}\n</spine>\n</package>\n`
    }
  ]
  return files
}
