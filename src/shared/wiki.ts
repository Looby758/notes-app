import type { TimelineSeries, WikiSpoilerSettings } from './wikiSpoilers'

/**
 * Wikis: any Fandom wiki, downloaded once and read offline (no ads, no internet), with the
 * offline AI answering questions from it. This file is the plain data and text handling (no
 * Electron), so it can be tested; src/main/wiki.ts downloads and stores the wikis, and
 * components/Wiki shows them.
 *
 * Fandom wikis run on MediaWiki, so pages come from its API (/api.php), not by scraping.
 * Downloaded wikis stay on each computer (they're big); they aren't shared through the notes folder.
 */

// ---------- types ----------

/**
 * Which pictures to download: none, the main picture of each page (the one at the top of its
 * info box), or all of them. Kept to three plain choices: the wiki's own category names can give
 * away the story ("Deceased"), so they're never shown.
 */
export type WikiPictureChoice = 'none' | 'main' | 'all'

export const DEFAULT_PICTURES: WikiPictureChoice = 'main'

/** A saved choice (older downloads saved { main, categories }). */
export function pictureChoice(saved: unknown): WikiPictureChoice {
  if (saved === 'none' || saved === 'main' || saved === 'all') return saved
  if (saved && typeof saved === 'object' && (saved as { main?: unknown }).main === false) return 'none'
  return DEFAULT_PICTURES
}

export type WikiStatus = 'listing' | 'pages' | 'indexing' | 'done' | 'paused' | 'error'

/** A downloaded (or downloading) wiki, as the Wiki tab shows it. */
export interface WikiInfo {
  id: string
  name: string
  /** "https://walkingdead.fandom.com" (with "/es" for a wiki in another language). */
  base: string
  mainPage: string
  licence: { text: string; url: string }
  pictures: WikiPictureChoice
  status: WikiStatus
  /** A download is going right now. */
  running: boolean
  /** Pages in the wiki, and how many are downloaded. */
  total: number
  done: number
  /** Pages that wouldn't download (skipped). */
  failed: number
  /** Space it takes on this computer. */
  bytes: number
  error?: string
  added: number
  /** When the download finished. */
  finished?: number
  /** The spoiler limit and how far you are (shared with your other computers). */
  spoilers?: WikiSpoilerSettings
}

/** What the spoiler settings show for a wiki. */
export interface WikiSpoilerView {
  settings: WikiSpoilerSettings
  /** The shows and comics found in the wiki, with their episodes or issues. */
  series: TimelineSeries[]
  /** The timeline has been worked out (it is once some pages have arrived). */
  ready: boolean
  /** The whole wiki is downloaded (until then, the timeline may be missing some episodes). */
  finished: boolean
}

/** What the download screen shows about a wiki before you download it. */
export interface WikiCheck {
  base: string
  name: string
  articles: number
  licence: { text: string; url: string }
  /** It's already downloaded (or downloading). */
  already: boolean
}

/** A page as the reader shows it. */
export interface WikiPageView {
  wikiId: string
  title: string
  displayTitle: string
  /** The page as the wiki made it (cleaned before it's shown: components/Wiki/wikiHtml.ts). */
  html: string
  /** Picture address → downloaded file name. Pictures not in here aren't shown. */
  images: Record<string, string>
  categories: string[]
  /** The page on the wiki itself (for the licence's attribution). */
  url: string
  /** Not shown: it's past where you are, about a part you've switched off, or not checked yet. */
  blocked?: 'later' | 'part' | 'unchecked' | 'unplaced'
  /** How many pieces were hidden as past where you are, and as "couldn't tell when this happens". */
  hiddenLater?: number
  hiddenUnplaced?: number
}

export interface WikiHit {
  wikiId: string
  wikiName: string
  title: string
  section: string
  snippet: string
}

export interface WikiSource {
  n: number
  wikiId: string
  wikiName: string
  title: string
  section: string
}

export interface WikiAnswer {
  text: string
  /** The pages the answer came from (or the pages it read, when it didn't say). */
  sources: WikiSource[]
  /** The answer said which extract each fact came from. */
  cited: boolean
  /** The final spoiler check stopped the answer. */
  spoilerHidden?: boolean
}

