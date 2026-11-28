/**
 * The SkyBlock market tracker (src/main/skyblockMarket.ts records, this file thinks).
 *
 * Orbit saves the Bazaar every few minutes, along with who the mayor is, fire sales and the
 * SkyBlock calendar, because Hypixel only ever says what's happening now. From that history it
 * learns what "normal" looks like for each item, notices when something moves in a way it
 * hasn't before, and turns that into a question for you on Home. Your answers, and the rules the
 * AI suggests, are checked against new data as it comes in.
 *
 * Everything here is plain functions with no Electron, so it's all tested.
 */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

// ---------- one look at the Bazaar ----------

/** For each item: instant-buy price, instant-sell price, and how many were bought and sold over the last week. */
export type MarketRow = [buy: number, sell: number, buyWeek: number, sellWeek: number]
export const FIELDS = 4

export interface BazaarSnap {
  at: number
  rows: Record<string, MarketRow>
}

/**
 * /v2/skyblock/bazaar. Hypixel's names are back to front for a person: its "buyPrice" is what you
 * pay to buy now (the cheapest sell offer), and "sellPrice" what you get selling now.
 */
export function parseBazaar(body: unknown, fallbackAt = Date.now()): BazaarSnap | null {
  if (!isObj(body) || !isObj(body.products)) return null
  const rows: Record<string, MarketRow> = {}
  for (const [id, p] of Object.entries(body.products)) {
    if (!isObj(p) || !isObj(p.quick_status)) continue
    const q = p.quick_status
    rows[id] = [num(q.buyPrice), num(q.sellPrice), num(q.buyMovingWeek), num(q.sellMovingWeek)]
  }
  if (!Object.keys(rows).length) return null
  return { at: num(body.lastUpdated) || fallbackAt, rows }
}

// ---------- a block of looks (a day's file) ----------

/**
 * Many looks at the Bazaar, stored compactly. `rows[i]` holds `ids.length * 4` numbers as they
 * were at `times[i]` (items that appeared later are shorter rows; missing values are NaN).
 */
export interface MarketBlock {
  ids: string[]
  times: number[]
  rows: Float32Array[]
}

export const emptyBlock = (): MarketBlock => ({ ids: [], times: [], rows: [] })

export function addSnap(block: MarketBlock, snap: BazaarSnap, index?: Map<string, number>): void {
  const at = index ?? new Map(block.ids.map((id, i) => [id, i]))
  for (const id of Object.keys(snap.rows)) {
    if (!at.has(id)) {
      at.set(id, block.ids.length)
      block.ids.push(id)
    }
  }
  const row = new Float32Array(block.ids.length * FIELDS).fill(NaN)
  for (const [id, r] of Object.entries(snap.rows)) row.set(r, at.get(id)! * FIELDS)
  block.times.push(snap.at)
  block.rows.push(row)
}

/** One item's values at row `i`, or null if it wasn't on the Bazaar then. */
export function rowOf(block: MarketBlock, i: number, idIndex: number): MarketRow | null {
  const row = block.rows[i]
  const o = idIndex * FIELDS
  if (!row || o + FIELDS > row.length || Number.isNaN(row[o])) return null
  return [row[o], row[o + 1], row[o + 2], row[o + 3]]
}

/** Bytes for a file: a little JSON header (ids and times), then every row padded to the same width. */
export function encodeBlock(block: MarketBlock): Uint8Array {
  const header = new TextEncoder().encode(JSON.stringify({ v: 1, ids: block.ids, times: block.times }))
  const width = block.ids.length * FIELDS
  const body = new Float32Array(width * block.times.length).fill(NaN)
  block.rows.forEach((r, i) => body.set(r.subarray(0, width), i * width))
  const out = new Uint8Array(4 + header.length + body.byteLength + ((4 - ((4 + header.length) % 4)) % 4))
  const pad = (4 - ((4 + header.length) % 4)) % 4
  new DataView(out.buffer).setUint32(0, header.length, true)
  out.set(header, 4)
  out.set(new Uint8Array(body.buffer), 4 + header.length + pad)
  return out
}

export function decodeBlock(bytes: Uint8Array): MarketBlock | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const len = view.getUint32(0, true)
    const head = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + len))) as { v: number; ids: string[]; times: number[] }
    if (head.v !== 1 || !Array.isArray(head.ids) || !Array.isArray(head.times)) return null
    const pad = (4 - ((4 + len) % 4)) % 4
    const start = 4 + len + pad
    const width = head.ids.length * FIELDS
    const copy = bytes.slice(start, start + width * head.times.length * 4)
    const body = new Float32Array(copy.buffer, 0, width * head.times.length)
    return { ids: head.ids, times: head.times, rows: head.times.map((_, i) => body.subarray(i * width, (i + 1) * width)) }
  } catch {
    return null
  }
}

