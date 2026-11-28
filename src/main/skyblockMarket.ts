import { app, BrowserWindow, ipcMain, net } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { gunzipSync, gzipSync } from 'zlib'
import {
  addSnap,
  answerNote,
  answerNotePath,
  ANOMALY_SETTINGS,
  bazaarName,
  checkRule,
  cleanRule,
  contextLines,
  correlation,
  DAY,
  dailyCoins,
  dateKey,
  dayNote,
  decodeBlock,
  emptyBlock,
  encodeBlock,
  findAnomalies,
  groupAnomalies,
  HOUR,
  hourly,
  mayorAt,
  mid,
  MINUTE,
  movers,
  noteMayor,
  parseBazaar,
  parseCoflHistory,
  pastAnswers,
  pickNew,
  pointNear,
  QUESTION_SETTINGS,
  questionText,
  rowOf,
  ruleScore,
  ruleText,
  settled,
  shortCoins,
  span,
  thinPoints,
  triggerStarts,
  VAULT_FOLDER,
  type Anomaly,
  type MarketAnswer,
  type MarketBlock,
  type MarketChart,
  type MarketItemHit,
  type MarketMark,
  type MarketQuestion,
  type MarketRule,
  type MarketState,
  type MayorTerm,
  type Mute,
  type Point
} from '@shared/skyblockMarket'
import { mayorOf, YEARLY_EVENT_KINDS, yearlyEventsBetween } from '@shared/skyblockMore'
import { neuId } from '@shared/skyblockGoals'
import { addonOn, onAddonsChanged } from './addonGate'
import { askWithTools, claudeReady, type AiTool } from './ai'
import { itemNameOf } from './skyblockGoals'
import { skyblockAccount } from './skyblock'
import { logError } from './log'
import type { Vault } from './vault'

/**
 * The SkyBlock market tracker. Hypixel only says what the Bazaar is doing right now, so once you
 * press Start, Orbit saves every item's prices and trading every 5 minutes (while Orbit is open,
 * even with its window closed), plus the mayor, fire sales and news, into the settings folder:
 *
 *   skyblock-market/5m/<day>.bin.gz   every 5-minute look, kept for two weeks (about 8 MB a day)
 *   skyblock-market/1h/<day>.bin.gz   hour averages, kept for good (about 0.6 MB a day)
 *   skyblock-market/imported.json.gz  the week of history Coflnet gives as a head start
 *   skyblock-market/state.json        mayors, questions, your answers, rules
 *
 * After each look it checks every busy item against what's normal for it, and odd moves become
 * questions on Home. Your answers go into your vault as notes (SkyBlock Market/…), along with a
 * note for each day. No AI is used for any of that; Claude is only asked when you ask it something
 * or press "Find rules".
 */

const HYPIXEL = process.env.NOTES_HYPIXEL_URL ?? 'https://api.hypixel.net'
const COFL = process.env.NOTES_COFL_URL ?? 'https://sky.coflnet.com'
const TICK = Number(process.env.NOTES_MARKET_TICK_MS) || 5 * MINUTE
const EXTRAS_EVERY = 30 * MINUTE
const NEWS_EVERY = 3 * HOUR
const KEEP_FINE_DAYS = 14
const HEAD_START_ITEMS = 300
const HEAD_START_GAP = Number(process.env.NOTES_MARKET_COFL_GAP_MS) || 2500
const FLUSH_EVERY = 15 * MINUTE

interface Stored {
  version: 1
  recording: boolean
  startedAt: number | null
  lastAt: number | null
  terms: MayorTerm[]
  marks: MarketMark[]
  questions: MarketQuestion[]
  mutes: Mute[]
  rules: MarketRule[]
  /** The last day a day note was written for. */
  dayNoted: string
  headStartAt: number | null
  seenFiresales: string[]
  seenNews: string[]
  extrasAt: number
  newsAt: number
}

const fresh = (): Stored => ({
  version: 1,
  recording: false,
  startedAt: null,
  lastAt: null,
  terms: [],
  marks: [],
  questions: [],
  mutes: [],
  rules: [],
  dayNoted: '',
  headStartAt: null,
  seenFiresales: [],
  seenNews: [],
  extrasAt: 0,
  newsAt: 0
})

const dir = (...parts: string[]): string => join(app.getPath('userData'), 'skyblock-market', ...parts)

let stored: Stored | null = null
let problem = ''
let getVault: () => Vault | null = () => null
let timer: ReturnType<typeof setInterval> | null = null
let busy = false
let lastFlush = 0
let headStart = { done: 0, total: 0, running: false }
/** 5-minute looks by day, for the days loaded (today and the last couple). */
const fine = new Map<string, MarketBlock>()
/** Hour averages by day, loaded as needed. */
const hours = new Map<string, MarketBlock>()
const dirty = new Set<string>()
let imported: Record<string, Point[]> | null = null
const indexes = new WeakMap<MarketBlock, Map<string, number>>()

function load(): Stored {
  if (stored) return stored
  try {
    const s = JSON.parse(readFileSync(dir('state.json'), 'utf8')) as Partial<Stored>
    stored = { ...fresh(), ...s, version: 1 }
  } catch {
    stored = fresh()
  }
  return stored
}

function save(): void {
  try {
    mkdirSync(dir(), { recursive: true })
    writeFileSync(dir('state.json.tmp'), JSON.stringify(load()), 'utf8')
    renameSync(dir('state.json.tmp'), dir('state.json'))
  } catch (err) {
    logError('saving the SkyBlock market', err)
  }
}

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('skyblockMarket:changed')
}

const indexOf = (b: MarketBlock): Map<string, number> => {
  let m = indexes.get(b)
  if (!m || m.size !== b.ids.length) indexes.set(b, (m = new Map(b.ids.map((id, i) => [id, i]))))
  return m
}

// ---------- files ----------

