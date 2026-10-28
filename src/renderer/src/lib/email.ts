import type { EmailAddress, EmailMessage } from '@shared/types'
import { yamlValue } from './properties'
import { findWhen } from './when'

/** Helpers for the Email page: replies, saving an email as a note, and spotting a date for the calendar. */

export const EMAIL_FOLDER = 'Emails'

export const showAddress = (a: EmailAddress): string => (a.name && a.name !== a.email ? `${a.name} <${a.email}>` : a.email)
export const shortName = (a: EmailAddress): string => (a.name && a.name !== a.email ? a.name : a.email.split('@')[0])

export const replySubject = (subject: string): string => (/^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`)
export const forwardSubject = (subject: string): string => (/^(fwd?|fw):/i.test(subject.trim()) ? subject.trim() : `Fwd: ${subject.trim()}`)

/** Collapses the extra blank lines and spaces that emails are full of. */
export const tidyText = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/** "On 28 Oct 2026, 09:14, Sam Lee wrote:" followed by the email, each line starting with "> ". */
export function quoted(email: EmailMessage, text: string): string {
  const when = new Date(email.date).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const body = tidyText(text)
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n')
  return `\n\nOn ${when}, ${showAddress(email.from)} wrote:\n${body}`
}

/** A file name for the note: the subject without the characters file names can't have. */
export function noteName(subject: string): string {
  const clean = subject
    .replace(/^((re|fwd?|fw|aw|sv):\s*)+/i, '')
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '')
  return clean || 'Email'
}

/** The first free path for a note, adding " 2", " 3"… if the name is taken. */
export function freePath(folder: string, name: string, taken: (path: string) => boolean): string {
  const base = folder ? `${folder}/${name}` : name
  if (!taken(`${base}.md`)) return `${base}.md`
  for (let n = 2; ; n++) if (!taken(`${base} ${n}.md`)) return `${base} ${n}.md`
}

const day = (iso: string): string => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The note an email becomes: who sent it and when as properties, then the message. */
export function emailToNote(email: EmailMessage, body: string): string {
  const props = [
    `from: ${yamlValue(showAddress(email.from))}`,
    ...(email.to.length ? [`to: ${yamlValue(email.to.map(showAddress).join(', '))}`] : []),
    `received: ${day(email.date)}`,
    `email: ${yamlValue(email.webUrl)}`,
    'tags: [email]'
  ]
  const files = email.attachments.length ? `\n\n**Attachments** (in Gmail): ${email.attachments.map((a) => a.name).join(', ')}` : ''
  return `---\n${props.join('\n')}\n---\n\n# ${email.subject}\n\n${tidyText(body) || '*(This email has no text.)*'}${files}\n`
}

export interface EventGuess {
  date: Date
  start?: string
  title: string
}

/**
 * A calendar event from an email: the subject as its title, and the first date or time written in
 * the subject or the start of the message. With no date found, it's the day the email arrived.
 */
export function guessEvent(email: EmailMessage, text: string, now = new Date()): EventGuess {
  const title = noteName(email.subject) === 'Email' ? `Email from ${shortName(email.from)}` : email.subject.replace(/^((re|fwd?|fw):\s*)+/i, '').trim()
  const received = new Date(email.date)
  const from = received > now ? now : received
  // The subject first, then each sentence near the start of the message. Only a written date counts
  // in the message: a lone "at 5" in a long email is too often something else.
  const found = [email.subject, ...text.slice(0, 3000).split(/\n+|(?<=[.!?])\s+/)]
    .map((line, i) => ({ when: findWhen(line, from), subject: i === 0 }))
    .filter((f) => f.when && (f.subject || f.when.hasDate))
    .map((f) => f.when!)
  // "Dinner on Friday?" with "Friday at 7pm" in the message: the one with a time wins.
  const when = found.find((w) => w.hasDate && w.time) ?? found.find((w) => w.hasDate) ?? found[0]
  if (!when) return { date: new Date(received.getFullYear(), received.getMonth(), received.getDate()), title }
  return { date: when.date, start: when.time, title }
}
