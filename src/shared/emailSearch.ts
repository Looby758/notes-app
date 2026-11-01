import type { EmailSummary } from './types'

/**
 * Picking the emails that answer a question in Ask everything, and turning them into text for the
 * AI. Plain data handling (no Electron) so it can be tested; src/main/emailAsk.ts fetches and keeps
 * the emails.
 *
 * Matching by meaning: besides the words in the question, the AI suggests related words the email
 * itself would likely use ("flight" → booking, boarding pass, Ryanair), and words are compared by
 * their stem, so "booked", "booking" and "bookings" all match.
 */

/** An email kept for Ask everything: the list details plus its plain text. */
export interface CachedEmail extends EmailSummary {
  to?: string
  text?: string
}

const WORD = /[\p{L}\p{N}£$€]{2,}/gu
const STOP = new Set(
  'the and for what when did last how much many this that with from have has was were are you your my any about there get got can could would should will its it is to of in on at by an or be do does me we our us they them their which who whom whose where why been being into out up down off over under again then once here all both each few more most other some such no nor not only own same so than too very just also email emails mail inbox message messages sent send someone anyone tell show find said say says'.split(' ')
)

/** A rough stem, so word forms match each other. */
export function stem(word: string): string {
  let w = word.toLowerCase()
  if (w.length <= 3) return w
  for (const end of ['ments', 'ment', 'ings', 'ing', 'tion', 'tions', 'ers', 'ies', 'ied', 'ed', 'es', 'er', 'ly', 's']) {
    if (w.endsWith(end) && w.length - end.length >= 3) {
      w = w.slice(0, -end.length)
      break
    }
  }
  // "booking" → "book", "stopped" → "stopp" → "stop"
  if (/([b-df-hj-np-tv-z])\1$/.test(w) && w.length > 3) w = w.slice(0, -1)
  return w
}

/** The words in a question worth searching for, as typed. */
export function keywords(text: string): string[] {
  return [...new Set((text.toLowerCase().match(WORD) ?? []).filter((w) => !STOP.has(w) && !/^\d{1,2}$/.test(w)))]
}

/** The same, as stems. */
export function searchTerms(text: string): string[] {
  return [...new Set(keywords(text).map(stem))]
}

/** The AI's list of related words (one per line, or commas) cleaned up. */
export function parseRelatedWords(reply: string, max = 15): string[] {
  const out: string[] = []
  for (const raw of reply.replace(/<think>[\s\S]*?<\/think>/gi, '').split(/[\n,;]+/)) {
    const w = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/["'`]/g, '').trim()
    if (!w || w.length > 40 || /[:]$/.test(w) || w.split(/\s+/).length > 3) continue
    if (!out.some((x) => x.toLowerCase() === w.toLowerCase())) out.push(w)
    if (out.length >= max) break
  }
  return out
}

/** Gmail search text for the question's words and the related ones: any of them, anywhere. */
export function gmailQuery(words: string[], related: string[]): string {
  const parts = [...words, ...related]
    .map((w) => w.trim())
    .filter((w) => w.length >= 3)
    .slice(0, 16)
    .map((w) => (/\s/.test(w) ? `"${w.replace(/"/g, '')}"` : w.replace(/[^\p{L}\p{N}£$€.@-]/gu, '')))
    .filter(Boolean)
  return parts.length ? `{${parts.join(' ')}}` : ''
}

export interface RankedEmail {
  email: CachedEmail
  score: number
}

const DAY = 86400000

/**
 * Scores each email against the question. A word from the question counts more than a related
 * word, and a match in the subject or sender more than one in the text. Newer emails win ties.
 */
export function rankEmails(emails: CachedEmail[], question: string, related: string[], now = Date.now()): RankedEmail[] {
  const own = searchTerms(question)
  const extra = searchTerms(related.join(' ')).filter((t) => !own.includes(t))
  const phrases = related.filter((r) => /\s/.test(r)).map((r) => r.toLowerCase())
  return emails
    .map((email) => {
      const fields = {
        subject: new Set(searchTerms(email.subject)),
        from: new Set(searchTerms(`${email.from.name} ${email.from.email.replace(/[@.]/g, ' ')}`)),
        body: new Set(searchTerms(`${email.snippet} ${email.text ?? ''}`.slice(0, 20000)))
      }
      const hit = (t: string): number => (fields.subject.has(t) ? 3 : 0) + (fields.from.has(t) ? 3 : 0) + (fields.body.has(t) ? 1 : 0)
      let score = 0
      for (const t of own) score += hit(t) * 2
      for (const t of extra) score += hit(t)
      const all = `${email.subject}\n${email.text ?? email.snippet}`.toLowerCase()
      for (const p of phrases) if (all.includes(p)) score += 2
      const age = Math.max(0, (now - Date.parse(email.date)) / DAY)
      // Up to one point for being recent, fading over about two months.
      const fresh = score > 0 ? 1 / (1 + age / 60) : 0
      return { email, score: score + fresh }
    })
    .sort((a, b) => b.score - a.score || b.email.date.localeCompare(a.email.date))
}

const one = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Long reply chains: keeps the new part of an email, not the quoted history under it. */
export function withoutQuotes(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  for (const l of lines) {
    if (/^On .{6,120}wrote:\s*$/.test(l.trim()) || /^-{2,}\s*Original Message\s*-{2,}/i.test(l.trim()) || (/^From: .+/.test(l.trim()) && out.length > 3)) break
    if (/^\s*>/.test(l)) continue
    out.push(l)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

const header = (e: CachedEmail): string =>
  [e.date.slice(0, 10), `from ${e.from.name ? `${e.from.name} <${e.from.email}>` : e.from.email}`, e.to ? `to ${e.to}` : '', `subject: ${e.subject}`, e.unread ? 'unread' : '']
    .filter(Boolean)
    .join(' | ')

/**
 * The emails as text, within `budget` characters: the full text of the best few matches first,
 * then one-line previews of the rest (matching ones, then the newest).
 */
export function emailDigest(ranked: RankedEmail[], budget: number, fullCount = 3): string {
  const seen = new Set<string>()
  const list = ranked.filter((r) => !seen.has(r.email.id) && seen.add(r.email.id))
  const best = list.filter((r) => r.score >= 1 && r.email.text).slice(0, fullCount)
  let out = ''
  if (best.length) {
    // Full emails get up to two-thirds of the room, shared between them.
    const each = Math.floor((budget * 0.66) / best.length)
    out += 'Best matches, in full:\n'
    for (const r of best) {
      const body = withoutQuotes(r.email.text!)
      const room = Math.max(200, each - header(r.email).length - 20)
      out += `\n[${header(r.email)}]\n${body.length > room ? body.slice(0, room) + '…' : body}\n`
    }
    out += '\nOther emails (date | from | subject | preview):\n'
  }
  const rest = list.filter((r) => !best.includes(r))
  const matching = rest.filter((r) => r.score >= 1)
  const others = rest.filter((r) => r.score < 1).sort((a, b) => b.email.date.localeCompare(a.email.date))
  for (const r of [...matching, ...others]) {
    const e = r.email
    const row = [e.date.slice(0, 10), e.from.name ? `${e.from.name} <${e.from.email}>` : e.from.email, e.subject, one(e.snippet).slice(0, 200), e.unread ? 'unread' : '']
      .filter(Boolean)
      .join(' | ')
    if (out.length + row.length + 1 > budget) break
    out += row + '\n'
  }
  return out.trim()
}