function readBlock(kind: '5m' | '1h', day: string): MarketBlock | null {
  const file = dir(kind, `${day}.bin.gz`)
  if (!existsSync(file)) return null
  try {
    return decodeBlock(new Uint8Array(gunzipSync(readFileSync(file))))
  } catch (err) {
    logError(`reading SkyBlock market ${kind} ${day}`, err)
    return null
  }
}

function writeBlock(kind: '5m' | '1h', day: string, b: MarketBlock): void {
  try {
    mkdirSync(dir(kind), { recursive: true })
    const file = dir(kind, `${day}.bin.gz`)
    writeFileSync(`${file}.tmp`, gzipSync(encodeBlock(b), { level: 6 }))
    renameSync(`${file}.tmp`, file)
  } catch (err) {
    logError(`saving SkyBlock market ${kind} ${day}`, err)
  }
}

const dayOf = (t: number): string => dateKey(t)
const dayStart = (t: number): number => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function fineDay(day: string): MarketBlock | null {
  if (!fine.has(day)) {
    const b = readBlock('5m', day)
    if (!b) return null
    fine.set(day, b)
  }
  return fine.get(day)!
}

function hourDay(day: string): MarketBlock | null {
  if (!hours.has(day)) {
    const b = readBlock('1h', day)
    if (!b) return null
    hours.set(day, b)
  }
  return hours.get(day)!
}

/** Days between two times, as keys. */
function daysBetween(from: number, to: number): string[] {
  const out: string[] = []
  for (let t = dayStart(from); t <= to; t = dayStart(t + 26 * HOUR)) out.push(dayOf(t))
  return out
}

function importedPoints(): Record<string, Point[]> {
  if (imported) return imported
  try {
    imported = JSON.parse(gunzipSync(readFileSync(dir('imported.json.gz'))).toString('utf8')) as Record<string, Point[]>
  } catch {
    imported = {}
  }
  return imported
}

function saveImported(): void {
  try {
    mkdirSync(dir(), { recursive: true })
    writeFileSync(dir('imported.json.gz.tmp'), gzipSync(JSON.stringify(importedPoints())))
    renameSync(dir('imported.json.gz.tmp'), dir('imported.json.gz'))
  } catch (err) {
    logError('saving the SkyBlock market head start', err)
  }
}

function flush(force = false): void {
  if (!force && Date.now() - lastFlush < FLUSH_EVERY) return
  lastFlush = Date.now()
  for (const key of dirty) {
    const [kind, day] = key.split('/') as ['5m' | '1h', string]
    const b = kind === '5m' ? fine.get(day) : hours.get(day)
    if (b) writeBlock(kind, day, b)
  }
  dirty.clear()
}

/** Throws out 5-minute files older than two weeks, and days no longer needed in memory. */
function tidy(now: number): void {
  const cutoff = dayOf(now - KEEP_FINE_DAYS * DAY)
  try {
    for (const f of readdirSync(dir('5m'))) if (f.slice(0, 10) < cutoff) rmSync(dir('5m', f), { force: true })
  } catch {
    // Nothing saved yet.
  }
  const keepFine = new Set(daysBetween(now - 2 * DAY, now))
  for (const d of [...fine.keys()]) if (!keepFine.has(d) && !dirty.has(`5m/${d}`)) fine.delete(d)
  const keepHours = new Set(daysBetween(now - 40 * DAY, now))
  for (const d of [...hours.keys()]) if (!keepHours.has(d) && !dirty.has(`1h/${d}`)) hours.delete(d)
}

function diskMb(): number {
  let bytes = 0
  const walk = (d: string): void => {
    try {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name))
        else bytes += statSync(join(d, e.name)).size
      }
    } catch {
      // Not there yet.
    }
  }
  walk(dir())
  return Math.round((bytes / 1024 ** 2) * 10) / 10
}

// ---------- reading history ----------

/** An item's hour points (and the head start before them) from `from` to `to`. */
function hourSeries(id: string, from: number, to: number): Point[] {
  const out: Point[] = []
  for (const day of daysBetween(from, to)) {
    const b = hourDay(day)
    if (!b) continue
    const k = indexOf(b).get(id)
    if (k === undefined) continue
    b.times.forEach((t, i) => {
      if (t < from || t > to) return
      const r = rowOf(b, i, k)
      if (r) out.push({ at: t, buy: r[0], sell: r[1], buyWeek: r[2], sellWeek: r[3] })
    })
  }
  const first = out[0]?.at ?? Infinity
  const head = (importedPoints()[id] ?? []).filter((p) => p.at >= from && p.at <= to && p.at < first - HOUR)
  return [...head, ...out]
}

function fineSeries(id: string, from: number, to: number): Point[] {
  const out: Point[] = []
  for (const day of daysBetween(from, to)) {
    const b = fineDay(day)
    if (!b) continue
    const k = indexOf(b).get(id)
    if (k === undefined) continue
    b.times.forEach((t, i) => {
      if (t < from || t > to) return
      const r = rowOf(b, i, k)
      if (r) out.push({ at: t, buy: r[0], sell: r[1], buyWeek: r[2], sellWeek: r[3] })
    })
  }
  return out
}

/** Hours up to the last whole hour, then 5-minute points after that. */
function series(id: string, from: number, to: number): Point[] {
  const cut = Math.floor(Date.now() / HOUR) * HOUR
  const h = hourSeries(id, from, Math.min(to, cut - 1))
  const lastHour = h.length ? h[h.length - 1].at + HOUR : from
  return [...h, ...fineSeries(id, Math.max(from, lastHour), to)]
}

function priceAt(id: string, at: number): number | null {
  const p = pointNear(series(id, at - 3 * HOUR, at + 3 * HOUR), at, 90 * MINUTE)
  return p ? mid(p) : null
}