/** One downloaded page, as stored (gzipped JSON) in the wiki's folder. */
export interface StoredWikiPage {
  id: number
  title: string
  displayTitle: string
  revid: number
  html: string
  categories: string[]
  images: Record<string, string>
  sections: WikiSection[]
}

export interface WikiSection {
  heading: string
  text: string
}

// ---------- addresses ----------

export interface WikiAddress {
  /** "walkingdead.fandom.com" */
  host: string
  /** "" for the main language, else "es", "pt-br"… */
  lang: string
  base: string
  api: string
  /** Folder name and id: "walkingdead", "walkingdead-es". */
  id: string
}

const LANG = /^[a-z]{2,3}(?:-[a-z]{2,4})?$/

/** Reads a pasted Fandom address ("walkingdead.fandom.com", or any page's link). Null if it isn't a Fandom wiki. */
export function parseWikiAddress(input: string): WikiAddress | null {
  let text = input.trim()
  if (!text) return null
  if (!/^[a-z]+:\/\//i.test(text)) text = `https://${text}`
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  let host = url.hostname.toLowerCase()
  // Old Wikia addresses moved to fandom.com.
  if (host.endsWith('.wikia.com')) host = host.replace(/\.wikia\.com$/, '.fandom.com')
  if (!host.endsWith('.fandom.com')) return null
  const sub = host.slice(0, -'.fandom.com'.length)
  if (!sub || sub === 'www' || sub === 'community' || sub === 'auth' || !/^[a-z0-9.-]+$/.test(sub)) return null
  const first = url.pathname.split('/')[1]?.toLowerCase() ?? ''
  const lang = first && first !== 'wiki' && LANG.test(first) ? first : ''
  const base = `https://${host}${lang ? `/${lang}` : ''}`
  return { host, lang, base, api: `${base}/api.php`, id: `${sub.replace(/\./g, '-')}${lang ? `-${lang}` : ''}` }
}

/** A page's address on the wiki itself. */
export const pageUrl = (base: string, title: string): string => `${base}/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%3A/g, ':')}`

/** A title the way MediaWiki keeps it: spaces not underscores, first letter capital. */
export function normaliseTitle(title: string): string {
  const t = title.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : t
}

/** Kinds of page that aren't articles, so they aren't downloaded and their links go nowhere. */
const NOT_ARTICLES = /^(file|image|category|special|template|user|user talk|talk|help|forum|message wall|board|thread|mediawiki|module|blog|user blog|user blog comment|map|wiki|project)( talk)?:/i

export type WikiLink = { kind: 'page'; title: string; fragment: string } | { kind: 'anchor'; fragment: string } | { kind: 'external'; url: string } | null

/** Where a link in a downloaded page goes: another page of the wiki, a heading on this one, or the web. */
export function wikiLink(href: string, base: string): WikiLink {
  const h = href.trim()
  if (!h) return null
  if (h.startsWith('#')) return { kind: 'anchor', fragment: safeDecode(h.slice(1)) }
  let url: URL
  try {
    url = new URL(h, `${base}/wiki/`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const own = new URL(base)
  const ownPath = own.pathname.replace(/\/$/, '')
  if (url.hostname === own.hostname) {
    const m = new RegExp(`^${ownPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/wiki/(.+)$`).exec(url.pathname)
    if (m) {
      const title = normaliseTitle(safeDecode(m[1]))
      if (!title || NOT_ARTICLES.test(title)) return null
      return { kind: 'page', title, fragment: safeDecode(url.hash.slice(1)) }
    }
    // Edit links, red links ("this page doesn't exist yet") and the like.
    if (/\/index\.php$/.test(url.pathname) || /\/api\.php$/.test(url.pathname)) return null
  }
  return { kind: 'external', url: url.href }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// ---------- reading the pages' HTML ----------

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  times: '×',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  eacute: 'é',
  egrave: 'è',
  aacute: 'á',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  szlig: 'ß'
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all
    }
    return ENTITIES[name.toLowerCase()] ?? all
  })
}

