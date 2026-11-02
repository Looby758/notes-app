import { create } from 'zustand'
import { openSpecialTab, WIKI_TAB } from '../lib/editorController'

/** Where the Wiki tab is: a page of a downloaded wiki, search results, or the list of wikis. */
export interface WikiPlace {
  wikiId: string
  /** A page title, or null for the wiki's main page. */
  title: string | null
  fragment?: string
  /** Showing "search inside pages" results for this instead of a page. */
  search?: string
}

interface WikiState {
  /** null: the list of wikis (and downloading a new one). */
  place: WikiPlace | null
  back: WikiPlace[]
  forward: WikiPlace[]
}

const PLACE_KEY = 'wiki:place'

function savedPlace(): WikiPlace | null {
  try {
    const p = JSON.parse(localStorage.getItem(PLACE_KEY) ?? 'null') as WikiPlace | null
    return p && typeof p.wikiId === 'string' ? { wikiId: p.wikiId, title: typeof p.title === 'string' ? p.title : null } : null
  } catch {
    return null
  }
}

export const useWiki = create<WikiState>(() => ({ place: savedPlace(), back: [], forward: [] }))

function remember(place: WikiPlace | null): void {
  try {
    if (place && !place.search) localStorage.setItem(PLACE_KEY, JSON.stringify({ wikiId: place.wikiId, title: place.title }))
    else if (!place) localStorage.removeItem(PLACE_KEY)
  } catch {
    // only a convenience
  }
}

/** Goes to a page (or the list of wikis, with null), keeping where you were for Back. */
export function goWiki(place: WikiPlace | null): void {
  const { place: now, back } = useWiki.getState()
  useWiki.setState({ place, back: now ? [...back, now].slice(-100) : back, forward: [] })
  remember(place)
}

export function wikiBack(): void {
  const { place, back, forward } = useWiki.getState()
  const to = back[back.length - 1]
  if (!to) return
  useWiki.setState({ place: to, back: back.slice(0, -1), forward: place ? [place, ...forward] : forward })
  remember(to)
}

export function wikiForward(): void {
  const { place, back, forward } = useWiki.getState()
  const to = forward[0]
  if (!to) return
  useWiki.setState({ place: to, back: place ? [...back, place] : back, forward: forward.slice(1) })
  remember(to)
}

/** Opens the Wiki tab (at a page, when given). */
export function openWiki(place?: WikiPlace): void {
  if (place) goWiki(place)
  openSpecialTab(WIKI_TAB)
}