/** The latest look at the Bazaar. */
function latest(): { at: number; rows: Map<string, Point> } | null {
  const today = fineDay(dayOf(Date.now())) ?? fineDay(dayOf(Date.now() - DAY))
  if (!today || !today.times.length) return null
  const i = today.times.length - 1
  const rows = new Map<string, Point>()
  today.ids.forEach((id, k) => {
    const r = rowOf(today, i, k)
    if (r) rows.set(id, { at: today.times[i], buy: r[0], sell: r[1], buyWeek: r[2], sellWeek: r[3] })
  })
  return { at: today.times[i], rows }
}

export function marketName(id: string): string {
  return itemNameOf(id) ?? itemNameOf(neuId(id)) ?? bazaarName(id)
}

function firstDataAt(): number {
  const s = load()
  const heads = Object.values(importedPoints())
    .map((p) => p[0]?.at ?? Infinity)
    .reduce((a, b) => Math.min(a, b), Infinity)
  return Math.min(s.startedAt ?? Infinity, heads)
}

// ---------- recording ----------

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await net.fetch(url, { headers, signal: AbortSignal.timeout(30_000) })
  if (res.status === 429) throw new Error('Too many requests right now. Orbit will try again.')
  if (!res.ok) throw new Error(`${url.includes('coflnet') ? 'Coflnet' : 'Hypixel'} answered ${res.status}. Orbit will try again.`)
  return res.json()
}

async function tick(): Promise<void> {
  const s = load()
  if (!s.recording || !addonOn('skyblock') || busy) return
  busy = true
  try {
    let body: unknown
    try {
      body = await getJson(`${HYPIXEL}/v2/skyblock/bazaar`)
    } catch (err) {
      problem = err instanceof Error && /answered|Too many/.test(err.message) ? err.message : 'Couldn’t reach Hypixel. Orbit will keep trying.'
      broadcast()
      return
    }
    const snap = parseBazaar(body)
    if (!snap || snap.at === s.lastAt) return
    problem = ''
    const now = snap.at
    if (s.lastAt && now - s.lastAt > 4 * TICK) s.marks.push({ at: s.lastAt, end: now, kind: 'gap', text: `Not recorded for ${span(now - s.lastAt)}` })
    const prevDay = s.lastAt ? dayOf(s.lastAt) : null
    const prevHour = s.lastAt ? Math.floor(s.lastAt / HOUR) : null
    const day = dayOf(now)
    let b = fineDay(day)
    if (!b) fine.set(day, (b = emptyBlock()))
    addSnap(b, snap, indexOf(b))
    dirty.add(`5m/${day}`)
    s.lastAt = now
    s.startedAt ??= now

    // A new hour: the hour just finished gets its average.
    if (prevHour !== null && prevHour !== Math.floor(now / HOUR) && prevDay) {
      const pd = fineDay(prevDay)
      if (pd) {
        hours.set(prevDay, hourly(pd, prevDay === day ? Math.floor(now / HOUR) * HOUR : Infinity))
        dirty.add(`1h/${prevDay}`)
      }
      checkRules(now)
    }
    if (prevDay && prevDay !== day) {
      flush(true)
      writeDayNote(prevDay)
      tidy(now)
    }
    if (now - s.extrasAt > EXTRAS_EVERY) await extras(now)
    findQuestions(now)
    save()
    flush()
    broadcast()
  } catch (err) {
    logError('recording the SkyBlock market', err)
  } finally {
    busy = false
  }
}

/** The mayor, fire sales and (with your key) SkyBlock news. */
async function extras(now: number): Promise<void> {
  const s = load()
  s.extrasAt = now
  try {
    const m = mayorOf(await getJson(`${HYPIXEL}/v2/resources/skyblock/election`))
    if (m) s.terms = noteMayor(s.terms, { name: m.name, perks: m.perks.map((p) => p.name), minister: m.minister?.name ?? null }, now)
  } catch {
    // Next time.
  }
  try {
    const body = (await getJson(`${HYPIXEL}/v2/skyblock/firesales`)) as { sales?: { item_id?: string; start?: number; end?: number; price?: number }[] }
    for (const f of body.sales ?? []) {
      const key = `${f.item_id}-${f.start}`
      if (!f.item_id || s.seenFiresales.includes(key)) continue
      s.seenFiresales = [...s.seenFiresales, key].slice(-100)
      s.marks.push({ at: f.start ?? now, end: f.end, kind: 'firesale', text: `${marketName(f.item_id)}${f.price ? ` for ${f.price} gems` : ''}` })
    }
  } catch {
    // Next time.
  }
  const key = skyblockAccount().key
  if (key && now - s.newsAt > NEWS_EVERY) {
    s.newsAt = now
    try {
      const body = (await getJson(`${HYPIXEL}/v2/skyblock/news`, { 'API-Key': key })) as { items?: { title?: string; text?: string; link?: string }[] }
      for (const n of body.items ?? []) {
        const title = [n.title, n.text].filter(Boolean).join(': ')
        if (!title || s.seenNews.includes(title)) continue
        const first = s.seenNews.length === 0
        s.seenNews = [...s.seenNews, title].slice(-200)
        // The first time, it's old news: remember it without marking it as happening now.
        if (!first) s.marks.push({ at: now, kind: 'news', text: title })
      }
    } catch {
      // Next time.
    }
  }
  s.marks = s.marks.filter((m) => m.at > now - 400 * DAY)
}

// ---------- questions ----------

function eventsAround(from: number, to: number): { id: string; name: string; start: number; end: number }[] {
  return yearlyEventsBetween(from - 2 * DAY, to)
}

let corrCache = new Map<string, number>()
let corrAt = 0

function together(a: string, b: string): boolean {
  const now = Date.now()
  if (now - corrAt > 6 * HOUR) (corrCache = new Map()), (corrAt = now)
  const key = [a, b].sort().join('|')
  if (!corrCache.has(key)) corrCache.set(key, correlation(hourSeries(a, now - 7 * DAY, now), hourSeries(b, now - 7 * DAY, now)))
  return corrCache.get(key)! >= 0.6
}

