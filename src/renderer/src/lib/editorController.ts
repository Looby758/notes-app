import { Annotation, ChangeSet, EditorState, Transaction, type ChangeSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { autocompletion } from '@codemirror/autocomplete'
import { createState, prefsCompartment, prefsExtensions, zenCompartment, zenExtensions } from '../components/Editor/setup'
import { attachmentLink } from '../components/Editor/attachments'
import { linksChanged, notePath, paneCompartment, paneFacet, pathCompartment } from '../components/Editor/facets'
import { EDITOR_COMMANDS } from '../components/Editor/formatting'
import { embedsChanged } from '../components/Editor/embeds'
import {
  FIRST_PANE,
  paneOrder,
  paneWithTab,
  setPanes,
  setStatus,
  useEditor,
  type LayoutNode,
  type PaneState
} from '../store/editor'
import { notify } from '../store/notify'
import { usePrefs } from '../store/prefs'
import type { Prefs } from '@shared/prefs'
import { isWithin, replacePrefix } from './paths'
import { noteLockState, onBeforeLock, openText, remapLock, sealText, useLock, type NoteLock } from './lock/session'
import { currentHeadingIndex, extractHeadings } from './outline'
import { flushBoards } from './boards'
import { forgetWebPage, loadInWebTab, setWebPage } from '../store/web'
import {
  isValidLayout,
  newId,
  PRESET_PANES,
  presetLayout,
  removeFromLayout,
  splitLayout,
  equalize,
  type Preset,
  type Side
} from './layout'

/**
 * Owns the editors. The editor area is split into panes (store/editor.ts has the layout);
 * each pane has one CodeMirror view and its own tabs.
 *
 * - A NoteFile per open note handles saving and changes on disk, once, however many panes show it.
 * - A Session per (pane, note) holds that pane's editor state, so each keeps its own cursor and
 *   undo history. When the same note is open in two panes, edits are copied between them.
 */

// ---------- tab ids ----------

/**
 * Tabs are note paths, or special pages whose ids contain ":" (which file names can't):
 * blank tabs ("blank:1712345", filled by the next note you pick) and pages like Settings.
 */
export const isBlankTab = (id: string | null): boolean => !!id && id.startsWith('blank:')
export const isNoteTab = (id: string | null): id is string => !!id && !id.includes(':')
export const SETTINGS_TAB = 'settings:'
export const CALENDAR_TAB = 'calendar:'
export const GRAPH_TAB = 'graph:'
export const REPLACE_TAB = 'replace:'
export const CONFLICTS_TAB = 'conflicts:'
export const AI_TAB = 'ai:'
export const CHAT_TAB = 'chat:'
export const FLASHCARDS_TAB = 'flashcards:'
export const TERMINAL_TAB = 'terminal:'
export const PASSWORDS_TAB = 'passwords:'
export const EMAIL_TAB = 'email:'
export const HOME_TAB = 'home:'
export const MONEY_TAB = 'money:'
export const CONVERT_TAB = 'convert:'
export const SUDOKU_TAB = 'sudoku:'
export const COMICS_TAB = 'comics:'
export const MINESWEEPER_TAB = 'minesweeper:'
/** Clocks for places around the world (components/Clocks). */
export const CLOCKS_TAB = 'clocks:'
/** Big countdown cards (components/Countdowns). */
export const COUNTDOWNS_TAB = 'countdowns:'
/** Monitor brightness, contrast and input (components/Screens). */
export const SCREENS_TAB = 'screens:'
/** A volume for each app (components/Mixer). */
export const MIXER_TAB = 'mixer:'
/** Download a video from a link into the attachments folder (components/Downloader). */
export const DOWNLOADER_TAB = 'downloader:'
/** Scenes, webcam and screen recording (components/Studio). */
export const STUDIO_TAB = 'studio:'
/** Instant replay and the clip editor (components/Clips). */
export const CLIPS_TAB = 'clips:'
/** Sound clips with hotkeys, the voice changer and music into a voice call (components/Soundboard). */
export const SOUNDBOARD_TAB = 'soundboard:'
/** Who's in your Discord voice channel, with mute and deafen (components/Discord). */
export const DISCORD_TAB = 'discord-voice:'
/** WhatsApp and Discord in one tab (components/Messages). */
export const MESSAGES_TAB = 'messages:'
export const GAMES_TAB = 'games:'
/** The video player (components/Video); which video it shows is in store/videoPlayer. */
export const VIDEO_TAB = 'video:'
/** Browse the whole computer and Google Drive (components/Explorer). */
export const EXPLORER_TAB = 'explorer:'
/** Any Files tab: the first is "explorer:", more are "explorer:<id>" (each remembers its own folder). */
export const isExplorerTab = (id: string | null): id is string => !!id && id.startsWith(EXPLORER_TAB)
const explorerId = (): string => `${EXPLORER_TAB}${Date.now()}${Math.random().toString(36).slice(2, 5)}`
/** The folder a new Files tab starts in, read once by its page (components/Explorer). */
export const explorerStartDirs = new Map<string, string>()
/** A picture, recording, PDF… from the notes folder, shown in a tab: "file:attachments/a.png". */
export const FILE_TAB = 'file:'
export const fileTab = (path: string): string => FILE_TAB + path
export const isFileTab = (id: string | null): id is string => !!id && id.startsWith(FILE_TAB)
export const fileOfTab = (id: string): string => id.slice(FILE_TAB.length)
/** A web page in a tab: "web:1712345abc" (its address and title are in store/web). Open as many as you like. */
export const WEB_TAB = 'web:'
export const isWebTab = (id: string | null): id is string => !!id && id.startsWith(WEB_TAB)
const webId = (): string => `${WEB_TAB}${Date.now()}${Math.random().toString(36).slice(2, 5)}`
const blankId = (): string => `blank:${Date.now()}${Math.random().toString(36).slice(2, 5)}`

// ---------- state ----------

interface NoteFile {
  path: string
  /** What we believe is on disk. */
  saved: string
  timer?: ReturnType<typeof setTimeout>
  saving?: Promise<void>
  /** Disk content that arrived while there were unsaved edits. */
  conflict?: string
  /** Set for a locked note: it's saved locked again. */
  lock?: NoteLock
}

interface Session {
  pane: string
  path: string
  /** The editor state while not on screen (the view holds the live one while it is). */
  state: EditorState
}

interface PaneView {
  view: EditorView
  /** The note this pane's view is showing, if any. */
  shown: string | null
}

/** Marks transactions that came from disk rather than from typing. */
const fromDisk = Annotation.define<boolean>()
/** Marks edits copied from another pane showing the same note (so they aren't copied back). */
const fromSync = Annotation.define<boolean>()

const files = new Map<string, NoteFile>()
const loading = new Map<string, Promise<NoteFile | null | 'locked'>>()
const sessions = new Map<string, Session>()
const views = new Map<string, PaneView>()
let vaultKey = ''
let statsTimer: ReturnType<typeof setTimeout> | undefined

// Pane ids and file names can't contain "|", so this key is unambiguous.
const keyOf = (pane: string, path: string): string => `${pane}|${path}`
const sessionsFor = (path: string): Session[] => [...sessions.values()].filter((s) => s.path === path)
const paneState = (pane: string): PaneState => useEditor.getState().panes[pane] ?? { tabs: [], active: null }
const activePane = (): string => useEditor.getState().activePane

/** The live state for a session: the view's if it's on screen, otherwise the stored one. */
function stateOf(s: Session): EditorState {
  const pv = views.get(s.pane)
  return pv && pv.shown === s.path ? pv.view.state : s.state
}

/** A note's current text (with unsaved edits), or what's on disk if no pane has it open. */
function currentText(path: string): string | null {
  const s = sessionsFor(path)[0]
  return s ? stateOf(s).doc.toString() : (files.get(path)?.saved ?? null)
}

/** A note's text as it is right now, unsaved edits included (null if it isn't loaded). */
export const noteTextNow = currentText

const editListeners = new Set<(path: string) => void>()

/** Calls `fn` with a note's path whenever its text changes (typing, another pane, or disk). */
export function onNoteEdited(fn: (path: string) => void): () => void {
  editListeners.add(fn)
  return () => editListeners.delete(fn)
}

// CodeMirror uses \n internally; normalise so comparisons with disk content are meaningful.
const normalize = (text: string): string => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
const countWords = (text: string): number => text.match(/[\p{L}\p{N}'’-]+/gu)?.length ?? 0
const saveDelay = (): number => usePrefs.getState().prefs.autosaveDelay

/** Applies a change to every session of a note except `origin`. */
function copyToOthers(path: string, changes: ChangeSet, origin: Session | undefined): void {
  for (const s of sessionsFor(path)) {
    if (s === origin) continue
    const spec = { changes, annotations: [fromSync.of(true), Transaction.addToHistory.of(false)] }
    const pv = views.get(s.pane)
    if (pv && pv.shown === s.path) pv.view.dispatch(spec)
    else s.state = s.state.update(spec).state
  }
}

// ---------- preferences ----------

/** The preferences the editor itself cares about; others (colours, fonts) are plain CSS. */
const EDITOR_PREF_KEYS = [
  'livePreview',
  'spellcheck',
  'tabSize',
  'indentWithTabs',
  'lineNumbers',
  'highlightActiveLine',
  'autoPair',
  'wrapSelection',
  'selectionToolbar',
  'smartPaste',
  'aiAutocomplete',
  'vimMode',
  'cursorBlink',
  'typewriterCenter',
  'typewriterDim',
  'typewriterDimUnit',
  'readingMode',
  'shortcuts'
] as const satisfies readonly (keyof Prefs)[]

const editorPrefsKey = (p: Prefs): string => JSON.stringify(EDITOR_PREF_KEYS.map((k) => p[k]))
let appliedPrefsKey = editorPrefsKey(usePrefs.getState().prefs)

/** Reconfigures every editor (on screen or not) when editor settings change. */
usePrefs.subscribe(({ prefs }) => {
  const key = editorPrefsKey(prefs)
  if (key === appliedPrefsKey) return
  appliedPrefsKey = key
  const effects = prefsCompartment.reconfigure(prefsExtensions(prefs))
  for (const s of sessions.values()) {
    const pv = views.get(s.pane)
    if (pv && pv.shown === s.path) pv.view.dispatch({ effects })
    else s.state = s.state.update({ effects }).state
  }
})

/** Zen mode on or off: every editor (on screen or not) gets typewriter mode for the duration. */
export function setZenEditor(on: boolean): void {
  const effects = zenCompartment.reconfigure(zenExtensions(on))
  for (const s of sessions.values()) {
    const pv = views.get(s.pane)
    if (pv && pv.shown === s.path) pv.view.dispatch({ effects })
    else s.state = s.state.update({ effects }).state
  }
}

/**
 * Puts an embed for a file from the notes folder (a voice note, an image) on its own line at the
 * cursor of the note you're in. Returns false if no note is open.
 */
export function insertIntoActiveNote(file: string): boolean {
  return insertBlockIntoActiveNote((note) => attachmentLink(file, note))
}

/** Puts text on lines of its own at the cursor of the note being edited; false if no note is open. */
export function insertBlockIntoActiveNote(text: string | ((note: string) => string)): boolean {
  const pv = views.get(activePane())
  if (!pv?.shown || !isNoteTab(pv.shown)) return false
  const view = pv.view
  const insert = typeof text === 'string' ? text : text(pv.shown)
  const at = view.state.selection.main.head
  const line = view.state.doc.lineAt(at)
  const before = at > line.from ? '\n' : ''
  const after = at < line.to ? '\n' : ''
  view.dispatch({ changes: { from: at, insert: before + insert + after }, selection: { anchor: at + before.length + insert.length } })
  return true
}

const live = new Map<string, { view: EditorView; from: number; length: number }>()

/**
 * Text that keeps changing as it arrives (talking into the phone): the first piece goes in at the
 * cursor of the note you're in, and each later one replaces it. `done` ends that piece.
 */
export function liveTypeIntoActiveNote(id: string, text: string, done: boolean): boolean {
  let at = live.get(id)
  if (!at || at.from + at.length > at.view.state.doc.length) {
    const pv = views.get(activePane())
    if (!pv?.shown || !isNoteTab(pv.shown)) return false
    const head = pv.view.state.selection.main.head
    // Start after a space if the cursor is right after a word.
    const before = head > 0 && /\S/.test(pv.view.state.sliceDoc(head - 1, head)) ? ' ' : ''
    if (before) pv.view.dispatch({ changes: { from: head, insert: before } })
    at = { view: pv.view, from: head + before.length, length: 0 }
    live.set(id, at)
  }
  at.view.dispatch({ changes: { from: at.from, to: at.from + at.length, insert: text }, selection: { anchor: at.from + text.length } })
  at.length = text.length
  if (done) live.delete(id)
  return true
}

// ---------- stats for the active pane ----------

function updateStats(state: EditorState): void {
  const text = state.doc.toString()
  const outline = extractHeadings(text)
  useEditor.setState({
    words: countWords(text),
    outline,
    currentHeading: currentHeadingIndex(outline, state.selection.main.head)
  })
}

function clearStats(): void {
  useEditor.setState({ words: 0, outline: [], currentHeading: -1 })
}

function refreshStats(): void {
  const pv = views.get(activePane())
  if (pv?.shown) updateStats(pv.view.state)
  else clearStats()
}

const onUpdate = EditorView.updateListener.of((update) => {
  const pane = update.state.facet(paneFacet)
  const path = update.state.facet(notePath)
  if (!pane || !path) return
  const inActivePane = pane === activePane()
  if (inActivePane && update.selectionSet && !update.docChanged) {
    const current = currentHeadingIndex(useEditor.getState().outline, update.state.selection.main.head)
    if (current !== useEditor.getState().currentHeading) useEditor.setState({ currentHeading: current })
  }
  if (!update.docChanged) return
  for (const fn of editListeners) fn(path)
  if (inActivePane) {
    clearTimeout(statsTimer)
    statsTimer = setTimeout(refreshStats, 200)
  }
  // Edits copied in from another pane (or made programmatically) were saved/synced at their source.
  if (update.transactions.some((tr) => tr.annotation(fromSync))) return
  copyToOthers(path, update.changes, sessions.get(keyOf(pane, path)))
  if (update.transactions.every((tr) => tr.annotation(fromDisk))) return
  const file = files.get(path)
  if (file) scheduleSave(file)
})

// ---------- reveal (jump to a line or heading once a note opens) ----------

interface Reveal {
  /** Exact character offset (e.g. a template's {{cursor}}). */
  offset?: number
  /** 0-based line. */
  line?: number
  heading?: string
  /** Text on that line to select. */
  match?: string
}
let pendingReveal: { pane: string; path: string; reveal: Reveal } | null = null

function applyReveal(pane: string, path: string): void {
  const pv = views.get(pane)
  if (!pv || pendingReveal?.pane !== pane || pendingReveal.path !== path) return
  const { offset, line, heading, match } = pendingReveal.reveal
  pendingReveal = null
  const view = pv.view
  const doc = view.state.doc
  if (offset !== undefined) {
    const at = Math.min(offset, doc.length)
    view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) })
    return
  }
  let lineNo: number | undefined
  if (heading) {
    const wanted = heading.trim().toLowerCase()
    for (let n = 1; n <= doc.lines; n++) {
      const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(doc.line(n).text)
      if (m && m[1].toLowerCase() === wanted) {
        lineNo = n
        break
      }
    }
  } else if (line !== undefined) {
    lineNo = Math.min(Math.max(line + 1, 1), doc.lines)
  }
  if (lineNo === undefined) return
  const target = doc.line(lineNo)
  const at = match ? target.text.toLowerCase().indexOf(match.toLowerCase()) : -1
  const anchor = at === -1 ? target.from : target.from + at
  const head = at === -1 ? anchor : anchor + match!.length
  view.dispatch({ selection: { anchor, head }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) })
}