/**
 * Hour averages from a block of 5-minute looks: prices are averaged, the weekly counts are the
 * last seen. Only whole hours before `before` (the hour still going is left for later).
 */
export function hourly(block: MarketBlock, before = Infinity): MarketBlock {
  const out = emptyBlock()
  out.ids = [...block.ids]
  const byHour = new Map<number, number[]>()
  block.times.forEach((t, i) => {
    const h = Math.floor(t / HOUR) * HOUR
    if (h + HOUR > before) return
    ;(byHour.get(h) ?? byHour.set(h, []).get(h)!).push(i)
  })
  for (const h of [...byHour.keys()].sort((a, b) => a - b)) {
    const rows = byHour.get(h)!
    const row = new Float32Array(out.ids.length * FIELDS).fill(NaN)
    for (let k = 0; k < out.ids.length; k++) {
      let buy = 0
      let sell = 0
      let n = 0
      let last: MarketRow | null = null
      for (const i of rows) {
        const r = rowOf(block, i, k)
        if (!r) continue
        buy += r[0]
        sell += r[1]
        n++
        last = r
      }
      if (n && last) row.set([buy / n, sell / n, last[2], last[3]], k * FIELDS)
    }
    out.times.push(h)
    out.rows.push(row)
  }
  return out
}

// ---------- one item over time ----------

export interface Point {
  at: number
  buy: number
  sell: number
  buyWeek: number
  sellWeek: number
}

/** The middle of the buy and sell price (or whichever there is). */
export const mid = (p: Pick<Point, 'buy' | 'sell'>): number => (p.buy > 0 && p.sell > 0 ? (p.buy + p.sell) / 2 : p.buy || p.sell)

/** One item's points from several blocks, oldest first, between `from` and `to`. */
export function seriesOf(blocks: readonly MarketBlock[], id: string, from = -Infinity, to = Infinity): Point[] {
  const out: Point[] = []
  for (const b of blocks) {
    const k = b.ids.indexOf(id)
    if (k === -1) continue
    b.times.forEach((t, i) => {
      if (t < from || t > to) return
      const r = rowOf(b, i, k)
      if (r) out.push({ at: t, buy: r[0], sell: r[1], buyWeek: r[2], sellWeek: r[3] })
    })
  }
  return out.sort((a, b) => a.at - b.at)
}

/** About `max` points spread evenly, for a chart or for the AI, keeping the first and last. */
export function thinPoints<T>(list: readonly T[], max: number): T[] {
  if (list.length <= max) return [...list]
  const out: T[] = []
  for (let i = 0; i < max; i++) out.push(list[Math.round((i * (list.length - 1)) / (max - 1))])
  return out
}

/** Coins traded a day, from the weekly counts. */
export const dailyCoins = (p: Point): number => (p.buyWeek * p.buy + p.sellWeek * p.sell) / 7

/** The point closest to `at`, if one is within `within`. `points` must be oldest first. */
export function pointNear(points: readonly Point[], at: number, within: number): Point | null {
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (points[m].at < at) lo = m + 1
    else hi = m
  }
  let best: Point | null = null
  for (const i of [lo - 1, lo]) {
    const p = points[i]
    if (p && Math.abs(p.at - at) <= within && (!best || Math.abs(p.at - at) < Math.abs(best.at - at))) best = p
  }
  return best
}

export const median = (xs: readonly number[]): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Middle and spread of a list, in a way one wild value can't drag about (median and MAD). */
export function robust(xs: readonly number[]): { mid: number; spread: number } {
  const m = median(xs)
  return { mid: m, spread: 1.4826 * median(xs.map((x) => Math.abs(x - m))) }
}

