import {
  activeTake,
  allScenes,
  buildBrain,
  calendarOrder,
  checkContinuity,
  countWords,
  dateLabel,
  diffText,
  entityById,
  findMentions,
  findQuote,
  findScene,
  flashbacks,
  pacing,
  READER,
  relationshipAt,
  sceneFacts,
  sceneText,
  sentences,
  stepsInOrder,
  type Brain,
  type Chapter,
  type ContinuityIssue,
  type Entity,
  type Fact,
  type PlotThread,
  type ReaderComment,
  type Secret,
  type Story
} from './writing'

/**
 * The Writing Studio's second set of tools, worked out from the story with no app: who knows what,
 * setups and payoffs, how each character talks, the canon drawer, AO3 tags, what readers' comments
 * picked out, the cutting room floor, the story map's steps, the story's shape, reading aloud and
 * what the stuck button tells the AI about a scene.
 */

const orderMap = (story: Story): Map<string, number> => new Map(allScenes(story).map((p) => [p.scene.id, p.order]))
const sceneName = (story: Story, id: string): string => {
  const p = findScene(story, id)
  return p ? `${p.chapter.title} – ${p.scene.title}` : 'a deleted scene'
}

// ---------- who knows what ----------

/** When someone finds a secret out, as a scene order (-1: from the start), or null if they never do. */
export function learnsAt(story: Story, secret: Secret, who: string, orders = orderMap(story)): number | null {
  let best: number | null = null
  for (const l of secret.learns) {
    if (l.who !== who) continue
    const o = l.scene ? orders.get(l.scene) : -1
    if (o === undefined) continue
    if (best === null || o < best) best = o
  }
  return best
}

/** Whether someone knows a secret by a point in the story (a scene order; a scene where they find out counts). */
export function knows(story: Story, secret: Secret, who: string, order: number, orders = orderMap(story)): boolean {
  const at = learnsAt(story, secret, who, orders)
  return at !== null && at <= order
}

