import { app, net, safeStorage, shell } from 'electron'
import { createHash, randomBytes } from 'crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { createServer, type Server } from 'http'
import { join } from 'path'
import type { CalEvent, CalendarSourcesStatus, GoogleAuthStatus } from '@shared/types'
import { parseIcs } from '@shared/ics'

/**
 * Read-only calendars: Google Calendar (you sign in with Google in your browser) and calendar
 * links (.ics, e.g. Google's "secret address in iCal format"). Sign-ins and links are stored
 * encrypted with Windows' own protection (Electron safeStorage), never in plain text.
 *
 * Google sign-in uses the standard desktop flow: your browser opens Google's page, you approve,
 * and Google sends a one-time code to a temporary address on this computer (127.0.0.1). The app
 * only asks for read-only access to your calendars and your Google Sheets (so .gsheet files in the
 * notes folder can be shown, see googleSheets.ts), plus access to Gmail once you turn on the Email
 * page (see email.ts), which shares this sign-in.
 */

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
const SCOPE = `https://www.googleapis.com/auth/calendar.readonly ${SHEETS_SCOPE} openid email`
/** Read, label, archive and send email (not delete forever). */
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'
// Overridable for tests, which point these at a local fake Google server.
const AUTH_URL = process.env.NOTES_GOOGLE_AUTH_URL ?? 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = process.env.NOTES_GOOGLE_TOKEN_URL ?? 'https://oauth2.googleapis.com/token'
const REVOKE_URL = process.env.NOTES_GOOGLE_REVOKE_URL ?? 'https://oauth2.googleapis.com/revoke'
const API_URL = process.env.NOTES_GOOGLE_API_URL ?? 'https://www.googleapis.com/calendar/v3'
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000
const FEED_COLORS = ['#5ea8ff', '#4ade80', '#e0a458', '#f472b6', '#3ccfcf', '#f97066']

interface Stored {
  clientId: string
  /** Encrypted. */
  clientSecret?: string
  /** Encrypted refresh token. */
  refreshToken?: string
  email?: string
  /** What the sign-in was allowed (Google lets you untick some). Missing for sign-ins from before Sheets. */
  scopes?: string
  /** You turned on the Email page, so signing in again asks for Gmail too. */
  gmail?: boolean
  /** Google calendars you've switched off. */
  disabled: string[]
  calendars: { id: string; name: string; color: string }[]
  feeds: { id: string; name: string; color: string; url: string /* encrypted */ }[]
}

let stored: Stored | null = null
let accessToken: { token: string; expires: number } | null = null
let googleError: string | undefined
const feedErrors = new Map<string, string>()

const file = (name: string): string => join(app.getPath('userData'), name)

function load(): Stored {
  if (stored) return stored
  try {
    stored = { disabled: [], calendars: [], feeds: [], clientId: '', ...JSON.parse(readFileSync(file('calendars.json'), 'utf8')) }
  } catch {
    stored = { clientId: '', disabled: [], calendars: [], feeds: [] }
  }
  return stored!
}

function save(): void {
  const tmp = file('calendars.json.tmp')
  writeFileSync(tmp, JSON.stringify(stored, null, 2), 'utf8')
  renameSync(tmp, file('calendars.json'))
}

const encrypt = (text: string): string => safeStorage.encryptString(text).toString('base64')
const decrypt = (text: string): string => safeStorage.decryptString(Buffer.from(text, 'base64'))

export function status(): CalendarSourcesStatus {
  const s = load()
  return {
    google: {
      clientId: s.clientId,
      hasSecret: !!s.clientSecret,
      connected: !!s.refreshToken,
      email: s.email,
      error: googleError,
      calendars: s.calendars.map((c) => ({ ...c, enabled: !s.disabled.includes(c.id) }))
    },
    feeds: s.feeds.map(({ id, name, color }) => ({ id, name, color, error: feedErrors.get(id) })),
    canEncrypt: safeStorage.isEncryptionAvailable()
  }
}

export function setClient(clientId: string, clientSecret: string): CalendarSourcesStatus {
  const s = load()
  const id = clientId.trim()
  if (id && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id) && !process.env.NOTES_GOOGLE_AUTH_URL) {
    throw new Error('That doesn’t look like a Google client ID (it should end in .apps.googleusercontent.com).')
  }
  if (id !== s.clientId) {
    // A different app: the old sign-in doesn't apply any more.
    s.refreshToken = undefined
    s.email = undefined
    s.scopes = undefined
    s.calendars = []
    accessToken = null
  }
  s.clientId = id
  if (clientSecret.trim()) s.clientSecret = encrypt(clientSecret.trim())
  save()
  return status()
}

// ---------- Google sign-in ----------

