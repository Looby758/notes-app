import { create } from 'zustand'
import { emptyTimeline, newTimelineId, orderAt, readTimeline, storyOrder, timelineJson, type TimelineData, type TimelineEntry } from '../lib/timeline'
import { recordUndo } from '../lib/undo'
import { notify } from './notify'

/**
 * The story timeline (lib/timeline.ts). Saved in the notes folder (.notesapp/timeline.json) so it
 * follows your notes to other computers. Every change can be undone with Ctrl+Z.
 */
export const useTimeline = create<TimelineData & { loaded: boolean }>(() => ({ ...emptyTimeline(), loaded: false }))

const FILE = 'timeline.json'

let generation = 0

export async function loadTimeline(): Promise<void> {
  generation++
  useTimeline.setState({ ...emptyTimeline(), loaded: false })
  try {
    useTimeline.setState({ ...readTimeline(await window.api.readAppData(FILE)), loaded: true })
  } catch {
    useTimeline.setState({ loaded: true })
  }
}

export async function ensureTimeline(): Promise<void> {
  if (!useTimeline.getState().loaded) await loadTimeline()
}

let writing = false
let again = false

function persist(): void {
  if (writing) {
    again = true
    return
  }
  writing = true
  const { eras, entries } = useTimeline.getState()
  window.api
    .writeAppData(FILE, timelineJson({ eras, entries }))
    .catch(notify)
    .finally(() => {
      writing = false
      if (again) {
        again = false
        persist()
      }
    })
}

function write(change: Partial<TimelineData>): void {
  useTimeline.setState(change)
  persist()
}

/** Makes a change Ctrl+Z can undo. Changes with the same `mergeKey` a moment apart (typing) undo as one. */
function save(change: Partial<TimelineData>, label: string, mergeKey?: string): void {
  const state = useTimeline.getState()
  const before = Object.fromEntries(Object.keys(change).map((k) => [k, state[k as keyof TimelineData]])) as Partial<TimelineData>
  const at = generation
  const swap = (to: Partial<TimelineData>) => (): void => {
    if (at !== generation) throw new Error('Your timeline was reloaded since, so that can’t be undone.')
    write(to)
  }
  recordUndo({ label, mergeKey, undo: swap(before), redo: swap(change) })
  write(change)
}

const short = (text: string): string => {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > 40 ? `“${t.slice(0, 40)}…”` : t ? `“${t}”` : 'an entry'
}

/** Adds an entry at the end of its era. Returns its id. */
export function addEntry(fields: Partial<TimelineEntry>): string {
  const { eras, entries } = useTimeline.getState()
  const era = fields.era && eras.some((e) => e.id === fields.era) ? fields.era : eras[0].id
  const inEra = storyOrder({ eras, entries }, entries.filter((e) => e.era === era))
  const now = Date.now()
  const entry: TimelineEntry = {
    text: '',
    characters: [],
    when: '',
    medium: 'show',
    episode: '',
    at: '',
    telling: 'shown',
    inbox: false,
    ...fields,
    id: newTimelineId(),
    era,
    order: orderAt(inEra, inEra.length),
    created: now,
    updated: now
  }
  save({ entries: [...entries, entry] }, `Added ${short(entry.text)} to the timeline`)
  return entry.id
}

export function updateEntry(id: string, patch: Partial<TimelineEntry>, label = 'Changed a timeline entry', mergeKey?: string): void {
  const { entries } = useTimeline.getState()
  if (!entries.some((e) => e.id === id)) return
  save({ entries: entries.map((e) => (e.id === id ? { ...e, ...patch, id, updated: Date.now() } : e)) }, label, mergeKey ?? `timeline:${id}:${Object.keys(patch).sort().join(',')}`)
}

export function deleteEntry(id: string): void {
  const { entries } = useTimeline.getState()
  const gone = entries.find((e) => e.id === id)
  if (gone) save({ entries: entries.filter((e) => e.id !== id) }, `Deleted ${short(gone.text)} from the timeline`)
}

/** Puts an entry at `index` in an era (story order), e.g. after dragging it there. */
export function moveEntry(id: string, era: string, index: number): void {
  const data = useTimeline.getState()
  const entry = data.entries.find((e) => e.id === id)
  if (!entry) return
  const others = storyOrder(data, data.entries.filter((e) => e.era === era && e.id !== id))
  const order = orderAt(others, Math.max(0, Math.min(index, others.length)))
  if (entry.era === era && entry.order === order) return
  save({ entries: data.entries.map((e) => (e.id === id ? { ...e, era, order, updated: Date.now() } : e)) }, `Moved ${short(entry.text)} in the timeline`)
}

export function addEra(name: string): void {
  const clean = name.trim().slice(0, 80)
  if (!clean) return
  save({ eras: [...useTimeline.getState().eras, { id: newTimelineId(), name: clean }] }, `Added the era “${clean}”`)
}

export function renameEra(id: string, name: string): void {
  const clean = name.trim().slice(0, 80)
  const { eras } = useTimeline.getState()
  if (!clean || !eras.some((e) => e.id === id && e.name !== clean)) return
  save({ eras: eras.map((e) => (e.id === id ? { ...e, name: clean } : e)) }, `Renamed an era to “${clean}”`)
}

/** Moves an era one place earlier or later in the story. */
export function moveEra(id: string, by: -1 | 1): void {
  const eras = [...useTimeline.getState().eras]
  const i = eras.findIndex((e) => e.id === id)
  const j = i + by
  if (i < 0 || j < 0 || j >= eras.length) return
  ;[eras[i], eras[j]] = [eras[j], eras[i]]
  save({ eras }, `Moved the era “${eras[j].name}”`)
}

/** Deletes an era that has nothing in it. */
export function deleteEra(id: string): void {
  const { eras, entries } = useTimeline.getState()
  const era = eras.find((e) => e.id === id)
  if (!era || eras.length <= 1) return
  if (entries.some((e) => e.era === id)) {
    notify('Move the entries out of this era first.', 'info')
    return
  }
  save({ eras: eras.filter((e) => e.id !== id) }, `Deleted the era “${era.name}”`)
}