/** Every busy item's odd moves right now. */
function anomaliesNow(now: number): Map<string, Anomaly[]> {
  const out = new Map<string, Anomaly[]>()
  const last = latest()
  if (!last) return out
  for (const [id, p] of last.rows) {
    if (dailyCoins(p) < ANOMALY_SETTINGS.minCoins) continue
    const h = hourSeries(id, now - ANOMALY_SETTINGS.baselineDays * DAY, now)
    const recent = fineSeries(id, now - (ANOMALY_SETTINGS.windowHours + 1) * HOUR, now)
    const found = findAnomalies(id, h, recent, now)
    if (found.length) out.set(id, found)
  }
  return out
}

function findQuestions(now: number): void {
  const s = load()
  const found = anomaliesNow(now)

  // Open questions: file them away once things are back to normal, and say how "later" ones are going.
  for (const q of s.questions) {
    if (q.status !== 'open' && q.status !== 'later') continue
    const lead = q.items[0]
    const a = found.get(lead.id)?.find((x) => x.kind === q.kind)
    const age = now - q.at
    if (q.status === 'later') {
      const p = priceAt(lead.id, now)
      if (p && q.kind !== 'spread' && q.kind !== 'volume') {
        const since = p / lead.now - 1
        q.followUp = settled(a)
          ? `Back to normal now (${shortCoins(p)} coins).`
          : `Still going: ${since >= 0 ? 'up' : 'down'} another ${Math.round(Math.abs(since) * 100)}% since Orbit asked (${shortCoins(p)} coins).`
      } else q.followUp = settled(a) ? 'Back to normal now.' : 'Still going.'
      if (age > 2 * QUESTION_SETTINGS.fileAfter) q.status = 'settled'
    } else if (age > QUESTION_SETTINGS.fileAfter || (age > QUESTION_SETTINGS.settleAfter && settled(a))) q.status = 'settled'
  }

  const all = [...found.values()].flat()
  if (!all.length) return
  const groups = pickNew(groupAnomalies(all, together), s.questions, s.mutes, now)
  const events = eventsAround(now - 12 * HOUR, now + 12 * HOUR)
  for (const g of groups) {
    const lead = g[0]
    const items = g
      .filter((a, i) => g.findIndex((x) => x.id === a.id) === i)
      .map((a) => ({ id: a.id, name: marketName(a.id), change: a.change, before: a.before, now: a.now }))
    const context = contextLines(now, s.terms, events, s.marks)
    const q: MarketQuestion = {
      id: `q${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      at: now,
      kind: lead.kind,
      items,
      z: lead.z,
      score: lead.score,
      text: questionText(lead.kind, items, context),
      context,
      history: pastAnswers(s.questions, lead.id, lead.kind),
      status: 'open'
    }
    s.questions.push(q)
  }
  s.questions = s.questions.slice(-500)
}

async function answer(id: string, a: MarketAnswer): Promise<void> {
  const s = load()
  const q = s.questions.find((x) => x.id === id)
  if (!q) throw new Error('That question isn’t there any more.')
  if (a.action === 'explain') {
    const text = a.text.trim()
    if (!text) throw new Error('Write what you think happened first.')
    q.status = 'explained'
    q.answer = text.slice(0, 2000)
  } else if (a.action === 'later') q.status = 'later'
  else if (a.action === 'unknown') q.status = 'unknown'
  else if (a.action === 'ignore') {
    q.status = 'ignored'
    if (!s.mutes.some((m) => m.item === q.items[0].id && m.kind === q.kind)) s.mutes.push({ item: q.items[0].id, kind: q.kind })
  } else if (a.action === 'reopen') {
    q.status = 'open'
    s.mutes = s.mutes.filter((m) => !(m.item === q.items[0].id && m.kind === q.kind))
  }
  q.answeredAt = Date.now()
  if (q.status === 'explained' || q.status === 'unknown') await writeAnswerNote(q)
  save()
  broadcast()
}

// ---------- notes in the vault ----------

async function writeNote(path: string, text: string): Promise<boolean> {
  const v = getVault()
  if (!v) return false
  try {
    const full = v.abs(path)
    mkdirSync(join(full, '..'), { recursive: true })
    await v.write(path, text)
    return true
  } catch (err) {
    logError(`writing ${path}`, err)
    return false
  }
}

async function writeAnswerNote(q: MarketQuestion): Promise<void> {
  const path = q.notePath ?? answerNotePath(q)
  if (await writeNote(path, answerNote(q))) q.notePath = path
}

function writeDayNote(day: string): void {
  const s = load()
  if (s.dayNoted >= day) return
  s.dayNoted = day
  const h = hourDay(day)
  if (!h || !h.times.length) return
  const pointsAt = (i: number): Map<string, Point> => {
    const m = new Map<string, Point>()
    h.ids.forEach((id, k) => {
      const r = rowOf(h, i, k)
      if (r) m.set(id, { at: h.times[i], buy: r[0], sell: r[1], buyWeek: r[2], sellWeek: r[3] })
    })
    return m
  }
  const { up, down } = movers(pointsAt(0), pointsAt(h.times.length - 1), marketName)
  const start = h.times[0]
  const end = start + DAY
  const gaps = s.marks.filter((m) => m.kind === 'gap' && m.at < end && (m.end ?? m.at) > start).reduce((t, m) => t + Math.min(end, m.end ?? m.at) - Math.max(start, m.at), 0)
  const note = dayNote(
    start,
    mayorAt(s.terms, start + 12 * HOUR),
    yearlyEventsBetween(start - DAY, end).filter((e) => e.end > start),
    up.slice(0, 6),
    down.slice(0, 6),
    s.questions.filter((q) => dayOf(q.at) === day),
    gaps
  )
  void writeNote(`${VAULT_FOLDER}/Days/${day}.md`, note)
}

function rulesNote(): string {
  const s = load()
  const lines = ['---', 'skyblock-market: rules', '---', '', '# SkyBlock market rules', '', 'Patterns you or the AI think hold, and how often they’ve been right since Orbit started recording. Orbit updates this note.', '']
  if (!s.rules.length) lines.push('No rules yet. Press “Find rules” on the Market page, or ask the AI to add one.')
  for (const r of s.rules) {
    const sc = ruleScore(r)
    lines.push(`## ${ruleText(r, YEARLY_EVENT_KINDS)}`, '', `- **${sc.label}**${r.off ? ' (turned off)' : ''}`, `- Suggested by ${r.source === 'ai' ? 'the AI' : 'you'} on ${new Date(r.createdAt).toLocaleDateString('en-GB')}`)
    if (r.why) lines.push(`- Why: ${r.why}`)
    for (const c of r.checks.slice(-5)) lines.push(`  - ${new Date(c.at).toLocaleDateString('en-GB')}: ${c.change >= 0 ? '+' : '−'}${Math.round(Math.abs(c.change) * 100)}% ${c.hit ? '✓' : '✗'}`)
    lines.push('')
  }
  return lines.join('\n')
}

// ---------- rules ----------

function checkRules(now: number): void {
  const s = load()
  if (!s.rules.length) return
  const events = yearlyEventsBetween(firstDataAt() - 14 * DAY, now)
  for (const r of s.rules) {
    if (r.off) continue
    r.checks = checkRule(r, triggerStarts(r.trigger, s.terms, events), (at) => priceAt(r.item, at), now)
  }
  void writeNote(`${VAULT_FOLDER}/Rules.md`, rulesNote())
}

function addRule(v: unknown): MarketRule {
  const s = load()
  const r = cleanRule(v, marketName, Date.now())
  if (!r) throw new Error('That rule doesn’t make sense: it needs an item, a mayor or event, a time window and a size.')
  if (!latest()?.rows.has(r.item) && !importedPoints()[r.item]) throw new Error(`Orbit hasn’t seen ${r.item} on the Bazaar. Use the item’s Bazaar id, like ENCHANTED_GOLD.`)
  if (r.trigger.type === 'event' && !YEARLY_EVENT_KINDS.some((k) => k.id === (r.trigger as { kind: string }).kind))
    throw new Error(`Events Orbit knows: ${YEARLY_EVENT_KINDS.map((k) => k.id).join(', ')}.`)
  s.rules.push(r)
  checkRules(Date.now())
  save()
  broadcast()
  return r
}

// ---------- the head start ----------

/** Coflnet's last few days for the busiest items, so questions can start in hours instead of days. */
async function runHeadStart(): Promise<void> {
  if (headStart.running) return
  let last = latest()
  if (!last) {
    try {
      const snap = parseBazaar(await getJson(`${HYPIXEL}/v2/skyblock/bazaar`))
      if (snap) last = { at: snap.at, rows: new Map(Object.entries(snap.rows).map(([id, r]) => [id, { at: snap.at, buy: r[0], sell: r[1], buyWeek: r[2], sellWeek: r[3] }])) }
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Couldn’t reach Hypixel.')
    }
  }
  if (!last) throw new Error('Hypixel didn’t send the Bazaar. Try again in a minute.')
  const ids = [...last.rows.entries()]
    .sort((a, b) => dailyCoins(b[1]) - dailyCoins(a[1]))
    .slice(0, HEAD_START_ITEMS)
    .map(([id]) => id)
  headStart = { done: 0, total: ids.length, running: true }
  broadcast()
  const pts = importedPoints()
  let failures = 0
  for (const id of ids) {
    if (!addonOn('skyblock')) break
    try {
      const got = parseCoflHistory(await getJson(`${COFL}/api/bazaar/${encodeURIComponent(id)}/history/week`))
      if (got.length) pts[id] = got
      failures = 0
    } catch {
      if (++failures >= 5) break
    }
    headStart.done++
    if (headStart.done % 20 === 0) (saveImported(), broadcast())
    await new Promise((r) => setTimeout(r, HEAD_START_GAP))
  }
  saveImported()
  load().headStartAt = Date.now()
  save()
  headStart.running = false
  corrAt = 0
  broadcast()
}

/** One item's head start, when you look at something Orbit hasn't recorded much of. */
async function headStartFor(id: string): Promise<void> {
  const pts = importedPoints()
  if (pts[id]?.length) return
  try {
    const got = parseCoflHistory(await getJson(`${COFL}/api/bazaar/${encodeURIComponent(id)}/history/week`))
    if (got.length) {
      pts[id] = got
      saveImported()
    }
  } catch {
    // The chart shows what Orbit has.
  }
}

// ---------- what the page sees ----------

function state(): MarketState {
  const s = load()
  const last = latest()
  const now = Date.now()
  const first = firstDataAt()
  const historyHours = Number.isFinite(first) ? Math.round((now - first) / HOUR) : 0
  let days = 0
  try {
    days = readdirSync(dir('1h')).length + (fine.has(dayOf(now)) && !existsSync(dir('1h', `${dayOf(now)}.bin.gz`)) ? 1 : 0)
  } catch {
    days = fine.size
  }
  const order: Record<string, number> = { open: 0, later: 1, unknown: 2, explained: 3, settled: 4, ignored: 5 }
  return {
    recording: s.recording,
    startedAt: s.startedAt,
    lastAt: s.lastAt,
    items: last?.rows.size ?? 0,
    watched: last ? [...last.rows.values()].filter((p) => dailyCoins(p) >= ANOMALY_SETTINGS.minCoins).length : 0,
    days,
    mb: diskMb(),
    learning: historyHours < ANOMALY_SETTINGS.minHours,
    historyHours,
    problem,
    mayor: s.terms[s.terms.length - 1] ?? null,
    mayors: s.terms.slice(-12),
    questions: [...s.questions].reverse().sort((a, b) => order[a.status] - order[b.status] || (a.status === 'open' ? b.score - a.score : b.at - a.at)).slice(0, 80),
    rules: s.rules,
    mutes: s.mutes,
    headStart: { ...headStart, at: s.headStartAt },
    aiReady: claudeReady(),
    eventKinds: YEARLY_EVENT_KINDS
  }
}

const RANGES: Record<string, number> = { '1d': DAY, '7d': 7 * DAY, '30d': 30 * DAY, all: 3650 * DAY }

async function chart(id: string, range: string): Promise<MarketChart> {
  const s = load()
  const now = Date.now()
  const span = RANGES[range] ?? 7 * DAY
  if (span > DAY && hourSeries(id, now - span, now).length < 24) await headStartFor(id)
  const from = Math.max(now - span, Number.isFinite(firstDataAt()) ? firstDataAt() - HOUR : now - span)
  const pts = span <= DAY ? [...hourSeries(id, from, now - 2 * DAY), ...fineSeries(id, Math.max(from, now - DAY), now)] : series(id, from, now)
  return {
    id,
    name: marketName(id),
    points: thinPoints(pts, 600),
    mayors: s.terms.filter((t) => t.end >= from),
    events: yearlyEventsBetween(from - DAY, now).filter((e) => e.end >= from),
    marks: s.marks.filter((m) => (m.end ?? m.at) >= from),
    questions: s.questions.filter((q) => q.items.some((i) => i.id === id)),
    imported: pts.some((p) => (importedPoints()[id] ?? []).includes(p))
  }
}

function search(query: string): MarketItemHit[] {
  const last = latest()
  const q = query.trim().toLowerCase()
  const ids = last ? [...last.rows.keys()] : Object.keys(importedPoints())
  const hits: MarketItemHit[] = []
  for (const id of ids) {
    const name = marketName(id)
    if (q && !name.toLowerCase().includes(q) && !id.toLowerCase().includes(q.replace(/\s+/g, '_'))) continue
    const p = last?.rows.get(id) ?? importedPoints()[id]?.slice(-1)[0]
    hits.push({ id, name, price: p ? mid(p) : 0, coins: p ? dailyCoins(p) : 0 })
  }
  return hits.sort((a, b) => b.coins - a.coins).slice(0, q ? 30 : 12)
}

function moversOver(hoursBack: number): { up: { id: string; name: string; change: number; now: number }[]; down: { id: string; name: string; change: number; now: number }[] } {
  const last = latest()
  if (!last) return { up: [], down: [] }
  const then = new Map<string, Point>()
  const at = last.at - hoursBack * HOUR
  for (const id of last.rows.keys()) {
    const p = pointNear(series(id, at - 2 * HOUR, at + 2 * HOUR), at, 90 * MINUTE)
    if (p) then.set(id, p)
  }
  return movers(then, last.rows, marketName)
}

// ---------- asking the AI ----------

const csvTime = (t: number): string => new Date(t).toISOString().slice(0, 16).replace('T', ' ')

const TOOLS: AiTool[] = [
  {
    name: 'find_items',
    description: 'Search Bazaar items by name. Returns Bazaar ids, names, current middle price and coins traded a day. Use the id with the other tools.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Part of the name, like "gold" or "wither essence". Empty for the busiest items.' } }, required: ['query'] }
  },
  {
    name: 'price_history',
    description:
      'One item’s recorded history as CSV (UTC time, instant-buy price, instant-sell price, bought last 7 days, sold last 7 days). Hour averages, then 5-minute points for the latest hours. Rows before Orbit started recording come from Coflnet (every 2 hours).',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'Bazaar id, like ENCHANTED_GOLD' },
        from_hours_ago: { type: 'number', description: 'Default 168 (a week).' },
        to_hours_ago: { type: 'number', description: 'Default 0 (now).' },
        max_rows: { type: 'number', description: 'Default 200, at most 600. Rows are spread evenly.' }
      },
      required: ['item']
    }
  },
  {
    name: 'market_movers',
    description: 'The busy items that rose and fell the most over the last N hours.',
    input_schema: { type: 'object', properties: { hours: { type: 'number', description: 'Default 24.' } }, required: [] }
  },
  {
    name: 'what_happened',
    description: 'Mayors (with perks and ministers), SkyBlock calendar events, fire sales, Hypixel news and times Orbit wasn’t recording, between two times.',
    input_schema: { type: 'object', properties: { from_hours_ago: { type: 'number' }, to_hours_ago: { type: 'number' } }, required: ['from_hours_ago'] }
  },
  {
    name: 'by_mayor',
    description: 'An item’s average middle price during each mayor’s term Orbit has recorded, and how much it changed over each term.',
    input_schema: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] }
  },
  {
    name: 'moves_with',
    description: 'The busy items whose hourly price moves best match this one’s over the last week (correlation from −1 to 1).',
    input_schema: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] }
  },
  {
    name: 'questions_and_answers',
    description: 'Every odd move Orbit has asked the person about, with their answers (explanations are the most useful thing you have: they know the game).',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'rules',
    description: 'The rules being tracked, and how often each has been right.',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'add_rule',
    description:
      'Start tracking a rule: an item moving a certain way around a mayor taking office or a yearly event starting. Orbit checks it against every past and future time the trigger happens and reports how often it was right. Only add rules with some evidence behind them.',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'Bazaar id' },
        trigger: {
          type: 'object',
          description: `{ "type": "mayor", "name": "Derpy" } or { "type": "event", "kind": one of ${YEARLY_EVENT_KINDS.map((k) => `"${k.id}" (${k.name})`).join(', ')} }`
        },
        fromHours: { type: 'number', description: 'Start of the window, in hours after the trigger (negative for before).' },
        toHours: { type: 'number', description: 'End of the window, in hours after the trigger.' },
        expect: { type: 'string', enum: ['up', 'down'] },
        size: { type: 'number', description: 'The move expected over the window, like 0.15 for 15%. Counts as right at half this or more.' },
        why: { type: 'string', description: 'One sentence on why, in plain words.' }
      },
      required: ['item', 'trigger', 'fromHours', 'toHours', 'expect', 'size', 'why']
    }
  }
]

