import { create } from 'zustand'
import {
  addRevision,
  countWords,
  MAX_CUTS,
  historyFile,
  LIBRARY_FILE,
  listingOf,
  newChapter,
  newEntity,
  newId,
  newScene,
  newStory,
  newTake,
  readHistory,
  readLibrary,
  readStory,
  storyFile,
  storyWords,
  trackDay,
  type Chapter,
  type EntityKind,
  type Scene,
  type Story,
  type StoryListing,
  type TakeHistory
} from '@shared/writing'
import type { WritingAiEngine } from '@shared/types'
import { cutFrom } from '@shared/writingTools'
import { openSpecialTab, WRITING_TAB } from '../lib/editorController'
import { recordUndo } from '../lib/undo'
import { notify } from './notify'

/**
 * The Writing Studio (components/WritingStudio): the library of stories and the one that's open.
 * Each story is its own file in .notesapp (writing-story-<id>.json), with its typing history for the
 * time-lapse in another (writing-history-<id>.json), and the library list in writing-studio.json.
 * None of it is a note, and nothing here touches the notes.
 */

export type StudioView = 'write' | 'brain' | 'calendar' | 'map' | 'shape' | 'export'
export type BrainTab = 'pages' | 'met' | 'relationships' | 'secrets' | 'canon' | 'ask'

interface WritingState {
  library: StoryListing[]
  loaded: boolean
  /** The notes folder the library was read from. */
  vault: string | null
  story: Story | null
  /** Typing history of the open story's takes, for the time-lapse. */
  history: Record<string, TakeHistory>
  view: StudioView
  scene: string | null
  brainTab: BrainTab
  /** The entity whose page is open in the brain. */
  entity: string | null
  /** The pair picked in the who-met-who grid (a pairKey). */
  pair: string | null
  /** "As of chapter X" (a chapter index), or null for the whole story. */
  asOf: number | null
  /** Filling the whole window (and the screen). */
  full: boolean
  /** Asking for the "where I left off" line before closing the story. */
  closing: boolean
  /** The line from last time, showing until it's dismissed. */
  welcome: string | null
  /** Which AI reads the story for the ghost reader, "how" notes, Ask the brain and the stuck button. */
  ai: WritingAiEngine
}

export const useWriting = create<WritingState>(() => ({
  library: [],
  loaded: false,
  vault: null,
  story: null,
  history: {},
  view: 'write',
  scene: null,
  brainTab: 'pages',
  entity: null,
  pair: null,
  asOf: null,
  full: false,
  closing: false,
  welcome: null,
  ai: 'offline'
}))

export function openWritingStudio(): void {
  openSpecialTab(WRITING_TAB)
}

// ---------- the files ----------

/** One write at a time per file; a change made while writing is written straight after. */
const writers = new Map<string, { busy: boolean; next: string | null }>()
function writeFile(name: string, content: string): void {
  const w = writers.get(name) ?? { busy: false, next: null }
  writers.set(name, w)
  if (w.busy) {
    w.next = content
    return
  }
  w.busy = true
  window.api
    .writeAppData(name, content)
    .catch(notify)
    .finally(() => {
      w.busy = false
      const again = w.next
      w.next = null
      if (again !== null) writeFile(name, again)
    })
}

export async function loadLibrary(vault: string | null): Promise<void> {
  const s = useWriting.getState()
  if (s.loaded && s.vault === vault) return
  // Another notes folder: whatever was open belonged to the old one.
  if (s.story) flushAll()
  useWriting.setState({ library: [], loaded: false, vault, story: null, history: {}, scene: null, entity: null, closing: false, welcome: null })
  try {
    const raw = await window.api.readAppData(LIBRARY_FILE)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    const ai = (parsed as { ai?: unknown } | null)?.ai === 'claude' ? 'claude' : 'offline'
    useWriting.setState({ library: parsed ? readLibrary(parsed) : [], loaded: true, ai })
  } catch (err) {
    useWriting.setState({ loaded: true })
    notify(err)
  }
}

function saveLibrary(library: StoryListing[]): void {
  useWriting.setState({ library })
  writeFile(LIBRARY_FILE, JSON.stringify({ stories: library, ai: useWriting.getState().ai }, null, 2))
}