/** How alike two items' hourly moves are, from −1 to 1 (0 when there isn't enough overlap). */
export function correlation(a: readonly Point[], b: readonly Point[]): number {
  const moves = (ps: readonly Point[]): Map<number, number> => {
    const m = new Map<number, number>()
    for (let i = 1; i < ps.length; i++) {
      const x = mid(ps[i - 1])
      const y = mid(ps[i])
      if (x > 0 && y > 0 && ps[i].at - ps[i - 1].at <= 1.5 * HOUR) m.set(Math.round(ps[i].at / HOUR), Math.log(y / x))
    }
    return m
  }
  const ma = moves(a)
  const mb = moves(b)
  const xs: number[] = []
  const ys: number[] = []
  for (const [k, v] of ma) if (mb.has(k)) (xs.push(v), ys.push(mb.get(k)!))
  if (xs.length < 12) return 0
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length
  const my = ys.reduce((s, v) => s + v, 0) / ys.length
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0
}

// ---------- noticing odd moves ----------

export type AnomalyKind = 'up' | 'down' | 'spread' | 'volume'

export interface Anomaly {
  id: string
  kind: AnomalyKind
  /** How far outside normal, in "usual wobbles" (robust z-score). */
  z: number
  /** The change: price change for up/down, the gap between buy and sell for spread, extra trading for volume (0.4 = 40%). */
  change: number
  before: number
  now: number
  /** Coins traded a day, to rank big markets above tiny ones. */
  coins: number
  score: number
}

export const ANOMALY_SETTINGS = {
  /** Look back this far to learn what's normal. */
  baselineDays: 14,
  /** History an item needs (in hours, and in points) before Orbit will call anything about it odd. */
  minHours: 72,
  minPoints: 30,
  /** The window a move is measured over. */
  windowHours: 3,
  /** Items trading less than this many coins a day are too small to bother you about. */
  minCoins: 5_000_000,
  /** How many usual wobbles a move has to be before it counts. */
  minZ: 4,
  /** And at least this big a price change. */
  minPriceChange: 0.08
}

/**
 * Whether one item is doing something it doesn't normally do, from its hourly history (to learn
 * normal) and its latest few-minute points (what it's doing now).
 */
export function findAnomalies(id: string, hours: readonly Point[], recent: readonly Point[], now: number, s = ANOMALY_SETTINGS): Anomaly[] {
  const w = s.windowHours * HOUR
  const base = hours.filter((p) => p.at >= now - s.baselineDays * DAY && p.at < now - w)
  if (base.length < s.minPoints || base[base.length - 1].at - base[0].at < (s.minHours - s.windowHours) * HOUR) return []
  const latest = recent.filter((p) => p.at > now - 20 * MINUTE)
  if (!latest.length) return []
  const cur: Point = {
    at: now,
    buy: median(latest.map((p) => p.buy)),
    sell: median(latest.map((p) => p.sell)),
    buyWeek: latest[latest.length - 1].buyWeek,
    sellWeek: latest[latest.length - 1].sellWeek
  }
  const coins = dailyCoins(cur)
  if (coins < s.minCoins) return []
  const all = [...hours, ...recent].sort((a, b) => a.at - b.at)
  const out: Anomaly[] = []
  const weight = Math.log10(Math.max(10, coins))

  // Price: the move over the window against the item's usual moves over the same length of time.
  const ref = pointNear(all, now - w, 45 * MINUTE)
  if (ref && mid(ref) > 0 && mid(cur) > 0) {
    const moves: number[] = []
    for (let i = 0; i < base.length; i++) {
      const back = pointNear(base, base[i].at - w, 65 * MINUTE)
      if (back && back !== base[i] && mid(back) > 0 && mid(base[i]) > 0) moves.push(Math.log(mid(base[i]) / mid(back)))
    }
    if (moves.length >= s.minPoints * 0.7) {
      const { mid: m, spread } = robust(moves)
      const move = Math.log(mid(cur) / mid(ref))
      const z = (move - m) / Math.max(spread, 0.01)
      const change = mid(cur) / mid(ref) - 1
      if (Math.abs(z) >= s.minZ && Math.abs(change) >= s.minPriceChange)
        out.push({ id, kind: change > 0 ? 'up' : 'down', z, change, before: mid(ref), now: mid(cur), coins, score: Math.abs(z) * weight })
    }
  }

  // The gap between buy and sell opening wide.
  const gap = (p: Point): number | null => (p.buy > 0 && p.sell > 0 ? (p.buy - p.sell) / p.buy : null)
  const gaps = base.map(gap).filter((g): g is number => g !== null)
  const g = gap(cur)
  if (g !== null && gaps.length >= s.minPoints) {
    const { mid: m, spread } = robust(gaps)
    const z = (g - m) / Math.max(spread, 0.01)
    if (z >= s.minZ + 1 && g >= 0.15 && g >= 2 * m)
      out.push({ id, kind: 'spread', z, change: g, before: m, now: g, coins, score: z * weight * 0.8 })
  }

  // Trading surging: how much the weekly count grew over the window, against how it usually grows.
  const weekOf = (p: Point): number => p.buyWeek + p.sellWeek
  if (ref && weekOf(ref) > 0) {
    const growth: number[] = []
    for (let i = 0; i < base.length; i++) {
      const back = pointNear(base, base[i].at - w, 65 * MINUTE)
      if (back && back !== base[i] && weekOf(back) > 0) growth.push(weekOf(base[i]) / weekOf(back) - 1)
    }
    if (growth.length >= s.minPoints * 0.7) {
      const { mid: m, spread } = robust(growth)
      const r = weekOf(cur) / weekOf(ref) - 1
      const z = (r - m) / Math.max(spread, 0.005)
      if (z >= s.minZ + 1 && r >= 0.1) out.push({ id, kind: 'volume', z, change: r, before: weekOf(ref), now: weekOf(cur), coins, score: z * weight * 0.7 })
    }
  }
  return out
}

