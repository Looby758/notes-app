import { net } from 'electron'
import type { EmailFolder, EmailList, EmailMessage, EmailSummary, GoogleAuthStatus, OutgoingEmail } from '@shared/types'
import * as google from './calendarSources'
import { buildMessage, header, parseAddress, parseAddresses, readBodies, type GmailPart } from './mail'

/**
 * Gmail, for the Email page. It uses the same Google sign-in as the calendar (calendarSources.ts),
 * with Gmail access added the first time you connect from the Email page. Emails are fetched from
 * Google when you look at them and aren't stored on this computer.
 */

// Overridable for tests, which point it at a local fake server.
const API_URL = process.env.NOTES_GMAIL_API_URL ?? 'https://gmail.googleapis.com/gmail/v1/users/me'
const PAGE_SIZE = 30

/** The page's setup card looks for this wording. */
export const API_OFF = 'The Gmail API is turned off in your Google project.'

export const status = (): GoogleAuthStatus => google.authStatus()

export async function connect(): Promise<GoogleAuthStatus> {
  await google.connect(true)
  return status()
}

async function gmail(path: string, init: { method?: string; params?: Record<string, string | string[]>; body?: unknown } = {}): Promise<Record<string, unknown>> {
  if (!google.hasGmail()) throw new Error('Orbit doesn’t have access to your email yet. Connect Gmail first.')
  const token = await google.getAccessToken()
  if (!token) throw new Error(google.authStatus().error ?? 'Not connected to Google.')
  const url = new URL(API_URL + path)
  for (const [key, value] of Object.entries(init.params ?? {})) {
    for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, v)
  }
  const res = await net.fetch(url.toString(), {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const err = (body.error ?? {}) as { message?: string; status?: string; details?: { reason?: string }[] }
    const text = `${err.message ?? ''} ${JSON.stringify(err.details ?? [])}`
    if (/SERVICE_DISABLED|accessNotConfigured|has not been used in project/i.test(text)) {
      throw new Error(`${API_OFF} Turn it on, wait a minute, then try again.`)
    }
    if (res.status === 403 && /insufficient|scope/i.test(text)) throw new Error('Orbit doesn’t have permission to do that in Gmail. Connect Gmail again.')
    if (res.status === 404) throw new Error('That email isn’t there any more.')
    if (res.status === 401) throw new Error('Your Google sign-in has ended. Connect Gmail again.')
    throw new Error(`Gmail said ${res.status}${err.message ? `: ${err.message}` : ''}`)
  }
  return body
}

interface GmailMessage {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: GmailPart
}

/** Gmail's previews come HTML-escaped ("&#39;"). */
const unescape = (s: string): string =>
  s.replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (whole, code: string) => {
    const c = code.toLowerCase()
    if (c.startsWith('#x')) return String.fromCodePoint(parseInt(c.slice(2), 16))
    if (c.startsWith('#')) return String.fromCodePoint(Number(c.slice(1)))
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[c] ?? whole
  })

function summary(m: GmailMessage): EmailSummary {
  const labels = m.labelIds ?? []
  const hasAttachments = (part: GmailPart | undefined): boolean => !!part && (!!(part.filename && part.body?.attachmentId) || (part.parts ?? []).some(hasAttachments))
  const date = Number(m.internalDate)
  return {
    id: m.id,
    threadId: m.threadId,
    from: parseAddress(header(m.payload, 'From') || '(unknown sender)'),
    subject: header(m.payload, 'Subject').trim() || '(No subject)',
    snippet: unescape(m.snippet ?? ''),
    date: new Date(Number.isFinite(date) && date > 0 ? date : Date.parse(header(m.payload, 'Date')) || Date.now()).toISOString(),
    unread: labels.includes('UNREAD'),
    starred: labels.includes('STARRED'),
    hasAttachments: hasAttachments(m.payload) || /multipart\/mixed/i.test(m.payload?.mimeType ?? '')
  }
}

const FOLDERS: Record<EmailFolder, { labelIds?: string[]; q?: string }> = {
  inbox: { labelIds: ['INBOX'] },
  unread: { labelIds: ['INBOX', 'UNREAD'] },
  starred: { labelIds: ['STARRED'] },
  sent: { labelIds: ['SENT'] },
  all: {}
}

export async function list(folder: EmailFolder, query: string, next?: string): Promise<EmailList> {
  const f = FOLDERS[folder] ?? FOLDERS.inbox
  // Searching looks everywhere, like Gmail's own search box.
  const q = query.trim()
  const page = await gmail('/messages', {
    params: {
      maxResults: String(PAGE_SIZE),
      ...(q ? { q } : f.labelIds ? { labelIds: f.labelIds } : {}),
      ...(next ? { pageToken: next } : {})
    }
  })
  const ids = ((page.messages as { id: string }[] | undefined) ?? []).map((m) => m.id)
  const emails: EmailSummary[] = []
  // A few at a time, so a page loads quickly without hammering Google.
  for (let i = 0; i < ids.length; i += 10) {
    const batch = await Promise.all(
      ids.slice(i, i + 10).map((id) =>
        gmail(`/messages/${encodeURIComponent(id)}`, { params: { format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] } }).catch(() => null)
      )
    )
    for (const m of batch) if (m) emails.push(summary(m as unknown as GmailMessage))
  }
  return { emails, next: page.nextPageToken as string | undefined }
}

export async function get(id: string): Promise<EmailMessage> {
  const m = (await gmail(`/messages/${encodeURIComponent(id)}`, { params: { format: 'full' } })) as unknown as GmailMessage
  const payload = m.payload ?? {}
  const bodies = readBodies(payload)
  const replyTo = header(payload, 'Reply-To')
  const me = google.authStatus().email
  return {
    ...summary(m),
    to: parseAddresses(header(payload, 'To')),
    cc: parseAddresses(header(payload, 'Cc')),
    replyTo: replyTo ? parseAddress(replyTo) : undefined,
    messageId: header(payload, 'Message-ID') || header(payload, 'Message-Id') || undefined,
    references: header(payload, 'References') || undefined,
    text: bodies.text,
    html: bodies.html,
    attachments: bodies.attachments,
    webUrl: `https://mail.google.com/mail/${me ? `?authuser=${encodeURIComponent(me)}` : ''}#all/${encodeURIComponent(m.id)}`
  }
}

export async function send(email: OutgoingEmail): Promise<void> {
  const raw = buildMessage({
    to: email.to,
    cc: email.cc,
    subject: email.subject,
    body: email.body,
    inReplyTo: email.replyTo?.messageId,
    references: email.replyTo?.references
  })
  await gmail('/messages/send', { method: 'POST', body: { raw, ...(email.replyTo ? { threadId: email.replyTo.threadId } : {}) } })
}

const modify = (id: string, add: string[], remove: string[]): Promise<unknown> =>
  gmail(`/messages/${encodeURIComponent(id)}/modify`, { method: 'POST', body: { addLabelIds: add, removeLabelIds: remove } })

export async function markRead(id: string, read: boolean): Promise<void> {
  await modify(id, read ? [] : ['UNREAD'], read ? ['UNREAD'] : [])
}

export async function star(id: string, starred: boolean): Promise<void> {
  await modify(id, starred ? ['STARRED'] : [], starred ? [] : ['STARRED'])
}

export async function archive(id: string): Promise<void> {
  await modify(id, [], ['INBOX'])
}

export async function trash(id: string): Promise<void> {
  await gmail(`/messages/${encodeURIComponent(id)}/trash`, { method: 'POST' })
}
