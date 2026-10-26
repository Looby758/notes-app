import { create } from 'zustand'
import { notify } from './notify'

/**
 * Text snippets: type ;code (e.g. ;sig) and it becomes the saved text. Saved in the notes folder
 * (.notesapp/snippets.json) so they're the same on every computer.
 */

export interface Snippet {
  /** What you type after ";", e.g. "sig". */
  trigger: string
  text: string
}

export const useSnippets = create<{ snippets: Snippet[] }>(() => ({ snippets: [] }))

const FILE = 'snippets.json'

/** Triggers are letters, digits, - and _ (so they end at a space or punctuation). */
export const cleanTrigger = (t: string): string => t.replace(/^;+/, '').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 30)

export function parseSnippets(raw: string | null): Snippet[] {
  try {
    const list = raw ? JSON.parse(raw)?.snippets : []
    if (!Array.isArray(list)) return []
    return list
      .filter((s): s is Snippet => s && typeof s.trigger === 'string' && typeof s.text === 'string')
      .map((s) => ({ trigger: cleanTrigger(s.trigger), text: s.text }))
      .filter((s) => s.trigger)
  } catch {
    return []
  }
}

export async function loadSnippets(): Promise<void> {
  useSnippets.setState({ snippets: [] })
  useSnippets.setState({ snippets: parseSnippets(await window.api.readAppData(FILE).catch(() => null)) })
}

let chain: Promise<void> = Promise.resolve()

export function saveSnippets(snippets: Snippet[]): void {
  useSnippets.setState({ snippets })
  const content = JSON.stringify({ snippets: snippets.filter((s) => s.trigger) }, null, 2)
  chain = chain.then(() => window.api.writeAppData(FILE, content)).catch(notify)
}

export const findSnippet = (trigger: string): Snippet | undefined =>
  useSnippets.getState().snippets.find((s) => s.trigger.toLowerCase() === trigger.toLowerCase())