/** Whether an item is back to normal for this kind of move, so an open question can be filed away. */
export function settled(a: Anomaly | undefined, s = ANOMALY_SETTINGS): boolean {
  return !a || Math.abs(a.z) < s.minZ * 0.4
}

/**
 * Odd moves that go together (items that usually move together, moving the same way now) become
 * one group, biggest first. `together(a, b)` says whether two items usually move together.
 */
export function groupAnomalies(list: readonly Anomaly[], together: (a: Anomaly, b: Anomaly) => boolean): Anomaly[][] {
  const left = [...list].sort((a, b) => b.score - a.score)
  const groups: Anomaly[][] = []
  while (left.length) {
    const lead = left.shift()!
    const group = [lead]
    for (let i = 0; i < left.length; i++) {
      const o = left[i]
      if (o.kind === lead.kind && o.id !== lead.id && together(lead, o)) {
        group.push(o)
        left.splice(i--, 1)
      }
    }
    // The same item showing up twice (price and volume) stays one question too.
    for (let i = 0; i < left.length; i++) if (left[i].id === lead.id) (group.push(left[i]), left.splice(i--, 1))
    groups.push(group)
  }
  return groups
}

// ---------- what was going on ----------

export interface MayorTerm {
  name: string
  perks: string[]
  minister: string | null
  /** When Orbit first saw them as mayor. */
  start: number
  /** When Orbit last saw them (or when the next one started). */
  end: number
}

export interface MarketMark {
  at: number
  kind: 'firesale' | 'news' | 'gap'
  text: string
  end?: number
}

/** Adds what the election answer says to the list of mayors, starting a new term when the mayor changes. */
export function noteMayor(terms: readonly MayorTerm[], seen: { name: string; perks: string[]; minister: string | null } | null, at: number): MayorTerm[] {
  if (!seen?.name) return [...terms]
  const out = [...terms]
  const last = out[out.length - 1]
  if (last && last.name === seen.name) out[out.length - 1] = { ...last, end: at, perks: seen.perks.length ? seen.perks : last.perks, minister: seen.minister ?? last.minister }
  else out.push({ name: seen.name, perks: seen.perks, minister: seen.minister, start: at, end: at })
  return out
}

export const mayorAt = (terms: readonly MayorTerm[], at: number): MayorTerm | null =>
  [...terms].reverse().find((t) => t.start <= at && at <= t.end + 2 * HOUR) ?? null

/** "3 hours", "2 days". */
export function span(ms: number): string {
  const m = Math.max(1, Math.round(Math.abs(ms) / MINUTE))
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'}`
}

/** Things that happened shortly before `at` that might explain a move, in words. */
export function contextLines(at: number, terms: readonly MayorTerm[], events: readonly { name: string; start: number; end: number }[], marks: readonly MarketMark[], lookBack = 12 * HOUR): string[] {
  const out: string[] = []
  for (const t of terms) if (t.start > at - lookBack && t.start <= at && terms.indexOf(t) > 0) out.push(`${t.name} became mayor ${span(at - t.start)} earlier`)
  for (const e of events) {
    // "Jerry’s Workshop opens" reads as "opened" and "opens in", not "opens started".
    const opens = / opens$/.test(e.name)
    const name = e.name.replace(/ opens$/, '')
    if (e.start > at - lookBack && e.start <= at) out.push(`${name} ${opens ? 'opened' : 'started'} ${span(at - e.start)} earlier`)
    else if (e.end > at - lookBack && e.end <= at) out.push(`${name} ${opens ? 'closed' : 'ended'} ${span(at - e.end)} earlier`)
    else if (e.start > at && e.start - at < lookBack) out.push(`${name} ${opens ? 'opens' : 'starts'} in ${span(e.start - at)}`)
  }
  for (const m of marks) if (m.kind !== 'gap' && m.at > at - lookBack && m.at <= at) out.push(`${m.kind === 'firesale' ? 'Fire sale' : 'News'}: ${m.text}`)
  return shownContext(out, 4)
}