/** Which AI the studio uses: the offline one (nothing leaves this computer) or Claude. */
export function setStudioAi(ai: WritingAiEngine): void {
  useWriting.setState({ ai })
  saveLibrary(useWriting.getState().library)
}

let storyTimer: ReturnType<typeof setTimeout> | undefined
let historyTimer: ReturnType<typeof setTimeout> | undefined

function flushStory(): void {
  clearTimeout(storyTimer)
  storyTimer = undefined
  const { story, library } = useWriting.getState()
  if (!story) return
  writeFile(storyFile(story.id), JSON.stringify(story))
  const listing = listingOf(story)
  const others = library.filter((l) => l.id !== story.id)
  saveLibrary([listing, ...others].sort((a, b) => b.updated - a.updated))
}

function flushHistory(): void {
  clearTimeout(historyTimer)
  historyTimer = undefined
  const { story, history } = useWriting.getState()
  if (story) writeFile(historyFile(story.id), JSON.stringify(history))
}

function flushAll(): void {
  commitAllRevisions()
  if (storyTimer) flushStory()
  if (historyTimer) flushHistory()
}

window.addEventListener('beforeunload', () => flushAll())

function scheduleSave(): void {
  clearTimeout(storyTimer)
  storyTimer = setTimeout(flushStory, 700)
}

/** Replaces the open story and saves it shortly after. */
function setStory(story: Story): void {
  useWriting.setState({ story: { ...story, updated: Date.now() } })
  scheduleSave()
}

/**
 * A change to the story's shape (adding, removing, renaming, moving), made on a copy. With a
 * label, Ctrl+Z outside the text puts it back.
 */
export function change(label: string | null, fn: (draft: Story) => void): void {
  const before = useWriting.getState().story
  if (!before) return
  const draft = structuredClone(before)
  fn(draft)
  setStory(draft)
  if (label) {
    const after = useWriting.getState().story!
    recordUndo({
      label,
      undo: () => {
        if (useWriting.getState().story?.id === before.id) restore(before)
      },
      redo: () => {
        if (useWriting.getState().story?.id === after.id) restore(after)
      }
    })
  }
}

/** Puts the story back as it was (an undo), keeping the scene open if it still exists. */
function restore(story: Story): void {
  setStory(story)
  const { scene, entity } = useWriting.getState()
  const scenes = story.chapters.flatMap((c) => c.scenes)
  if (scene && !scenes.some((s) => s.id === scene)) useWriting.setState({ scene: scenes[0]?.id ?? null })
  if (entity && !story.entities.some((e) => e.id === entity)) useWriting.setState({ entity: null })
}

// ---------- stories ----------

export function createStory(title: string): void {
  if (useWriting.getState().story) flushAll()
  const story = newStory(title)
  useWriting.setState({ story, history: {}, view: 'write', scene: story.chapters[0].scenes[0].id, entity: null, asOf: null, welcome: null, closing: false })
  flushStory()
}

export async function openStory(id: string): Promise<void> {
  if (useWriting.getState().story) flushAll()
  try {
    const raw = await window.api.readAppData(storyFile(id))
    if (!raw) {
      notify('That story’s file is missing. If it was written on another computer, it may still be syncing.')
      return
    }
    const story = readStory(JSON.parse(raw))
    const hist = await window.api.readAppData(historyFile(id)).catch(() => null)
    const first = story.chapters.flatMap((c) => c.scenes)
    const scene = (story.leftOff && first.find((s) => s.id === story.leftOff!.scene)?.id) ?? first[0]?.id ?? null
    useWriting.setState({
      story,
      history: hist ? readHistory(JSON.parse(hist)) : {},
      view: 'write',
      scene,
      entity: null,
      asOf: null,
      closing: false,
      welcome: story.leftOff?.text ?? null
    })
    lastText.clear()
  } catch (err) {
    notify(err)
  }
}

/** Closes the story, saving the "where I left off" line (empty to leave the old one). */
export function closeStory(leftOff: string | null): void {
  const { story, scene } = useWriting.getState()
  if (!story) return
  if (leftOff !== null && leftOff.trim()) {
    useWriting.setState({ story: { ...story, leftOff: { text: leftOff.trim().slice(0, 500), scene: scene ?? '', at: Date.now() } } })
  }
  scheduleSave()
  flushAll()
  useWriting.setState({ story: null, history: {}, scene: null, entity: null, closing: false, welcome: null, full: false })
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
}

