import { create } from 'zustand'
import type { WebviewTag } from 'electron'

/** One web browser tab: the page it's on, and that page's title (for the tab). */
export interface WebPage {
  url: string
  title: string
}

interface WebState {
  /** By tab id ("web:…"). Kept between launches, so web tabs come back where you left them. */
  pages: Record<string, WebPage>
}

const KEY = 'webTabs'

function load(): Record<string, WebPage> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    const pages: Record<string, WebPage> = {}
    for (const [id, p] of Object.entries(saved as Record<string, Partial<WebPage>>)) {
      if (typeof p?.url === 'string') pages[id] = { url: p.url, title: typeof p.title === 'string' ? p.title : '' }
    }
    return pages
  } catch {
    return {}
  }
}

export const useWeb = create<WebState>(() => ({ pages: load() }))

useWeb.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s.pages))
  } catch {
    // not fatal: web tabs just open empty next time
  }
})

export function setWebPage(id: string, patch: Partial<WebPage>): void {
  useWeb.setState((s) => {
    const old = s.pages[id]
    const page: WebPage = { url: old?.url ?? '', title: old?.title ?? '', ...patch }
    return old && old.url === page.url && old.title === page.title ? s : { pages: { ...s.pages, [id]: page } }
  })
}

export function forgetWebPage(id: string): void {
  useWeb.setState((s) => {
    if (!(id in s.pages)) return s
    const { [id]: _gone, ...pages } = s.pages
    return { pages }
  })
}

/** The web pages on screen, by tab id (WebPage registers them), so links can be opened in them. */
export const webviews = new Map<string, WebviewTag>()

/** Goes to `url` in a web tab: straight away if it's on screen, otherwise when it next shows. */
export function loadInWebTab(id: string, url: string): void {
  setWebPage(id, { url })
  const view = webviews.get(id)
  if (view) void view.loadURL(url).catch(() => undefined)
}
