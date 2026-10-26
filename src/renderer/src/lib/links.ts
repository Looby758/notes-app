import { isWithin, parentOf, replacePrefix, resolveRelative } from './paths'

/** A link found in a note: `[[Target#Heading|Alias]]` or `[text](relative/path.md)`. */
export interface LinkRef {
  kind: 'wiki' | 'md'
  /** The note it points at, as written (no heading or alias), e.g. "Plan" or "Projects/Plan.md". */
  target: string
  /** Offsets of the whole link in the note's text. */
  from: number
  to: number
  /** 0-based line number of the link. */
  line: number
}

// ---------- parsing ----------

/** Blanks out code (fenced blocks and inline spans) so links inside code are ignored. Offsets are preserved. */
export function maskCode(text: string): string {
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ')
  return text
    .replace(/^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\1\2[^\n]*$|(?![\s\S]))/gm, blank)
    .replace(/(`+)(?!`)[^\n]*?[^`]\1(?!`)|`[^`\n]`/g, blank)
}

const WIKI = /\[\[([^[\]\n]+?)\]\]/g
const MD = /(?<!!)\[[^\]\n]*\]\((?:<([^>\n]+)>|([^)\s]+))(?:\s+"[^"\n]*")?\)/g
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** Splits the inside of `[[...]]` into target, heading and alias. */
export function parseWikiInner(inner: string): { target: string; heading: string; alias: string } {
  const bar = inner.indexOf('|')
  const targetPart = bar === -1 ? inner : inner.slice(0, bar)
  const alias = bar === -1 ? '' : inner.slice(bar + 1)
  const hash = targetPart.indexOf('#')
  return {
    target: (hash === -1 ? targetPart : targetPart.slice(0, hash)).trim(),
    heading: hash === -1 ? '' : targetPart.slice(hash + 1).trim(),
    alias: alias.trim()
  }
}

export function parseLinks(text: string): LinkRef[] {
  const masked = maskCode(text)
  const lineStarts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1)
  const lineOf = (pos: number): number => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= pos) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  const links: LinkRef[] = []
  for (const m of masked.matchAll(WIKI)) {
    const { target } = parseWikiInner(m[1])
    if (target) links.push({ kind: 'wiki', target, from: m.index, to: m.index + m[0].length, line: lineOf(m.index) })
  }
  for (const m of masked.matchAll(MD)) {
    let url = (m[1] ?? m[2]).split('#')[0]
    if (!url || SCHEME.test(url)) continue
    try {
      url = decodeURI(url)
    } catch {
      // keep as typed
    }
    // Only links to notes: .md files, or extension-less paths.
    if (!/\.md$/i.test(url) && /\.[a-z0-9]{1,5}$/i.test(url)) continue
    links.push({ kind: 'md', target: url, from: m.index, to: m.index + m[0].length, line: lineOf(m.index) })
  }
  return links.sort((a, b) => a.from - b.from)
}

// ---------- resolving ----------

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

/** Fast lookups from link text to note paths. Build once per set of notes. */
export class NoteLookup {
  private byPath = new Map<string, string>()
  private byName = new Map<string, string[]>()

  constructor(readonly paths: string[]) {
    for (const p of paths) {
      this.byPath.set(p.toLowerCase(), p)
      const name = baseName(p).toLowerCase()
      const list = this.byName.get(name)
      if (list) list.push(p)
      else this.byName.set(name, [p])
    }
  }

  has(path: string): boolean {
    return this.byPath.has(path.toLowerCase())
  }

  /** Is `name` the title of exactly one note? */
  isUnique(name: string): boolean {
    return (this.byName.get(name.toLowerCase())?.length ?? 0) === 1
  }

  /**
   * Wikilinks: "Plan" matches any note titled Plan (closest to the linking note wins);
   * "Projects/Plan" matches that path from the vault root.
   * Markdown links: resolved relative to the linking note's folder.
   */
  resolve(link: Pick<LinkRef, 'kind' | 'target'>, fromNote: string): string | null {
    if (link.kind === 'md') {
      const rel = resolveRelative(parentOf(fromNote), link.target)
      return this.byPath.get(rel.toLowerCase()) ?? this.byPath.get(`${rel}.md`.toLowerCase()) ?? null
    }
    const target = link.target.replace(/^\/+/, '')
    if (target.includes('/')) {
      return this.byPath.get(target.toLowerCase()) ?? this.byPath.get(`${target}.md`.toLowerCase()) ?? null
    }
    const matches = this.byName.get(target.replace(/\.md$/i, '').toLowerCase())
    if (!matches) return null
    if (matches.length === 1) return matches[0]
    const folder = parentOf(fromNote)
    return (
      matches.find((p) => parentOf(p) === folder) ??
      [...matches].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0]
    )
  }
}

// ---------- rewriting after a rename or move ----------

/** Relative path from a folder to a file, e.g. ('a/b', 'a/c/d.md') → '../c/d.md'. */
export function relativePath(fromFolder: string, to: string): string {
  const a = fromFolder.split('/').filter(Boolean)
  const b = to.split('/').filter(Boolean)
  let i = 0
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/')
}

const encodeUrl = (path: string): string => path.split('/').map(encodeURIComponent).join('/')

/** `[text](` · `<url>` or `url` · ` "title")` */
const MD_PARTS = /^(\[[^\]\n]*\]\()(?:<([^>\n]+)>|([^)\s]+))((?:\s+"[^"\n]*")?\))$/

/**
 * Rewrites the links in one note after `from` (a note or folder) was renamed or moved to `to`.
 * `source` is the note's path before the change. Returns the new text, or null if nothing changed.
 */
export function rewriteLinks(
  text: string,
  source: string,
  from: string,
  to: string,
  before: NoteLookup,
  after: NoteLookup
): string | null {
  const newSource = replacePrefix(source, from, to)
  let out = ''
  let last = 0
  let changed = false
  for (const link of parseLinks(text)) {
    const oldTarget = before.resolve(link, source)
    if (!oldTarget) continue
    const newTarget = replacePrefix(oldTarget, from, to)
    const raw = text.slice(link.from, link.to)
    let next = raw
    if (link.kind === 'wiki') {
      // Bare names keep working when only folders change; only rewrite when they'd break.
      if (after.resolve(link, newSource) === newTarget) continue
      const { heading, alias } = parseWikiInner(raw.slice(2, -2))
      const title = baseName(newTarget)
      const name = !link.target.includes('/') && after.isUnique(title) ? title : newTarget.replace(/\.md$/i, '')
      next = `[[${name}${heading ? `#${heading}` : ''}${alias ? `|${alias}` : ''}]]`
    } else {
      if (newTarget === oldTarget && newSource === source) continue
      const parts = MD_PARTS.exec(raw)
      if (!parts) continue
      const [, text, angled, plain, rest] = parts
      const url = angled ?? plain
      const anchor = url.includes('#') ? url.slice(url.indexOf('#')) : ''
      let rel = relativePath(parentOf(newSource), newTarget)
      if (!/\.md$/i.test(link.target)) rel = rel.replace(/\.md$/i, '')
      // Inside <angle brackets> spaces are allowed as-is; otherwise they must be %20.
      next = angled !== undefined ? `${text}<${rel}${anchor}>${rest}` : `${text}${encodeUrl(rel)}${anchor}${rest}`
    }
    if (next === raw) continue
    out += text.slice(last, link.from) + next
    last = link.to
    changed = true
  }
  return changed ? out + text.slice(last) : null
}

const FILE_LINK = /(!?\[[^\]\n]*\]\()(?:<([^>\n]+)>|([^)\s]+))((?:\s+"[^"\n]*")?\))/g
const NOTE_OR_PAGE = /(^[a-z][a-z0-9+.-]*:)|\.md$|^#/i

/**
 * Fixes links to pictures, recordings and other files (`![](attachments/a.png)`) in one note after
 * `from` (a file or folder) became `to`. Also fixes them when the note itself moved, since the links
 * are relative to it. `source` is where the note was before. Returns null if nothing changed.
 */
export function rewriteFileLinks(text: string, source: string, from: string, to: string): string | null {
  const newSource = replacePrefix(source, from, to)
  const masked = maskCode(text)
  let out = ''
  let last = 0
  let changed = false
  for (const m of masked.matchAll(FILE_LINK)) {
    // Code is blanked out in `masked`, so these groups are the real text.
    const raw = m[0]
    const [, head, angled, plain, rest] = m
    let url = angled ?? plain
    if (!url || NOTE_OR_PAGE.test(url) || !/\.[a-z0-9]{1,5}$/i.test(url.split('#')[0])) continue
    try {
      url = decodeURI(url)
    } catch {
      // keep as typed
    }
    const target = resolveRelative(parentOf(source), url)
    const newTarget = isWithin(target, from) ? replacePrefix(target, from, to) : target
    if (newTarget === target && newSource === source) continue
    const rel = relativePath(parentOf(newSource), newTarget)
    const next = angled !== undefined ? `${head}<${rel}>${rest}` : `${head}${encodeUrl(rel)}${rest}`
    if (next === raw) continue
    out += text.slice(last, m.index) + next
    last = m.index + m[0].length
    changed = true
  }
  return changed ? out + text.slice(last) : null
}