/** Plain text of some HTML: blocks on their own lines, table cells split by " | ". */
export function htmlText(html: string): string {
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<\/(p|div|li|tr|h[1-6]|table|ul|ol|dl|dd|dt|aside|section|figure|figcaption|blockquote|pre|caption|center)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
  return decodeEntities(text)
    .replace(/\u0001\s*/g, ': ')
    .split('\n')
    .map((l) =>
      l
        .replace(/[ \t\u00a0]+/g, ' ')
        .replace(/^(\s*\|\s*)+|(\s*\|\s*)+$/g, '')
        .trim()
    )
    .filter((l) => l && !/^[|\s:]+$/.test(l))
    .join('\n')
}

/** Headings that are only lists of links or notes, not worth the AI reading. */
const SKIP_SECTIONS = /^(references|notes and references|external links|navigation|sources|citations)$/i

/** A page's text in sections (by its headings), for searching and for the AI. Info box fields read "Status: Deceased". */
export function htmlToSections(html: string): WikiSection[] {
  const clean = html
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<sup\b[^>]*class="[^"]*\breference\b[^"]*"[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<ol\b[^>]*class="[^"]*\breferences\b[^"]*"[^>]*>[\s\S]*?<\/ol>/gi, '')
    .replace(/<span\b[^>]*class="[^"]*\bmw-editsection\b[^"]*"[^>]*>[\s\S]*?<\/span>\s*<\/span>/gi, '')
    // Info box labels: "Status" then "Deceased" becomes "Status: Deceased".
    .replace(/(<h3\b[^>]*class="[^"]*\bpi-data-label\b[^"]*"[^>]*>[\s\S]*?)<\/h3>/gi, '$1\u0001</h3>')
  const out: WikiSection[] = []
  const heading = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi
  let at = 0
  let current = ''
  let m: RegExpExecArray | null
  const push = (body: string): void => {
    const text = htmlText(body)
    if (text && !SKIP_SECTIONS.test(current)) out.push({ heading: current, text })
  }
  while ((m = heading.exec(clean))) {
    // An info box's own small headings (h2/h3 inside <aside>) aren't the page's sections.
    const before = clean.slice(0, m.index)
    const inBox = before.lastIndexOf('<aside') > before.lastIndexOf('</aside>')
    if (inBox || /pi-(data-label|title|header)/.test(m[0])) continue
    push(clean.slice(at, m.index))
    current = htmlText(m[2]).replace(/\u0001/g, '').trim()
    at = m.index + m[0].length
  }
  push(clean.slice(at))
  return out
}

export interface WikiChunk {
  /** Its place in the page's list of chunks. */
  n: number
  section: string
  text: string
}

/** A page's sections cut into pieces of at most `max` characters (at line breaks where it can). */
export function chunkSections(sections: WikiSection[], max = 1200): WikiChunk[] {
  const out: WikiChunk[] = []
  for (const s of sections) {
    let piece = ''
    const flush = (): void => {
      if (piece.trim()) out.push({ n: out.length, section: s.heading, text: piece.trim() })
      piece = ''
    }
    for (const line of s.text.split('\n')) {
      if (piece && piece.length + line.length + 1 > max) flush()
      if (line.length > max) {
        for (let i = 0; i < line.length; i += max) {
          piece = line.slice(i, i + max)
          flush()
        }
        continue
      }
      piece += (piece ? '\n' : '') + line
    }
    flush()
  }
  return out
}

/** The attributes of one HTML tag. */
export function tagAttributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([a-z_:][-a-z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gi
  const inner = tag.replace(/^<\s*[a-z0-9]+/i, '').replace(/\/?>$/, '')
  let m: RegExpExecArray | null
  while ((m = re.exec(inner))) out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '')
  return out
}

/** A picture's real address in a page (Fandom loads them late: the real one is in data-src). */
export function imageUrl(attrs: Record<string, string>): string | null {
  let url = attrs['data-src'] || attrs.src || ''
  if (!url || url.startsWith('data:')) url = attrs.src && !attrs.src.startsWith('data:') ? attrs.src : ''
  if (url.startsWith('//')) url = `https:${url}`
  return /^https?:\/\//i.test(url) ? url : null
}

