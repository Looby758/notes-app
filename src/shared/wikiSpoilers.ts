import { DomUtils, parseDocument } from 'htmlparser2'
import type { AnyNode, Element } from 'domhandler'
import { htmlText, normaliseTitle, wikiLink } from './wiki'

/**
 * The spoiler limit (and the Show / Comics switch) for downloaded wikis. No Electron here, so it
 * can be tested.
 *
 * 1. A timeline is built from the wiki's own episode and issue pages: an episode page says
 *    "Season 1, Episode 1" in its info box and is in a "<series> Episodes" category; an issue page
 *    is "Issue 12" in a "<series> Issues" category; a volume page lists its issues.
 * 2. Every piece of a page (a paragraph, a list item, an info box field…) is placed on that timeline
 *    by the heading it's under ("Season 3", or a heading that links to "Volume 2"), the episode
 *    heading above it inside a season, the page itself (an episode's own page), and every episode
 *    or issue it links to (the latest wins).
 * 3. Anything past where you are is hidden, and so is anything that can't be placed (you can show
 *    those yourself). Pages about something you haven't reached (by their first appearance) are
 *    hidden altogether, title and all.
 *
 * Each TV show (and the comics) in a wiki is its own series with its own "how far I am"; a series
 * you haven't set is "not started".
 */

// ---------- types ----------

export type WikiPart = 'show' | 'comics' | 'other'
export type WikiPartsChoice = 'show' | 'comics' | 'both'

/** "You need to be at least this far in each of these series": series name → order. */
export type Req = Record<string, number>
/** null: couldn't be placed. 'safe': fine at any point (an actor's name, a character's eye colour). */
export type UnitReq = Req | null | 'safe'

export interface TimelinePoint {
  order: number
  label: string
}

export interface TimelineSeries {
  name: string
  part: 'show' | 'comics'
  points: TimelinePoint[]
}

export interface TimelineEntry {
  series: string
  part: 'show' | 'comics'
  order: number
}

export interface WikiTimeline {
  /** By the page's title (lower case): its place on the timeline. */
  entries: Record<string, TimelineEntry>
  /** A volume's name ("days gone bye") → its page title (lower case), for headings that name it. */
  volumes: Record<string, string>
  series: TimelineSeries[]
}

export interface WikiSpoilerSettings {
  /** The spoiler limit is on. */
  limit: boolean
  parts: WikiPartsChoice
  /** How far you are in each series (its order: season × 1000 + episode, or the issue number). */
  progress: Record<string, number>
  updated: number
}

export const DEFAULT_SPOILERS: WikiSpoilerSettings = { limit: false, parts: 'both', progress: {}, updated: 0 }

/** A saved or synced setting, checked over. */
export function spoilerSettings(raw: unknown): WikiSpoilerSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<WikiSpoilerSettings>
  const progress: Record<string, number> = {}
  if (r.progress && typeof r.progress === 'object')
    for (const [k, v] of Object.entries(r.progress)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) progress[String(k).slice(0, 200)] = v
  return {
    limit: r.limit === true,
    parts: r.parts === 'show' || r.parts === 'comics' ? r.parts : 'both',
    progress,
    updated: typeof r.updated === 'number' && Number.isFinite(r.updated) ? r.updated : 0
  }
}

// ---------- which part a page is about ----------

const catKey = (c: string): string => normaliseTitle(c).toLowerCase()

/** Show, comics, or other (games, novels, the real world, or both), from its categories ("Television Universe", "Comic Series"…). */
export function pagePart(categories: string[]): WikiPart {
  const cats = categories.map(catKey)
  const tv = cats.some((c) => /\b(television|tv)\b/.test(c))
  const comic = cats.some((c) => /\bcomics?\b/.test(c))
  if (tv && !comic) return 'show'
  if (comic && !tv) return 'comics'
  return 'other'
}

export const partShown = (part: WikiPart, parts: WikiPartsChoice): boolean => part === 'other' || parts === 'both' || part === parts

// ---------- the timeline ----------

export type TimelineFact =
  | { kind: 'episode'; title: string; series: string; season: number; episode: number }
  | { kind: 'issue'; title: string; series: string; issue: number }
  | { kind: 'volume'; title: string; volume: number | null; links: string[] }

