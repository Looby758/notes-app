import { Marked, type Tokens } from 'marked'
import katex from 'katex'
import { headingAnchor, parseNoteHref, slug, type ExportItem } from './prepare'
import { BANNER_GRADIENTS } from '../banners'

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
  /** A ```mermaid block's text (trimmed) → the diagram as SVG. */
  diagrams?: Map<string, string>
  title: string
  /** PDF: always light, page breaks between notes. */
  forPrint: boolean
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const CALLOUT_LINE = /^\[!([A-Za-z-]+)\]([+-]?)[ \t]*(.*)$/

/** ==highlight== as <mark>. */
export const highlightExtension = {
  name: 'highlight',
  level: 'inline' as const,
  start: (src: string) => src.indexOf('=='),
  tokenizer(this: { lexer: { inlineTokens: (s: string) => Tokens.Generic[] } }, src: string) {
    const m = /^==(?=[^\s=])([^\n]*?[^\s=])==(?!=)/.exec(src)
    if (m) return { type: 'highlight', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) }
    return undefined
  },
  renderer(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Generic) {
    return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`
  }
}

/**
 * Maths as MathML, which browsers (and the PDF printer) draw themselves, so the file needs no
 * fonts or styles of its own.
 */
const mathHtml = (tex: string, displayMode: boolean): string =>
  katex.renderToString(tex, { displayMode, output: 'mathml', throwOnError: false })

/** $$ … $$ as a centred formula. */
export const mathBlockExtension = {
  name: 'mathBlock',
  level: 'block' as const,
  start: (src: string) => src.match(/^ {0,3}\$\$/m)?.index,
  tokenizer(src: string) {
    const m = /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/.exec(src)
    if (m && m[1].trim()) return { type: 'mathBlock', raw: m[0], text: m[1].trim() }
    return undefined
  },
  renderer: (token: Tokens.Generic) => `<div class="math-block">${mathHtml(token.text, true)}</div>\n`
}

/** $x^2$ inside a sentence. */
export const mathInlineExtension = {
  name: 'mathInline',
  level: 'inline' as const,
  start: (src: string) => src.match(/(?<![\\$\w])\$(?=[^\s$])/)?.index,
  tokenizer(src: string) {
    const m = /^\$(?=[^\s$])((?:\\.|[^$\n\\])*?[^\s\\])\$(?![$\d])/.exec(src)
    if (m) return { type: 'mathInline', raw: m[0], text: m[1] }
    return undefined
  },
  renderer: (token: Tokens.Generic) => mathHtml(token.text, false)
}

function renderNote(item: ExportItem, opts: HtmlOptions): string {
  const inFile = new Set(opts.items.map((i) => i.path))
  const marked = new Marked({ gfm: true, breaks: false })
  marked.use({ extensions: [highlightExtension, mathBlockExtension, mathInlineExtension] })
  marked.use({
    renderer: {
      // ```mermaid blocks: the diagram, drawn before exporting (or the text, if it couldn't be).
      code({ text, lang }: Tokens.Code) {
        const svg = lang?.trim().toLowerCase() === 'mermaid' ? opts.diagrams?.get(text.trim()) : undefined
        return svg ? `<div class="diagram">${svg}</div>\n` : false
      },
      // > [!tip] Title  →  a coloured box with a title.
      blockquote(this: { parser: { parse: (t: Tokens.Generic[]) => string } }, { tokens }: Tokens.Blockquote) {
        const first = tokens[0] as Tokens.Paragraph | undefined
        const m = first?.type === 'paragraph' ? CALLOUT_LINE.exec(first.raw.split('\n')[0]) : null
        if (!m) return `<blockquote>\n${this.parser.parse(tokens)}</blockquote>\n`
        const type = m[1].toLowerCase()
        const rest = first!.raw.split('\n').slice(1).join('\n').trim()
        const restTokens = rest ? marked.lexer(rest) : []
        const title = m[3] ? (marked.parseInline(m[3], { async: false }) as string) : esc(type[0].toUpperCase() + type.slice(1))
        return `<div class="callout callout-${esc(type)}"><div class="callout-title">${title}</div>\n${this.parser.parse([...restTokens, ...tokens.slice(1)])}</div>\n`
      },
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
        // Voice notes can't play on paper: their name instead.
        if (/\.(webm|mp3|m4a|wav|ogg|oga|aac)$/i.test(href)) return `<span class="audio-note">🎙 ${esc(text || 'Voice note')}</span>`
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
  const heading = `<h1 class="note-title" id="${headingAnchor(item.path, item.title)}">${item.icon ? `<span class="note-icon">${esc(item.icon)}</span> ` : ''}${titleHtml}</h1>\n`
  // The banner: an image (built in), a colour or a gradient.
  let banner = ''
  if (item.banner) {
    const b = item.banner.trim()
    const path = b.replace(/^\[\[|\]\]$/g, '').replace(/^\/+/, '')
    const image = opts.images.get(path) ?? (/^https?:\/\//i.test(b) ? b : null)
    const fill = /^#[0-9a-f]{3,8}$/i.test(b) ? b : BANNER_GRADIENTS[b.toLowerCase()]
    if (image) banner = `<div class="banner" style="background-image:url('${esc(image)}');background-position:center ${item.bannerY ?? 50}%"></div>\n`
    else if (fill) banner = `<div class="banner" style="background:${esc(fill)}"></div>\n`
  }
  const props = item.properties.length
    ? `<table class="properties">${item.properties.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>\n`
    : ''
  return `<article class="note" id="${item.anchor}">\n${banner}${heading}${props}${body}</article>`
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
.math-block { margin: 0 0 1em; overflow-x: auto; text-align: center; }
math { font-size: 1.1em; }
.diagram { margin: 0 0 1em; text-align: center; break-inside: avoid; }
.diagram svg { max-width: 100%; height: auto; }
table.properties { width: auto; margin-bottom: 1.6em; font-size: 0.88em; }
table.properties th, table.properties td { border: none; border-bottom: 1px solid var(--border); padding: 4px 16px 4px 0; background: none; }
table.properties th { color: var(--faint); font-weight: 500; }
.missing-image { color: var(--faint); font-style: italic; }
footer { margin-top: 48px; color: var(--faint); font-size: 12px; }
.banner { height: 180px; margin: 0 0 22px; border-radius: 12px; background-size: cover; background-repeat: no-repeat; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.note-icon { font-size: 1.1em; }
mark { background: color-mix(in srgb, #f5d547 40%, transparent); color: inherit; border-radius: 3px; padding: 0 2px; }
mark.hl-green { background: color-mix(in srgb, #4ade80 35%, transparent); }
mark.hl-blue { background: color-mix(in srgb, #5ea8ff 35%, transparent); }
mark.hl-pink { background: color-mix(in srgb, #f472b6 35%, transparent); }
mark.hl-purple { background: color-mix(in srgb, #a78bfa 35%, transparent); }
mark.hl-orange { background: color-mix(in srgb, #fb923c 35%, transparent); }
.callout { --co: #5ea8ff; margin: 0 0 1em; padding: 10px 14px; border-left: 3px solid var(--co); border-radius: 0 8px 8px 0; background: color-mix(in srgb, var(--co) 10%, transparent); }
.callout > :last-child { margin-bottom: 0; }
.callout-title { font-weight: 650; color: color-mix(in srgb, var(--co) 70%, var(--text)); margin-bottom: 4px; }
.callout-tip, .callout-success, .callout-hint, .callout-check, .callout-done { --co: #22a35a; }
.callout-warning, .callout-caution, .callout-attention { --co: #d98a2b; }
.callout-important { --co: #8b6cf0; }
.callout-question, .callout-faq, .callout-help { --co: #1fa6a6; }
.callout-danger, .callout-error, .callout-bug, .callout-failure { --co: #e0524a; }
.callout-quote, .callout-cite { --co: #8a8e9c; }
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