// ---------- recent notes ----------

const MAX_RECENT = 30

function rememberRecent(path: string): void {
  const recent = [path, ...useEditor.getState().recent.filter((p) => p !== path)].slice(0, MAX_RECENT)
  useEditor.setState({ recent })
  try {
    localStorage.setItem(`recent:${vaultKey}`, JSON.stringify(recent))
  } catch {
    // not fatal
  }
}

function loadRecent(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(`recent:${vaultKey}`) ?? '[]')
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

// ---------- layout persistence ----------

function persist(): void {
  const { layout, panes, activePane: ap } = useEditor.getState()
  try {
    localStorage.setItem(`layout:${vaultKey}`, JSON.stringify({ layout, panes, activePane: ap }))
  } catch {
    // not fatal: the layout just won't be restored
  }
}

function restore(): { layout: LayoutNode; panes: Record<string, PaneState>; activePane: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(`layout:${vaultKey}`) ?? 'null')
    if (saved && typeof saved.panes === 'object') {
      const panes: Record<string, PaneState> = {}
      for (const [id, p] of Object.entries(saved.panes as Record<string, PaneState>)) {
        if (Array.isArray(p?.tabs)) {
          const tabs = p.tabs.filter((t) => typeof t === 'string')
          const pinned = Array.isArray(p.pinned) ? p.pinned.filter((t) => tabs.includes(t)) : []
          panes[id] = { tabs, active: p.active ?? null, pinned }
        }
      }
      const ids = new Set(Object.keys(panes))
      if (isValidLayout(saved.layout, ids) && paneOrder(saved.layout).length === ids.size) {
        const ap = ids.has(saved.activePane) ? saved.activePane : paneOrder(saved.layout)[0]
        return { layout: saved.layout, panes, activePane: ap }
      }
    }
    // Older versions kept one list of tabs.
    const old = JSON.parse(localStorage.getItem(`tabs:${vaultKey}`) ?? 'null')
    if (Array.isArray(old?.tabs)) {
      return { layout: { type: 'pane', id: FIRST_PANE }, panes: { [FIRST_PANE]: { tabs: old.tabs, active: old.active ?? null } }, activePane: FIRST_PANE }
    }
  } catch {
    // fall through
  }
  return { layout: { type: 'pane', id: FIRST_PANE }, panes: { [FIRST_PANE]: { tabs: [], active: null } }, activePane: FIRST_PANE }
}