function runTool(name: string, input: Record<string, unknown>): Promise<string> | string {
  const s = load()
  const now = Date.now()
  const n = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const item = typeof input.item === 'string' ? input.item.trim().toUpperCase() : ''
  switch (name) {
    case 'find_items':
      return JSON.stringify(search(String(input.query ?? '')).map((h) => ({ id: h.id, name: h.name, price: +h.price.toPrecision(5), coinsPerDay: Math.round(h.coins) })))
    case 'price_history': {
      return (async () => {
        const from = now - n(input.from_hours_ago, 168) * HOUR
        const to = now - n(input.to_hours_ago, 0) * HOUR
        if (to - from > 2 * DAY && hourSeries(item, from, to).length < 24) await headStartFor(item)
        const pts = thinPoints(series(item, from, to), Math.min(600, n(input.max_rows, 200)))
        if (!pts.length) return `No history for ${item} in that time. Check the id with find_items.`
        return ['time,buy,sell,boughtWeek,soldWeek', ...pts.map((p) => `${csvTime(p.at)},${+p.buy.toPrecision(6)},${+p.sell.toPrecision(6)},${Math.round(p.buyWeek)},${Math.round(p.sellWeek)}`)].join('\n')
      })()
    }
    case 'market_movers': {
      const m = moversOver(n(input.hours, 24))
      const f = (x: { id: string; name: string; change: number; now: number }): string => `${x.name} (${x.id}): ${x.change >= 0 ? '+' : ''}${(x.change * 100).toFixed(1)}%, now ${shortCoins(x.now)}`
      return `Rose:\n${m.up.map(f).join('\n') || 'none'}\n\nFell:\n${m.down.map(f).join('\n') || 'none'}`
    }
    case 'what_happened': {
      const from = now - n(input.from_hours_ago, 168) * HOUR
      const to = now - n(input.to_hours_ago, 0) * HOUR
      const lines: string[] = []
      for (const t of s.terms.filter((t) => t.end >= from && t.start <= to)) lines.push(`Mayor ${t.name} from ${csvTime(t.start)} to ${csvTime(t.end)}${t.minister ? `, minister ${t.minister}` : ''}. Perks: ${t.perks.join(', ') || 'unknown'}`)
      for (const e of yearlyEventsBetween(from - DAY, to).filter((e) => e.end >= from)) lines.push(`Event ${e.name} from ${csvTime(e.start)} to ${csvTime(e.end)}`)
      for (const m of s.marks.filter((m) => (m.end ?? m.at) >= from && m.at <= to)) lines.push(`${m.kind === 'gap' ? 'Not recording' : m.kind === 'firesale' ? 'Fire sale' : 'News'} at ${csvTime(m.at)}${m.end ? ` to ${csvTime(m.end)}` : ''}: ${m.text}`)
      lines.push('Every hour: Dark Auction at :55 and Jacob’s Farming Contest at :15 (not listed).')
      return lines.join('\n')
    }
    case 'by_mayor': {
      if (!s.terms.length) return 'Orbit hasn’t recorded any mayors yet.'
      return s.terms
        .map((t) => {
          const pts = series(item, t.start, t.end)
          if (!pts.length) return `${t.name} (${csvTime(t.start)}): no data`
          const avg = pts.reduce((a, p) => a + mid(p), 0) / pts.length
          const change = mid(pts[pts.length - 1]) / mid(pts[0]) - 1
          return `${t.name} (${csvTime(t.start)} to ${csvTime(t.end)}): average ${+avg.toPrecision(5)}, changed ${(change * 100).toFixed(1)}% over the term`
        })
        .join('\n')
    }
    case 'moves_with': {
      const last = latest()
      if (!last) return 'Nothing recorded yet.'
      const mine = hourSeries(item, now - 7 * DAY, now)
      const out: { id: string; c: number }[] = []
      for (const [id, p] of last.rows) {
        if (id === item || dailyCoins(p) < ANOMALY_SETTINGS.minCoins) continue
        out.push({ id, c: correlation(mine, hourSeries(id, now - 7 * DAY, now)) })
      }
      return (
        out
          .sort((a, b) => b.c - a.c)
          .slice(0, 12)
          .map((x) => `${marketName(x.id)} (${x.id}): ${x.c.toFixed(2)}`)
          .join('\n') || 'Not enough history yet.'
      )
    }
    case 'questions_and_answers':
      return (
        s.questions
          .filter((q) => q.status !== 'ignored')
          .slice(-80)
          .map((q) => `${csvTime(q.at)} [${q.status}] ${q.text}${q.answer ? ` ANSWER: ${q.answer}` : ''}${q.followUp ? ` (since: ${q.followUp})` : ''}`)
          .join('\n') || 'No questions yet.'
      )
    case 'rules':
      return s.rules.map((r) => `${r.id}: ${ruleText(r, YEARLY_EVENT_KINDS)}. ${ruleScore(r).label}. Why: ${r.why}`).join('\n') || 'No rules yet.'
    case 'add_rule': {
      const r = addRule({ ...input, source: 'ai' })
      return `Added. ${ruleScore(r).label} so far${r.checks.length ? `: ${r.checks.map((c) => `${(c.change * 100).toFixed(1)}%`).join(', ')}` : ''}.`
    }
  }
  throw new Error(`There’s no tool called ${name}.`)
}