/** Takes a story off the library list. Its file stays in .notesapp, so Ctrl+Z brings it back. */
export function removeStory(id: string): void {
  const { library, story } = useWriting.getState()
  const listing = library.find((l) => l.id === id)
  if (!listing) return
  if (story?.id === id) closeStory(null)
  saveLibrary(useWriting.getState().library.filter((l) => l.id !== id))
  recordUndo({
    label: `Removed “${listing.title}”`,
    undo: () => saveLibrary([listing, ...useWriting.getState().library.filter((l) => l.id !== id)].sort((a, b) => b.updated - a.updated)),
    redo: () => saveLibrary(useWriting.getState().library.filter((l) => l.id !== id))
  })
}

export function setStoryField(patch: Partial<Pick<Story, 'title' | 'goal' | 'dailyGoal' | 'author'>>): void {
  change(null, (s) => Object.assign(s, patch))
}

// ---------- the text ----------

/** What a take said before its first change, for a take with no time-lapse yet. */
const lastText = new Map<string, string>()
const revTimers = new Map<string, ReturnType<typeof setTimeout>>()

function commitRevision(takeId: string): void {
  clearTimeout(revTimers.get(takeId))
  revTimers.delete(takeId)
  const { story, history } = useWriting.getState()
  if (!story) return
  const take = story.chapters.flatMap((c) => c.scenes).flatMap((s) => s.takes).find((t) => t.id === takeId)
  if (!take) return
  const h = history[takeId]
  const before = h ? textOf(h) : (lastText.get(takeId) ?? '')
  if (before === take.text) return
  useWriting.setState({ history: { ...history, [takeId]: addRevision(h, before, take.text, Date.now()) } })
  clearTimeout(historyTimer)
  historyTimer = setTimeout(flushHistory, 3000)
}

/** The latest text in a take's history (cached, since replaying thousands of changes on each keystroke would be slow). */
const latestCache = new WeakMap<TakeHistory, string>()
export function textOf(h: TakeHistory): string {
  const hit = latestCache.get(h)
  if (hit !== undefined) return hit
  let text = h.base
  for (const r of h.revs) text = text.slice(0, r.at) + r.ins + text.slice(r.at + r.del)
  latestCache.set(h, text)
  return text
}

function commitAllRevisions(): void {
  for (const id of [...revTimers.keys()]) commitRevision(id)
}

/** Typing in a scene: the take's text changes, today's words are counted, and the time-lapse gets a frame after each pause. */
export function setTakeText(sceneId: string, takeId: string, text: string): void {
  const story = useWriting.getState().story
  if (!story) return
  const before = storyWords(story)
  const chapters: Chapter[] = story.chapters.map((c) =>
    c.scenes.some((s) => s.id === sceneId)
      ? { ...c, scenes: c.scenes.map((s): Scene => (s.id === sceneId ? { ...s, takes: s.takes.map((t) => (t.id === takeId ? { ...t, text } : t)) } : s)) }
      : c
  )
  let next: Story = { ...story, chapters }
  // A passage deleted (not just retyped) goes to the cutting room floor.
  const scene = story.chapters.flatMap((c) => c.scenes).find((sc) => sc.id === sceneId)
  const oldText = scene?.takes.find((t) => t.id === takeId)?.text ?? ''
  const cut = cutFrom(oldText, text)
  if (cut && scene) next = { ...next, cuts: addCut(next.cuts, cut, scene) }
  // The first change to a take since it was opened: what it said before is the time-lapse's start.
  if (!lastText.has(takeId) && !useWriting.getState().history[takeId]) {
    lastText.set(takeId, story.chapters.flatMap((c) => c.scenes).flatMap((s) => s.takes).find((t) => t.id === takeId)?.text ?? '')
  }
  setStory({ ...next, ...trackDay(story, before, storyWords(next), new Date()) })
  clearTimeout(revTimers.get(takeId))
  revTimers.set(
    takeId,
    setTimeout(() => commitRevision(takeId), 1200)
  )
}

// ---------- the cutting room floor ----------

function addCut(cuts: Story['cuts'], text: string, scene: Scene): Story['cuts'] {
  if (cuts.some((c) => c.text === text)) return cuts
  return [{ id: newId(), text, scene: scene.id, from: scene.title, at: Date.now() }, ...cuts].slice(0, MAX_CUTS)
}

