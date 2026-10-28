import type { EmailAddress } from '@shared/types'

/**
 * Reading and writing the email format itself (no network here, so it can be tested): addresses
 * like `"Sam Lee" <sam@example.com>`, the parts of a Gmail message, and building a message to send.
 */

/** A message part as the Gmail API returns it. */
export interface GmailPart {
  mimeType?: string
  filename?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string; size?: number; attachmentId?: string }
  parts?: GmailPart[]
}

export const header = (part: GmailPart | undefined, name: string): string =>
  part?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''

/** `=?UTF-8?B?…?=` and `=?ISO-8859-1?Q?…?=` words in a header, as plain text. */
export function decodeWords(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[bq]\?[^?]*\?=)\s+(?==\?)/gi, '$1')
    .replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (whole, charset: string, kind: string, text: string) => {
      try {
        const bytes =
          kind.toLowerCase() === 'b'
            ? Buffer.from(text, 'base64')
            : Buffer.from(
                text.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))),
                'latin1'
              )
        return decodeBytes(bytes, charset)
      } catch {
        return whole
      }
    })
}

export function decodeBytes(bytes: Uint8Array, charset = 'utf-8'): string {
  try {
    return new TextDecoder(charset.trim().toLowerCase() || 'utf-8').decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

/** Splits "a@x.com, "Lee, Sam" <s@y.com>" at the commas between addresses. */
function splitAddresses(value: string): string[] {
  const out: string[] = []
  let current = ''
  let quoted = false
  let angle = false
  for (const ch of value) {
    if (ch === '"') quoted = !quoted
    else if (ch === '<' && !quoted) angle = true
    else if (ch === '>' && !quoted) angle = false
    if ((ch === ',' || ch === ';') && !quoted && !angle) {
      if (current.trim()) out.push(current.trim())
      current = ''
    } else current += ch
  }
  if (current.trim()) out.push(current.trim())
  return out
}

export function parseAddress(value: string): EmailAddress {
  const text = decodeWords(value).trim()
  const m = /^(.*?)\s*<([^>]+)>\s*$/.exec(text)
  if (m) {
    const name = m[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1')
    return { name: name || m[2].trim(), email: m[2].trim() }
  }
  return { name: text, email: text }
}

export const parseAddresses = (value: string): EmailAddress[] => splitAddresses(value).map(parseAddress)

export interface Bodies {
  text?: string
  html?: string
  attachments: { name: string; size: number }[]
}

/** The readable text and HTML of a message, and the names of its attached files. */
export function readBodies(payload: GmailPart): Bodies {
  const out: Bodies = { attachments: [] }
  const walk = (part: GmailPart): void => {
    const type = (part.mimeType ?? '').toLowerCase()
    const disposition = header(part, 'Content-Disposition').toLowerCase()
    if (part.filename && (part.body?.attachmentId || disposition.startsWith('attachment'))) {
      out.attachments.push({ name: part.filename, size: part.body?.size ?? 0 })
      return
    }
    if (part.parts?.length) {
      part.parts.forEach(walk)
      return
    }
    if (!part.body?.data || (type !== 'text/plain' && type !== 'text/html')) return
    const charset = /charset="?([^";\s]+)/i.exec(header(part, 'Content-Type'))?.[1]
    const text = decodeBytes(Buffer.from(part.body.data, 'base64url'), charset)
    if (type === 'text/plain' && out.text === undefined) out.text = text
    if (type === 'text/html' && out.html === undefined) out.html = text
  }
  walk(payload)
  return out
}

/** Header text can't contain line breaks (they'd start new headers). */
const oneLine = (s: string): string => s.replace(/[\r\n]+/g, ' ').trim()

/** A header value that may contain non-ASCII text, e.g. a subject with "é" or an emoji. */
const encodeWord = (s: string): string => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`)

/** Checks and tidies a To/Cc line typed by you; throws if an address doesn't look right. */
export function cleanRecipients(value: string, field: string): string {
  const list = splitAddresses(oneLine(value))
  for (const one of list) {
    const { email } = parseAddress(one)
    if (!/^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(email)) throw new Error(`“${one}” in ${field} doesn’t look like an email address.`)
  }
  return list.join(', ')
}

export interface Outgoing {
  from?: string
  to: string
  cc?: string
  subject: string
  body: string
  inReplyTo?: string
  references?: string
  date?: Date
}

/** A plain-text email, ready for Gmail's "send" (base64url of the whole message). */
export function buildMessage(m: Outgoing): string {
  const to = cleanRecipients(m.to, 'To')
  if (!to) throw new Error('Add who the email is to.')
  const cc = m.cc?.trim() ? cleanRecipients(m.cc, 'Cc') : ''
  const lines = [
    ...(m.from ? [`From: ${oneLine(m.from)}`] : []),
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${encodeWord(oneLine(m.subject))}`,
    `Date: ${(m.date ?? new Date()).toUTCString().replace('GMT', '+0000')}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${oneLine(m.inReplyTo)}`] : []),
    ...(m.inReplyTo || m.references ? [`References: ${oneLine([m.references, m.inReplyTo].filter(Boolean).join(' '))}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    (Buffer.from(m.body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n')
  ]
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url')
}
