import { describe, expect, it } from 'vitest'
import { buildMessage, cleanRecipients, decodeWords, parseAddress, parseAddresses, readBodies } from './mail'

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64url')
const decode = (raw: string): string => Buffer.from(raw, 'base64url').toString('utf8')

describe('addresses', () => {
  it('reads names and addresses', () => {
    expect(parseAddress('"Sam Lee" <sam@example.com>')).toEqual({ name: 'Sam Lee', email: 'sam@example.com' })
    expect(parseAddress('sam@example.com')).toEqual({ name: 'sam@example.com', email: 'sam@example.com' })
    expect(parseAddress('<sam@example.com>')).toEqual({ name: 'sam@example.com', email: 'sam@example.com' })
  })
  it('splits lists without breaking quoted names', () => {
    expect(parseAddresses('"Lee, Sam" <s@x.com>, jo@y.com').map((a) => a.email)).toEqual(['s@x.com', 'jo@y.com'])
  })
  it('decodes encoded header words', () => {
    expect(decodeWords('=?UTF-8?B?Q2Fmw6k=?= tonight')).toBe('Café tonight')
    expect(decodeWords('=?ISO-8859-1?Q?Caf=E9_tonight?=')).toBe('Café tonight')
  })
  it('rejects addresses that are not addresses', () => {
    expect(cleanRecipients('a@b.com; Sam <s@x.org>', 'To')).toBe('a@b.com, Sam <s@x.org>')
    expect(() => cleanRecipients('sam', 'To')).toThrow(/doesn’t look like an email address/)
  })
})

describe('reading a message', () => {
  it('finds the text, the HTML and the attachments', () => {
    const bodies = readBodies({
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }], body: { data: b64('Hi there 👋') } },
            { mimeType: 'text/html', body: { data: b64('<p>Hi there</p>') } }
          ]
        },
        { mimeType: 'application/pdf', filename: 'invoice.pdf', body: { attachmentId: 'a1', size: 2048 } }
      ]
    })
    expect(bodies.text).toBe('Hi there 👋')
    expect(bodies.html).toBe('<p>Hi there</p>')
    expect(bodies.attachments).toEqual([{ name: 'invoice.pdf', size: 2048 }])
  })
  it('reads other character sets', () => {
    const data = Buffer.from([0x43, 0x61, 0x66, 0xe9]).toString('base64url')
    expect(readBodies({ mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=iso-8859-1' }], body: { data } }).text).toBe('Café')
  })
})

describe('building a message', () => {
  it('writes the headers and the text', () => {
    const raw = decode(buildMessage({ to: 'sam@example.com', subject: 'Lunch ☕', body: 'See you\nat 1', date: new Date(Date.UTC(2026, 9, 28, 9)) }))
    const [head, body] = raw.split('\r\n\r\n')
    expect(head).toContain('To: sam@example.com')
    expect(head).toContain(`Subject: =?UTF-8?B?${Buffer.from('Lunch ☕').toString('base64')}?=`)
    expect(head).toContain('Content-Type: text/plain; charset=UTF-8')
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe('See you\r\nat 1')
  })
  it('keeps replies in the same conversation', () => {
    const raw = decode(buildMessage({ to: 'sam@example.com', subject: 'Re: Plan', body: 'Yes', inReplyTo: '<b@x>', references: '<a@x>' }))
    expect(raw).toContain('In-Reply-To: <b@x>')
    expect(raw).toContain('References: <a@x> <b@x>')
  })
  it('does not let a subject add headers', () => {
    const raw = decode(buildMessage({ to: 'sam@example.com', subject: 'Hi\r\nBcc: evil@x.com', body: '' }))
    expect(raw).not.toMatch(/^Bcc:/m)
  })
  it('needs someone to send to', () => {
    expect(() => buildMessage({ to: ' ', subject: 'x', body: '' })).toThrow(/who the email is to/)
  })
})
