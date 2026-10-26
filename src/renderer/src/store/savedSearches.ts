import { create } from 'zustand'
import { notify } from './notify'

/**
 * Searches you've saved (like "#work" or "meeting"), one click away in the sidebar. Kept in the
 * notes folder (.notesapp/saved-searches.json) so every computer has them.
 */
export const useSavedSearches = create<{ queries: string[] }>(() => ({ queries: [] }))

const FILE = 'saved-searches.json'

export async function loadSavedSearches(): Promise<void> {
  useSavedSearches.setState({ queries: [] })
  try {
    const parsed = JSON.parse((await window.api.readAppData(FILE)) ?? 'null')
    const queries = Array.isArray(parsed?.searches) ? parsed.searches.filter((q: unknown) => typeof q === 'string' && q.trim()) : []
    useSavedSearches.setState({ queries })
  } catch {
    // unreadable: start with none
  }
}

let chain: Promise<void> = Promise.resolve()

function save(queries: string[]): void {
  useSavedSearches.setState({ queries })
  const content = JSON.stringify({ searches: queries }, null, 2)
  chain = chain.then(() => window.api.writeAppData(FILE, content)).catch(notify)
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

export const isSaved = (query: string): boolean => useSavedSearches.getState().queries.some((q) => same(q, query))

/** Saves the search, or forgets it if it's saved already. */
export function toggleSavedSearch(query: string): void {
  const q = query.trim()
  if (!q) return
  const { queries } = useSavedSearches.getState()
  save(isSaved(q) ? queries.filter((x) => !same(x, q)) : [...queries, q])
}

export function removeSavedSearch(query: string): void {
  save(useSavedSearches.getState().queries.filter((x) => !same(x, query)))
}

