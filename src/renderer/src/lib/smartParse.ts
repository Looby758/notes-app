import { findWhen, dayKeyOf } from './when'
import { calculate } from './calc'
import { DEFAULT_CATEGORIES, formatPounds, guessCategory, OTHER, OTHER_INCOME, type MoneyCategory } from './money'

/**
 * Smart commands: plain sentences typed into Ctrl+K or the summon bar, turned into actions.
 *   "spent 12 on food"               → a £12 Eating out entry in Money
 *   "remind me friday 5pm call Dave" → a reminder on Friday at 17:00
 *   "convert this to mp3"            → the file converter, set to MP3
 *   "play Drake"                     → music
 * Everything here runs on your computer. Only if nothing matches does Ctrl+K offer to ask the
 * AI, and it asks you first (lib/smartCommands.ts).
 */

export type SmartAction =
  | { kind: 'money'; income: boolean; amount: number; category: string; note: string; date: string }
  | { kind: 'event'; date: string; time?: string; title: string; remind: boolean }
  | { kind: 'note'; title: string }
  | { kind: 'jot'; text: string }
  | { kind: 'convert'; format: string }
  | { kind: 'play'; query: string }
  | { kind: 'music'; action: 'toggle' | 'next' | 'previous' }
  | { kind: 'open'; feature: string }
  | { kind: 'search'; query: string }
  | { kind: 'web'; query: string }
  | { kind: 'calc'; expression: string; result: string }
  | { kind: 'goal'; name: string; amount: number }
  | { kind: 'ask'; question: string }

export interface FeatureName {
  id: string
  name: string
  keywords?: string
}

export interface ParseContext {
  categories?: MoneyCategory[]
  features?: FeatureName[]
  now?: Date
}

export const CONVERT_FORMATS = ['pdf', 'docx', 'html', 'md', 'txt', 'jpg', 'png', 'webp', 'mp3', 'wav'] as const

const FORMAT_WORDS: Record<string, string> = { word: 'docx', doc: 'docx', jpeg: 'jpg', markdown: 'md', text: 'txt', 'web page': 'html', webpage: 'html' }

// Everyday words for the built-in categories, so "spent 12 on food" lands in Eating out.
const CATEGORY_WORDS: [RegExp, string][] = [
  [/\b(food|lunch|dinner|breakfast|takeaway|take away|coffee|snack|snacks|meal|drinks?|pub|chippy|maccies|mcdonalds|kfc|pizza|nandos)\b/, 'eating-out'],
  [/\b(groceries|grocery|food shop|big shop|tesco|aldi|lidl|asda|sainsburys?|supermarket)\b/, 'groceries'],
  [/\b(bus|train|taxi|uber|petrol|fuel|diesel|parking|travel|tube|flight|fares?)\b/, 'transport'],
  [/\b(rent|bills?|electric|electricity|gas|water|council tax|phone bill|wifi|internet|insurance)\b/, 'bills'],
  [/\b(clothes|shoes|trainers|hoodie|amazon|shopping|gift|present|makeup)\b/, 'shopping'],
  [/\b(netflix|spotify|subscription|disney|game pass|ps plus|prime|gym)\b/, 'subscriptions'],
  [/\b(cinema|movie|game|games|steam|concert|tickets?|bowling|night out|fun)\b/, 'fun'],
  [/\b(furniture|ikea|diy|home|garden|cleaning)\b/, 'home'],
  [/\b(pay|paid|salary|wages|payday|work)\b/, 'pay']
]

/** Money: "12", "£12.50", "12.5", "£1,200". In pence. */
function pence(text: string): number | null {
  const m = /^£?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(text.trim())
  if (!m) return null
  const pounds = Number(m[1].replace(/,/g, ''))
  const p = m[2] ? Number(m[2].padEnd(2, '0')) : 0
  const total = pounds * 100 + p
  return total > 0 ? total : null
}

const AMOUNT = '£?\\s*(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{1,2}))?(?:\\s*(?:quid|pounds?|gbp))?'