/** The series a page belongs to, from a "<series> Episodes" / "<series> Issues" category. */
function seriesFrom(categories: string[], suffix: 'Episodes' | 'Issues'): string | null {
  for (const c of categories) {
    const name = normaliseTitle(c)
    const m = new RegExp(`^(.+) ${suffix}$`, 'i').exec(name)
    if (m && !/^season \d+$/i.test(m[1]) && !/^volume \d+$/i.test(m[1])) return m[1]
  }
  return null
}

const infoBox = (html: string): string => {
  const start = html.search(/<aside\b[^>]*portable-infobox/i)
  if (start < 0) return ''
  const end = html.indexOf('</aside>', start)
  return html.slice(start, end < 0 ? undefined : end)
}

/** Page titles a piece of HTML links to (on this wiki). */
function linkedTitles(html: string, base: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/gi)) {
    const link = wikiLink(m[1].replace(/&amp;/g, '&'), base)
    if (link?.kind === 'page') out.push(link.title)
  }
  return out
}

/** What a page adds to the timeline, if anything: it's an episode, an issue, or a volume. */
export function timelineFact(title: string, categories: string[], html: string, base: string): TimelineFact | null {
  const part = pagePart(categories)
  const box = infoBox(html)
  const boxText = htmlText(box)
  if (part === 'show') {
    const series = seriesFrom(categories, 'Episodes')
    const m = /season\s*(\d+)\s*[,;:–—-]?\s*episode\s*(\d+)/i.exec(boxText)
    if (series && m) return { kind: 'episode', title, series, season: +m[1], episode: +m[2] }
    return null
  }
  if (part === 'comics') {
    if (categories.some((c) => catKey(c) === 'volumes')) {
      const v = /^volume\s*(\d+)/i.exec(title)
      return { kind: 'volume', title, volume: v ? +v[1] : null, links: linkedTitles(box, base) }
    }
    const series = seriesFrom(categories, 'Issues')
    const n = /^issue\s*#?\s*(\d+)$/i.exec(title) ?? /issue\s*#?\s*(\d+)/i.exec(boxText)
    if (series && n) return { kind: 'issue', title, series, issue: +n[1] }
  }
  return null
}

/** The whole timeline, from every page's fact. `key` turns a title (or a redirect to it) into its page's key. */
export function buildTimeline(facts: TimelineFact[], key: (title: string) => string): WikiTimeline {
  const entries: Record<string, TimelineEntry> = {}
  const labels = new Map<string, string>()
  const volumeOf = new Map<string, number>()
  for (const f of facts) {
    if (f.kind === 'episode') {
      const order = f.season * 1000 + f.episode
      entries[key(f.title)] = { series: f.series, part: 'show', order }
      labels.set(`${f.series}\n${order}`, `Season ${f.season}, Episode ${f.episode}`)
    } else if (f.kind === 'issue') {
      entries[key(f.title)] = { series: f.series, part: 'comics', order: f.issue }
    }
  }
  const volumes: Record<string, string> = {}
  for (const f of facts) {
    if (f.kind !== 'volume') continue
    const issues = f.links.map((t) => entries[key(t)]).filter((e): e is TimelineEntry => !!e && e.part === 'comics')
    if (!issues.length) continue
    // A volume is as far as its last issue.
    const series = issues[0].series
    const last = Math.max(...issues.filter((e) => e.series === series).map((e) => e.order))
    entries[key(f.title)] = { series, part: 'comics', order: last }
    const name = f.title.includes(':') ? f.title.slice(f.title.indexOf(':') + 1).trim() : f.title
    volumes[name.toLowerCase()] = key(f.title)
    if (f.volume !== null) for (const e of issues) if (e.series === series && !volumeOf.has(`${series}\n${e.order}`)) volumeOf.set(`${series}\n${e.order}`, f.volume)
  }
  const bySeries = new Map<string, TimelineSeries>()
  for (const e of Object.values(entries)) {
    let s = bySeries.get(e.series)
    if (!s) bySeries.set(e.series, (s = { name: e.series, part: e.part, points: [] }))
    if (s.points.some((p) => p.order === e.order)) continue
    const vol = volumeOf.get(`${e.series}\n${e.order}`)
    const label = labels.get(`${e.series}\n${e.order}`) ?? `Issue ${e.order}${vol ? ` (Volume ${vol})` : ''}`
    s.points.push({ order: e.order, label })
  }
  const series = [...bySeries.values()].filter((s) => s.points.length > 0)
  for (const s of series) s.points.sort((a, b) => a.order - b.order)
  // Shows first, then comics, biggest first.
  series.sort((a, b) => (a.part === b.part ? b.points.length - a.points.length : a.part === 'show' ? -1 : 1))
  return { entries, volumes, series }
}