const base64url = (buf: Buffer): string => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function postForm(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await net.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString()
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const err = new Error(String(body.error_description ?? body.error ?? `Google said ${res.status}`))
    ;(err as Error & { code?: string }).code = String(body.error ?? '')
    throw err
  }
  return body
}

/** Email from the ID token Google sends back (only used to show who's signed in). */
function emailFromIdToken(idToken: unknown): string | undefined {
  if (typeof idToken !== 'string') return undefined
  try {
    return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8')).email
  } catch {
    return undefined
  }
}

/** Waits for Google to redirect the browser back to a one-off local address with the code. */
function listenForCode(state: string): Promise<{ server: Server; port: number; code: Promise<string> }> {
  return new Promise((resolve, reject) => {
    let deliver: (code: string) => void
    let fail: (err: Error) => void
    const code = new Promise<string>((res, rej) => {
      deliver = res
      fail = rej
    })
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/') {
        res.writeHead(404).end()
        return
      }
      const page = (title: string, text: string): void => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:Segoe UI,sans-serif;background:#16171d;color:#d7d9e0;display:grid;place-items:center;height:90vh"><div><h2>${title}</h2><p>${text}</p></div>`
        )
      }
      if (url.searchParams.get('state') !== state) {
        page('Something went wrong', 'This sign-in link doesn’t match. Please try connecting again from Orbit.')
        fail(new Error('Sign-in was interrupted. Please try again.'))
      } else if (url.searchParams.get('error')) {
        page('Not connected', 'You can close this tab and return to Orbit.')
        fail(new Error(url.searchParams.get('error') === 'access_denied' ? 'Google didn’t give access, so nothing was connected. If it said “Access blocked”, add your Google account under Test users on the Audience page of your Google Cloud project.' : 'Google sign-in failed.'))
      } else {
        page('Connected to Orbit ✓', 'You can close this tab and return to Orbit.')
        deliver(url.searchParams.get('code') ?? '')
      }
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve({ server, port: typeof addr === 'object' && addr ? addr.port : 0, code })
    })
  })
}

/** Who's signed in and whether Gmail is allowed, for the Email page. */
export function authStatus(): GoogleAuthStatus {
  const s = load()
  return {
    configured: !!s.clientId && !!s.clientSecret,
    connected: !!s.refreshToken,
    email: s.email,
    gmail: !!s.refreshToken && hasGmail(),
    error: googleError,
    canEncrypt: safeStorage.isEncryptionAvailable()
  }
}

export const hasGmail = (): boolean => (load().scopes ?? '').split(' ').includes(GMAIL_SCOPE)

/**
 * Signs in to Google in your browser. `withGmail` also asks for email access (from the Email page);
 * once you've allowed it, signing in again from Settings keeps asking for it.
 */
export async function connect(withGmail = false): Promise<CalendarSourcesStatus> {
  const s = load()
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows can’t protect a saved sign-in on this computer, so Google can’t be connected.')
  if (!s.clientId || !s.clientSecret) throw new Error('Add your Google client ID and secret first.')
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const state = base64url(randomBytes(16))
  const { server, port, code } = await listenForCode(state)
  const redirect = `http://127.0.0.1:${port}`
  try {
    const auth = new URL(AUTH_URL)
    auth.search = new URLSearchParams({
      client_id: s.clientId,
      redirect_uri: redirect,
      response_type: 'code',
      scope: withGmail || s.gmail ? `${SCOPE} ${GMAIL_SCOPE}` : SCOPE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      access_type: 'offline',
      prompt: 'consent'
    }).toString()
    await shell.openExternal(auth.toString())
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              'Sign-in timed out. If Google said “Access blocked”, add your Google account under Test users on the Audience page of your Google Cloud project, then connect again.'
            )
          ),
        SIGN_IN_TIMEOUT_MS
      )
    )
    const authCode = await Promise.race([code, timeout])
    const tokens = await postForm(TOKEN_URL, {
      code: authCode,
      client_id: s.clientId,
      client_secret: decrypt(s.clientSecret),
      redirect_uri: redirect,
      grant_type: 'authorization_code',
      code_verifier: verifier
    })
    if (typeof tokens.refresh_token !== 'string') throw new Error('Google didn’t allow offline access. Try connecting again.')
    s.refreshToken = encrypt(tokens.refresh_token)
    s.email = emailFromIdToken(tokens.id_token)
    s.scopes = typeof tokens.scope === 'string' ? tokens.scope : undefined
    if (withGmail) s.gmail = true
    accessToken = { token: String(tokens.access_token), expires: Date.now() + Number(tokens.expires_in ?? 3600) * 1000 }
    googleError = undefined
    save()
    if (withGmail && !hasGmail()) throw new Error('Google didn’t give Notes access to your email. Connect again and tick the Gmail box.')
    // Connecting from the Email page shouldn't fail just because the calendar isn't set up.
    await refreshCalendarList().catch((err) => {
      if (!withGmail) throw err
    })
    return status()
  } finally {
    server.close()
  }
}