function systemPrompt(): string {
  const s = load()
  const st = state()
  const explained = s.questions.filter((q) => q.status === 'explained').slice(-30)
  return `You help a Hypixel SkyBlock player understand the Bazaar, using the history Orbit (their notes app) has recorded. You talk to them inside Orbit's SkyBlock Market page.

What Orbit has: every Bazaar item's instant-buy and instant-sell price and weekly trading every 5 minutes since ${s.startedAt ? csvTime(s.startedAt) : 'not yet'} UTC (${st.historyHours} hours of history, counting a few days of Coflnet history for the busiest items), hour averages for good, the mayor and minister each half hour, fire sales and Hypixel news. The SkyBlock calendar (yearly events) is worked out, not recorded. Current mayor: ${st.mayor?.name ?? 'unknown'}. It's ${csvTime(Date.now())} UTC now.

How to work:
- Look things up with the tools before answering. Don't guess numbers.
- Be honest about how little data there is: a mayor term is about 5 days, so one or two terms can't show a pattern. Say when something could easily be coincidence, and how many times you've seen it.
- Things moving together isn't proof one causes the other. Game updates and patches cause big moves and aren't in the data unless the person explained them.
- The person's own explanations are the best evidence you have. Use them, and say when your finding fits or clashes with one.
- When you find something that looks like a repeatable pattern tied to a mayor or event, you may add it as a rule with add_rule so Orbit keeps checking it. Say you did.
- If you'd like the person to check something in game, ask them.

Keep replies short: under 80 words unless they ask for detail, in plain friendly English. Lead with the answer, give the key numbers, and skip the background on what data you looked at. No headings and no tables. Use item names, not ids.
${explained.length ? `\nThings the person has explained before:\n${explained.map((q) => `- ${csvTime(q.at)}: ${q.text.replace(/ Any idea why\?$/, '')} They said: "${q.answer}"`).join('\n')}` : ''}`
}

