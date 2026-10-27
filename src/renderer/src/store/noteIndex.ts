import { create } from 'zustand'
import MiniSearch from 'minisearch'
import { NoteLookup, parseLinks, type LinkRef } from '../lib/links'
import { parseTags, tagMatches } from '../lib/tags'
import { isWithin, noteTitle } from '../lib/paths'
import { findMentions, type Mention } from '../lib/mentions'
import { buildVectors, relatedTo, type Related, type RelatedInput } from '../lib/related'
import { readFrontmatter } from '../lib/properties'
import { compareItems, parseDatedItems, type DatedItem } from '../lib/schedule'
import { dailyDateOf } from '../lib/dailyPaths'
import { usePrefs } from './prefs'
import { forgetLockState, noteLockState } from '../lib/lock/session'
import { isLockedText } from '../lib/lock/crypto'
import { parseCards, type Flashcard } from '../lib/flashcards'

/**
 * Everything the app knows about the vault's notes beyond the file tree: links (for backlinks
 * and rename updates), tags, and a full-text search index.
 */

/** A link plus the line it sits on, for showing backlinks with context. */
export interface IndexedLink extends LinkRef {
  snippet: string
  /** Where the link sits within `snippet`. */
  snipFrom: number
  snipTo: number
}

export interface NoteEntry {
  links: IndexedLink[]
  tags: string[]
  /** Calendar items: the daily note itself, dated notes, due tasks, schedule events. */
  dated: DatedItem[]
  /** The note's emoji icon (`icon:` property), if it has one. */
  icon?: string
  /** Flashcards: `Question :: Answer` lines. */
  cards: Flashcard[]
}

export interface Backlink {
  source: string
  links: IndexedLink[]
}

interface IndexState {
  notes: Map<string, NoteEntry>
  lookup: NoteLookup
  /** Bumped on every change, so components can re-derive. */
  version: number
}

export const useNoteIndex = create<IndexState>(() => ({
  notes: new Map(),
  lookup: new NoteLookup([]),
  version: 0
}))

export const normalizeText = (text: string): string => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')

// Note text and the search index live outside React state: they're big and only read on demand.
const texts = new Map<string, string>()
const search = new MiniSearch<{ id: string; title: string; text: string }>({
  fields: ['title', 'text'],
  searchOptions: { boost: { title: 3 }, prefix: true, fuzzy: 0.2, combineWith: 'AND' }
})

/** A note's text as last saved (used by embeds and templates). */
export function getNoteText(path: string): string | undefined {
  return texts.get(path)
}

function indexLinks(text: string): IndexedLink[] {
  const lines = text.split('\n')
  return parseLinks(text).map((link) => {
    const lineStart = text.lastIndexOf('\n', link.from - 1) + 1
    const snippet = lines[link.line]
    return { ...link, snippet, snipFrom: link.from - lineStart, snipTo: Math.min(link.to - lineStart, snippet.length) }
  })
}

function datedItems(path: string, text: string): DatedItem[] {
  const prefs = usePrefs.getState().prefs
  return parseDatedItems(text, path, {
    dailyDate: dailyDateOf(path, prefs),
    scheduleHeading: prefs.scheduleHeading,
    title: noteTitle(path)
  })
}

function put(notes: Map<string, NoteEntry>, path: string, raw: string): void {
  noteLockState(path, raw)
  // Locked notes are left out of search, links, tags, the graph, the calendar and flashcards: only the name shows.
  const text = isLockedText(raw) ? '' : normalizeText(raw)
  texts.set(path, text)
  const icon = readFrontmatter(text)?.properties.find((p) => p.key === 'icon')?.value
  notes.set(path, { links: indexLinks(text), tags: parseTags(text), dated: datedItems(path, text), icon: typeof icon === 'string' && icon ? icon : undefined, cards: parseCards(text, path) })
  const doc = { id: path, title: noteTitle(path), text }
  if (search.has(path)) search.replace(doc)
  else search.add(doc)
}

function drop(notes: Map<string, NoteEntry>, path: string): void {
  forgetLockState(path)
  notes.delete(path)
  texts.delete(path)
  if (search.has(path)) search.discard(path)
}

let chain: Promise<void> = Promise.resolve()

export function resetIndex(): void {
  texts.clear()
  search.removeAll()
  useNoteIndex.setState((s) => ({ notes: new Map(), lookup: new NoteLookup([]), version: s.version + 1 }))
}

/**
 * Brings the index in line with the notes on disk: drops notes that are gone, and (re)reads
 * new notes and the ones in `changed`. Runs one sync at a time.
 */