// ---------- questions for you ----------

export type QuestionStatus = 'open' | 'later' | 'explained' | 'unknown' | 'ignored' | 'settled'

export interface QuestionItem {
  id: string
  name: string
  change: number
  before: number
  now: number
}

export interface MarketQuestion {
  id: string
  at: number
  kind: AnomalyKind
  items: QuestionItem[]
  z: number
  score: number
  text: string
  /** What was going on (mayor, events, fire sales). */
  context: string[]
  /** What you said about the same thing before. */
  history: string[]
  status: QuestionStatus
  answer?: string
  answeredAt?: number
  /** For "look into it later": what's happened since. */
  followUp?: string
  /** The note it was saved to in your vault. */
  notePath?: string
}

export const QUESTION_SETTINGS = {
  /** New questions a day, at most. */
  perDay: 5,
  /** Don't ask about the same item and kind of move again this soon. */
  quietFor: 24 * HOUR,
  /** Open questions are filed away after this long whatever happens. */
  fileAfter: 7 * DAY,
  /** And once the item's back to normal, after at least this long. */
  settleAfter: 6 * HOUR
}

const pct = (x: number): string => `${Math.round(Math.abs(x) * 100)}%`

export function shortCoins(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}b`
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}m`
  if (a >= 1e4) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`
  if (a >= 100) return Math.round(n).toLocaleString('en-GB')
  return n.toFixed(a >= 10 ? 1 : 2)
}

/** The odd move in one or two sentences, without the context or the question. */
export function questionHeadline(kind: AnomalyKind, items: readonly QuestionItem[], windowHours = ANOMALY_SETTINGS.windowHours): string {
  const lead = items[0]
  const name = cleanName(lead.name)
  const others = items.length - 1
  const hours = `${windowHours} hour${windowHours === 1 ? '' : 's'}`
  const move =
    kind === 'spread'
      ? `${name}’s buy and sell prices are ${pct(lead.now)} apart (usually ${pct(lead.before)}).`
      : kind === 'volume'
        ? `${name} is being traded far more than usual: ${pct(lead.change)} more in ${hours}.`
        : `${name}’s price is ${kind === 'up' ? 'up' : 'down'} ${pct(lead.change)} in ${hours} (${shortCoins(lead.before)} → ${shortCoins(lead.now)} coins).`
  const along = !others
    ? ''
    : kind === 'spread'
      ? ` ${others} other item${others === 1 ? '' : 's'} did the same.`
      : ` ${others} item${others === 1 ? '' : 's'} that usually move${others === 1 ? 's' : ''} with it did the same.`
  return move + along
}

/** The whole question in one paragraph (for notes and the AI). */
export function questionText(kind: AnomalyKind, items: readonly QuestionItem[], context: readonly string[], windowHours = ANOMALY_SETTINGS.windowHours): string {
  const why = context.length ? ` Around then: ${context.join('; ')}.` : ' Nothing on the SkyBlock calendar explains it.'
  return `${questionHeadline(kind, items, windowHours)}${why} Any idea why?`
}

/** The few context lines worth showing: mayors and events first, then at most one fire sale and one news item. */
export function shownContext(lines: readonly string[], max = 3): string[] {
  const rank = (l: string): number => (l.startsWith('News:') ? 2 : l.startsWith('Fire sale:') ? 1 : 0)
  const out: string[] = []
  let sales = 0
  let news = 0
  for (const l of [...lines].sort((a, b) => rank(a) - rank(b))) {
    if (rank(l) === 1 && sales++) continue
    if (rank(l) === 2 && news++) continue
    out.push(l)
  }
  return out.slice(0, max)
}

/** Item names without the odd symbols some carry (gemstone icons and the like, which show as boxes). */
export const cleanName = (name: string): string =>
  name
    .replace(/[\uE000-\uF8FF\uFFFD\u2E00-\u2E7F]/g, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim() || name

/** What you said the last few times the same item did the same thing. */
export function pastAnswers(questions: readonly MarketQuestion[], itemId: string, kind: AnomalyKind): string[] {
  const day = (t: number): string => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return questions
    .filter((q) => q.items.some((i) => i.id === itemId) && q.kind === kind && (q.status === 'explained' || q.status === 'unknown'))
    .slice(-3)
    .map((q) => (q.status === 'explained' ? `On ${day(q.at)} you said: “${q.answer}”` : `This also happened on ${day(q.at)}, and you weren’t sure why then.`))
}

export interface Mute {
  item: string
  kind: AnomalyKind
}

/** Which groups become new questions: not muted, not asked about lately, not over today's limit. */
export function pickNew(groups: readonly Anomaly[][], questions: readonly MarketQuestion[], mutes: readonly Mute[], now: number, s = QUESTION_SETTINGS): Anomaly[][] {
  const today = new Date(now).toDateString()
  let room = s.perDay - questions.filter((q) => new Date(q.at).toDateString() === today).length
  const out: Anomaly[][] = []
  for (const g of groups) {
    if (room <= 0) break
    const lead = g[0]
    if (mutes.some((m) => m.item === lead.id && m.kind === lead.kind)) continue
    const recent = questions.some((q) => q.kind === lead.kind && q.items.some((i) => i.id === lead.id) && (now - q.at < s.quietFor || q.status === 'open' || q.status === 'later'))
    if (recent) continue
    out.push(g)
    room--
  }
  return out
}

// ---------- rules ----------

export type RuleTrigger = { type: 'mayor'; name: string } | { type: 'event'; kind: string }

export interface RuleCheck {
  /** When the trigger happened. */
  at: number
  change: number
  hit: boolean
}

export interface MarketRule {
  id: string
  item: string
  itemName: string
  trigger: RuleTrigger
  /** Measured from this many hours after the trigger (negative: before it)… */
  fromHours: number
  /** …to this many. */
  toHours: number
  expect: 'up' | 'down'
  /** The size of move expected (0.15 = 15%). It counts as right at half this or more, in the right direction. */
  size: number
  why: string
  source: 'ai' | 'you'
  createdAt: number
  checks: RuleCheck[]
  off?: boolean
}

export const triggerName = (t: RuleTrigger, kinds: readonly { id: string; name: string }[] = []): string =>
  t.type === 'mayor' ? `${t.name} becomes mayor` : `${kinds.find((k) => k.id === t.kind)?.name ?? t.kind} starts`

export function ruleText(r: MarketRule, kinds: readonly { id: string; name: string }[] = []): string {
  const t = triggerName(r.trigger, kinds)
  const move = `${r.itemName} goes ${r.expect} ${pct(r.size)}`
  const at = (h: number): string => (h < 0 ? `${span(-h * HOUR)} before` : `${span(h * HOUR)} after`)
  if (r.fromHours === 0) return `${move} in the ${span(r.toHours * HOUR)} after ${t}`
  if (r.toHours === 0) return `${move} in the ${span(-r.fromHours * HOUR)} before ${t}`
  return `${move} between ${at(r.fromHours)} and ${at(r.toHours)} ${t}`
}

/** The event kind of a calendar event id ("spooky-412" → "spooky", "zoo-summer-412" → "zoo"). */
export const eventKind = (id: string): string => id.replace(/-\d+$/, '').replace(/-(summer|winter)$/, '')

/**
 * Every time a rule's trigger happened (and its window has finished), what the item actually did.
 * `price(at)` is the item's price near a time, or null when Orbit wasn't recording.
 */
export function checkRule(rule: MarketRule, starts: readonly number[], price: (at: number) => number | null, now: number): RuleCheck[] {
  const out: RuleCheck[] = []
  for (const at of starts) {
    const a = at + rule.fromHours * HOUR
    const b = at + rule.toHours * HOUR
    if (b > now) continue
    const pa = price(a)
    const pb = price(b)
    if (!pa || !pb) continue
    const change = pb / pa - 1
    out.push({ at, change, hit: (rule.expect === 'up' ? change : -change) >= rule.size / 2 })
  }
  return out
}

/** When a rule's trigger happened, from the mayors seen and the calendar. */
export function triggerStarts(t: RuleTrigger, terms: readonly MayorTerm[], events: readonly { id: string; start: number }[]): number[] {
  if (t.type === 'mayor') return terms.filter((m, i) => i > 0 && m.name.toLowerCase() === t.name.toLowerCase()).map((m) => m.start)
  return events.filter((e) => eventKind(e.id) === t.kind).map((e) => e.start)
}

export function ruleScore(r: MarketRule): { hits: number; total: number; label: string } {
  const hits = r.checks.filter((c) => c.hit).length
  const total = r.checks.length
  return { hits, total, label: total ? `Right ${hits} of ${total} time${total === 1 ? '' : 's'}` : 'Not tested yet' }
}

/** Cleans a rule the AI suggested, or null if it doesn't make sense. */
export function cleanRule(v: unknown, names: (id: string) => string, now: number): MarketRule | null {
  if (!isObj(v)) return null
  const item = typeof v.item === 'string' ? v.item.trim().toUpperCase() : ''
  const t = isObj(v.trigger) ? v.trigger : null
  const trigger: RuleTrigger | null =
    t?.type === 'mayor' && typeof t.name === 'string' && t.name.trim()
      ? { type: 'mayor', name: t.name.trim() }
      : t?.type === 'event' && typeof t.kind === 'string' && t.kind.trim()
        ? { type: 'event', kind: t.kind.trim() }
        : null
  const from = num(v.fromHours)
  const to = num(v.toHours)
  const size = Math.abs(num(v.size))
  if (!item || !trigger || to <= from || to - from > 24 * 14 || !(size > 0 && size < 10) || (v.expect !== 'up' && v.expect !== 'down')) return null
  return {
    id: `r${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    item,
    itemName: names(item),
    trigger,
    fromHours: from,
    toHours: to,
    expect: v.expect,
    size,
    why: typeof v.why === 'string' ? v.why.trim().slice(0, 400) : '',
    source: v.source === 'you' ? 'you' : 'ai',
    createdAt: now,
    checks: []
  }
}