async function ask(messages: { role: 'user' | 'assistant'; content: string }[]): Promise<string> {
  if (!claudeReady()) throw new Error('Asking about the data needs Claude. Add your Anthropic API key in Settings → AI helper.')
  const { text } = await askWithTools(systemPrompt(), messages.slice(-12), TOOLS, runTool)
  return text
}

async function suggestRules(): Promise<{ text: string; added: MarketRule[] }> {
  if (!claudeReady()) throw new Error('Finding rules needs Claude. Add your Anthropic API key in Settings → AI helper.')
  const before = new Set(load().rules.map((r) => r.id))
  const { text } = await askWithTools(
    systemPrompt(),
    [
      {
        role: 'user',
        content:
          'Look through the history, the mayors and events, and my answers, and add up to 3 rules with add_rule that you think have real evidence behind them (for example an item that rose before the last two Spooky Festivals, or moved the same way when the same mayor came in). Check each against the price history first. Then reply in at most 2 short sentences: what you added, or if nothing, why not and the most promising thing to watch.'
      }
    ],
    TOOLS,
    runTool,
    20
  )
  return { text, added: load().rules.filter((r) => !before.has(r.id)) }
}

// ---------- setup ----------

function start(): void {
  if (timer) return
  timer = setInterval(() => void tick(), TICK)
  setTimeout(() => void tick(), 5_000)
}