/** With "Show Home when Notes starts" on, starts on the Home page (keeping your other tabs). */
function withHome(r: ReturnType<typeof restore>): ReturnType<typeof restore> {
  if (!usePrefs.getState().prefs.homeOnStart) return r
  const pane = r.panes[r.activePane]
  const tabs = pane.tabs.includes(HOME_TAB) ? pane.tabs : [HOME_TAB, ...pane.tabs]
  return { ...r, panes: { ...r.panes, [r.activePane]: { ...pane, tabs, active: HOME_TAB } } }
}

// ---------- loading and showing ----------

/** A note's file, or 'locked' when it's a locked note you haven't unlocked yet. */
async function loadFile(path: string): Promise<NoteFile | null | 'locked'> {
  const existing = files.get(path)
  if (existing) return existing
  if (!loading.has(path)) {
    loading.set(
      path,
      window.api
        .readNote(path)
        .then((raw) => openText(path, normalize(raw)))
        .then((opened) => {
          if (opened === 'locked') return 'locked' as const
          const file: NoteFile = files.get(path) ?? { path, saved: opened.text, lock: opened.lock }
          files.set(path, file)
          setStatus(path, 'saved')
          return file
        })
        .catch(() => null)
        .finally(() => loading.delete(path))
    )
  }
  return loading.get(path)!
}

