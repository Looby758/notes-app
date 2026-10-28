/**
 * Saved logins: what one looks like, searching them, and combining two copies of the list
 * (when the passwords file was changed on another computer while this one had it open).
 */

export interface Login {
  id: string
  /** What it's for, e.g. "Netflix". */
  title: string
  username: string
  password: string
  /** The website, if any. */
  url: string
  notes: string
  created: number
  updated: number
  /** Deleted logins are kept (empty) for a while so another computer's copy can't bring them back. */
  deleted?: true
}

export const newId = (): string => globalThis.crypto.randomUUID()

export function blankLogin(now = Date.now()): Login {
  return { id: newId(), title: '', username: '', password: '', url: '', notes: '', created: now, updated: now }
}

/** A deleted login: only its id and when, nothing secret. */
export const tombstone = (id: string, now = Date.now()): Login => ({ ...blankLogin(now), id, deleted: true })

/** Deleted marks older than this are dropped. */
const KEEP_DELETED_MS = 90 * 24 * 60 * 60 * 1000

/** Both lists combined: for each login, whichever copy was changed last wins. */
export function mergeLogins(a: Login[], b: Login[], now = Date.now()): Login[] {
  const byId = new Map<string, Login>()
  for (const l of [...a, ...b]) {
    const have = byId.get(l.id)
    if (!have || l.updated > have.updated || (l.updated === have.updated && l.deleted)) byId.set(l.id, l)
  }
  return [...byId.values()].filter((l) => !l.deleted || now - l.updated < KEEP_DELETED_MS)
}

/** The website's name for showing ("https://www.netflix.com/login" → "netflix.com"). */
export function siteName(url: string): string {
  const u = url.trim()
  if (!u) return ''
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '')
  } catch {
    return u
  }
}

/** A link that's safe to open: only http(s). */
export function siteLink(url: string): string | null {
  const u = url.trim()
  if (!u) return null
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}

/** Logins matching a search (by name, username, website or notes, never the password), A–Z. */
export function searchLogins(logins: Login[], query: string): Login[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return logins
    .filter((l) => !l.deleted)
    .filter((l) => {
      const hay = `${l.title} ${l.username} ${l.url} ${l.notes}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
    .sort((x, y) => (x.title || siteName(x.url)).localeCompare(y.title || siteName(y.url), undefined, { sensitivity: 'base' }))
}

/** Ids of logins whose password is also used by another login. */
export function reusedPasswords(logins: Login[]): Set<string> {
  const byPassword = new Map<string, string[]>()
  for (const l of logins) {
    if (l.deleted || !l.password) continue
    byPassword.set(l.password, [...(byPassword.get(l.password) ?? []), l.id])
  }
  return new Set([...byPassword.values()].filter((ids) => ids.length > 1).flat())
}