function stop(): void {
  if (timer) clearInterval(timer)
  timer = null
  flush(true)
}

export function setupSkyblockMarket(opts: { getVault: () => Vault | null }): void {
  getVault = opts.getVault
  const s = load()
  if (s.recording && addonOn('skyblock')) start()
  onAddonsChanged(() => {
    if (load().recording && addonOn('skyblock')) start()
    else stop()
  })
  app.on('before-quit', () => flush(true))

  ipcMain.handle('skyblockMarket:state', () => state())
  ipcMain.handle('skyblockMarket:record', (_e, on: boolean) => {
    const st = load()
    st.recording = !!on
    save()
    if (st.recording) start()
    else stop()
    broadcast()
    return state()
  })
  ipcMain.handle('skyblockMarket:answer', async (_e, id: string, a: MarketAnswer) => {
    await answer(id, a)
    return state()
  })
  ipcMain.handle('skyblockMarket:chart', (_e, id: string, range: string) => chart(String(id), String(range)))
  ipcMain.handle('skyblockMarket:search', (_e, query: string) => search(String(query ?? '')))
  ipcMain.handle('skyblockMarket:movers', (_e, hoursBack: number) => moversOver(Number(hoursBack) || 24))
  ipcMain.handle('skyblockMarket:ask', (_e, messages: { role: 'user' | 'assistant'; content: string }[]) => ask(messages))
  ipcMain.handle('skyblockMarket:suggestRules', () => suggestRules())
  ipcMain.handle('skyblockMarket:addRule', (_e, rule: unknown) => {
    addRule({ ...(rule as object), source: 'you' })
    return state()
  })
  ipcMain.handle('skyblockMarket:removeRule', (_e, id: string) => {
    const st = load()
    st.rules = st.rules.filter((r) => r.id !== id)
    save()
    void writeNote(`${VAULT_FOLDER}/Rules.md`, rulesNote())
    broadcast()
    return state()
  })
  ipcMain.handle('skyblockMarket:unmute', (_e, item: string, kind: string) => {
    const st = load()
    st.mutes = st.mutes.filter((m) => !(m.item === item && m.kind === kind))
    save()
    broadcast()
    return state()
  })
  ipcMain.handle('skyblockMarket:headStart', () => {
    void runHeadStart().catch((err) => {
      headStart.running = false
      problem = err instanceof Error ? err.message : String(err)
      broadcast()
    })
    return state()
  })
}

/** For tests: run one look now. */
export const marketTickNow = (): Promise<void> => tick()