async function getSession(pane: string, path: string): Promise<Session | null | 'locked'> {
  const key = keyOf(pane, path)
  if (sessions.has(key)) return sessions.get(key)!
  const file = await loadFile(path)
  if (!file || file === 'locked') return file
  if (sessions.has(key)) return sessions.get(key)! // created while we waited
  // Another pane may already have unsaved edits to this note: start from those.
  const text = currentText(path) ?? file.saved
  const extra = [onUpdate, paneCompartment.of(paneFacet.of(pane))]
  const s: Session = { pane, path, state: createState(text, path, extra, usePrefs.getState().prefs) }
  sessions.set(key, s)
  return s
}

/**
 * What a pane shows while no note is open. It keeps autocomplete's slot: closing an open
 * suggestion list on blur happens a moment later, after the note may already be swapped out.
 */
const blankState = (): EditorState => EditorState.create({ extensions: autocompletion() })

/** Saves a pane's on-screen state back into its session before the view shows something else. */
function stash(pane: string): void {
  const pv = views.get(pane)
  if (!pv?.shown) return
  const s = sessions.get(keyOf(pane, pv.shown))
  if (s) s.state = pv.view.state
}

async function show(pane: string, id: string | null, focus = true): Promise<void> {
  const pv = views.get(pane)
  if (!pv) return
  stash(pane)
  if (!isNoteTab(id)) {
    pv.shown = null
    pv.view.setState(blankState())
    if (pane === activePane()) clearStats()
    return
  }
  const s = await getSession(pane, id)
  const now = views.get(pane)
  if (!now || paneState(pane).active !== id) return
  if (!s) {
    // The file is gone (deleted or renamed outside the app); drop the tab quietly.
    closeTab(id, pane)
    return
  }
  if (s === 'locked') {
    // The pane shows the lock screen; this tab is shown again once it's unlocked.
    now.shown = null
    now.view.setState(blankState())
    if (pane === activePane()) clearStats()
    return
  }
  stash(pane)
  now.shown = id
  now.view.setState(s.state)
  // Link styling may be stale if notes changed while this tab was in the background.
  now.view.dispatch({ effects: linksChanged.of(null) })
  applyReveal(pane, id)
  if (focus) now.view.focus()
  if (pane === activePane()) updateStats(now.view.state)
  rememberRecent(id)
}

/** Creates a pane's editor view inside `parent` (called by the Pane component). */
export function mountPane(pane: string, parent: HTMLElement): () => void {
  // Moving a pane into a split remounts it; keep anything the old view hadn't stashed yet.
  stash(pane)
  const pv: PaneView = { view: new EditorView({ parent, state: blankState() }), shown: null }
  views.set(pane, pv)
  show(pane, paneState(pane).active, false)
  return () => {
    // Stash from this view specifically (a newer view for the same pane may already exist).
    if (pv.shown) {
      const s = sessions.get(keyOf(pane, pv.shown))
      if (s) s.state = pv.view.state
    }
    pv.view.destroy()
    if (views.get(pane) === pv) views.delete(pane)
  }
}

// ---------- panes ----------

/** Makes `pane` the one you're working in (outline, backlinks and commands follow it). */
export function focusPane(pane: string): void {
  if (activePane() === pane || !useEditor.getState().panes[pane]) return
  setPanes(() => ({ activePane: pane }))
  refreshStats()
  persist()
}

function updatePane(pane: string, next: Partial<PaneState>): void {
  setPanes((s) => ({ panes: { ...s.panes, [pane]: { ...s.panes[pane], ...next } } }))
}

/**
 * Opens a new pane next to `pane` (default: the active one). By default it shows the same note
 * as the pane it split from; pass `tab` to show something else, or `moveFrom` to move a tab there.
 */
export function splitPane(side: Side, opts: { pane?: string; tab?: string; moveFrom?: string } = {}): void {
  const target = opts.pane ?? activePane()
  const source = paneState(target)
  const tab = opts.tab ?? source.active
  // Moving the only tab of a pane next to itself would just leave an empty pane behind.
  if (opts.moveFrom === target && source.tabs.length <= 1) return
  const id = newId('p')
  setPanes((s) => ({
    layout: splitLayout(s.layout, target, id, side),
    panes: { ...s.panes, [id]: { tabs: [], active: null } },
    activePane: id
  }))
  if (opts.moveFrom && tab) {
    moveTab(tab, opts.moveFrom, id)
  } else {
    // Settings and other pages aren't duplicated; the new pane gets a blank tab instead.
    // (A web or Files tab goes there only when it's a new one, from openWebTab / openExplorerTab.)
    const first = tab && (isNoteTab(tab) || ((isWebTab(tab) || isExplorerTab(tab)) && !paneWithTab(tab))) ? tab : blankId()
    updatePane(id, { tabs: [first], active: first })
  }
  persist()
}

/** Closes a pane and all its tabs (unsaved edits are saved first). The last pane can't be closed. */
export async function closePane(pane: string): Promise<void> {
  const { panes } = useEditor.getState()
  if (Object.keys(panes).length <= 1 || !panes[pane]) return
  for (const tab of [...panes[pane].tabs]) {
    await releaseSession(pane, tab)
    if (isWebTab(tab)) forgetWebPage(tab)
  }
  removePane(pane)
}

