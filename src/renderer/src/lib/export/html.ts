import { Marked, type Tokens } from 'marked'
import { headingAnchor, parseNoteHref, slug, type ExportItem } from './prepare'

/**
 * Notes as a web page (also what PDFs are printed from): clean, light, readable on paper, with
 * images built in. Links between notes in the same file jump within it; links to notes in other
 * exported files point at those files; links to notes that weren't exported become plain text.
 */

export interface HtmlOptions {
  /** Notes in this file. */
  items: ExportItem[]
  /** For one-file-per-note exports: note path → file name of its page. */
  otherFiles?: Map<string, string>
  /** Vault image path → data: URL. */
  images: Map<string, string>
  title: string
  /** PDF: always light, page breaks between notes. */
  forPrint: boolean
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function renderNote(item: ExportItem, opts: HtmlOptions): string {
  const inFile = new Set(opts.items.map((i) => i.path))
  const marked = new Marked({ gfm: true, breaks: false })
  marked.use({
    renderer: {
      heading(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, { tokens, depth, text }: Tokens.Heading) {
        return `<h${depth} id="${headingAnchor(item.path, text.replace(/[*_~`]/g, ''))}">${this.parser.parseInline(tokens)}</h${depth}>\n`
      },
      link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, { href, title, tokens }: Tokens.Link) {
        const label = this.parser.parseInline(tokens)
        const note = parseNoteHref(href)
        if (note) {
          if (inFile.has(note.path)) {
            const to = note.heading ? headingAnchor(note.path, note.heading) : `n-${slug(note.path.replace(/\.md$/i, ''))}`
            return `<a class="note-link" href="#${to}">${label}</a>`
          }
          const file = opts.otherFiles?.get(note.path)
          if (file) return `<a class="note-link" href="${esc(encodeURI(file))}${note.heading ? `#${headingAnchor(note.path, note.heading)}` : ''}">${label}</a>`
          return `<span class="note-link missing">${label}</span>`
        }
        return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''}>${label}</a>`
      },
      image({ href, text, title }: Tokens.Image) {
        if (href.startsWith('vault:')) {
          const data = opts.images.get(decodeURI(href.slice(6)))
          if (!data) return `<span class="missing-image">[image: ${esc(text || href.slice(6))}]</span>`
          return `<img src="${data}" alt="${esc(text)}"${title ? ` title="${esc(title)}"` : ''}>`
        }
        return `<img src="${esc(href)}" alt="${esc(text)}">`
      }
    }
  })
  // Every note starts with its title, then its properties. A note that already opens with its
  // title as a heading uses that heading (so it isn't shown twice).
  let markdown = item.markdown
  let titleHtml = esc(item.title)
  const firstLine = markdown.split('\n').find((l) => l.trim()) ?? ''
  const first = /^#\s+(.+?)\s*#*\s*$/.exec(firstLine)
  if (first && first[1].replace(/[*_~`]/g, '').trim().toLowerCase() === item.title.toLowerCase()) {
    titleHtml = marked.parseInline(first[1], { async: false }) as string
    markdown = markdown.slice(markdown.indexOf(firstLine) + firstLine.length)
  }
  const body = marked.parse(markdown, { async: false }) as string
  const heading = `<h1 class="note-title" id="${headingAnchor(item.path, item.title)}">${titleHtml}</h1>\n`
  const props = item.properties.length
    ? `<table class="properties">${item.properties.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>\n`
    : ''
  return `<article class="note" id="${item.anchor}">\n${heading}${props}${body}</article>`
}

const CSS = `
:root { color-scheme: light; --text: #1d1f27; --muted: #5d6170; --faint: #8a8e9c; --border: #e3e4ea; --soft: #f5f5f8; --accent: #6b5bd6; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: #fff; color: var(--text); font: 15px/1.65 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 48px 28px 80px; }
article.note + article.note { margin-top: 64px; padding-top: 40px; border-top: 1px solid var(--border); }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.5em; font-weight: 650; }
article > :first-child { margin-top: 0; }
h1 { font-size: 1.9em; } h2 { font-size: 1.45em; } h3 { font-size: 1.2em; } h4, h5, h6 { font-size: 1em; }
p, ul, ol, blockquote, pre, table { margin: 0 0 1em; }
a { color: var(--accent); text-decoration: none; border-bottom: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); }
.note-link.missing { color: var(--muted); }
img { max-width: 100%; height: auto; border-radius: 6px; }
code { font: 0.88em/1.5 'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace; background: var(--soft); padding: 0.1em 0.35em; border-radius: 4px; }
pre { background: var(--soft); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
pre code { background: none; padding: 0; }
blockquote { margin-left: 0; padding: 2px 0 2px 16px; border-left: 3px solid color-mix(in srgb, var(--accent) 45%, var(--border)); color: var(--muted); }
blockquote > :last-child { margin-bottom: 0; }
table { border-collapse: collapse; width: 100%; font-size: 0.95em; }
th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: var(--soft); font-weight: 600; }
hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }
li > input[type=checkbox] { margin: 0 6px 0 -2px; accent-color: var(--accent); }
ul:has(> li > input[type=checkbox]) { list-style: none; padding-left: 1.2em; }
table.properties { width: auto; margin-bottom: 1.6em; font-size: 0.88em; }
table.properties th, table.properties td { border: none; border-bottom: 1px solid var(--border); padding: 4px 16px 4px 0; background: none; }
table.properties th { color: var(--faint); font-weight: 500; }
.missing-image { color: var(--faint); font-style: italic; }
footer { margin-top: 48px; color: var(--faint); font-size: 12px; }
`

const SCREEN_DARK = `
@media (prefers-color-scheme: dark) {
  :root { color-scheme: dark; --text: #dcdee6; --muted: #a0a3b1; --faint: #727686; --border: #2c2e3a; --soft: #1f2029; --accent: #a092ff; }
  body { background: #16171d; }
}
`

const PRINT = `
@page { size: A4; margin: 18mm 16mm; }
body { font-size: 11pt; }
main { max-width: none; padding: 0; }
article.note + article.note { break-before: page; margin-top: 0; padding-top: 0; border-top: none; }
pre, blockquote, table, img { break-inside: avoid; }
h1, h2, h3 { break-after: avoid; }
`

export function toHtmlDocument(opts: HtmlOptions): string {
  const notes = opts.items.map((i) => renderNote(i, opts)).join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<style>${CSS}${opts.forPrint ? PRINT : SCREEN_DARK}</style>
</head>
<body>
<main>
${notes}
</main>
</body>
</html>
`
}
