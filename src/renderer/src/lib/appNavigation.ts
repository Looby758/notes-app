import { useEditor, paneWithTab } from '../store/editor'
import { useNoteIndex } from '../store/noteIndex'
import { webviews } from '../store/web'
import { activateTab, focusPane, isBlankTab, isFileTab, isNoteTab, openNote, openSpecialTab } from './editorController'
import { NavHistory, type Place } from './navHistory'

/**
 * The mouse's back and forward buttons (and anything else that wants them): in a web tab they step
 * through that page's history first, like a browser; otherwise, or once the page can't go any
 * further, they step through where you've been in the app (lib/navHistory).
 */

const history = new NavHistory()

/** Mouse button numbers for the side buttons (MouseEvent.button). */
const BACK_BUTTON = 3
const FORWARD_BUTTON = 4

/** Starts remembering where you go (from scratch, e.g. for a newly opened notes folder). Returns a stop function. */
export function startNavHistory(): () => void {
  history.clear()
  let prev = useEditor.getState()
  const record = (): void => {
    const s = useEditor.getState()
    const before = prev
    prev = s
    const tab = s.active
    if (!tab || isBlankTab(tab)) return
    const beforeTab = before.panes[s.activePane]?.active ?? null
    // Clicking into another pane, with nothing in it changing, isn't a step anywhere (unless it's the first).
    if (beforeTab === tab && history.current()) return
    const from = beforeTab && !isBlankTab(beforeTab) ? { pane: s.activePane, tab: beforeTab } : null
    history.visit({ pane: s.activePane, tab }, from)
  }
  record()
  return useEditor.subscribe((s, old) => {
    if (s.panes !== old.panes || s.activePane !== old.activePane) record()
  })
}

/** Whether a place you were can still be gone back to. */
function stillThere({ tab }: Place): boolean {
  // Pages there's only one of (Settings, Calendar…) open again; so does a picture or PDF. A closed
  // web or Files tab can't: what it was showing went with it.
  if (paneWithTab(tab) || tab.endsWith(':') || isFileTab(tab)) return true
  if (!isNoteTab(tab)) return false
  const { notes } = useNoteIndex.getState()
  // (Before the index has loaded, assume it's there.)
  return notes.size === 0 || notes.has(tab)
}

function goTo(place: Place): void {
  const { panes } = useEditor.getState()
  const paneExists = !!panes[place.pane]
  if (paneExists && panes[place.pane].tabs.includes(place.tab)) return activateTab(place.tab, place.pane)
  const open = paneWithTab(place.tab)
  if (open) return activateTab(place.tab, open)
  if (isNoteTab(place.tab) || isFileTab(place.tab)) return openNote(place.tab, { pane: paneExists ? place.pane : undefined })
  if (paneExists) focusPane(place.pane)
  openSpecialTab(place.tab)
}

/** Steps back (-1) or forward (1) around the app. Returns false if there was nowhere to go. */
export function navigateApp(dir: 1 | -1): boolean {
  const place = history.step(dir, stillThere)
  if (!place) return false
  goTo(place)
  return true
}

/** Back or forward in a web tab's own page history, if it can. */
function navigateWebTab(tab: string, dir: 1 | -1): boolean {
  const view = webviews.get(tab)
  if (!view) return false
  try {
    if (dir === -1 ? !view.canGoBack() : !view.canGoForward()) return false
    if (dir === -1) view.goBack()
    else view.goForward()
    return true
  } catch {
    // The page isn't ready yet.
    return false
  }
}

/**
 * Back (-1) or forward (1), as the mouse's side buttons do: in `webTab` (the web tab the pointer is
 * over; else the tab you're in, if it's a web page), the page goes back first; then the app does.
 */
export function navigate(dir: 1 | -1, webTab: string | null = useEditor.getState().active): void {
  if (webTab && navigateWebTab(webTab, dir)) return
  navigateApp(dir)
}

/** The web tab whose page is the web contents `id` (from main/browser.ts), if it's one of the web tabs. */
function webTabOfContents(id: number): string | null {
  for (const [tab, view] of webviews) {
    try {
      if (view.getWebContentsId() === id) return tab
    } catch {
      // not attached yet
    }
  }
  return null
}

/**
 * Listens for the mouse's back and forward buttons, in the app and (sent over by main/browser.ts)
 * in web pages. Returns a stop function.
 */
export function watchMouseNavigation(): () => void {
  const isSideButton = (e: MouseEvent): boolean => e.button === BACK_BUTTON || e.button === FORWARD_BUTTON
  // The press itself does nothing else (no text selection, no stray clicks).
  const swallow = (e: MouseEvent): void => {
    if (isSideButton(e)) e.preventDefault()
  }
  const onUp = (e: MouseEvent): void => {
    if (!isSideButton(e)) return
    e.preventDefault()
    // Over a web tab's address bar (in a pane that may not be the active one): that page.
    const webTab = (e.target as Element | null)?.closest?.('[data-web-tab]')?.getAttribute('data-web-tab') ?? useEditor.getState().active
    navigate(e.button === BACK_BUTTON ? -1 : 1, webTab)
  }
  window.addEventListener('mousedown', swallow, true)
  window.addEventListener('mouseup', onUp, true)
  window.addEventListener('auxclick', swallow, true)
  const offWeb = window.api.onWebMouseNav((contentsId, dir) => {
    const tab = webTabOfContents(contentsId)
    // A web tab steps back through its own pages first; other pages (the messages hub) go straight to the app.
    if (tab) navigate(dir, tab)
    else navigateApp(dir)
  })
  return () => {
    window.removeEventListener('mousedown', swallow, true)
    window.removeEventListener('mouseup', onUp, true)
    window.removeEventListener('auxclick', swallow, true)
    offWeb()
  }
}