const cueRe = (cues: string[]): RegExp | null => {
  const clean = cues.map((c) => c.trim()).filter((c) => c.length >= 2)
  if (!clean.length) return null
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${clean.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}])`, 'giu')
}

/**
 * Characters who seem to act on a secret before they know it: a sentence naming them that also has
 * one of the secret's cue words, in a scene before they find out. Only secrets with someone on their
 * "who finds out" list are checked, so a secret you've just started writing down stays quiet.
 */
export function secretSlips(story: Story, sceneId: string, text: string): ContinuityIssue[] {
  const placed = findScene(story, sceneId)
  if (!placed) return []
  const orders = orderMap(story)
  const chars = new Map(story.entities.filter((e) => e.kind === 'character').map((e) => [e.id, e]))
  const mentions = findMentions(text, story.entities).filter((m) => chars.has(m.entity))
  const out: ContinuityIssue[] = []
  for (const secret of story.secrets) {
    const re = cueRe(secret.cues)
    if (!re || !secret.learns.some((l) => l.who !== READER)) continue
    for (const s of sentences(text)) {
      const end = s.start + s.text.length
      re.lastIndex = 0
      const cue = re.exec(s.text)
      if (!cue) continue
      const flagged = new Set<string>()
      for (const m of mentions) {
        if (m.start < s.start || m.end > end || flagged.has(m.entity)) continue
        if (knows(story, secret, m.entity, placed.order, orders)) continue
        flagged.add(m.entity)
        const at = learnsAt(story, secret, m.entity, orders)
        const learn = secret.learns.find((l) => l.who === m.entity && l.scene && orders.get(l.scene) === at)
        const when = at === null || !learn ? 'never finds out' : `doesn’t find out until “${sceneName(story, learn.scene)}”`
        out.push({ start: s.start + cue.index, end: s.start + cue.index + cue[0].length, entity: m.entity, message: `${chars.get(m.entity)!.name} ${when} that ${secret.text || 'this secret'}.` })
      }
    }
  }
  return out
}

export interface SecretGap {
  who: string
  /** Who knows first: the reader (dramatic irony) or the character (a mystery for the reader). */
  ahead: 'reader' | 'character'
  from: number
  to: number | null
}

/** Stretches where the reader knows a secret and a character doesn't (or the other way round). */
export function secretGaps(story: Story, secret: Secret): SecretGap[] {
  const orders = orderMap(story)
  const reader = learnsAt(story, secret, READER, orders)
  const out: SecretGap[] = []
  const people = [...new Set(secret.learns.map((l) => l.who).filter((w) => w !== READER))]
  for (const who of people) {
    const them = learnsAt(story, secret, who, orders)
    if (them === reader) continue
    if (reader !== null && (them === null || reader < them)) out.push({ who, ahead: 'reader', from: reader, to: them })
    else if (them !== null && (reader === null || them < reader)) out.push({ who, ahead: 'character', from: them, to: reader })
  }
  return out
}

// ---------- setups and payoffs ----------

/** Setups that haven't paid off yet (and you haven't let go of), oldest first. */
export function openThreads(story: Story): PlotThread[] {
  const orders = orderMap(story)
  return story.threads.filter((t) => !t.dropped && !t.payoffs.length).sort((a, b) => (orders.get(a.setup.scene) ?? 1e9) - (orders.get(b.setup.scene) ?? 1e9))
}

/** Where setups and payoffs are in one scene's text, for underlining them. */
export function threadMarks(story: Story, sceneId: string, text: string): { from: number; to: number; kind: 'setup' | 'payoff'; title: string }[] {
  const out: { from: number; to: number; kind: 'setup' | 'payoff'; title: string }[] = []
  for (const t of story.threads) {
    if (t.setup.scene === sceneId) {
      const at = findQuote(text, t.setup.quote)
      if (at) out.push({ from: at.start, to: at.end, kind: 'setup', title: `Setup: ${t.label}${t.payoffs.length ? ' (paid off)' : t.dropped ? ' (let go)' : ' (not paid off yet)'}` })
    }
    for (const p of t.payoffs) {
      if (p.scene !== sceneId) continue
      const at = findQuote(text, p.quote)
      if (at) out.push({ from: at.start, to: at.end, kind: 'payoff', title: `Pays off: ${t.label}` })
    }
  }
  return out
}

/** How long ago a setup was planted, in scenes, from a point in the story. */
export function scenesSince(story: Story, sceneId: string, from: string): number | null {
  const orders = orderMap(story)
  const a = orders.get(sceneId)
  const b = orders.get(from)
  return a === undefined || b === undefined ? null : b - a
}

// ---------- voice ----------

export interface Line {
  who: string
  text: string
  start: number
  end: number
}

const SPEECH =
  /^(said|says|asked|asks|replied|replies|whispered|shouted|yelled|muttered|called|snapped|told|answered|added|murmured|growled|grunted|cried|screamed|laughed|sighed|hissed|mumbled|barked|drawled|continued|insisted|admitted|demanded|began|offered|repeated|breathed|spat|joked|teased|warned|pleaded|begged)$/i

/**
 * The lines of dialogue in a text and who says each: the one character named outside the quotes
 * in that paragraph, or the one next to "said" (or "asked", "muttered"…) when there are several.
 * Lines it can't place are left out.
 */
export function dialogueLines(text: string, entities: Entity[]): Line[] {
  const chars = entities.filter((e) => e.kind === 'character')
  if (!chars.length) return []
  const out: Line[] = []
  let at = 0
  for (const para of text.split('\n')) {
    const base = at
    at += para.length + 1
    const quotes: { start: number; end: number; text: string }[] = []
    const re = /“([^”]*)”?|"([^"\n]*)"?/g
    for (let m = re.exec(para); m; m = re.exec(para)) {
      const inner = (m[1] ?? m[2] ?? '').trim()
      if (inner) quotes.push({ start: m.index, end: m.index + m[0].length, text: inner })
    }
    if (!quotes.length) continue
    const inQuote = (i: number): boolean => quotes.some((q) => i >= q.start && i < q.end)
    const names = findMentions(para, chars).filter((m) => !inQuote(m.start))
    const ids = [...new Set(names.map((n) => n.entity))]
    let who: string | null = ids.length === 1 ? ids[0] : null
    if (!who && ids.length > 1) {
      for (const n of names) {
        const before = para.slice(Math.max(0, n.start - 20), n.start).trim().split(/\s+/).pop() ?? ''
        const after = para.slice(n.end, n.end + 20).trim().split(/\s+/)[0] ?? ''
        if (SPEECH.test(before.replace(/[^a-z]/gi, '')) || SPEECH.test(after.replace(/[^a-z]/gi, ''))) {
          who = n.entity
          break
        }
      }
    }
    if (!who) continue
    for (const q of quotes) out.push({ who, text: q.text, start: base + q.start, end: base + q.end })
  }
  return out
}

const SWEARS = new Set(
  `fuck fucking fucked fucker motherfucker shit shitty bullshit damn damned dammit goddamn goddammit hell ass asshole bastard bitch crap piss pissed bloody bugger arse dick prick wanker`.split(/\s+/)
)
const FORMAL: [RegExp, string][] = [
  [/\bdo not\b/i, 'don’t'],
  [/\bdoes not\b/i, 'doesn’t'],
  [/\bcannot\b/i, 'can’t'],
  [/\bwill not\b/i, 'won’t'],
  [/\bI am\b/, 'I’m'],
  [/\bit is\b/i, 'it’s'],
  [/\bthat is\b/i, 'that’s'],
  [/\bwe are\b/i, 'we’re'],
  [/\byou are\b/i, 'you’re'],
  [/\bthey are\b/i, 'they’re'],
  [/\bis not\b/i, 'isn’t'],
  [/\bdid not\b/i, 'didn’t'],
  [/\bI will\b/, 'I’ll'],
  [/\bI have\b/, 'I’ve']
]
const CONTRACTION = /\b[a-z]+[’'](?:t|m|s|re|ll|ve|d)\b/gi
const COMMON = new Set(
  `the a an and or but if so to of in on at by for with from up down out over under is are was were be been am i you he she it we they me him her us them my your his its our their this that these those what who how why when where there here not no yes just do does did have has had will would can could should get got go going gonna come know like want need think right now then oh well okay ok all one about some any too very really back don’t don't can’t can't i’m i'm it’s it's that’s that's you’re you're we’re we're they’re they're won’t won't didn’t didn't isn’t isn't i’ll i'll i’ve i've let’s let's`.split(/\s+/)
)

export interface Voice {
  lines: number
  words: number
  /** Words per line, on average. */
  perLine: number
  /** Share of lines that ask something, and that end in "!". */
  questions: number
  exclaims: number
  /** Swear words per 100 words. */
  swears: number
  /** Of the places they could shorten ("don't" or "do not"), the share where they do. */
  contracts: number
  /** How many times they could have. */
  contractChances: number
  /** Words they use more than anyone else does. */
  favourites: string[]
}

const wordsOf = (s: string): string[] => s.toLowerCase().match(/[\p{L}’']+/gu) ?? []

function measure(lines: string[], everyone: Map<string, number>, everyoneTotal: number): Voice {
  let words = 0
  let questions = 0
  let exclaims = 0
  let swears = 0
  let contracted = 0
  let formal = 0
  const counts = new Map<string, number>()
  for (const l of lines) {
    const w = wordsOf(l)
    words += w.length
    if (l.includes('?')) questions++
    if (l.includes('!')) exclaims++
    for (const x of w) {
      if (SWEARS.has(x)) swears++
      counts.set(x, (counts.get(x) ?? 0) + 1)
    }
    contracted += (l.match(CONTRACTION) ?? []).length
    for (const [re] of FORMAL) if (re.test(l)) formal++
  }
  const favourites = [...counts]
    .filter(([w, n]) => n >= 2 && w.length >= 3 && !COMMON.has(w))
    .map(([w, n]) => ({ w, score: n / Math.max(1, words) / ((everyone.get(w) ?? n) / Math.max(1, everyoneTotal)), n }))
    .filter((x) => x.score > 1.3 || x.n >= 4)
    .sort((a, b) => b.score * b.n - a.score * a.n)
    .slice(0, 8)
    .map((x) => x.w)
  const n = Math.max(1, lines.length)
  return {
    lines: lines.length,
    words,
    perLine: words / n,
    questions: questions / n,
    exclaims: exclaims / n,
    swears: words ? (swears / words) * 100 : 0,
    contracts: contracted + formal ? contracted / (contracted + formal) : 1,
    contractChances: contracted + formal,
    favourites
  }
}

/** Every line of dialogue in the story (takes in use), by who says it, with which scene it's in. */
export function storyLines(story: Story): (Line & { scene: string })[] {
  const out: (Line & { scene: string })[] = []
  for (const p of allScenes(story)) for (const l of dialogueLines(sceneText(p.scene), story.entities)) out.push({ ...l, scene: p.scene.id })
  return out
}

/** How each character talks, from all their lines in the story. */
export function voices(story: Story, lines = storyLines(story)): Map<string, Voice> {
  const everyone = new Map<string, number>()
  let total = 0
  for (const l of lines)
    for (const w of wordsOf(l.text)) {
      everyone.set(w, (everyone.get(w) ?? 0) + 1)
      total++
    }
  const by = new Map<string, string[]>()
  for (const l of lines) by.set(l.who, [...(by.get(l.who) ?? []), l.text])
  return new Map([...by].map(([who, ls]) => [who, measure(ls, everyone, total)]))
}

/** A character needs this many lines before their voice is checked. */
export const VOICE_MIN_LINES = 8

/**
 * Lines in a scene that don't sound like the character saying them, measured against everything
 * else they say: swearing when they never do, "do not" from someone who always says "don't", a
 * speech from someone who talks in short bursts.
 */
export function voiceFlags(story: Story, sceneId: string, text: string, all = storyLines(story)): ContinuityIssue[] {
  const here = dialogueLines(text, story.entities)
  const out: ContinuityIssue[] = []
  for (const line of here) {
    // Measured without this line, so one odd line can't hide itself.
    const others = all.filter((l) => l.who === line.who && !(l.scene === sceneId && l.text === line.text))
    if (others.length < VOICE_MIN_LINES) continue
    const v = measure(
      others.map((l) => l.text),
      new Map(),
      0
    )
    const name = entityById(story, line.who)?.name ?? 'They'
    const w = wordsOf(line.text)
    const swear = w.find((x) => SWEARS.has(x))
    if (swear && v.swears === 0) {
      out.push({ start: line.start, end: line.end, entity: line.who, message: `${name} doesn’t swear anywhere else (“${swear}”).` })
      continue
    }
    const formal = FORMAL.find(([re]) => re.test(line.text))
    if (formal && v.contractChances >= 6 && v.contracts >= 0.85) {
      const said = formal[0].exec(line.text)![0]
      out.push({ start: line.start, end: line.end, entity: line.who, message: `${name} usually says “${formal[1]}”, not “${said}”.` })
      continue
    }
    if (w.length >= 18 && v.perLine <= 8 && w.length >= v.perLine * 3) {
      out.push({ start: line.start, end: line.end, entity: line.who, message: `Long for ${name}: they usually say about ${Math.max(1, Math.round(v.perLine))} words at a time.` })
    }
  }
  return out
}

// ---------- canon ----------

const DEAD_LABEL = /\b(dead|died|dies|death|status|alive|fate)\b/i
const DEAD_VALUE = /\b(dead|died|dies|killed|deceased)\b/i

/** A canon fact that says someone is dead. */
export const saysDead = (f: Fact): boolean => DEAD_LABEL.test(f.label) && DEAD_VALUE.test(f.value)

/**
 * Things in a scene that go against canon (facts you haven't marked as changed on purpose): eye
 * colour, hair and age like the character pages, and someone canon has dead turning up in a scene.
 * A character's own page wins where it says something different.
 */
export function canonIssues(story: Story, sceneId: string, text: string): ContinuityIssue[] {
  const facts = story.canon.facts.filter((f) => !f.changed && f.entity && f.label.trim() && f.value.trim())
  if (!facts.length) return []
  const out = checkContinuity(story, sceneId, text, {
    deaths: false,
    factsOf: (e) => facts.filter((f) => f.entity === e.id && !e.facts.some((p) => p.value.trim() && p.label.trim().toLowerCase() === f.label.trim().toLowerCase())),
    where: (e, f) => `In canon, ${e.name}’s ${f.label.toLowerCase()} is ${f.value}.`
  })
  const placed = findScene(story, sceneId)
  if (placed) {
    const cast = sceneFacts(story, placed).cast
    const mentions = findMentions(text, story.entities)
    for (const f of facts) {
      if (!saysDead(f) || !cast.includes(f.entity)) continue
      const e = entityById(story, f.entity)
      const m = mentions.find((x) => x.entity === f.entity)
      if (e && m) out.push({ start: m.start, end: m.end, entity: e.id, message: `In canon, ${e.name} is ${f.value}. If that’s on purpose, tick “Changed on purpose” in the canon drawer.` })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/** Character pages that say something different from canon (and the fact isn't marked as changed). */
export function canonDifferences(story: Story): { fact: string; entity: string; page: string; canon: string }[] {
  const out: { fact: string; entity: string; page: string; canon: string }[] = []
  for (const f of story.canon.facts) {
    if (f.changed || !f.entity) continue
    const e = entityById(story, f.entity)
    const p = e?.facts.find((x) => x.label.trim().toLowerCase() === f.label.trim().toLowerCase() && x.value.trim())
    if (e && p && p.value.trim().toLowerCase() !== f.value.trim().toLowerCase()) out.push({ fact: f.id, entity: e.id, page: p.value, canon: f.value })
  }
  return out
}

// ---------- AO3 tags ----------

export const AO3_RATINGS = ['Not Rated', 'General Audiences', 'Teen And Up Audiences', 'Mature', 'Explicit'] as const
export const AO3_WARNINGS = [
  'Creator Chose Not To Use Archive Warnings',
  'Graphic Depictions Of Violence',
  'Major Character Death',
  'No Archive Warnings Apply',
  'Rape/Non-Con',
  'Underage Sex'
] as const

const ROMANTIC = /\b(dating|lovers?|married|marry|partners?|together|romance|romantic|crush|engaged|boyfriends?|girlfriends?|husbands?|wife|wives|in love|kiss(ed|ing)?|exes|ex|ex-|sleeping together|hook(ed)? up|spouses?|fianc[eé]e?)\b/i
const VIOLENT = new Set(
  `blood bloody bleeding bled gore gory guts entrails corpse corpses stabbed stabbing slit severed decapitated beheaded skull brains torn mangled maimed bite bitten gunshot shot killed kill killing murder murdered butchered`.split(/\s+/)
)

export interface Ao3Suggestion {
  fandom: string
  rating: string
  ratingWhy: string
  warnings: string[]
  relationships: string[]
  characters: string[]
  freeform: string[]
}

/**
 * Tags worked out from the story brain: characters by how much they're in it, relationships from
 * the relationship histories ("A/B" for a romance, "A & B" otherwise), Major Character Death if
 * someone dies, and a rating and violence warning from the words used. They're suggestions to check.
 */
export function ao3Suggest(story: Story, brain: Brain = buildBrain(story)): Ao3Suggestion {
  const name = (id: string): string => entityById(story, id)?.name ?? ''
  const inScenes = new Map<string, number>()
  for (const s of brain.scenes) for (const c of s.cast) inScenes.set(c, (inScenes.get(c) ?? 0) + 1)
  const characters = [...inScenes].sort((a, b) => b[1] - a[1]).map(([id]) => name(id)).filter(Boolean)
  const romance: string[] = []
  const friends: string[] = []
  for (const r of story.relationships) {
    if (!name(r.a) || !name(r.b) || !r.steps.length) continue
    const romantic = r.steps.some((s) => ROMANTIC.test(s.label))
    if (romantic) romance.push(`${name(r.a)}/${name(r.b)}`)
    else friends.push(`${name(r.a)} & ${name(r.b)}`)
  }
  let words = 0
  let swears = 0
  let violent = 0
  for (const p of allScenes(story))
    for (const w of wordsOf(sceneText(p.scene))) {
      words++
      if (SWEARS.has(w)) swears++
      if (VIOLENT.has(w)) violent++
    }
  const perK = (n: number): number => (words ? (n / words) * 1000 : 0)
  const graphic = perK(violent) >= 4 && violent >= 5
  const deaths = story.entities.some((e) => e.kind === 'character' && e.diesIn && findScene(story, e.diesIn))
  const warnings = [...(graphic ? ['Graphic Depictions Of Violence'] : []), ...(deaths ? ['Major Character Death'] : [])]
  let rating = 'General Audiences'
  let ratingWhy = 'Nothing in the words suggests a higher rating.'
  if (graphic) {
    rating = 'Mature'
    ratingWhy = 'There’s a lot of graphic violence.'
  } else if (swears || violent) {
    rating = 'Teen And Up Audiences'
    ratingWhy = swears ? 'There’s some swearing.' : 'There’s some violence.'
  }
  const freeform: string[] = []
  if (story.canon.splitAt) freeform.push('Alternate Universe - Canon Divergence')
  if (deaths) freeform.push('Character Death')
  if (flashbacks(brain).length) freeform.push('Flashbacks')
  return {
    fandom: story.tags.fandom || story.canon.source,
    rating,
    ratingWhy,
    warnings: warnings.length ? warnings : ['No Archive Warnings Apply'],
    relationships: [...romance, ...friends],
    characters,
    freeform
  }
}

// ---------- reader comments ----------

const norm = (s: string): string[] => s.toLowerCase().replace(/[’‘]/g, "'").match(/[\p{L}\p{N}']+/gu) ?? []
/** The most words in a row two word lists share. */
function longestRun(a: string[], b: string[]): number {
  let best = 0
  let prev = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1
        if (cur[j] > best) best = cur[j]
      }
    }
    prev = cur
  }
  return best
}

export interface QuotedLine {
  scene: string
  start: number
  end: number
  text: string
  /** The comments that picked it out. */
  comments: string[]
}

/**
 * The lines of a chapter that readers' comments quote or echo: five words in a row the same, or a
 * short line quoted whole. Most picked out first. Also how often each character is named.
 */
export function commentHeat(story: Story, chapter: Chapter, comments: ReaderComment[]): { lines: QuotedLine[]; names: { entity: string; count: number }[] } {
  const sents: { scene: string; start: number; end: number; text: string; words: string[] }[] = []
  for (const s of chapter.scenes) {
    const text = sceneText(s)
    for (const sent of sentences(text)) {
      const words = norm(sent.text)
      if (words.length < 3) continue
      const lead = sent.text.length - sent.text.trimStart().length
      sents.push({ scene: s.id, start: sent.start + lead, end: sent.start + sent.text.trimEnd().length, text: sent.text.trim(), words })
    }
  }
  const by = new Map<number, string[]>()
  for (const c of comments) {
    const cw = norm(c.text)
    const quoted = (c.text.match(/[“"]([^”"]{3,})[”"]/g) ?? []).map((q) => ` ${norm(q).join(' ')} `)
    // Each comment counts for the line it echoes most closely: five or more words in a row, or a short line quoted whole.
    const runs = sents.map((s) => {
      if (s.words.length < 5) return quoted.some((q) => q.includes(` ${s.words.join(' ')} `)) ? s.words.length + 100 : 0
      return longestRun(s.words, cw)
    })
    const best = Math.max(0, ...runs)
    if (best < 5) continue
    runs.forEach((r, i) => {
      if (r === best) by.set(i, [...(by.get(i) ?? []), c.id])
    })
  }
  const lines: QuotedLine[] = [...by].map(([i, ids]) => ({ scene: sents[i].scene, start: sents[i].start, end: sents[i].end, text: sents[i].text, comments: ids }))
  const counts = new Map<string, number>()
  const chars = story.entities.filter((e) => e.kind === 'character')
  // Readers shout names in capitals ("DARYL!!"), so names are matched however they're written.
  const lower = chars.map((e) => ({ ...e, name: e.name.toLowerCase(), aliases: e.aliases.map((a) => a.toLowerCase()) }))
  for (const c of comments) for (const id of new Set(findMentions(c.text.toLowerCase(), lower).map((m) => m.entity))) counts.set(id, (counts.get(id) ?? 0) + 1)
  return {
    lines: lines.sort((a, b) => b.comments.length - a.comments.length),
    names: [...counts].map(([entity, count]) => ({ entity, count })).sort((a, b) => b.count - a.count)
  }
}

// ---------- the cutting room floor ----------

/** What a change deleted, if it's worth keeping: at least a sentence or so, and not just rewritten in place. */
export function cutFrom(before: string, after: string): string | null {
  const rev = diffText(before, after, 0)
  if (!rev || !rev.del) return null
  const removed = before.slice(rev.at, rev.at + rev.del).trim()
  if (countWords(removed) < 8) return null
  if (rev.ins.length * 2 > rev.del) return null
  return removed
}

// ---------- the story map ----------

export interface MapStep {
  scene: string
  label: string
  title: string
  /** Where each character is by now (a location id). */
  at: Record<string, string>
  /** Who's in this step's scene. */
  here: string[]
  place: string
}

/**
 * The story map's steps: scenes with a place, in story-calendar order (or book order if nothing
 * has a date yet). Each step says where every character is by then: the last place they were seen.
 */
export function mapSteps(story: Story, brain: Brain = buildBrain(story)): { steps: MapStep[]; byCalendar: boolean } {
  const dated = calendarOrder(brain).filter((s) => s.place)
  const byCalendar = dated.length > 0
  const list = byCalendar ? dated : brain.scenes.filter((s) => s.place)
  const at: Record<string, string> = {}
  const steps: MapStep[] = []
  for (const s of list) {
    for (const c of s.cast) at[c] = s.place!
    const p = findScene(story, s.id)
    steps.push({ scene: s.id, label: byCalendar ? dateLabel(s.date) : (p?.chapter.title ?? ''), title: s.title, at: { ...at }, here: s.cast, place: s.place! })
  }
  return { steps, byCalendar }
}

// ---------- the story's shape ----------

/**
 * How tense a bit of writing feels, from 0 to 1, roughly: action, short sentences, questions and
 * exclamations push it up; long description brings it down. Rough on purpose, like the pacing strip.
 */
export function tension(text: string): number {
  const sents = sentences(text).filter((s) => s.text.trim())
  if (!sents.length) return 0
  const p = pacing(text)
  const short = sents.filter((s) => countWords(s.text) <= 8).length / sents.length
  const sharp = sents.filter((s) => /[!?]["”’)]*\s*$/.test(s.text.trim())).length / sents.length
  const raw = 0.5 * p.action + 0.25 * short + 0.15 * Math.min(1, sharp * 2) + 0.1 * p.dialogue
  return Math.min(1, Math.max(0, raw))
}

export interface ShapePoint {
  scene: string
  /** Where the scene sits in the story, 0–1 by words (its middle). */
  x: number
  /** Its tension, scaled so the calmest scene is 0 and the tensest is 1. */
  y: number
  words: number
}

/** The story's real shape: each scene's tension, placed by how far through the story it is. */
export function storyShape(story: Story): ShapePoint[] {
  const scenes = allScenes(story).map((p) => ({ id: p.scene.id, text: activeTake(p.scene).text }))
  const words = scenes.map((s) => countWords(s.text))
  const total = words.reduce((a, b) => a + b, 0)
  if (!total) return []
  const raw = scenes.map((s) => tension(s.text))
  const used = raw.filter((_, i) => words[i] > 0)
  const lo = Math.min(...used)
  const hi = Math.max(...used)
  let run = 0
  const out: ShapePoint[] = []
  scenes.forEach((s, i) => {
    if (!words[i]) return
    out.push({ scene: s.id, x: (run + words[i] / 2) / total, y: hi > lo ? (raw[i] - lo) / (hi - lo) : 0.5, words: words[i] })
    run += words[i]
  })
  return out
}

/** How many points a drawn shape has. */
export const SHAPE_POINTS = 48

/** The drawn shape's height at a point (0–1 across), joining the dots. */
export function shapeAt(shape: number[], x: number): number {
  if (!shape.length) return 0
  const f = Math.min(1, Math.max(0, x)) * (shape.length - 1)
  const i = Math.floor(f)
  const j = Math.min(shape.length - 1, i + 1)
  return shape[i] + (shape[j] - shape[i]) * (f - i)
}

export const SHAPE_PRESETS: { id: string; label: string; at: (x: number) => number }[] = [
  { id: 'rise', label: 'Build to a climax', at: (x) => (x < 0.85 ? 0.1 + 0.85 * (x / 0.85) ** 1.6 : 0.95 - (x - 0.85) * 4) },
  { id: 'acts', label: 'Three acts', at: (x) => 0.15 + 0.35 * Math.exp(-((x - 0.25) ** 2) / 0.005) + 0.45 * Math.exp(-((x - 0.55) ** 2) / 0.008) + 0.8 * Math.exp(-((x - 0.88) ** 2) / 0.006) },
  { id: 'burn', label: 'Slow burn', at: (x) => 0.08 + 0.85 * x ** 3 },
  { id: 'waves', label: 'Rollercoaster', at: (x) => 0.45 + 0.35 * Math.sin(x * Math.PI * 5 - 1) + 0.15 * x }
]

export function presetShape(id: string): number[] {
  const p = SHAPE_PRESETS.find((x) => x.id === id)
  if (!p) return []
  return Array.from({ length: SHAPE_POINTS }, (_, i) => Math.min(1, Math.max(0, p.at(i / (SHAPE_POINTS - 1)))))
}

/** Scenes where the real shape is far from the one you drew, biggest gap first. */
export function shapeDrift(points: ShapePoint[], shape: number[], gap = 0.35): { scene: string; want: number; got: number }[] {
  if (!shape.length) return []
  return points
    .map((p) => ({ scene: p.scene, want: shapeAt(shape, p.x), got: p.y }))
    .filter((d) => Math.abs(d.want - d.got) >= gap)
    .sort((a, b) => Math.abs(b.want - b.got) - Math.abs(a.want - a.got))
}

// ---------- read it to me ----------

/** A scene cut into bits to read aloud one at a time (sentences, joined when very short), with where each is. */
export function speechChunks(text: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = []
  for (const s of sentences(text)) {
    const t = s.text.trim()
    if (!t) continue
    const start = s.start + (s.text.length - s.text.trimStart().length)
    const end = start + t.length
    const last = out[out.length - 1]
    if (last && countWords(last.text) < 4 && !text.slice(last.end, start).includes('\n')) {
      last.text = `${last.text} ${t}`
      last.end = end
    } else out.push({ start, end, text: t })
  }
  return out
}

// ---------- the stuck button ----------

/** What the story brain knows about a scene, written out for the AI: when, where, who, how they stand, what's still open. */
export function sceneContext(story: Story, sceneId: string): string {
  const placed = findScene(story, sceneId)
  if (!placed) return ''
  const name = (id: string): string => entityById(story, id)?.name ?? 'someone'
  const facts = sceneFacts(story, placed)
  const lines: string[] = []
  if (facts.date) lines.push(`When: ${dateLabel(facts.date)}${facts.time ? ` ${facts.time}` : ''}`)
  if (facts.place) lines.push(`Where: ${name(facts.place)}`)
  if (facts.cast.length) lines.push(`In the scene: ${facts.cast.map(name).join(', ')}`)
  if (facts.mentioned.length) lines.push(`Mentioned: ${facts.mentioned.map(name).join(', ')}`)
  for (const id of facts.cast) {
    const e = entityById(story, id)
    const bits = [e?.about.trim().replace(/\s+/g, ' ').slice(0, 200), ...(e?.facts.filter((f) => f.label && f.value).map((f) => `${f.label}: ${f.value}`) ?? [])].filter(Boolean)
    if (bits.length) lines.push(`${name(id)}: ${bits.join('; ')}`)
  }
  for (const r of story.relationships) {
    if (!facts.cast.includes(r.a) || !facts.cast.includes(r.b)) continue
    const now = relationshipAt(story, r, placed.order)
    if (now) lines.push(`${name(r.a)} & ${name(r.b)}: ${now.label}${now.note ? ` (${now.note})` : ''}`)
    else if (stepsInOrder(story, r).length) lines.push(`${name(r.a)} & ${name(r.b)}: nothing between them yet`)
  }
  const orders = orderMap(story)
  const open = openThreads(story).filter((t) => (orders.get(t.setup.scene) ?? 1e9) <= placed.order)
  if (open.length) lines.push(`Set up earlier and not paid off yet: ${open.map((t) => t.label).join('; ')}`)
  for (const s of story.secrets) {
    if (!s.text) continue
    const who = facts.cast.filter((c) => knows(story, s, c, placed.order, orders)).map(name)
    const reader = knows(story, s, READER, placed.order, orders)
    lines.push(`Secret “${s.text}”: ${who.length ? `${who.join(', ')} know${who.length === 1 ? 's' : ''}` : 'nobody here knows'}; the reader ${reader ? 'knows' : 'doesn’t know yet'}`)
  }
  const prev = allScenes(story)[placed.order - 1]
  if (prev) {
    const t = sceneText(prev.scene).trim()
    if (t) lines.push(`How the scene before (“${prev.scene.title}”) ends: …${t.slice(-600)}`)
  }
  return lines.join('\n')
}