/** Keeps a deleted scene's or take's writing on the cutting room floor too. */
function keepCut(s: Story, text: string, scene: Scene): void {
  if (countWords(text) >= 8) s.cuts = addCut(s.cuts, text.trim(), scene)
}

export function deleteCut(id: string): void {
  change('Threw away a cut', (s) => {
    s.cuts = s.cuts.filter((c) => c.id !== id)
  })
}

// ---------- chapters and scenes ----------

export function openScene(id: string): void {
  commitAllRevisions()
  useWriting.setState({ scene: id, view: 'write' })
}

/** Adds a chapter and returns its id (so its name can be typed straight away). */
export function addChapter(): string | null {
  const story = useWriting.getState().story
  if (!story) return null
  const ch = newChapter(`Chapter ${story.chapters.length + 1}`)
  change('Added a chapter', (s) => {
    s.chapters.push(ch)
  })
  useWriting.setState({ scene: ch.scenes[0].id })
  return ch.id
}

export function addScene(chapterId: string): void {
  const story = useWriting.getState().story
  const chapter = story?.chapters.find((c) => c.id === chapterId)
  if (!chapter) return
  const sc = newScene(`Scene ${chapter.scenes.length + 1}`)
  change('Added a scene', (s) => {
    s.chapters.find((c) => c.id === chapterId)!.scenes.push(sc)
  })
  useWriting.setState({ scene: sc.id })
}

export function renameChapter(id: string, title: string): void {
  change(null, (s) => {
    const c = s.chapters.find((x) => x.id === id)
    if (c) c.title = title.slice(0, 120) || c.title
  })
}

export function updateScene(id: string, fn: (scene: Scene) => void, label: string | null = null): void {
  change(label, (s) => {
    for (const c of s.chapters) for (const sc of c.scenes) if (sc.id === id) fn(sc)
  })
}

export function deleteChapter(id: string): void {
  const story = useWriting.getState().story
  if (!story) return
  const chapter = story.chapters.find((c) => c.id === id)
  if (!chapter) return
  change(`Deleted “${chapter.title}”`, (s) => {
    s.chapters = s.chapters.filter((c) => c.id !== id)
    if (!s.chapters.length) s.chapters.push(newChapter())
  })
  const scenes = useWriting.getState().story!.chapters.flatMap((c) => c.scenes)
  if (!scenes.some((s) => s.id === useWriting.getState().scene)) useWriting.setState({ scene: scenes[0]?.id ?? null })
}

export function deleteScene(id: string): void {
  const story = useWriting.getState().story
  if (!story) return
  const chapter = story.chapters.find((c) => c.scenes.some((s) => s.id === id))
  const scene = chapter?.scenes.find((s) => s.id === id)
  if (!chapter || !scene) return
  change(`Deleted “${scene.title}”`, (s) => {
    for (const t of scene.takes) keepCut(s, t.text, scene)
    const c = s.chapters.find((x) => x.id === chapter.id)!
    c.scenes = c.scenes.filter((x) => x.id !== id)
    if (!c.scenes.length) c.scenes.push(newScene())
  })
  if (useWriting.getState().scene === id) {
    const scenes = useWriting.getState().story!.chapters.flatMap((c) => c.scenes)
    useWriting.setState({ scene: scenes[0]?.id ?? null })
  }
}

/** Moves a chapter up or down. */
export function moveChapter(id: string, by: -1 | 1): void {
  change('Moved a chapter', (s) => {
    const i = s.chapters.findIndex((c) => c.id === id)
    const j = i + by
    if (i < 0 || j < 0 || j >= s.chapters.length) return
    ;[s.chapters[i], s.chapters[j]] = [s.chapters[j], s.chapters[i]]
  })
}

/** Moves a scene up or down, into the next or previous chapter at the ends. */
export function moveScene(id: string, by: -1 | 1): void {
  change('Moved a scene', (s) => {
    const ci = s.chapters.findIndex((c) => c.scenes.some((x) => x.id === id))
    if (ci < 0) return
    const list = s.chapters[ci].scenes
    const i = list.findIndex((x) => x.id === id)
    const j = i + by
    if (j >= 0 && j < list.length) {
      ;[list[i], list[j]] = [list[j], list[i]]
      return
    }
    const target = s.chapters[ci + by]
    if (!target) return
    const [scene] = list.splice(i, 1)
    if (by < 0) target.scenes.push(scene)
    else target.scenes.unshift(scene)
    if (!list.length) list.push(newScene())
  })
}