export async function disconnect(): Promise<CalendarSourcesStatus> {
  const s = load()
  if (s.refreshToken) {
    // Tell Google to forget the sign-in too (best effort).
    await net.fetch(`${REVOKE_URL}?token=${encodeURIComponent(decrypt(s.refreshToken))}`, { method: 'POST' }).catch(() => undefined)
  }
  s.refreshToken = undefined
  s.email = undefined
  s.scopes = undefined
  s.gmail = undefined
  s.calendars = []
  accessToken = null
  googleError = undefined
  save()
  return status()
}

export async function getAccessToken(): Promise<string | null> {
  const s = load()
  if (!s.refreshToken || !s.clientSecret) return null
  if (accessToken && accessToken.expires > Date.now() + 60_000) return accessToken.token
  try {
    const tokens = await postForm(TOKEN_URL, {
      client_id: s.clientId,
      client_secret: decrypt(s.clientSecret),
      refresh_token: decrypt(s.refreshToken),
      grant_type: 'refresh_token'
    })
    accessToken = { token: String(tokens.access_token), expires: Date.now() + Number(tokens.expires_in ?? 3600) * 1000 }
    googleError = undefined
    return accessToken.token
  } catch (err) {
    if ((err as Error & { code?: string }).code === 'invalid_grant') {
      // Typical when the Google Cloud project is in "Testing": sign-ins last 7 days.
      s.refreshToken = undefined
      save()
      googleError = 'Your Google sign-in expired. Connect again to keep seeing your events.'
    } else {
      googleError = 'Couldn’t reach Google right now.'
    }
    return null
  }
}

/** For other Google APIs: an access token if you're signed in and allowed `scope`, otherwise why not. */
export async function googleToken(scope: string): Promise<{ token: string; email?: string } | { missing: 'setup' | 'connect' | 'scope' | 'offline'; error?: string }> {
  const s = load()
  if (!s.clientId || !s.clientSecret) return { missing: 'setup' }
  if (!s.refreshToken) return { missing: 'connect', error: googleError }
  if (!(s.scopes ?? '').split(' ').includes(scope)) return { missing: 'scope' }
  const token = await getAccessToken()
  if (token) return { token, email: s.email }
  // An expired sign-in is cleared by getAccessToken; anything else is Google being out of reach.
  return { missing: s.refreshToken ? 'offline' : 'connect', error: googleError }
}