export function syncIndex(allPaths: string[], changed: string[] = []): Promise<void> {
  chain = chain
    .then(async () => {
      const state = useNoteIndex.getState()
      const notes = new Map(state.notes)
      const present = new Set(allPaths)
      for (const path of [...notes.keys()]) if (!present.has(path)) drop(notes, path)

      const changedSet = new Set(changed)
      const toRead = allPaths.filter((p) => !notes.has(p) || changedSet.has(p))
      if (notes.size === 0 && toRead.length > 20) {
        // First load: one round trip for the whole vault.
        for (const { path, content } of await window.api.readAllNotes()) put(notes, path, content)
      } else {
        const read = await Promise.all(
          toRead.map(async (path) => {
            try {
              return [path, await window.api.readNote(path)] as const
            } catch {
              return [path, null] as const
            }
          })
        )
        for (const [path, content] of read) {
          if (content === null) drop(notes, path)
          else put(notes, path, content)
        }
      }

      const samePaths = state.lookup.paths.length === allPaths.length && allPaths.every((p) => state.lookup.has(p))
      if (!samePaths || toRead.length > 0 || notes.size !== state.notes.size) {
        useNoteIndex.setState({
          notes,
          lookup: samePaths ? state.lookup : new NoteLookup(allPaths),
          version: state.version + 1
        })
      }
    })
    .catch((err) => console.error('[index]', err))
  return chain
}

// ---------- calendar ----------

/** Everything dated, grouped by day key and sorted (all-day first, then by time). */
export function itemsByDay(): Map<string, DatedItem[]> {
  const byDay = new Map<string, DatedItem[]>()
  for (const { dated } of useNoteIndex.getState().notes.values()) {
    for (const item of dated) {
      const list = byDay.get(item.date)
      if (list) list.push(item)
      else byDay.set(item.date, [item])
    }
  }
  for (const list of byDay.values()) list.sort(compareItems)
  return byDay
}

// Changing where daily notes live (or the schedule heading) changes what counts as dated.
const calendarKey = (p: ReturnType<typeof usePrefs.getState>['prefs']): string => `${p.dailyFolder}|${p.dailyFormat}|${p.scheduleHeading}`
let calendarPrefsKey = calendarKey(usePrefs.getState().prefs)
usePrefs.subscribe(({ prefs }) => {
  const key = calendarKey(prefs)
  if (key === calendarPrefsKey) return
  calendarPrefsKey = key
  useNoteIndex.setState((s) => {
    const notes = new Map(s.notes)
    for (const [path, entry] of notes) notes.set(path, { ...entry, dated: datedItems(path, texts.get(path) ?? '') })
    return { notes, version: s.version + 1 }
  })
})

// ---------- backlinks ----------

/** Notes that link to `target`, with each linking line. */
export function backlinksTo(target: string): Backlink[] {
  const { notes, lookup } = useNoteIndex.getState()
  const result: Backlink[] = []
  for (const [source, { links }] of notes) {
    if (source === target) continue
    const matching = links.filter((l) => lookup.resolve(l, source) === target)
    if (matching.length) result.push({ source, links: matching })
  }
  return result.sort((a, b) => a.source.localeCompare(b.source, undefined, { numeric: true, sensitivity: 'base' }))
}

// ---------- unlinked mentions ----------

export interface MentionGroup {
  source: string
  mentions: Mention[]
}

/** Notes that mention `target`'s name in plain text without linking to it. */
export function unlinkedMentionsOf(target: string): MentionGroup[] {
  const title = noteTitle(target)
  const result: MentionGroup[] = []
  for (const [source, text] of texts) {
    if (source === target) continue
    const mentions = findMentions(text, title)
    if (mentions.length) result.push({ source, mentions })
  }
  return result.sort((a, b) => a.source.localeCompare(b.source, undefined, { numeric: true, sensitivity: 'base' }))
}

/** How a new link to `target` is written: its name, or its path if other notes share the name. */
export function linkNameFor(target: string): string {
  const title = noteTitle(target)
  return useNoteIndex.getState().lookup.isUnique(title) ? title : target.replace(/\.md$/i, '')
}

// ---------- related notes ----------

let relatedCache: { version: number; inputs: RelatedInput[]; vectors: ReturnType<typeof buildVectors> } | null = null

/** Notes like `target` (shared tags or links, similar words), best first. Templates are left out. */
export function relatedNotes(target: string): Related[] {
  const { notes, lookup, version } = useNoteIndex.getState()
  if (!relatedCache || relatedCache.version !== version) {
    const { templatesFolder } = usePrefs.getState().prefs
    const inputs: RelatedInput[] = [...notes]
      .filter(([path]) => !templatesFolder || !isWithin(path, templatesFolder))
      .map(([path, entry]) => ({
        path,
        tags: entry.tags,
        links: entry.links.map((l) => lookup.resolve(l, path)).filter((p): p is string => !!p),
        text: texts.get(path) ?? ''
      }))
    relatedCache = { version, inputs, vectors: buildVectors(inputs) }
  }
  return relatedTo(target, relatedCache.inputs, relatedCache.vectors)
}

