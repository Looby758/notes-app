import { NOT_READY } from '@shared/claudeDesktop'
import { findNotePath } from '@shared/claudeFormat'
import { useNoteIndex } from '../../store/noteIndex'
import { useVault } from '../../store/vault'
import { lockedFolderOf } from '../lock/folders'

/** Shared bits for the answers Orbit's window gives Claude Desktop (see ../claudeAnswers.ts). */

export type Args = Record<string, unknown>
export type Answer = (args: Args) => string | Promise<string>

export const str = (v: unknown): string => (typeof v === 'string' ? v : '')
export const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
export const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && !!s.trim()) : [])
export const has = (args: Args, key: string): boolean => args[key] !== undefined && args[key] !== null

export function needNotes(): void {
  if (!useVault.getState().vault) throw new Error(NOT_READY)
}

export const locked = (path: string): boolean => !!lockedFolderOf(path)

const squash = (s: string): string => s.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim()

/**
 * Picks the one thing Claude means by name: the exact name (any case), else the only one whose
 * name has it in, else the only one whose name starts with it. Never guesses between several.
 */
export function pickOne<T>(items: readonly T[], want: string, nameOf: (t: T) => string, what: string): T {
  const w = squash(want)
  if (!w) throw new Error(`Say which ${what}.`)
  const exact = items.filter((i) => squash(nameOf(i)) === w)
  if (exact.length === 1) return exact[0]
  const inside = exact.length ? exact : items.filter((i) => squash(nameOf(i)).includes(w))
  if (inside.length === 1) return inside[0]
  const names = (list: readonly T[]): string =>
    list
      .slice(0, 30)
      .map((i) => `“${nameOf(i)}”`)
      .join(', ')
  if (inside.length > 1) throw new Error(`More than one ${what} matches “${want}”: ${names(inside)}. Say which one.`)
  if (!items.length) throw new Error(`There isn’t any ${what} yet.`)
  throw new Error(`There’s no ${what} called “${want}”. There’s ${names(items)}${items.length > 30 ? ' and more' : ''}.`)
}

/** Pounds as Claude writes them (12.5) → whole pence. */
export function pence(v: unknown, what = 'amount'): number {
  const n = typeof v === 'number' ? v : Number(str(v).replace(/[£,\s]/g, ''))
  if (!Number.isFinite(n)) throw new Error(`The ${what} has to be a number of pounds, like 12.50.`)
  return Math.round(n * 100)
}

/** A note's path from its name or path, leaving out locked ones. */
export function findNote(want: string): string {
  const all = [...useNoteIndex.getState().notes.keys()]
  const path = findNotePath(
    all.filter((p) => !locked(p)),
    want
  )
  if (path) return path
  if (findNotePath(all, want)) throw new Error('That note is in a locked folder, so Claude can’t see it.')
  throw new Error(`There’s no note called “${want}” (or more than one has that name: use its full path from search_notes).`)
}

/** A web page's or wiki page's HTML as plain text, keeping paragraphs and headings on their own lines. */
export function htmlText(html: string): string {
  const marked = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-6])[^>]*>/gi, (_m, n: string) => `\n\n${'#'.repeat(Number(n))} `)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(br|\/p|\/div|\/tr|\/h[1-6]|\/table)[^>]*>/gi, '\n')
  const text = new DOMParser().parseFromString(marked, 'text/html').body.textContent ?? ''
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n /g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
