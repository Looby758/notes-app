import { NoteLookup, parseWikiInner } from '../links'
import { extractSection } from '../outline'
import { readFrontmatter } from '../properties'
import { isWithin, noteTitle, parentOf, resolveRelative } from '../paths'

/**
 * Turns notes into plain markdown ready to export: properties pulled out, embeds filled in,
 * and links rewritten so the exporters can point them at the right place (or drop them).
 *   [[Note#Heading|text]]  →  [text](note:Folder%2FNote.md#Heading)   (if the note exists)
 *   ![[Note]] on its own line → the note's text, as a quote
 *   ![](../img/a.png)        →  ![](vault:img/a.png)
 */

export interface ExportItem {
  path: string
  title: string
  /** Id for links to this note within a combined export. */
  anchor: string
  markdown: string
  properties: [string, string][]
}

export interface PrepareContext {
  lookup: NoteLookup
  textOf: (path: string) => string | undefined
}

export const slug = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'x'

export const anchorFor = (path: string): string => `n-${slug(path.replace(/\.md$/i, ''))}`
export const headingAnchor = (path: string, heading: string): string => `${anchorFor(path)}--${slug(heading)}`

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
const encodeTarget = (path: string, heading: string): string =>
  `note:${encodeURIComponent(path)}${heading ? `#${encodeURIComponent(heading)}` : ''}`

/** Rewrites links and embeds in one note's markdown (code is left alone). */
export function rewriteMarkdown(text: string, path: string, ctx: PrepareContext, depth = 0): string {
  const folder = parentOf(path)
  const parts = text.split(/(^ {0,3}(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}(?:`{3,}|~{3,})[ \t]*$|`[^`\n]+`)/m)
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part // code
      return (
        part
          // Embeds alone on a line: the note (or section) itself, quoted.
          .replace(/^[ \t]*!\[\[([^\]\n]+)\]\][ \t]*$/gm, (_whole, inner: string) => {
            const { target, heading, alias } = parseWikiInner(inner)
            if (IMAGE.test(target)) return `![${alias || ''}](vault:${encodeURI(resolveImage(target, folder, ctx))})`
            const resolved = ctx.lookup.resolve({ kind: 'wiki', target }, path)
            if (!resolved) return `*${target} (missing note)*`
            if (depth >= 2) return `[${alias || noteTitle(resolved)}](${encodeTarget(resolved, heading)})`
            const full = ctx.textOf(resolved) ?? ''
            const body = heading ? (extractSection(full, heading) ?? '') : stripFrontmatter(full)
            const inner2 = rewriteMarkdown(body.trim(), resolved, ctx, depth + 1)
            const title = `**${noteTitle(resolved)}${heading ? ` › ${heading}` : ''}**`
            return [title, '', inner2].join('\n').split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')
          })
          // Other embeds and wikilinks: links (or plain text if the note doesn't exist).
          .replace(/(!?)\[\[([^\]\n]+)\]\]/g, (_m, bang: string, inner: string) => {
            const { target, heading, alias } = parseWikiInner(inner)
            if (bang && IMAGE.test(target)) return `![${alias || ''}](vault:${encodeURI(resolveImage(target, folder, ctx))})`
            const label = escapeLabel(alias || (heading ? `${target} › ${heading}` : target))
            const resolved = ctx.lookup.resolve({ kind: 'wiki', target }, path)
            return resolved ? `[${label}](${encodeTarget(resolved, heading)})` : label
          })
          // Markdown links to notes and local images.
          .replace(/(!?)\[([^\]\n]*)\]\((<[^>\n]+>|[^)\s]+)(\s+"[^"\n]*")?\)/g, (whole, bang: string, label: string, rawUrl: string) => {
            let url = rawUrl.replace(/^<|>$/g, '')
            if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#')) return whole
            const [file, hash = ''] = url.split('#')
            try {
              url = decodeURI(file)
            } catch {
              url = file
            }
            if (bang) return `![${label}](vault:${encodeURI(resolveRelative(folder, url))})`
            if (!/\.md$/i.test(url) && /\.[a-z0-9]{1,5}$/i.test(url)) return label || url // an attachment: keep its name
            const resolved = ctx.lookup.resolve({ kind: 'md', target: url }, path)
            return resolved ? `[${label}](${encodeTarget(resolved, decodeURIComponent(hash))})` : label
          })
      )
    })
    .join('')
}

const escapeLabel = (s: string): string => s.replace(/[[\]]/g, '\\$&')

function resolveImage(target: string, folder: string, ctx: PrepareContext): string {
  // ![[pic.png]] works like a wikilink: by name anywhere in the vault, else relative.
  const byName = ctx.lookup.paths.find((p) => p.toLowerCase().endsWith(`/${target.toLowerCase()}`) || p.toLowerCase() === target.toLowerCase())
  return byName ?? resolveRelative(folder, target)
}

function stripFrontmatter(text: string): string {
  const fm = readFrontmatter(text.replace(/\r\n?/g, '\n'))
  return fm ? text.replace(/\r\n?/g, '\n').slice(fm.to) : text
}

export function prepareNote(path: string, ctx: PrepareContext, includeProperties: boolean): ExportItem {
  const text = (ctx.textOf(path) ?? '').replace(/\r\n?/g, '\n')
  const fm = readFrontmatter(text)
  const body = fm ? text.slice(fm.to) : text
  const properties: [string, string][] =
    includeProperties && fm
      ? fm.properties.filter((p) => p.value !== null && (Array.isArray(p.value) ? p.value.length : p.value !== '')).map((p) => [p.key, Array.isArray(p.value) ? p.value.join(', ') : p.value!])
      : []
  return { path, title: noteTitle(path), anchor: anchorFor(path), markdown: rewriteMarkdown(body.trim(), path, ctx), properties }
}

/** The notes to export for a note, a folder (optionally with its subfolders), or '' for everything. */
export function notesUnder(all: string[], target: string, isFolder: boolean, subfolders: boolean): string[] {
  if (!isFolder) return [target]
  const inside = all.filter((p) => (target === '' || isWithin(p, target)) && (subfolders || parentOf(p) === target))
  return inside.sort((a, b) => {
    // Notes in the folder first, then subfolders, each alphabetically.
    const da = a.split('/').length
    const db = b.split('/').length
    return da - db || a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  })
}

/** Image paths (in the vault) a set of prepared notes uses. */
export function imagesIn(items: ExportItem[]): string[] {
  const out = new Set<string>()
  for (const it of items) for (const m of it.markdown.matchAll(/!\[[^\]\n]*\]\(vault:([^)\s]+)\)/g)) out.add(decodeURI(m[1]))
  return [...out]
}

/** Where a `note:` link points: the note's path and heading. */
export function parseNoteHref(href: string): { path: string; heading: string } | null {
  if (!href.startsWith('note:')) return null
  const [p, h = ''] = href.slice(5).split('#')
  return { path: decodeURIComponent(p), heading: decodeURIComponent(h) }
}