// ---------- takes ----------

/** A new take of a scene: blank, or starting as a copy of the take in use. */
export function addTake(sceneId: string, copy: boolean): void {
  updateScene(
    sceneId,
    (sc) => {
      const from = sc.takes.find((t) => t.id === sc.take)
      const take = newTake(`Take ${sc.takes.length + 1}`, copy ? (from?.text ?? '') : '')
      sc.takes.push(take)
      sc.take = take.id
    },
    'Added a take'
  )
}

export function useTake(sceneId: string, takeId: string): void {
  commitAllRevisions()
  updateScene(sceneId, (sc) => {
    sc.take = takeId
  })
}

export function renameTake(sceneId: string, takeId: string, name: string): void {
  updateScene(sceneId, (sc) => {
    const t = sc.takes.find((x) => x.id === takeId)
    if (t && name.trim()) t.name = name.trim().slice(0, 80)
  })
}

export function deleteTake(sceneId: string, takeId: string): void {
  change('Deleted a take', (s) => {
    for (const c of s.chapters)
      for (const sc of c.scenes) {
        if (sc.id !== sceneId || sc.takes.length < 2) continue
        const gone = sc.takes.find((t) => t.id === takeId)
        if (gone) keepCut(s, gone.text, sc)
        sc.takes = sc.takes.filter((t) => t.id !== takeId)
        if (sc.take === takeId) sc.take = sc.takes[0].id
      }
  })
}

/** The time-lapse's "bring this back": an old version of a take becomes a new take, so nothing is lost. */
export function takeFromVersion(sceneId: string, name: string, text: string): void {
  updateScene(
    sceneId,
    (sc) => {
      const take = newTake(name, text)
      sc.takes.push(take)
      sc.take = take.id
    },
    'Brought back an old version'
  )
}

// ---------- the brain ----------

export function addEntity(kind: EntityKind, name: string): string | null {
  const clean = name.trim()
  if (!clean) return null
  const e = newEntity(kind, clean)
  change(`Added “${e.name}”`, (s) => {
    s.entities.push(e)
  })
  useWriting.setState({ entity: e.id })
  return e.id
}

export function updateEntity(id: string, fn: (e: Story['entities'][number]) => void, label: string | null = null): void {
  change(label, (s) => {
    const e = s.entities.find((x) => x.id === id)
    if (e) fn(e)
  })
}

export function deleteEntity(id: string): void {
  const e = useWriting.getState().story?.entities.find((x) => x.id === id)
  if (!e) return
  change(`Deleted “${e.name}”`, (s) => {
    s.entities = s.entities.filter((x) => x.id !== id)
    s.relationships = s.relationships.filter((r) => r.a !== id && r.b !== id)
    for (const c of s.chapters)
      for (const sc of c.scenes) {
        if (sc.place === id) sc.place = ''
        sc.castAdd = sc.castAdd.filter((x) => x !== id)
        sc.castRemove = sc.castRemove.filter((x) => x !== id)
        for (const k of Object.keys(sc.hows)) if (k.split('|').includes(id)) delete sc.hows[k]
      }
  })
  if (useWriting.getState().entity === id) useWriting.setState({ entity: null })
}

export function addRelationship(a: string, b: string): string | null {
  const story = useWriting.getState().story
  if (!story || !a || !b || a === b) return null
  const existing = story.relationships.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a))
  if (existing) return existing.id
  const id = newId()
  change('Added a relationship', (s) => {
    s.relationships.push({ id, a, b, steps: [] })
  })
  return id
}

export function updateRelationship(id: string, fn: (r: Story['relationships'][number]) => void, label: string | null = null): void {
  change(label, (s) => {
    const r = s.relationships.find((x) => x.id === id)
    if (r) fn(r)
  })
}

export function deleteRelationship(id: string): void {
  change('Deleted a relationship', (s) => {
    s.relationships = s.relationships.filter((r) => r.id !== id)
  })
}