// ---------- notes in your vault ----------

export const VAULT_FOLDER = 'SkyBlock Market'

const safeName = (s: string): string => s.replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)

export const dateKey = (t: number): string => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const KIND_WORDS: Record<AnomalyKind, string> = { up: 'price jump', down: 'price drop', spread: 'price gap', volume: 'trading surge' }

export function answerNotePath(q: MarketQuestion): string {
  return `${VAULT_FOLDER}/Explanations/${dateKey(q.at)} ${safeName(q.items[0]?.name ?? 'Item')} ${KIND_WORDS[q.kind]}.md`
}

/** The note an answered question becomes. */
export function answerNote(q: MarketQuestion): string {
  const lines = [
    '---',
    `skyblock-market: ${q.status === 'explained' ? 'explanation' : 'unexplained'}`,
    `items: [${q.items.map((i) => i.id).join(', ')}]`,
    `kind: ${q.kind}`,
    `seen: ${new Date(q.at).toISOString()}`,
    '---',
    '',
    `# ${q.items[0]?.name ?? 'Item'} ${KIND_WORDS[q.kind]}`,
    '',
    q.text.replace(/ Any idea why\?$/, ''),
    ''
  ]
  if (q.items.length > 1) {
    lines.push('Items that moved together:', '')
    for (const i of q.items) lines.push(`- ${i.name}: ${q.kind === 'spread' ? `${pct(i.now)} apart` : `${i.change >= 0 ? '+' : '−'}${pct(i.change)}`}`)
    lines.push('')
  }
  if (q.context.length) lines.push('What was going on:', '', ...q.context.map((c) => `- ${c}`), '')
  lines.push('## Why', '', q.status === 'explained' ? (q.answer ?? '') : 'Not sure yet. Orbit is watching for this to happen again.', '')
  return lines.join('\n')
}

