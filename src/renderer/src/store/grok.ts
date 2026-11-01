import { create } from 'zustand'
import { GROK_URL, isGrokUrl, type FloatRect } from '@shared/grok'

interface GrokState {
  /** Grok is showing in the floating panel over your notes (rather than, or as well as, nowhere). */
  floating: boolean
  /** The Grok page you were last on (a chat), so moving between the tab and the panel keeps it. */
  url: string
  /** Where you left the floating panel; null until you first move it. */
  rect: FloatRect | null
}

const KEY = 'grok'

function load(): GrokState {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<GrokState>
    const rect = saved.rect && typeof saved.rect === 'object' ? saved.rect : null
    return {
      floating: saved.floating === true,
      url: typeof saved.url === 'string' && isGrokUrl(saved.url) ? saved.url : GROK_URL,
      rect
    }
  } catch {
    return { floating: false, url: GROK_URL, rect: null }
  }
}

export const useGrok = create<GrokState>(() => load())

useGrok.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Storage is full or turned off: Grok just starts on its home page next time.
  }
})

/** Remembers the Grok page you're on (pages elsewhere, like the sign-in, aren't worth coming back to). */
export function setGrokUrl(url: string): void {
  if (isGrokUrl(url) && useGrok.getState().url !== url) useGrok.setState({ url })
}

export const setGrokRect = (rect: FloatRect): void => useGrok.setState({ rect })
export const setGrokFloating = (floating: boolean): void => useGrok.setState({ floating })