function removePane(pane: string): void {
  const order = paneOrder(useEditor.getState().layout)
  const i = order.indexOf(pane)
  const neighbour = order[i - 1] ?? order[i + 1] ?? order[0]
  setPanes((s) => {
    const { [pane]: _gone, ...panes } = s.panes
    return {
      layout: removeFromLayout(s.layout, pane),
      panes,
      activePane: s.activePane === pane ? neighbour : s.activePane
    }
  })
  refreshStats()
  persist()
}

/** Moves (or reorders) a tab. Notes keep their cursor and undo history when they move. */
export function moveTab(id: string, from: string, to: string, index?: number): void {
  const src = paneState(from)
  if (!src.tabs.includes(id)) return

  if (from === to) {
    const tabs = src.tabs.filter((t) => t !== id)
    const at = Math.max(0, Math.min(index ?? tabs.length, tabs.length))
    tabs.splice(at, 0, id)
    updatePane(from, { tabs })
    persist()
    return
  }

  if (isNoteTab(id)) {
    stash(from)
    const s = sessions.get(keyOf(from, id))
    sessions.delete(keyOf(from, id))
    if (s && !sessions.has(keyOf(to, id))) {
      s.pane = to
      s.state = s.state.update({ effects: paneCompartment.reconfigure(paneFacet.of(to)) }).state
      sessions.set(keyOf(to, id), s)
    }
    const pv = views.get(from)
    if (pv?.shown === id) pv.shown = null
  }

  // Take it out of the source pane…
  const remaining = src.tabs.filter((t) => t !== id)
  const i = src.tabs.indexOf(id)
  const srcActive = src.active === id ? (remaining[i] ?? remaining[i - 1] ?? null) : src.active
  // …and put it into the target.
  const dst = paneState(to)
  const dstTabs = dst.tabs.filter((t) => t !== id)
  const at = Math.max(0, Math.min(index ?? dstTabs.length, dstTabs.length))
  dstTabs.splice(at, 0, id)

  // A pinned tab stays pinned in its new pane.
  const wasPinned = (src.pinned ?? []).includes(id)
  const dstPinned = wasPinned ? [...(dst.pinned ?? []).filter((t) => t !== id), id] : (dst.pinned ?? []).filter((t) => t !== id)
  setPanes((s) => ({
    panes: {
      ...s.panes,
      [from]: { tabs: remaining, active: srcActive, pinned: (src.pinned ?? []).filter((t) => t !== id) },
      [to]: { tabs: dstTabs, active: id, pinned: dstPinned }
    },
    activePane: to
  }))
  if (remaining.length === 0 && Object.keys(useEditor.getState().panes).length > 1) removePane(from)
  else if (src.active === id) show(from, srcActive, false)
  show(to, id)
  persist()
}

/** Switches the editor area to a preset arrangement, keeping your tabs. */
export function applyPreset(preset: Preset): void {
  const order = paneOrder(useEditor.getState().layout)
  const count = PRESET_PANES[preset]
  const keep = order.slice(0, count)
  // Panes that don't fit hand their tabs to the last pane that stays.
  for (const extra of order.slice(count)) {
    for (const tab of [...paneState(extra).tabs]) moveTab(tab, extra, keep[keep.length - 1])
  }
  const ids = [...keep]
  while (ids.length < count) ids.push(newId('p'))
  setPanes((s) => {
    const panes: Record<string, PaneState> = {}
    for (const id of ids) {
      if (s.panes[id]) panes[id] = s.panes[id]
      else {
        const b = blankId()
        panes[id] = { tabs: [b], active: b }
      }
    }
    return { layout: presetLayout(preset, ids), panes, activePane: ids.includes(s.activePane) ? s.activePane : ids[0] }
  })
  refreshStats()
  persist()
}

export function equalizePanes(): void {
  setPanes((s) => ({ layout: equalize(s.layout) }))
  persist()
}

/** Saves a split's sizes after you drag a divider. */
export function setLayout(layout: LayoutNode): void {
  setPanes(() => ({ layout }))
  persist()
}

export function focusNextPane(step: 1 | -1): void {
  const order = paneOrder(useEditor.getState().layout)
  if (order.length < 2) return
  const i = order.indexOf(activePane())
  const next = order[(i + step + order.length) % order.length]
  focusPane(next)
  const pv = views.get(next)
  if (pv?.shown) pv.view.focus()
}

// ---------- tabs ----------

/** Resets everything for a newly opened vault and restores its layout and tabs. */
export function init(vault: string): void {
  for (const f of files.values()) clearTimeout(f.timer)
  files.clear()
  sessions.clear()
  vaultKey = vault
  const restored = withHome(restore())
  useEditor.setState({ status: {}, recent: loadRecent() })
  setPanes(() => restored)
  clearStats()
  for (const [pane, pv] of views) {
    pv.shown = null
    if (restored.panes[pane]) show(pane, restored.panes[pane].active, false)
  }
}

/**
 * Opens a note in the active pane (or `pane`), switching to its tab if it's already open there.
 * Otherwise it replaces the note in the current tab, unless that tab is pinned or a page like
 * Settings, `newTab` is set (Ctrl+click, "Open in new tab"), or the "open in new tab" setting is on.
 * `focus: false` leaves keyboard focus where it is; `line`/`heading` move the cursor there.
 */
export function openNote(
  path: string,
  { focus = true, line, heading, match, offset, pane, newTab }: { focus?: boolean; pane?: string; newTab?: boolean } & Reveal = {}
): void {
  const target = pane ?? activePane()
  pendingReveal =
    line !== undefined || heading || offset !== undefined ? { pane: target, path, reveal: { line, heading, match, offset } } : null
  if (pendingReveal && views.get(target)?.shown === path) applyReveal(target, path)
  const p = paneState(target)

  // A blank tab is waiting for a note: fill it (or, if the note is already open in this pane, go there).
  if (isBlankTab(p.active)) {
    const tabs = p.tabs.includes(path) ? p.tabs.filter((t) => t !== p.active) : p.tabs.map((t) => (t === p.active ? path : t))
    setPanes((s) => ({ panes: { ...s.panes, [target]: { tabs, active: path } }, activePane: target }))
    show(target, path, focus)
    persist()
    return
  }

  const tabs = [...p.tabs]
  // The note it replaces, if it goes into the current tab.
  let replaced: string | null = null
  if (!tabs.includes(path)) {
    const reuse =
      !newTab &&
      !usePrefs.getState().prefs.openInNewTab &&
      (isNoteTab(p.active) || isFileTab(p.active)) &&
      !(p.pinned ?? []).includes(p.active!)
    if (reuse) {
      replaced = p.active
      tabs[tabs.indexOf(p.active!)] = path
    } else {
      const at = p.active ? tabs.indexOf(p.active) + 1 : tabs.length
      tabs.splice(at, 0, path)
    }
  }
  const changed = p.active !== path
  setPanes((s) => ({ panes: { ...s.panes, [target]: { tabs, active: path } }, activePane: target }))
  if (changed) show(target, path, focus)
  else if (focus) views.get(target)?.view.focus()
  // The replaced note is saved and let go, as if its tab had been closed.
  if (replaced) void releaseSession(target, replaced)
  refreshStats()
  persist()
}