export interface DayMover {
  name: string
  change: number
  now: number
}

/** A short note for each day: mayor, events, the biggest movers and the questions. */
export function dayNote(day: number, mayor: MayorTerm | null, events: readonly { name: string }[], up: readonly DayMover[], down: readonly DayMover[], questions: readonly MarketQuestion[], gaps: number): string {
  const lines = [`---`, `skyblock-market: day`, `---`, '', `# SkyBlock market, ${new Date(day).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`, '']
  lines.push(`**Mayor:** ${mayor ? `${mayor.name}${mayor.minister ? ` (minister ${mayor.minister})` : ''}` : 'not known'}`)
  if (events.length) lines.push(`**Events:** ${events.map((e) => e.name).join(', ')}`)
  if (gaps) lines.push(`**Not recorded:** ${span(gaps)} (Orbit or the PC was off)`)
  lines.push('')
  const list = (title: string, ms: readonly DayMover[]): void => {
    if (!ms.length) return
    lines.push(`## ${title}`, '')
    for (const m of ms) lines.push(`- ${m.name}: ${m.change >= 0 ? '+' : '−'}${pct(m.change)} (now ${shortCoins(m.now)})`)
    lines.push('')
  }
  list('Biggest rises', up)
  list('Biggest falls', down)
  if (questions.length) {
    lines.push('## Questions Orbit asked', '')
    for (const q of questions) lines.push(`- ${q.text.replace(/ Any idea why\?$/, '')}${q.answer ? ` **You said:** ${q.answer}` : ''}`)
    lines.push('')
  }
  return lines.join('\n')
}

