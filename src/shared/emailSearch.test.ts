import { describe, expect, it } from 'vitest'
import { emailDigest, gmailQuery, parseRelatedWords, rankEmails, searchTerms, stem, withoutQuotes, type CachedEmail } from './emailSearch'

const NOW = Date.parse('2026-11-01T12:00:00Z')

const mail = (id: string, subject: string, text: string, from = 'Someone <someone@example.com>', date = '2026-10-20T09:00:00Z'): CachedEmail => {
  const [, name, address] = /^(.*) <(.*)>$/.exec(from)!
  return { id, threadId: id, from: { name, email: address }, subject, snippet: text.slice(0, 80), date, unread: false, starred: false, hasAttachments: false, text }
}

describe('stem', () => {
  it('matches word forms', () => {
    expect(stem('booking')).toBe(stem('booked'))
    expect(stem('bookings')).toBe(stem('book'))
    expect(stem('flights')).toBe(stem('flight'))
  })
})

describe('searchTerms', () => {
  it('drops filler words', () => {
    expect(searchTerms('When is my flight to Rome?')).toEqual(['flight', 'rome'])
  })
})

describe('parseRelatedWords', () => {
  it('reads a list in any of the usual shapes', () => {
    expect(parseRelatedWords('<think>hmm</think>\n- booking\n2. boarding pass\nRyanair, easyJet\nHere are some words:')).toEqual(['booking', 'boarding pass', 'Ryanair', 'easyJet'])
  })
})

describe('gmailQuery', () => {
  it('searches for any of the words, quoting phrases', () => {
    expect(gmailQuery(['flight'], ['boarding pass', 'Ryanair'])).toBe('{flight "boarding pass" Ryanair}')
    expect(gmailQuery([], [])).toBe('')
  })
})

describe('rankEmails', () => {
  const emails = [
    mail('news', 'Weekly newsletter', 'Lots of news about gardening.', 'Garden <news@garden.example>', '2026-10-31T09:00:00Z'),
    mail('trip', 'Your booking is confirmed', 'Boarding pass attached. Departure 07:15 from Stansted to Rome.', 'Ryanair <noreply@ryanair.com>'),
    mail('dentist', 'Appointment reminder', 'Your dentist appointment is on Tuesday.')
  ]

  it('finds an email by meaning, through the related words, even without the question’s own words', () => {
    const ranked = rankEmails(emails, 'when is my flight?', ['booking', 'boarding pass', 'Ryanair', 'departure'], NOW)
    expect(ranked[0].email.id).toBe('trip')
    expect(ranked[0].score).toBeGreaterThan(1)
    expect(ranked.find((r) => r.email.id === 'news')!.score).toBe(0)
  })

  it('counts the question’s own words more than related ones', () => {
    const ranked = rankEmails(emails, 'dentist appointment', ['booking'], NOW)
    expect(ranked[0].email.id).toBe('dentist')
  })
})

describe('withoutQuotes', () => {
  it('drops the quoted history of a reply', () => {
    expect(withoutQuotes('See you at 6.\n\nOn Mon, 3 Nov 2026 at 10:00, Sam <sam@x.com> wrote:\n> Are we still on?')).toBe('See you at 6.')
  })
})

describe('emailDigest', () => {
  const emails = [
    mail('trip', 'Your booking is confirmed', 'Departure 07:15 from Stansted. ' + 'x'.repeat(5000), 'Ryanair <noreply@ryanair.com>'),
    mail('news', 'Weekly newsletter', 'Gardening news.')
  ]

  it('gives the best match in full and the rest as previews, within the budget', () => {
    const text = emailDigest(rankEmails(emails, 'flight', ['booking', 'departure'], NOW), 3000)
    expect(text).toContain('Best matches, in full:')
    expect(text).toContain('Departure 07:15 from Stansted')
    expect(text).toContain('Weekly newsletter')
    expect(text.length).toBeLessThanOrEqual(3000)
  })

  it('only gives previews when nothing matches', () => {
    const text = emailDigest(rankEmails(emails, 'pizza', [], NOW), 3000)
    expect(text).not.toContain('in full')
    expect(text).toContain('Your booking is confirmed')
  })
})