/** Opens a picture, recording or PDF from the notes folder in a tab (like a note). */
export function openFileTab(path: string, opts: { pane?: string; newTab?: boolean } = {}): void {
  openNote(fileTab(path), opts)
}

/** Opens an empty tab next to the current one; the next note you pick opens in it. */
export function newTab(pane = activePane()): void {
  const p = paneState(pane)
  const id = blankId()
  const at = p.active ? p.tabs.indexOf(p.active) + 1 : p.tabs.length
  const tabs = [...p.tabs]
  tabs.splice(at, 0, id)
  setPanes((s) => ({ panes: { ...s.panes, [pane]: { tabs, active: id } }, activePane: pane }))
  show(pane, id)
  persist()
}

/** Adds a tab after the current one in `pane` and switches to it. */
function addTab(pane: string, id: string): void {
  const p = paneState(pane)
  const at = p.active ? p.tabs.indexOf(p.active) + 1 : p.tabs.length
  const tabs = [...p.tabs]
  tabs.splice(at, 0, id)
  updatePane(pane, { tabs })
  activateTab(id, pane)
}

/** Opens (or switches to) a special page like Settings. There's only ever one of each. */
export function openSpecialTab(id: string): void {
  const existing = paneWithTab(id)
  if (existing) {
    activateTab(id, existing)
    return
  }
  addTab(activePane(), id)
}

/**
 * Opens another Files tab, in `dir` (or where the last one was). `beside` puts it in the pane next
 * to this one (or a new pane on the right), so files can be dragged from one folder to the other.
 */
export function openExplorerTab(dir?: string, { beside = false }: { beside?: boolean } = {}): void {
  const id = explorerId()
  if (dir) explorerStartDirs.set(id, dir)
  const here = activePane()
  if (!beside) return addTab(here, id)
  const order = paneOrder(useEditor.getState().layout)
  const i = order.indexOf(here)
  const other = order[i + 1] ?? order[i - 1]
  if (other) return addTab(other, id)
  splitPane('right', { pane: here, tab: id })
}

/**
 * Opens a web page in a tab (with no address: an empty one to type it in). `beside` keeps your note
 * in view: the page goes in the pane next to this one (into its web tab, if it's showing one), or
 * a new pane on the right.
 */
export function openWebTab(url = '', { beside = false }: { beside?: boolean } = {}): void {
  const here = activePane()
  // With nothing open there's no note to keep in view: the page just goes here.
  const current = paneState(here).active
  if (beside && current && !isBlankTab(current)) {
    const order = paneOrder(useEditor.getState().layout)
    const i = order.indexOf(here)
    const other = order[i + 1] ?? order[i - 1]
    if (!other) {
      const id = webId()
      setWebPage(id, { url, title: '' })
      splitPane('right', { pane: here, tab: id })
      return
    }
    const showing = paneState(other).active
    if (url && isWebTab(showing)) {
      loadInWebTab(showing, url)
      focusPane(other)
      return
    }
    const id = webId()
    setWebPage(id, { url, title: '' })
    addTab(other, id)
    return
  }
  const id = webId()
  setWebPage(id, { url, title: '' })
  // A blank tab waiting for something to show gets the web page.
  const p = paneState(here)
  if (isBlankTab(p.active)) {
    setPanes((s) => ({ panes: { ...s.panes, [here]: { ...p, tabs: p.tabs.map((t) => (t === p.active ? id : t)), active: id } } }))
    show(here, id)
    persist()
    return
  }
  addTab(here, id)
}

/** Switches to an existing tab (note or page). */
export function activateTab(id: string, pane = paneWithTab(id) ?? activePane()): void {
  const p = paneState(pane)
  if (p.active === id) {
    focusPane(pane)
    if (isNoteTab(id)) views.get(pane)?.view.focus()
    return
  }
  setPanes((s) => ({ panes: { ...s.panes, [pane]: { ...s.panes[pane], active: id } }, activePane: pane }))
  show(pane, id)
  persist()
}

export function cycleTab(step: 1 | -1): void {
  const pane = activePane()
  const { tabs, active } = paneState(pane)
  if (tabs.length < 2 || !active) return
  const i = (tabs.indexOf(active) + step + tabs.length) % tabs.length
  activateTab(tabs[i], pane)
}

/**
 * Lets go of a pane's session for a note. If no other pane has the note open, saves it first
 * (asking what to keep if it changed on disk) and forgets the file.
 */
async function releaseSession(pane: string, id: string): Promise<void> {
  if (!isNoteTab(id)) return
  const others = sessionsFor(id).filter((s) => s.pane !== pane)
  const file = files.get(id)
  if (file && others.length === 0) {
    if (file.conflict) {
      const keepMine = await window.api.confirm({
        type: 'warning',
        message: `"${id}" was changed on disk while you were editing it.`,
        detail: 'Keep your version (overwrites the file), or keep the version on disk?',
        ok: 'Keep mine',
        cancel: 'Keep disk version'
      })
      if (keepMine) await save(file, true)
    } else {
      await flush(file)
    }
  }
  stash(pane)
  sessions.delete(keyOf(pane, id))
  const pv = views.get(pane)
  if (pv?.shown === id) pv.shown = null
  if (sessionsFor(id).length === 0) forgetFile(id)
}

export const isPinned = (id: string, pane = paneWithTab(id) ?? activePane()): boolean =>
  (paneState(pane).pinned ?? []).includes(id)