/** The last episode of a season (or as far as the season could go, when its episodes aren't known). */
function seasonEnd(t: WikiTimeline, series: string, season: number): number {
  const s = t.series.find((x) => x.name === series)
  const inSeason = s?.points.filter((p) => Math.floor(p.order / 1000) === season) ?? []
  return inSeason.length ? inSeason[inSeason.length - 1].order : season * 1000 + 999
}

// ---------- checking against how far you are ----------

export function allowed(req: UnitReq, s: WikiSpoilerSettings): boolean {
  if (!s.limit || req === 'safe') return true
  if (!req) return false
  return Object.entries(req).every(([series, order]) => (s.progress[series] ?? 0) >= order)
}

function merge(a: Req | null, b: Req | null): Req | null {
  if (!a) return b
  if (!b) return a
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v)
  return out
}

const reqOf = (e: TimelineEntry | undefined): Req | null => (e ? { [e.series]: e.order } : null)

// ---------- placing each part of a page ----------

export interface SpoilerContext {
  timeline: WikiTimeline
  /** A title (or redirect) → its page's key, as in the timeline. */
  key: (title: string) => string
  base: string
}

/** Info box fields that never give anything away. */
const SAFE_FIELDS = new Set(
  'name title image image1 actor actors alt actors voice voice actor portrayed by gender sex hair eye eyes ethnicity race species number airdate air date writer writers director runtime issue# issue date release date artist page count publisher published volume/season part'.split(
    ' '
  )
)
const BLOCK = new Set(['p', 'li', 'dt', 'dd', 'blockquote', 'pre', 'figure', 'figcaption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'caption'])
const HEADING = /^h([1-6])$/
/** Fandom's own machine-written "Quick Answers": not the wiki's text, and full of spoilers. */
const JUNK = /\b(trfc\d*|quick-answers|quick_answers|toc|mw-editsection|navbox|printfooter)\b/

interface Unit {
  el: Element
  heading: number | null
  /** The headings it's under, for search ("Post-Apocalypse › TV Series › Season 1"). */
  path: string
  text: string
  context: Req | null
  links: Req | null
  safe: boolean
  inBox: boolean
  firstField: boolean
}

const cls = (el: Element): string => el.attribs?.class ?? ''
const isElement = (n: AnyNode): n is Element => n.type === 'tag' || n.type === 'script' || n.type === 'style'

function isBlock(el: Element): boolean {
  if (BLOCK.has(el.name)) return true
  const c = cls(el)
  return /\bpi-data\b|\bpi-image\b|\bpi-header\b|\bpi-title\b|\bpi-horizontal-group-item\b|\bpi-caption\b|\bwikia-gallery-item\b|\bgallerybox\b/.test(c)
}

interface Walked {
  doc: ReturnType<typeof parseDocument>
  units: Unit[]
  part: WikiPart
  self: Req | null
  first: Req | null
}

/** Goes through a page in order and places every piece of it on the timeline. */
function walk(html: string, title: string, categories: string[], ctx: SpoilerContext): Walked {
  const doc = parseDocument(html)
  const part = pagePart(categories)
  const self = reqOf(ctx.timeline.entries[ctx.key(title)])
  const seriesNames = new Map(ctx.timeline.series.map((s) => [s.name.toLowerCase(), s.name]))
  const mainShow = ctx.timeline.series.find((s) => s.part === 'show')?.name ?? null
  const mainComics = ctx.timeline.series.find((s) => s.part === 'comics')?.name ?? null

  const units: Unit[] = []
  const unitOf = new Map<Element, Unit>()
  // Headings above where we are: their level, text, the series they name, and how far they need.
  const stack: { level: number; text: string; series: string | null; req: Req | null }[] = []
  let episode: Req | null = null
  let first: Req | null = null

  const entryFor = (href: string): TimelineEntry | undefined => {
    const link = wikiLink(href, ctx.base)
    return link?.kind === 'page' ? ctx.timeline.entries[ctx.key(link.title)] : undefined
  }
  const linksIn = (el: Element): Req | null => {
    let req: Req | null = null
    for (const a of DomUtils.findAll((n) => n.name === 'a' && !!n.attribs.href, [el])) req = merge(req, reqOf(entryFor(a.attribs.href)))
    return req
  }

  const headingReq = (el: Element, text: string, level: number): { series: string | null; req: Req | null } => {
    const plain = text.trim().toLowerCase()
    const named = seriesNames.get(plain) ?? null
    let req = linksIn(el)
    const season = /^season\s+(\d+)$/i.exec(text.trim())
    if (season) {
      // The show it's under ("Dead City › Season 1"); straight under a main heading it's the main show. Under a heading
      // that isn't a show Orbit knows, it can't be placed.
      const parent = [...stack].reverse().find((h) => h.level < level)
      const named = [...stack].reverse().find((h) => h.level < level && h.series)?.series
      const series = parent?.series ?? (!parent || parent.level <= 2 ? (named ?? (part === 'show' ? mainShow : null)) : null)
      if (series) req = merge(req, { [series]: seasonEnd(ctx.timeline, series, +season[1]) })
    }
    const volume = ctx.timeline.volumes[plain.replace(/^volume\s*\d+\s*:\s*/, '')]
    if (volume) req = merge(req, reqOf(ctx.timeline.entries[volume]))
    if (!req && part === 'comics' && /^volume\s+(\d+)/i.test(text.trim()) && mainComics) {
      // "Volume 3" with no link: as far as its last issue, if the volume's page said.
      const n = +/^volume\s+(\d+)/i.exec(text.trim())![1]
      const v = Object.entries(ctx.timeline.volumes).find(([, k]) => new RegExp(`^volume\\s*${n}\\b`).test(k))
      if (v) req = reqOf(ctx.timeline.entries[v[1]])
    }
    return { series: named, req }
  }

  const contextNow = (): Req | null => episode ?? [...stack].reverse().find((h) => h.req)?.req ?? self

  const makeUnit = (el: Element, box: boolean, safe: boolean, firstField: boolean, heading: number | null, context: Req | null): Unit => {
    const unit: Unit = {
      el,
      heading,
      path: stack.map((x) => x.text).join(' › '),
      text: '',
      context: box ? self : context,
      links: linksIn(el),
      safe,
      inBox: box,
      firstField
    }
    unitOf.set(el, unit)
    units.push(unit)
    return unit
  }

  const visit = (node: AnyNode, inBox: boolean, block: Element | null, safe: boolean, firstField: boolean): void => {
    if (node.type === 'text') {
      let unit = block ? unitOf.get(block) : undefined
      // Text outside any paragraph (straight inside a box): its box is placed as one piece, so nothing goes unchecked.
      if (!unit && node.data.trim() && node.parent && isElement(node.parent as AnyNode)) {
        const parent = node.parent as Element
        unit = unitOf.get(parent) ?? makeUnit(parent, inBox, safe, firstField, null, contextNow())
      }
      if (unit) unit.text += node.data
      return
    }
    if (!isElement(node)) return
    const el = node
    if (el.name === 'script' || el.name === 'style' || el.name === 'noscript' || JUNK.test(cls(el))) {
      DomUtils.removeElement(el)
      return
    }
    const box = inBox || (el.name === 'aside' && /portable-infobox/.test(cls(el)))
    const source = el.attribs['data-source']?.toLowerCase()
    const nowSafe = safe || (box && ((!!source && SAFE_FIELDS.has(source)) || /\bpi-title\b|\bpi-image\b/.test(cls(el))))
    const nowFirst = firstField || (box && !!source && /first/.test(source))
    let here = block
    if (isBlock(el)) {
      here = el
      const h = HEADING.exec(el.name)
      const isHeading = !!h && !box
      const level = isHeading ? +h![1] : null
      let context = contextNow()
      if (isHeading) {
        const text = DomUtils.textContent(el)
        while (stack.length && stack[stack.length - 1].level >= level!) stack.pop()
        const { series, req } = headingReq(el, text, level!)
        stack.push({ level: level!, text: text.trim(), series, req })
        episode = null
        context = [...stack].reverse().find((x) => x.req)?.req ?? self
      } else if (el.name === 'dt' && !box) {
        // "Guts" above the paragraphs about that episode, inside a season.
        const req = linksIn(el)
        if (req) {
          // The episode is more exact than the season it's in.
          episode = req
          context = episode
        }
      }
      const unit = makeUnit(el, box, nowSafe, nowFirst, isHeading ? level : null, context)
      if (nowFirst && unit.links) {
        // First appearance: the earliest thing it links to, in each series.
        for (const a of DomUtils.findAll((n) => n.name === 'a' && !!n.attribs.href, [el])) {
          const e = entryFor(a.attribs.href)
          if (e) first = { ...(first ?? {}), [e.series]: Math.min(first?.[e.series] ?? Infinity, e.order) }
        }
      }
    }
    for (const child of [...el.children]) visit(child, box, here, nowSafe, nowFirst)
  }
  for (const child of [...doc.children]) visit(child, false, null, false, false)
  // An info box label above its value in a row ("First Appearance" over "Days Gone Bye") follows that value:
  // shown when it is, hidden when it isn't (so "Death Episode" doesn't give a death away).
  const values = new Map<string, Unit>()
  for (const u of units) if (u.inBox && u.el.name === 'td' && u.el.attribs['data-source']) values.set(u.el.attribs['data-source'], u)
  for (const u of units) {
    const value = u.inBox && u.el.name === 'th' ? values.get(u.el.attribs['data-source'] ?? '') : undefined
    if (!value) continue
    u.safe = value.safe
    u.context = value.context
    u.links = value.links
  }
  return { doc, units, part, self, first }
}

/** How far a piece needs you to be. */
function unitReq(u: Unit): UnitReq {
  if (u.safe) return 'safe'
  return merge(u.context, u.links)
}

/** Whether a whole page can be shown: its part is switched on, and you've reached it (or the first thing it's in). */
export function pageAllowed(page: { part: WikiPart; self: Req | null; first: Req | null }, s: WikiSpoilerSettings): 'ok' | 'part' | 'later' | 'unplaced' {
  if (!partShown(page.part, s.parts)) return 'part'
  if (!s.limit) return 'ok'
  if (page.self) return allowed(page.self, s) ? 'ok' : 'later'
  if (page.first) return Object.entries(page.first).some(([series, order]) => (s.progress[series] ?? 0) >= order) ? 'ok' : 'later'
  // Nothing on it could be placed: even its name might give something away.
  return 'unplaced'
}

export interface PageFacts {
  part: WikiPart
  self: Req | null
  first: Req | null
}

export interface PlacedChunk {
  section: string
  text: string
  req: UnitReq
}

/** A page's text in pieces of at most `max` characters, each placed on the timeline (for searching and the wiki brain). */
export function placedChunks(html: string, title: string, categories: string[], ctx: SpoilerContext, max = 1200): { facts: PageFacts; chunks: PlacedChunk[] } {
  const w = walk(html, title, categories, ctx)
  const chunks: PlacedChunk[] = []
  let cur: PlacedChunk | null = null
  const reqKey = (r: UnitReq): string => (r === 'safe' ? 'safe' : r ? JSON.stringify(Object.entries(r).sort()) : 'none')
  for (const u of w.units) {
    if (u.heading !== null) continue
    const text = u.text.replace(/\s+/g, ' ').trim()
    if (!text || /^(references|external links)\b/i.test(u.path.split(' › ')[0] ?? '')) continue
    const req = unitReq(u)
    const section = u.inBox ? '' : u.path
    if (!cur || cur.section !== section || reqKey(cur.req) !== reqKey(req) || cur.text.length + text.length > max) {
      if (cur) chunks.push(cur)
      cur = { section, text: '', req }
    }
    cur.text += (cur.text ? '\n' : '') + text.slice(0, max)
  }
  if (cur) chunks.push(cur)
  // With no first appearance in its info box, a page is as early as the earliest thing on it.
  let first = w.first
  if (!first && !w.self)
    for (const c of chunks) {
      if (!c.req || c.req === 'safe') continue
      for (const [series, order] of Object.entries(c.req)) first = { ...(first ?? {}), [series]: Math.min(first?.[series] ?? Infinity, order) }
    }
  return { facts: { part: w.part, self: w.self, first }, chunks }
}

/** Hidden pieces that leave a note (others, like info box fields and list items, just go). */
const NOTE_TAGS = new Set(['p', 'blockquote', 'pre', 'dd', 'figure', 'div', 'center'])
const HIDDEN_BOTH = 'Hidden: past where you are, or Orbit couldn’t tell when it happens.'
const HIDDEN_LATER = 'Hidden: this is past where you are.'
const HIDDEN_UNPLACED = 'Hidden: Orbit couldn’t tell when this happens.'

/**
 * A page with everything past where you are taken out (and what couldn't be placed, unless
 * `showUnplaced`). Hidden paragraphs leave a short note; hidden info box fields and list items
 * just go. Headings with nothing left under them go too.
 */
export function filterPage(html: string, title: string, categories: string[], ctx: SpoilerContext, s: WikiSpoilerSettings, showUnplaced: boolean): { html: string; hiddenLater: number; hiddenUnplaced: number } {
  const w = walk(html, title, categories, ctx)
  let hiddenLater = 0
  let hiddenUnplaced = 0
  const visible = new Set<Unit>()
  for (const u of w.units) {
    if (u.heading !== null) continue
    const req = unitReq(u)
    if (allowed(req, s) || (showUnplaced && req === null)) visible.add(u)
  }
  // A heading stays when something under it (before the next heading as big) is shown, and it isn't past you itself.
  w.units.forEach((u, i) => {
    if (u.heading === null) return
    if (s.limit && u.context && !allowed(u.context, s)) return
    for (let j = i + 1; j < w.units.length; j++) {
      const next = w.units[j]
      if (next.heading !== null && next.heading <= u.heading) break
      if (visible.has(next) && next.text.trim()) {
        visible.add(u)
        return
      }
    }
  })
  if (!s.limit) return { html: DomUtils.getOuterHTML(w.doc), hiddenLater, hiddenUnplaced }

  for (const u of w.units) {
    if (visible.has(u)) continue
    const unplaced = unitReq(u) === null
    // Pieces inside it that are their own (a list inside a list item) are kept or hidden by themselves.
    for (const child of [...u.el.children]) {
      if (isElement(child) && (isBlock(child) || DomUtils.findOne(isBlock, child.children, true))) continue
      DomUtils.removeElement(child)
    }
    const left = !!DomUtils.textContent(u.el).trim() || !!DomUtils.findOne((n) => n.name === 'img', u.el.children, true)
    if (left) continue
    if (u.heading === null && !u.inBox && NOTE_TAGS.has(u.el.name) && u.text.trim()) {
      if (unplaced) hiddenUnplaced++
      else hiddenLater++
      const note = parseDocument(`<div class="wiki-hidden${unplaced ? ' unplaced' : ''}">${unplaced ? HIDDEN_UNPLACED : HIDDEN_LATER}</div>`).children[0] as Element
      DomUtils.replaceElement(u.el, note)
    } else DomUtils.removeElement(u.el)
  }
  tidy(w.doc.children)
  return { html: DomUtils.getOuterHTML(w.doc), hiddenLater, hiddenUnplaced }
}

/** Takes away boxes left with nothing in them, and runs of hidden notes become one. */
function tidy(nodes: AnyNode[]): void {
  for (const n of [...nodes]) {
    if (!isElement(n)) continue
    tidy(n.children)
    const keep = ['br', 'hr', 'img', 'td', 'th'].includes(n.name) || /wiki-hidden/.test(cls(n))
    if (!keep && !DomUtils.textContent(n).trim() && !DomUtils.findOne((x) => x.name === 'img', n.children, true)) DomUtils.removeElement(n)
  }
  // Notes next to each other (with only space between) become one.
  for (const n of [...nodes]) {
    if (!isElement(n) || !/wiki-hidden/.test(cls(n)) || !n.parent) continue
    let next = n.next
    while (next && next.type === 'text' && !next.data.trim()) next = next.next
    if (next && isElement(next) && /wiki-hidden/.test(cls(next))) {
      if (cls(next) !== cls(n)) {
        next.attribs.class = 'wiki-hidden'
        next.children = parseDocument(HIDDEN_BOTH).children
      }
      DomUtils.removeElement(n)
    }
  }
}

// ---------- the final check on the wiki brain's answer ----------

/** Names an answer mustn't mention: pages you haven't reached (without "(TV Series)"), unless a page you have reached has the same name. */
export function forbiddenNames(hidden: string[], shown: string[]): string[] {
  const base = (t: string): string => t.replace(/\s*\([^)]*\)\s*$/, '').trim()
  const ok = new Set(shown.map((t) => base(t).toLowerCase()))
  const out = new Set<string>()
  for (const t of hidden) {
    const b = base(t)
    if (b.length >= 4 && !ok.has(b.toLowerCase()) && !/^(issue|volume|season|episode)\s+\d+$/i.test(b)) out.add(b)
  }
  return [...out]
}

/** The first hidden name an answer mentions (as a whole word, in the same capitals), or null. */
export function mentionsHidden(answer: string, names: string[]): string | null {
  for (const n of names) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u')
    if (re.test(answer)) return n
  }
  return null
}
