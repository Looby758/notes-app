import { create } from 'zustand'
import { CHAT_SITES, isSiteUrl, type ChatSiteId } from '@shared/chatSites'
import type { FloatRect } from '@shared/grok'

/** A chat site's place in Orbit (Grok, Claude): floating or not, the page you were on, and where the panel sits. */
export interface SiteState {
  /** Showing in the floating panel over your notes. */
  floating: boolean
  /** The page you were last on (a chat), so moving between the tab and the panel keeps it. */
  url: string
  /** Where you left the floating panel; null until you first move it. */
  rect: FloatRect | null
}

/** Each site's saved state; Grok keeps the key it always had. */
const KEYS: Record<ChatSiteId, string> = { grok: 'grok', claude: 'claude-site' }

function load(site: ChatSiteId): SiteState {
  const home = CHAT_SITES[site].home
  try {
    const saved = JSON.parse(localStorage.getItem(KEYS[site]) ?? '{}') as Partial<SiteState>
    const rect = saved.rect && typeof saved.rect === 'object' ? saved.rect : null
    return { floating: saved.floating === true, url: typeof saved.url === 'string' && isSiteUrl(site, saved.url) ? saved.url : home, rect }
  } catch {
    return { floating: false, url: home, rect: null }
  }
}

export const useChatSites = create<Record<ChatSiteId, SiteState>>(() => ({ grok: load('grok'), claude: load('claude') }))

let last = useChatSites.getState()
useChatSites.subscribe((s) => {
  for (const site of Object.keys(KEYS) as ChatSiteId[]) {
    if (s[site] === last[site]) continue
    try {
      localStorage.setItem(KEYS[site], JSON.stringify(s[site]))
    } catch {
      // Storage is full or turned off: the site just starts on its home page next time.
    }
  }
  last = s
})

const patch = (site: ChatSiteId, change: Partial<SiteState>): void => useChatSites.setState((s) => ({ [site]: { ...s[site], ...change } }) as Partial<Record<ChatSiteId, SiteState>>)

/** Remembers the page you're on (pages elsewhere, like the sign-in, aren't worth coming back to). */
export function setSiteUrl(site: ChatSiteId, url: string): void {
  if (isSiteUrl(site, url) && useChatSites.getState()[site].url !== url) patch(site, { url })
}
export const setSiteRect = (site: ChatSiteId, rect: FloatRect): void => patch(site, { rect })
export const setSiteFloating = (site: ChatSiteId, floating: boolean): void => patch(site, { floating })

/** Grok's state, as before. */
export const useGrok = <T,>(select: (s: SiteState) => T): T => useChatSites((s) => select(s.grok))
export const setGrokFloating = (floating: boolean): void => setSiteFloating('grok', floating)