/** The pictures in a page, and which is its main one (the first in its info box, else the first that isn't an icon). */
export function findImages(html: string): { all: string[]; main: string | null } {
  const all: string[] = []
  let main: string | null = null
  let firstBig: string | null = null
  const boxStart = html.search(/<aside\b[^>]*portable-infobox/i)
  const boxEnd = boxStart >= 0 ? html.indexOf('</aside>', boxStart) : -1
  const re = /<img\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const attrs = tagAttributes(m[0])
    const url = imageUrl(attrs)
    if (!url) continue
    const width = Number(attrs.width) || 0
    // Little icons (flags, arrows, "spoiler" badges).
    if (width && width < 40) continue
    if (!all.includes(url)) all.push(url)
    if (!main && boxStart >= 0 && m.index > boxStart && (boxEnd < 0 || m.index < boxEnd)) main = url
    if (!firstBig && (!width || width >= 100)) firstBig = url
  }
  return { all, main: main ?? firstBig }
}

/** Which of a page's pictures to download, by your choice. */
export function picturesToGet(found: { all: string[]; main: string | null }, choice: WikiPictureChoice): string[] {
  if (choice === 'all') return found.all
  return choice === 'main' && found.main ? [found.main] : []
}

/** The kind of file a picture is, from its address (Fandom's look like ".../Rick.png/revision/latest/scale-to-width-down/270"). */
export function imageExtension(url: string): string {
  const m = /\.(png|jpe?g|gif|webp|svg|avif)(?=[/?#]|$)/i.exec(new URL(url).pathname)
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'png'
}

/** Takes the HTML tags out of a display title ("<i>The Walking Dead</i>"). */
export const plainTitle = (html: string, fallback: string): string => htmlText(html).replace(/\n/g, ' ').trim() || fallback

// ---------- searching ----------

const STOP = new Set(
  'a an and are as at be been but by can could did do does for from had has have he her him his how i if in into is it its me my of on or our she so than that the their them then there these they this to was we were what when where which who whom why will with would you your about after before during tell know does did said say'.split(
    ' '
  )
)

/** Words worth searching for (no "the", "who", "when"…), lower case and without accents' quirks. */
export function searchTerm(term: string): string | null {
  const t = term.toLowerCase().replace(/['’]s$/, '')
  return t.length < 2 || STOP.has(t) ? null : t
}

// ---------- the wiki brain (the offline AI) ----------

export const WIKI_ASK_SYSTEM = `You answer questions about a fan wiki, using ONLY the numbered extracts from it that you are given.
- If the extracts don't contain the answer, say you couldn't find it in the downloaded wiki. Don't fill gaps with anything you know from elsewhere.
- Keep it short and plain.
- After each fact, put the number of the extract it came from in square brackets, like [2].`

/** Added when the spoiler limit is on. */
export const WIKI_SPOILER_NOTE = 'The reader is part-way through the story. Never mention anything that is not in the extracts, even if you know it, because it may spoil what they have not seen yet.'

export interface WikiExtract {
  wikiName: string
  title: string
  section: string
  text: string
}

export function wikiAskPrompt(question: string, extracts: WikiExtract[]): string {
  const parts = extracts.map((e, i) => `[${i + 1}] ${e.title}${e.section ? ` — ${e.section}` : ''} (${e.wikiName})\n${e.text}`)
  return `Extracts from the wiki:\n\n${parts.join('\n\n')}\n\nQuestion: ${question.trim()}`
}

/** The extract numbers an answer points to ("[2]", "[1, 3]"), in order, each once, only ones that exist. */
export function citedNumbers(reply: string, count: number): number[] {
  const out: number[] = []
  for (const m of reply.matchAll(/\[(\d+(?:\s*[,;]\s*\d+)*)\]/g)) {
    for (const part of m[1].split(/[,;]/)) {
      const n = Number(part.trim())
      if (n >= 1 && n <= count && !out.includes(n)) out.push(n)
    }
  }
  return out
}

/** A size for the wiki list ("340 MB"). */
export function bytesText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 / 1024)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