/** The category for a money sentence: one of yours by name, a word we know, then the statement guesser. */
export function categoryFor(what: string, income: boolean, categories: MoneyCategory[] = DEFAULT_CATEGORIES): string {
  const text = what.toLowerCase()
  const usable = categories.filter((c) => !!c.income === income)
  const named = usable.find((c) => new RegExp(`\\b${c.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text))
  if (named) return named.id
  for (const [re, id] of CATEGORY_WORDS) if (re.test(text) && usable.some((c) => c.id === id)) return id
  const guess = guessCategory({ date: '', amount: income ? 1 : -1, description: what }, {}, categories)
  return guess || (income ? OTHER_INCOME : OTHER)
}

const tidy = (s: string): string => s.replace(/\s+/g, ' ').replace(/^[\s,.:;-]+|[\s,.:;!?-]+$/g, '').trim()

function parseMoney(text: string, ctx: ParseContext, now: Date): SmartAction | null {
  const categories = ctx.categories ?? DEFAULT_CATEGORIES
  // Take a date out first: "spent 12 on food yesterday".
  let rest = text
  let date = dayKeyOf(now)
  if (/\byesterday\b/i.test(rest)) {
    date = dayKeyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
    rest = rest.replace(/\byesterday\b/i, ' ')
  } else {
    const when = findWhen(rest, now)
    if (when?.hasDate) {
      date = dayKeyOf(when.date)
      rest = when.title
    }
  }
  rest = tidy(rest)

  const out: [RegExp, boolean][] = [
    // spent 12 on food / paid £30 for petrol / spend 4.50 at costa
    [new RegExp(`^(?:i\\s+)?(?:spent|spend|paid|pay|payed|bought\\s+.+?\\s+for|lost)\\s+${AMOUNT}(?:\\s+(?:on|for|at|in|to)\\s+(.+))?$`, 'i'), false],
    // £12 on food / 12 quid on lunch
    [new RegExp(`^${AMOUNT}\\s+(?:on|for|at)\\s+(.+)$`, 'i'), false],
    // got paid 500 / earned £20 from mowing / received 50 from mum
    [new RegExp(`^(?:i\\s+)?(?:got\\s+paid|earned|received|got|made|sold\\s+.+?\\s+for)\\s+${AMOUNT}(?:\\s+(?:from|for|by|at)\\s+(.+))?$`, 'i'), true]
  ]
  for (const [re, income] of out) {
    const m = re.exec(rest)
    if (!m) continue
    const amount = pence(`${m[1]}${m[2] ? `.${m[2]}` : ''}`)
    if (!amount) continue
    // "bought a hoodie for 30": the thing is in the verb part.
    const bought = /^(?:i\s+)?bought\s+(.+?)\s+for\s/i.exec(rest)?.[1] ?? /^(?:i\s+)?sold\s+(.+?)\s+for\s/i.exec(rest)?.[1]
    const what = tidy(m[3] ?? bought ?? (/got\s+paid/i.test(rest) ? 'Pay' : ''))
    const category = categoryFor(what || (income ? 'pay' : ''), income, categories)
    return { kind: 'money', income, amount, category, note: what ? what[0].toUpperCase() + what.slice(1) : '', date }
  }
  return null
}

function parseEvent(text: string, now: Date): SmartAction | null {
  const m =
    /^(?:remind\s+me\s+(?:to\s+)?|reminder\s*:?\s+|set\s+a\s+reminder\s+(?:to\s+|for\s+)?)(.+)$/i.exec(text) ??
    /^(?:add\s+)?(?:an?\s+)?(?:event|appointment)\s*:?\s+(.+)$/i.exec(text) ??
    /^(?:put|add)\s+(.+?)\s+(?:on|in|to)\s+(?:the|my)\s+calendar$/i.exec(text)
  if (!m) return null
  const remind = /^(?:remind|reminder|set a reminder)/i.test(text)
  const when = findWhen(m[1], now)
  if (!when) {
    // "remind me to call Dave" with no time: a reminder needs one, so it's a to-do in today's note.
    return remind ? { kind: 'jot', text: `- [ ] ${tidy(m[1].replace(/^to\s+/i, ''))}` } : null
  }
  const title = tidy(when.title.replace(/^to\s+/i, '')) || 'Reminder'
  return { kind: 'event', date: dayKeyOf(when.date), time: when.time, title, remind: remind && !!when.time }
}

function findFeature(name: string, features: FeatureName[]): string | null {
  const q = name.toLowerCase().trim().replace(/^(?:the|my)\s+/, '').replace(/\s+(?:page|tab|app)$/, '')
  if (!q) return null
  const exact = features.find((f) => f.name.toLowerCase() === q || f.id === q)
  if (exact) return exact.id
  const starts = features.find((f) => f.name.toLowerCase().startsWith(q))
  if (starts) return starts.id
  const word = features.find((f) => `${f.name} ${f.keywords ?? ''}`.toLowerCase().split(/\s+/).includes(q))
  return word?.id ?? null
}

/** The action a sentence asks for, or null if none of the built-in patterns fit. */
export function parseSmart(input: string, ctx: ParseContext = {}): SmartAction | null {
  const text = tidy(input)
  if (!text) return null
  const now = ctx.now ?? new Date()
  let m: RegExpExecArray | null

  // A sum: "12*4", "= 20% of 85", "£12.50 / 3".
  const sum = text.replace(/^=\s*/, '')
  if (/\d/.test(sum) && !/^(?:spent|spend|paid|pay|got|earned|received|save|saving|remind|play|convert)\b/i.test(sum)) {
    const result = calculate(sum)
    if (result) return { kind: 'calc', expression: sum, result }
  }

  const money = parseMoney(text, ctx, now)
  if (money) return money

  // Savings goal: "save 1200 for a new pc", "saving £300 for holiday by June".
  if ((m = new RegExp(`^(?:save|saving|savings goal)\\s+${AMOUNT}\\s+(?:for|towards)\\s+(.+)$`, 'i').exec(text))) {
    const amount = pence(`${m[1]}${m[2] ? `.${m[2]}` : ''}`)
    if (amount) return { kind: 'goal', name: tidy(m[3]).replace(/^(?:a|an|the|my)\s+/i, '').replace(/^./, (c) => c.toUpperCase()), amount }
  }

  const event = parseEvent(text, now)
  if (event) return event

  if ((m = /^convert\s+(?:this|it|that|these|the\s+file|a\s+file|files?)?\s*(?:in)?to\s+(?:an?\s+)?(.+?)(?:\s+files?)?$/i.exec(text))) {
    const word = m[1].toLowerCase().replace(/^\./, '')
    const format = FORMAT_WORDS[word] ?? word
    if ((CONVERT_FORMATS as readonly string[]).includes(format)) return { kind: 'convert', format }
  }

  if (/^(?:pause|stop)(?:\s+(?:the\s+)?music)?$|^(?:resume|unpause)(?:\s+(?:the\s+)?music)?$/i.test(text)) return { kind: 'music', action: 'toggle' }
  if (/^(?:next|skip)(?:\s+(?:song|track))?$/i.test(text)) return { kind: 'music', action: 'next' }
  if (/^(?:previous|prev|last|go back a)(?:\s+(?:song|track))?$/i.test(text)) return { kind: 'music', action: 'previous' }
  if ((m = /^(?:play|put on|listen to)\s+(.+?)(?:\s+on\s+spotify)?$/i.exec(text))) return { kind: 'play', query: tidy(m[1]) }

  if ((m = /^(?:new|make|create|start)\s+(?:a\s+)?note(?:\s+(?:called|named|about|for))?\s*:?\s*(.*)$/i.exec(text))) return { kind: 'note', title: tidy(m[1]) }
  if ((m = /^(?:jot|note|capture|remember|write down|add to inbox)\s*:?\s+(.+)$/i.exec(text))) return { kind: 'jot', text: tidy(m[1]) }

  if ((m = /^(?:google|search\s+(?:the\s+)?(?:web|google|internet)\s+for|look\s+up\s+online)\s+(.+)$/i.exec(text))) return { kind: 'web', query: tidy(m[1]) }
  if ((m = /^(?:search|find|search\s+(?:my\s+)?notes\s+for|search\s+for)\s+(.+)$/i.exec(text))) return { kind: 'search', query: tidy(m[1]) }

  if ((m = /^(?:open|go\s+to|show(?:\s+me)?|launch|start)\s+(.+)$/i.exec(text)) && ctx.features) {
    const feature = findFeature(m[1], ctx.features)
    if (feature) return { kind: 'open', feature }
  }

  // A question: Ask everything.
  if (/\?$/.test(text) || /^(?:what|when|where|who|how|why|which|did|do|does|have|has|is|are|am|can|should)\b.+\s.+/i.test(text)) {
    if (/^(?:what|when|where|who|how|which|did|have|has|is|are)\b/i.test(text) || /\?$/.test(text)) return { kind: 'ask', question: text }
  }
  return null
}

/** What an action will do, in a few words, shown before you press Enter. */
export function describeSmart(a: SmartAction, ctx: ParseContext = {}): string {
  const categories = ctx.categories ?? DEFAULT_CATEGORIES
  const day = (key: string): string => {
    const now = ctx.now ?? new Date()
    const today = dayKeyOf(now)
    const tomorrow = dayKeyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
    const yesterday = dayKeyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
    if (key === today) return 'today'
    if (key === tomorrow) return 'tomorrow'
    if (key === yesterday) return 'yesterday'
    const [y, mo, d] = key.split('-').map(Number)
    return new Date(y, mo - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  }
  switch (a.kind) {
    case 'money': {
      const cat = categories.find((c) => c.id === a.category)?.name ?? 'Other'
      return a.income
        ? `Add ${formatPounds(a.amount)} coming in to ${cat}${a.note && a.note !== cat ? ` (${a.note})` : ''}, ${day(a.date)}`
        : `Add ${formatPounds(a.amount)} spent on ${cat}${a.note && a.note.toLowerCase() !== cat.toLowerCase() ? ` (${a.note})` : ''}, ${day(a.date)}`
    }
    case 'event':
      return `${a.remind ? 'Remind you' : 'Add to the calendar'}: “${a.title}”, ${day(a.date)}${a.time ? ` at ${a.time}` : ''}`
    case 'note':
      return a.title ? `New note called “${a.title}”` : 'New note'
    case 'jot':
      return `Jot “${a.text.replace(/^- \[ \] /, '')}” in today's note`
    case 'convert':
      return `Convert files to ${a.format.toUpperCase()}`
    case 'play':
      return `Play “${a.query}”`
    case 'music':
      return a.action === 'toggle' ? 'Play / pause the music' : a.action === 'next' ? 'Next song' : 'Previous song'
    case 'open':
      return `Open ${ctx.features?.find((f) => f.id === a.feature)?.name ?? a.feature}`
    case 'search':
      return `Search your notes for “${a.query}”`
    case 'web':
      return `Search the web for “${a.query}”`
    case 'calc':
      return `${a.expression} = ${a.result} (Enter copies it)`
    case 'goal':
      return `New savings goal: ${a.name}, ${formatPounds(a.amount, true)}`
    case 'ask':
      return `Ask everything: “${a.question}”`
  }
}

/** Checks an action that came from outside (the AI's answer), so only sensible actions run. */
export function validSmart(v: unknown, ctx: ParseContext = {}): SmartAction | null {
  if (!v || typeof v !== 'object') return null
  const a = v as Record<string, unknown>
  const str = (k: string, max = 300): string | null => (typeof a[k] === 'string' && (a[k] as string).trim() && (a[k] as string).length <= max ? (a[k] as string).trim() : null)
  const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  const categories = ctx.categories ?? DEFAULT_CATEGORIES
  switch (a.kind) {
    case 'money': {
      const amount = typeof a.amount === 'number' ? Math.round(a.amount) : NaN
      const income = a.income === true
      if (!(amount > 0 && amount < 1e10) || !isDay(a.date)) return null
      const category = categories.some((c) => c.id === a.category && !!c.income === income) ? (a.category as string) : income ? OTHER_INCOME : OTHER
      return { kind: 'money', income, amount, category, note: str('note', 120) ?? '', date: a.date }
    }
    case 'event': {
      const title = str('title', 200)
      if (!title || !isDay(a.date)) return null
      const time = typeof a.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(a.time) ? a.time : undefined
      return { kind: 'event', date: a.date, time, title, remind: a.remind === true && !!time }
    }
    case 'note':
      return { kind: 'note', title: str('title', 120) ?? '' }
    case 'jot': {
      const text = str('text', 2000)
      return text ? { kind: 'jot', text } : null
    }
    case 'convert':
      return typeof a.format === 'string' && (CONVERT_FORMATS as readonly string[]).includes(a.format) ? { kind: 'convert', format: a.format } : null
    case 'play': {
      const query = str('query', 200)
      return query ? { kind: 'play', query } : null
    }
    case 'music':
      return a.action === 'toggle' || a.action === 'next' || a.action === 'previous' ? { kind: 'music', action: a.action } : null
    case 'open':
      return typeof a.feature === 'string' && (!ctx.features || ctx.features.some((f) => f.id === a.feature)) ? { kind: 'open', feature: a.feature } : null
    case 'search':
    case 'web': {
      const query = str('query', 300)
      return query ? { kind: a.kind, query } : null
    }
    case 'goal': {
      const name = str('name', 80)
      const amount = typeof a.amount === 'number' ? Math.round(a.amount) : NaN
      return name && amount > 0 && amount < 1e10 ? { kind: 'goal', name, amount } : null
    }
    case 'ask': {
      const question = str('question', 1000)
      return question ? { kind: 'ask', question } : null
    }
    default:
      return null
  }
}