async function googleGet(path: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const token = await getAccessToken()
  if (!token) throw new Error(googleError ?? 'Not connected to Google.')
  const url = new URL(API_URL + path)
  url.search = new URLSearchParams(params).toString()
  const res = await net.fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Google Calendar said ${res.status}.`)
  return (await res.json()) as Record<string, unknown>
}

async function refreshCalendarList(): Promise<void> {
  const s = load()
  const list = await googleGet('/users/me/calendarList', { minAccessRole: 'reader' })
  const items = (list.items as Record<string, unknown>[] | undefined) ?? []
  s.calendars = items.map((c) => ({
    id: String(c.id),
    name: String(c.summaryOverride ?? c.summary ?? c.id),
    color: String(c.backgroundColor ?? '#5ea8ff')
  }))
  save()
}

export function setCalendarEnabled(id: string, enabled: boolean): CalendarSourcesStatus {
  const s = load()
  s.disabled = enabled ? s.disabled.filter((d) => d !== id) : [...new Set([...s.disabled, id])]
  save()
  return status()
}

/** The parts of a Google Calendar API event we use. */
interface GoogleEvent {
  id: string
  status?: string
  summary?: string
  location?: string
  htmlLink?: string
  start?: { date?: string; dateTime?: string }
  end?: { date?: string; dateTime?: string }
}

async function googleEvents(from: string, to: string): Promise<CalEvent[]> {
  const s = load()
  if (!s.refreshToken) return []
  if (s.calendars.length === 0) await refreshCalendarList()
  const out: CalEvent[] = []
  for (const cal of s.calendars.filter((c) => !s.disabled.includes(c.id))) {
    let pageToken: string | undefined
    do {
      const page = await googleGet(`/calendars/${encodeURIComponent(cal.id)}/events`, {
        timeMin: from,
        timeMax: to,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '2500',
        ...(pageToken ? { pageToken } : {})
      })
      for (const e of (page.items as GoogleEvent[] | undefined) ?? []) {
        if (e.status === 'cancelled' || !e.start) continue
        const allDay = !!e.start.date
        out.push({
          id: `g:${cal.id}:${e.id}`,
          sourceId: `google:${cal.id}`,
          calendarName: cal.name,
          color: cal.color,
          title: String(e.summary ?? '(No title)'),
          allDay,
          start: allDay ? e.start.date! : new Date(e.start.dateTime!).toISOString(),
          end: allDay ? (e.end?.date ?? e.start.date!) : new Date(e.end?.dateTime ?? e.start.dateTime!).toISOString(),
          location: e.location,
          url: e.htmlLink
        })
      }
      pageToken = page.nextPageToken as string | undefined
    } while (pageToken)
  }
  return out
}

// ---------- calendar links (.ics) ----------

/** Accepts https links (and webcal://, which is the same thing); plain http only for this computer. */
function normalizeFeedUrl(url: string): string {
  const u = new URL(url.trim().replace(/^webcal:/i, 'https:'))
  const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost'
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('Calendar links must start with https:// (or webcal://).')
  return u.toString()
}

export function addFeed(name: string, url: string): CalendarSourcesStatus {
  const s = load()
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows can’t protect saved links on this computer.')
  const clean = normalizeFeedUrl(url)
  s.feeds.push({
    id: base64url(randomBytes(6)),
    name: name.trim() || 'Calendar',
    color: FEED_COLORS[s.feeds.length % FEED_COLORS.length],
    url: encrypt(clean)
  })
  save()
  return status()
}

export function removeFeed(id: string): CalendarSourcesStatus {
  const s = load()
  s.feeds = s.feeds.filter((f) => f.id !== id)
  feedErrors.delete(id)
  save()
  return status()
}

async function feedEvents(from: string, to: string): Promise<CalEvent[]> {
  const s = load()
  const out: CalEvent[] = []
  await Promise.all(
    s.feeds.map(async (feed) => {
      try {
        const res = await net.fetch(decrypt(feed.url))
        if (!res.ok) throw new Error(`The calendar link answered ${res.status}.`)
        const text = await res.text()
        if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('That link didn’t return a calendar.')
        feedErrors.delete(feed.id)
        for (const e of parseIcs(text, new Date(from), new Date(to))) {
          out.push({
            id: `f:${feed.id}:${e.uid}:${e.start}`,
            sourceId: `feed:${feed.id}`,
            calendarName: feed.name,
            color: feed.color,
            title: e.title,
            allDay: e.allDay,
            start: e.start,
            end: e.end,
            location: e.location,
            url: e.url
          })
        }
      } catch (err) {
        feedErrors.set(feed.id, (err as Error).message)
        throw err
      }
    }).map((p) => p.catch(() => undefined))
  )
  return out
}

// ---------- fetching, with an offline cache ----------

interface Cache {
  [range: string]: { at: number; events: CalEvent[] }
}

function readCache(): Cache {
  try {
    return existsSync(file('calendar-cache.json')) ? JSON.parse(readFileSync(file('calendar-cache.json'), 'utf8')) : {}
  } catch {
    return {}
  }
}

export async function fetchEvents(from: string, to: string): Promise<{ events: CalEvent[]; errors: string[]; offline: boolean }> {
  const s = load()
  const errors: string[] = []
  let events: CalEvent[] = []
  let failed = false
  const enabledGoogle = s.refreshToken ? s.calendars.filter((c) => !s.disabled.includes(c.id)) : []
  if (s.refreshToken && (enabledGoogle.length || s.calendars.length === 0)) {
    try {
      events = events.concat(await googleEvents(from, to))
    } catch (err) {
      failed = true
      errors.push((err as Error).message)
    }
  } else if (googleError) {
    errors.push(googleError)
  }
  if (s.feeds.length) {
    events = events.concat(await feedEvents(from, to))
    for (const [id, msg] of feedErrors) errors.push(`${s.feeds.find((f) => f.id === id)?.name ?? 'Calendar link'}: ${msg}`)
    if (feedErrors.size) failed = true
  }

  const key = `${from}|${to}`
  const cache = readCache()
  if (failed && cache[key]) {
    // Offline or a source failed: show the last copy we had for this range.
    const fresh = new Set(events.map((e) => e.sourceId))
    return { events: [...events, ...cache[key].events.filter((e) => !fresh.has(e.sourceId))], errors, offline: true }
  }
  cache[key] = { at: Date.now(), events }
  // Keep the cache small: the 12 most recently fetched ranges.
  const keep = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, 12)
  try {
    writeFileSync(file('calendar-cache.json'), JSON.stringify(Object.fromEntries(keep)), 'utf8')
  } catch {
    // not fatal
  }
  return { events, errors, offline: false }
}
