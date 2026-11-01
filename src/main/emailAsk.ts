import { app, safeStorage } from 'electron'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AiEngine } from '@shared/types'
import { emailDigest, gmailQuery, keywords, rankEmails, type CachedEmail } from '@shared/emailSearch'
import * as google from './calendarSources'
import * as email from './email'

/**
 * Email for Ask everything. Orbit keeps a copy of your recent emails (their text too) on this
 * computer, so questions about them work without the internet, and the offline AI can be given
 * the whole text of the emails that match instead of only Gmail's short previews.
 *
 * The copy is encrypted with the system's own protection (Electron safeStorage, like your
 * sign-ins) in `email-copy.bin` in the settings folder. Where that isn't available it's kept in
 * memory only. It's deleted when you disconnect Google, and started afresh for another account.
 */

const FILE = 'email-copy.bin'
const MAX_EMAILS = 500
const MAX_TEXT = 8000
/** How many of the newest emails each catch-up looks at. */
const RECENT = 60

interface Copy {
  account: string
  emails: Record<string, CachedEmail>
}

let copy: Copy | null = null
let saving: NodeJS.Timeout | null = null

const path = (): string => join(app.getPath('userData'), FILE)

function load(): Copy {
  const account = google.authStatus().email ?? ''
  if (copy && copy.account === account) return copy
  copy = { account, emails: {} }
  if (!safeStorage.isEncryptionAvailable()) return copy
  try {
    const data = JSON.parse(safeStorage.decryptString(readFileSync(path()))) as Copy
    if (data.account === account && data.emails) copy = data
  } catch {
    // None yet, or from another account: start afresh.
  }
  return copy
}

function saveSoon(): void {
  if (saving || !safeStorage.isEncryptionAvailable()) return
  saving = setTimeout(() => {
    saving = null
    if (!copy) return
    try {
      const tmp = path() + '.tmp'
      writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(copy)))
      renameSync(tmp, path())
    } catch {
      // Not being able to save the copy only means it's fetched again next time.
    }
  }, 2000)
}

/** Keeps the newest emails only. */
function trim(c: Copy): void {
  const all = Object.values(c.emails)
  if (all.length <= MAX_EMAILS) return
  all.sort((a, b) => b.date.localeCompare(a.date))
  for (const e of all.slice(MAX_EMAILS)) delete c.emails[e.id]
}

/** Adds an email you opened (or Ask everything fetched) to the copy. */
export function remember(m: Awaited<ReturnType<typeof email.get>>): void {
  if (!google.hasGmail()) return
  const c = load()
  const text = (m.text ?? (m.html ? htmlText(m.html) : '')).slice(0, MAX_TEXT)
  c.emails[m.id] = {
    id: m.id,
    threadId: m.threadId,
    from: m.from,
    subject: m.subject,
    snippet: m.snippet,
    date: m.date,
    unread: m.unread,
    starred: m.starred,
    hasAttachments: m.hasAttachments,
    to: m.to.map((a) => a.name || a.email).join(', ') || undefined,
    text
  }
  trim(c)
  saveSoon()
}

/** Takes an email out of the copy (moved to the bin). */
export function forget(id: string): void {
  const c = load()
  if (!c.emails[id]) return
  delete c.emails[id]
  saveSoon()
}

/** Deletes the copy (Google disconnected). */
export function clear(): void {
  copy = null
  try {
    rmSync(path(), { force: true })
  } catch {
    // Already gone.
  }
}

/** HTML-only emails: just the words. */
function htmlText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
}

/** Fetches the full text of emails not in the copy yet, a few at a time. */
async function fetchMissing(ids: string[]): Promise<void> {
  const c = load()
  const missing = [...new Set(ids)].filter((id) => !c.emails[id])
  for (let i = 0; i < missing.length; i += 6) {
    await Promise.all(missing.slice(i, i + 6).map((id) => email.get(id).then(remember, () => undefined)))
  }
}

let catchingUp: Promise<void> | null = null

/** Brings the copy up to date with the newest emails. Quietly does nothing without the internet. */
export function catchUp(): Promise<void> {
  if (!google.hasGmail()) return Promise.resolve()
  catchingUp ??= (async () => {
    try {
      await fetchMissing(await email.ids('', RECENT))
    } catch {
      // Offline, or signed out: the copy stays as it was.
    } finally {
      catchingUp = null
    }
  })()
  return catchingUp
}

/**
 * The email part of Ask everything: the emails that best answer the question, the best few in
 * full. `related` are words the AI suggested the email might use. Searches Gmail too when it can,
 * so older emails are found, and falls back to the copy on this computer without the internet.
 */
export async function contextFor(question: string, related: string[], engine: AiEngine): Promise<string> {
  if (!google.hasGmail()) return ''
  const q = gmailQuery(keywords(question).slice(0, 6), related)
  await Promise.all([
    catchUp(),
    q
      ? email
          .ids(q, 15)
          .then(fetchMissing)
          .catch(() => undefined)
      : undefined
  ])
  const emails = Object.values(load().emails)
  if (!emails.length) return ''
  const ranked = rankEmails(emails, question, related)
  // The offline AI reads less at once.
  return emailDigest(ranked, engine === 'offline' ? 9000 : 30000, engine === 'offline' ? 3 : 6)
}