/** Pins a tab (kept at the front; Ctrl+W and the close button leave it open) or unpins it. */
export function togglePin(id: string, pane = paneWithTab(id) ?? activePane()): void {
  const p = paneState(pane)
  if (!p.tabs.includes(id)) return
  const pinned = p.pinned ?? []
  updatePane(pane, { pinned: pinned.includes(id) ? pinned.filter((t) => t !== id) : [...pinned, id] })
  persist()
}

/**
 * Closing from Ctrl+W, a tab's close button or "Close others": pinned tabs stay open.
 * Returns false if the tab was pinned. (Deleting a note still closes its tab via closeTab.)
 */
export function closeTabUnlessPinned(id: string, pane = paneWithTab(id) ?? activePane()): boolean {
  if (isPinned(id, pane)) {
    notify('That tab is pinned. Unpin it to close it.', 'info')
    return false
  }
  closeTab(id, pane)
  return true
}

export async function closeTab(id: string, pane = paneWithTab(id) ?? activePane()): Promise<void> {
  await releaseSession(pane, id)
  // Discord only saves your sign-in as its page closes, so the hub's pages close properly first.
  if (id === MESSAGES_TAB) await window.api.releaseMessages().catch(() => undefined)
  const p = paneState(pane)
  const i = p.tabs.indexOf(id)
  if (i === -1) return
  if (isWebTab(id)) forgetWebPage(id)
  const tabs = p.tabs.filter((t) => t !== id)
  // Closing a pane's last tab closes the pane too (unless it's the only one).
  if (tabs.length === 0 && Object.keys(useEditor.getState().panes).length > 1) {
    removePane(pane)
    return
  }
  const active = p.active === id ? (tabs[i] ?? tabs[i - 1] ?? null) : p.active
  updatePane(pane, { tabs, active })
  if (p.active === id) show(pane, active)
  persist()
}

function forgetFile(path: string): void {
  const f = files.get(path)
  if (f) clearTimeout(f.timer)
  files.delete(path)
  useEditor.setState((st) => {
    const { [path]: _removed, ...status } = st.status
    return { status }
  })
}

/** After a rename or move, points tabs, sessions and files at the new paths. */
export function remap(from: string, to: string): void {
  for (const f of [...files.values()]) {
    if (!isWithin(f.path, from)) continue
    files.delete(f.path)
    const next = replacePrefix(f.path, from, to)
    remapLock(f.path, next)
    f.path = next
    files.set(f.path, f)
  }
  for (const s of [...sessions.values()]) {
    if (!isWithin(s.path, from)) continue
    const next = replacePrefix(s.path, from, to)
    sessions.delete(keyOf(s.pane, s.path))
    const effects = pathCompartment.reconfigure(notePath.of(next))
    const pv = views.get(s.pane)
    if (pv && pv.shown === s.path) {
      pv.view.dispatch({ effects })
      pv.shown = next
    } else {
      s.state = s.state.update({ effects }).state
    }
    s.path = next
    sessions.set(keyOf(s.pane, next), s)
  }
  const map = (t: string): string => (isNoteTab(t) ? replacePrefix(t, from, to) : isFileTab(t) ? fileTab(replacePrefix(fileOfTab(t), from, to)) : t)
  setPanes((s) => ({
    panes: Object.fromEntries(
      Object.entries(s.panes).map(([id, p]) => [
        id,
        { tabs: p.tabs.map(map), active: p.active && map(p.active), pinned: (p.pinned ?? []).map(map) }
      ])
    )
  }))
  useEditor.setState((st) => ({
    status: Object.fromEntries(Object.entries(st.status).map(([p, v]) => [replacePrefix(p, from, to), v]))
  }))
  persist()
}

/** Closes every tab at or inside `path` without saving (used after deleting it). */
export function discardWithin(path: string): void {
  for (const f of [...files.values()]) if (isWithin(f.path, path)) forgetFile(f.path)
  for (const s of [...sessions.values()]) if (isWithin(s.path, path)) sessions.delete(keyOf(s.pane, s.path))
  for (const [pane, p] of Object.entries(useEditor.getState().panes)) {
    for (const tab of p.tabs) {
      if ((isNoteTab(tab) && isWithin(tab, path)) || (isFileTab(tab) && isWithin(fileOfTab(tab), path))) closeTab(tab, pane)
    }
  }
}

/** Closes tabs whose files vanished from disk, unless they hold unsaved edits. */
export function closeMissing(exists: (path: string) => boolean): void {
  for (const [pane, p] of Object.entries(useEditor.getState().panes)) {
    for (const tab of p.tabs) {
      if (isFileTab(tab) && !exists(fileOfTab(tab))) {
        closeTab(tab, pane)
        continue
      }
      if (!isNoteTab(tab) || exists(tab) || loading.has(tab)) continue
      const f = files.get(tab)
      if (!(f && currentText(tab) !== f.saved)) closeTab(tab, pane)
    }
  }
}

// ---------- editor helpers for the active pane ----------

const activeView = (): EditorView | null => {
  const pv = views.get(activePane())
  return pv?.shown ? pv.view : null
}

export function focusEditor(): void {
  activeView()?.focus()
}

/** Runs an editor command (bold, italic…) on the active note, e.g. from the command palette. */
export function runEditorCommand(id: string): void {
  const view = activeView()
  const cmd = EDITOR_COMMANDS.find((c) => c.id === id)
  if (view && cmd) {
    cmd.run(view)
    view.focus()
  }
}

/** Moves the cursor to `pos` in the active note and scrolls it near the top (used by the outline). */
export function jumpTo(pos: number): void {
  const view = activeView()
  if (!view) return
  const at = Math.min(pos, view.state.doc.length)
  view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'start', yMargin: 48 }) })
  view.focus()
}

/** Re-checks which links point at existing notes (call when notes are added, removed or renamed). */
export function refreshLinkDecorations(): void {
  for (const pv of views.values()) if (pv.shown) pv.view.dispatch({ effects: linksChanged.of(null) })
}

/** Re-reads embedded notes (call when any note's text changes). */
export function refreshEmbeds(): void {
  for (const pv of views.values()) if (pv.shown) pv.view.dispatch({ effects: embedsChanged.of(null) })
}