/** Price changes between two blocks' worth of points, for "biggest movers". */
export function movers(start: ReadonlyMap<string, Point>, end: ReadonlyMap<string, Point>, names: (id: string) => string, minCoins = ANOMALY_SETTINGS.minCoins, limit = 8): { up: (DayMover & { id: string })[]; down: (DayMover & { id: string })[] } {
  const all: (DayMover & { id: string })[] = []
  for (const [id, b] of end) {
    const a = start.get(id)
    if (!a || mid(a) <= 0 || mid(b) <= 0 || dailyCoins(b) < minCoins) continue
    all.push({ id, name: names(id), change: mid(b) / mid(a) - 1, now: mid(b) })
  }
  all.sort((x, y) => y.change - x.change)
  return { up: all.filter((m) => m.change > 0).slice(0, limit), down: all.filter((m) => m.change < 0).reverse().slice(0, limit) }
}

/** "ENCHANTED_GOLD_BLOCK" → "Enchanted Gold Block", for items Orbit has no name for. */
export const bazaarName = (id: string): string =>
  id
    .replace(/^ENCHANTMENT_(ULTIMATE_)?/, '')
    .split(/[_:]/)
    .filter(Boolean)
    .map((w) => (/^\d+$/.test(w) ? w : w[0] + w.slice(1).toLowerCase()))
    .join(' ') + (id.startsWith('ENCHANTMENT_') ? ' (book)' : '')

/** Coflnet's Bazaar history (sky.coflnet.com/api/bazaar/<id>/history/week): about every 2 hours, as a head start. */
export function parseCoflHistory(body: unknown): Point[] {
  if (!Array.isArray(body)) return []
  const out: Point[] = []
  for (const p of body) {
    if (!isObj(p) || typeof p.timestamp !== 'string') continue
    const at = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(p.timestamp) ? p.timestamp : `${p.timestamp}Z`)
    if (!Number.isFinite(at)) continue
    out.push({ at, buy: num(p.buy), sell: num(p.sell), buyWeek: num(p.buyMovingWeek), sellWeek: num(p.sellMovingWeek) })
  }
  return out.sort((a, b) => a.at - b.at)
}

// ---------- what the page is shown ----------

export interface MarketState {
  /** Whether Orbit is saving the Bazaar. */
  recording: boolean
  startedAt: number | null
  lastAt: number | null
  /** How many items the Bazaar has, and how many trade enough to be watched for odd moves. */
  items: number
  watched: number
  /** Days with something recorded. */
  days: number
  /** Disk used, in MB. */
  mb: number
  /** Still learning what normal looks like (less than 3 days of history). */
  learning: boolean
  /** Hours of history Orbit has, counting the head start. */
  historyHours: number
  problem: string
  mayor: MayorTerm | null
  mayors: MayorTerm[]
  questions: MarketQuestion[]
  rules: MarketRule[]
  mutes: Mute[]
  headStart: { done: number; total: number; running: boolean; at: number | null }
  /** Whether Claude can be asked (needs your Anthropic key). */
  aiReady: boolean
  eventKinds: { id: string; name: string }[]
}

export interface MarketChart {
  id: string
  name: string
  points: Point[]
  mayors: MayorTerm[]
  events: { name: string; start: number; end: number }[]
  marks: MarketMark[]
  questions: MarketQuestion[]
  /** Some of the history came from Coflnet's head start. */
  imported: boolean
}

export interface MarketItemHit {
  id: string
  name: string
  price: number
  coins: number
}

export type MarketAnswer = { action: 'explain'; text: string } | { action: 'later' } | { action: 'unknown' } | { action: 'ignore' } | { action: 'reopen' }