// ---------- tags ----------

/** With "hide templates from tags" on, notes in the templates folder don't count for tags. */
function hiddenFromTags(path: string): boolean {
  const { hideTemplatesFromTags, templatesFolder } = usePrefs.getState().prefs
  return hideTemplatesFromTags && !!templatesFolder && isWithin(path, templatesFolder)
}

export interface TagCount {
  name: string
  count: number
}

/** Every tag in the vault with how many notes use it, alphabetically. */
export function allTags(): TagCount[] {
  const counts = new Map<string, TagCount>()
  for (const [path, { tags }] of useNoteIndex.getState().notes) {
    if (hiddenFromTags(path)) continue
    for (const tag of tags) {
      const key = tag.toLowerCase()
      const entry = counts.get(key)
      if (entry) entry.count++
      else counts.set(key, { name: tag, count: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

// ---------- search ----------

export interface SearchHit {
  path: string
  /** The matching line (trimmed around the match) and the 0-based line number. */
  snippet: string
  line: number
  /** Ranges in `snippet` to highlight. */
  highlights: [number, number][]
  /** Text to select when the note opens. */
  match: string
}

const SNIPPET_CONTEXT = 70
const MAX_HITS = 100

function makeSnippet(text: string, terms: string[]): Omit<SearchHit, 'path'> {
  const lower = text.toLowerCase()
  let at = -1
  let term = ''
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase())
    if (i !== -1 && (at === -1 || i < at)) {
      at = i
      term = t
    }
  }
  if (at === -1) {
    // No visible match (e.g. matched on title only): show the first line with text.
    const lines = text.split('\n')
    const line = Math.max(0, lines.findIndex((l) => l.trim() && !/^---\s*$/.test(l)))
    return { snippet: (lines[line] ?? '').slice(0, SNIPPET_CONTEXT * 2), line, highlights: [], match: '' }
  }
  const lineStart = text.lastIndexOf('\n', at - 1) + 1
  const lineEndRaw = text.indexOf('\n', at)
  const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw
  const line = text.slice(0, lineStart).split('\n').length - 1
  const from = Math.max(lineStart, at - SNIPPET_CONTEXT)
  const to = Math.min(lineEnd, at + term.length + SNIPPET_CONTEXT)
  const prefix = from > lineStart ? '…' : ''
  const snippet = prefix + text.slice(from, to).trim() + (to < lineEnd ? '…' : '')
  const highlights: [number, number][] = []
  const snipLower = snippet.toLowerCase()
  for (const t of terms) {
    const needle = t.toLowerCase()
    for (let i = snipLower.indexOf(needle); i !== -1 && needle; i = snipLower.indexOf(needle, i + needle.length)) {
      highlights.push([i, i + needle.length])
    }
  }
  highlights.sort((a, b) => a[0] - b[0])
  // Drop overlaps so highlighting stays well-formed.
  const merged = highlights.filter((h, i) => i === 0 || h[0] >= highlights[i - 1][1])
  return { snippet, line, highlights: merged, match: text.slice(at, at + term.length) }
}

/**
 * Full-text search. Words match note titles and text (prefix and typo-tolerant); `#tag` tokens
 * filter to notes with that tag (nested tags included).
 */
export function searchNotes(query: string): SearchHit[] {
  const tagFilters: string[] = []
  const words = query
    .replace(/(^|\s)#([\p{L}\p{N}_/-]+)/gu, (_m, pre: string, tag: string) => {
      tagFilters.push(tag)
      return pre
    })
    .trim()
  if (!words && tagFilters.length === 0) return []

  const { notes } = useNoteIndex.getState()
  const hasTags = (path: string): boolean => {
    // Searching by #tag leaves out templates (when hidden from tags); plain word searches still find them.
    if (tagFilters.length && hiddenFromTags(path)) return false
    const tags = notes.get(path)?.tags ?? []
    return tagFilters.every((want) => tags.some((t) => tagMatches(t, want)))
  }

  let ranked: { path: string; terms: string[] }[]
  if (words) {
    ranked = search.search(words).map((r) => ({ path: r.id as string, terms: [...r.terms, ...words.split(/\s+/)] }))
  } else {
    ranked = [...notes.keys()]
      .sort((a, b) => noteTitle(a).localeCompare(noteTitle(b), undefined, { sensitivity: 'base' }))
      .map((path) => ({ path, terms: tagFilters.map((t) => `#${t}`) }))
  }

  const hits: SearchHit[] = []
  for (const { path, terms } of ranked) {
    if (!hasTags(path)) continue
    const text = texts.get(path)
    if (text === undefined) continue
    hits.push({ path, ...makeSnippet(text, [...new Set(terms)].sort((a, b) => b.length - a.length)) })
    if (hits.length >= MAX_HITS) break
  }
  return hits
}