/** Re-measures layout after the editor font size changes. */
export function remeasure(): void {
  for (const pv of views.values()) pv.view.requestMeasure()
}

// ---------- saving ----------

function scheduleSave(f: NoteFile): void {
  if (f.conflict) return
  setStatus(f.path, 'unsaved')
  clearTimeout(f.timer)
  f.timer = setTimeout(() => save(f), saveDelay())
}

async function save(f: NoteFile, force = false): Promise<void> {
  clearTimeout(f.timer)
  f.timer = undefined
  if (f.conflict && !force) return
  if (force) f.conflict = undefined
  await f.saving
  const doc = currentText(f.path)
  if (doc === null || doc === f.saved) {
    setStatus(f.path, 'saved')
    return
  }
  setStatus(f.path, 'saving')
  f.saving = sealText(f.path, doc, f.lock)
    .then((content) => window.api.writeNote(f.path, content))
    .then(() => {
      f.saved = doc
      setStatus(f.path, currentText(f.path) === doc ? 'saved' : 'unsaved')
    })
    .catch((err) => {
      setStatus(f.path, 'error')
      notify(err)
    })
    .finally(() => (f.saving = undefined))
  await f.saving
}

async function flush(f: NoteFile): Promise<void> {
  if (f.timer) await save(f)
  else await f.saving
}

export async function flushAll(): Promise<void> {
  await Promise.all([...[...files.values()].map(flush), flushBoards()])
}

/** Ctrl+S: save right away instead of waiting for the pause. */
export function saveNow(): void {
  const pv = views.get(activePane())
  const f = pv?.shown ? files.get(pv.shown) : undefined
  if (f) save(f)
}

// ---------- programmatic edits and changes on disk ----------

/** The smallest single change turning `current` into `next`, so cursors stay put where possible. */
function diff(current: string, next: string): ChangeSpec {
  let start = 0
  while (start < current.length && start < next.length && current[start] === next[start]) start++
  let endA = current.length
  let endB = next.length
  while (endA > start && endB > start && current[endA - 1] === next[endB - 1]) {
    endA--
    endB--
  }
  return { from: start, to: endA, insert: next.slice(start, endB) }
}

/** Replaces a note's text in every pane that has it open. */
function replaceEverywhere(path: string, content: string, fromDiskChange: boolean): void {
  const current = currentText(path)
  if (current === null || current === content) return
  const changes = diff(current, content)
  for (const s of sessionsFor(path)) {
    const spec = { changes, annotations: [fromDisk.of(fromDiskChange), fromSync.of(true)] }
    const pv = views.get(s.pane)
    if (pv && pv.shown === s.path) pv.view.dispatch(spec)
    else s.state = s.state.update(spec).state
  }
}

/** An open note's current text, unsaved edits included; null if no pane has it open. */
export function getOpenText(path: string): string | null {
  return sessionsFor(path).length ? currentText(path) : null
}

/**
 * Replaces an open note's text as an ordinary edit (undoable, autosaved), e.g. when links in it
 * are updated after a rename. Returns false if the note isn't open anywhere.
 */
export function applyText(path: string, content: string): boolean {
  const f = files.get(path)
  if (!f || sessionsFor(path).length === 0) return false
  replaceEverywhere(path, content, false)
  scheduleSave(f)
  return true
}

/** Called with paths the file watcher saw change. */
export async function handleExternalChanges(paths: string[]): Promise<void> {
  for (const path of paths) {
    const f = files.get(path)
    if (!f) continue
    await f.saving
    let disk: string
    try {
      const opened = await openText(path, normalize(await window.api.readNote(path)))
      if (opened === 'locked') continue // locked by another device or app; keep what's open
      f.lock = opened.lock
      disk = opened.text
    } catch {
      continue // deleted (the tree refresh deals with it), or locked with a key we don't have
    }
    if (disk === f.saved) continue // our own save, or no real change
    if (currentText(path) === f.saved) {
      replaceEverywhere(path, disk, true)
      f.saved = disk
      setStatus(path, 'saved')
    } else {
      clearTimeout(f.timer)
      f.conflict = disk
      setStatus(path, 'conflict')
    }
  }
}

/** Resolves a "changed on disk" conflict by keeping one side. */
export function resolveConflict(path: string, keep: 'disk' | 'mine'): void {
  const f = files.get(path)
  if (!f?.conflict) return
  const disk = f.conflict
  if (keep === 'disk') {
    f.conflict = undefined
    replaceEverywhere(path, disk, true)
    f.saved = disk
    setStatus(path, 'saved')
  } else {
    save(f, true)
  }
}

// ---------- locked notes ----------

/**
 * Locks a note (with the notes password or its own), changes how, or (`lock` undefined) removes
 * the lock. The note must be readable right now (not locked, or unlocked).
 */
export async function setNoteLock(path: string, lock: NoteLock | undefined): Promise<void> {
  const file = await loadFile(path)
  if (!file || file === 'locked') throw new Error('Unlock the note first.')
  await flush(file)
  const text = currentText(path) ?? file.saved
  const content = await sealText(path, text, lock)
  file.lock = lock
  await window.api.writeNote(path, content)
  file.saved = text
  noteLockState(path, content)
  setStatus(path, currentText(path) === text ? 'saved' : 'unsaved')
}

/** Whether an open note is saved locked. */
export const noteLockOf = (path: string): NoteLock | undefined => files.get(path)?.lock

// Before keys are forgotten: save locked notes, and take them off screen.
onBeforeLock(async () => {
  const lockedFiles = [...files.values()].filter((f) => f.lock)
  await Promise.all(lockedFiles.map(flush))
  for (const f of lockedFiles) {
    for (const s of sessionsFor(f.path)) {
      const pv = views.get(s.pane)
      if (pv && pv.shown === s.path) {
        pv.shown = null
        pv.view.setState(blankState())
      }
      sessions.delete(keyOf(s.pane, s.path))
    }
    forgetFile(f.path)
  }
  refreshStats()
})

// Unlocking (or locking again): panes showing a locked note load it, or show the lock screen.
useLock.subscribe((s, prev) => {
  if (s.version === prev.version) return
  for (const [pane, pv] of views) {
    const active = paneState(pane).active
    if (isNoteTab(active) && pv.shown !== active) show(pane, active, pane === activePane())
  }
})