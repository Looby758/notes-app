import { describe, expect, it } from 'vitest'
import type { EmailMessage } from '@shared/types'
import { emailToNote, freePath, guessEvent, noteName, quoted, replySubject } from './email'

const email = (over: Partial<EmailMessage> = {}): EmailMessage => ({
  id: 'm1',
  threadId: 't1',
  from: { name: 'Sam Lee', email: 'sam@example.com' },
  to: [{ name: 'me@example.com', email: 'me@example.com' }],
  cc: [],
  subject: 'Dinner plans',
  snippet: '',
  date: new Date(2026, 9, 26, 9, 30).toISOString(),
  unread: false,
  starred: false,
  hasAttachments: false,
  attachments: [],
  webUrl: 'https://mail.google.com/mail/#all/m1',
  ...over
})

describe('email helpers', () => {
  it('adds Re: once', () => {
    expect(replySubject('Plan')).toBe('Re: Plan')
    expect(replySubject('RE: Plan')).toBe('RE: Plan')
  })
  it('makes safe note names', () => {
    expect(noteName('Re: Fwd: Invoice #42 / October?')).toBe('Invoice 42 October')
    expect(noteName('   ')).toBe('Email')
  })
  it('finds a free path', () => {
    const taken = new Set(['Emails/Plan.md', 'Emails/Plan 2.md'])
    expect(freePath('Emails', 'Plan', (p) => taken.has(p))).toBe('Emails/Plan 3.md')
  })
  it('quotes the email in a reply', () => {
    expect(quoted(email(), 'Hi\n\nSee you')).toMatch(/Sam Lee <sam@example.com> wrote:\n> Hi\n>\n> See you$/)
  })
  it('turns an email into a note', () => {
    const note = emailToNote(email({ attachments: [{ name: 'menu.pdf', size: 1 }] }), 'Shall we eat at 7?')
    expect(note).toContain('from: Sam Lee <sam@example.com>')
    expect(note).toContain('received: 2026-10-26')
    expect(note).toContain('tags: [email]')
    expect(note).toContain('# Dinner plans\n\nShall we eat at 7?')
    expect(note).toContain('menu.pdf')
  })
})

describe('guessing an event', () => {
  const now = new Date(2026, 9, 27, 12)
  it('uses a date written in the subject', () => {
    const g = guessEvent(email({ subject: 'Dentist on 30 Oct at 2pm' }), '', now)
    expect(g.date).toEqual(new Date(2026, 9, 30))
    expect(g.start).toBe('14:00')
    expect(g.title).toBe('Dentist on 30 Oct at 2pm')
  })
  it('finds a date in the message, relative to when it arrived', () => {
    const g = guessEvent(email(), 'Hi!\nAre you free tomorrow at 7pm for dinner?', now)
    expect(g.date).toEqual(new Date(2026, 9, 27))
    expect(g.start).toBe('19:00')
  })
  it('falls back to the day it arrived', () => {
    const g = guessEvent(email(), 'No dates here, just at 5 maybe', now)
    expect(g.date).toEqual(new Date(2026, 9, 26))
    expect(g.start).toBeUndefined()
  })
})
