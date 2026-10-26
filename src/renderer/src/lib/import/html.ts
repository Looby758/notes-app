/**
 * HTML (from Evernote, Apple Notes, Google Keep or a saved web page) to markdown. Covers what notes
 * use: headings, paragraphs and line breaks, bold/italic/strikethrough, links, lists and
 * checklists, quotes, code, tables, images and dividers.
 */

export interface HtmlOptions {
  /** An image: return the markdown for it (e.g. after saving it), or null to leave it out. */
  image?: (src: string, alt: string) => string | null
  /** Evernote's <en-media hash type>: an attached file. */
  media?: (hash: string, type: string) => string | null
}

const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'EN-NOTE', 'BODY'])

const escapeText = (s: string): string => s.replace(/([\\*_`[\]])/g, '\\$1').replace(/^(\s*)([#>+-]|\d+\.)(\s)/, '$1\\$2$3')

export function htmlToMarkdown(html: string, opts: HtmlOptions = {}): string {
  // Evernote writes <en-todo/> and <en-media/> self-closed, which HTML reads as wrapping what follows.
  const fixed = html.replace(/<(en-todo|en-media)\b([^>]*?)\/>/gi, '<$1$2></$1>')
  const doc = new DOMParser().parseFromString(fixed, 'text/html')
  const out = blocks(doc.body, opts, 0)
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Inline content of an element, as one markdown string. */
function inline(node: Node, opts: HtmlOptions): string {
  let s = ''
  node.childNodes.forEach((child) => (s += inlineNode(child, opts)))
  return s
}

function wrap(mark: string, text: string): string {
  const t = text.trim()
  if (!t) return text
  // Keep spaces outside the marks: markdown ignores "** bold**".
  const lead = text.slice(0, text.length - text.trimStart().length)
  const trail = text.slice(text.trimEnd().length)
  return `${lead}${mark}${t}${mark}${trail}`
}

function inlineNode(node: Node, opts: HtmlOptions): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeText((node.textContent ?? '').replace(/\s+/g, ' '))
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as HTMLElement
  const tag = el.tagName
  const style = el.getAttribute('style') ?? ''
  switch (tag) {
    case 'BR':
      return '\n'
    case 'B':
    case 'STRONG':
      return wrap('**', inline(el, opts))
    case 'I':
    case 'EM':
      return wrap('*', inline(el, opts))
    case 'S':
    case 'STRIKE':
    case 'DEL':
      return wrap('~~', inline(el, opts))
    case 'MARK':
      return wrap('==', inline(el, opts))
    case 'CODE':
    case 'TT':
      return `\`${el.textContent ?? ''}\``
    case 'A': {
      const href = el.getAttribute('href') ?? ''
      const text = inline(el, opts).trim() || href
      return href && !href.startsWith('#') && !/^javascript:/i.test(href) ? `[${text}](${href.replace(/ /g, '%20')})` : text
    }
    case 'IMG': {
      const src = el.getAttribute('src') ?? ''
      return opts.image?.(src, el.getAttribute('alt') ?? '') ?? ''
    }
    case 'EN-MEDIA':
      return opts.media?.(el.getAttribute('hash') ?? '', el.getAttribute('type') ?? '') ?? ''
    case 'EN-TODO':
      return el.getAttribute('checked') === 'true' ? '[x] ' : '[ ] '
    case 'SCRIPT':
    case 'STYLE':
    case 'HEAD':
      return ''
    case 'SPAN': {
      const text = inline(el, opts)
      if (/font-weight:\s*(bold|[6-9]00)/i.test(style)) return wrap('**', text)
      if (/font-style:\s*italic/i.test(style)) return wrap('*', text)
      if (/line-through/i.test(style)) return wrap('~~', text)
      return text
    }
    default:
      // Blocks inside inline content (e.g. a <div> in a <li>): their own line.
      if (BLOCK.has(tag)) return `\n${blocks(el, opts, 0).trim()}\n`
      return inline(el, opts)
  }
}

/** Block content: paragraphs separated by blank lines, lists, quotes… */
function blocks(node: Node, opts: HtmlOptions, depth: number): string {
  let out = ''
  let pending = ''
  const flush = (): void => {
    const t = pending.replace(/^\n+|\n+$/g, '')
    if (t.trim()) out += `${t}\n\n`
    pending = ''
  }
  node.childNodes.forEach((child) => {
    if (child.nodeType !== Node.ELEMENT_NODE || !BLOCK.has((child as HTMLElement).tagName)) {
      pending += inlineNode(child, opts)
      return
    }
    flush()
    out += block(child as HTMLElement, opts, depth)
  })
  flush()
  return out
}

function list(el: HTMLElement, opts: HtmlOptions, depth: number): string {
  const ordered = el.tagName === 'OL'
  const checklist = /checklist|todo/i.test(el.className)
  let n = Number(el.getAttribute('start') ?? 1)
  let out = ''
  for (const li of Array.from(el.children)) {
    if (li.tagName !== 'LI') continue
    const nested = Array.from(li.children).filter((c) => c.tagName === 'UL' || c.tagName === 'OL')
    nested.forEach((c) => c.remove())
    let text = inline(li, opts).replace(/\n+/g, ' ').trim()
    const checked = li.getAttribute('data-checked') ?? (li.className.includes('checked') ? 'true' : null)
    let marker = ordered ? `${n++}. ` : '- '
    if (checklist || checked !== null) marker = `- [${checked === 'true' ? 'x' : ' '}] `
    // Evernote writes checkboxes inside the item: "- [ ] text" already.
    if (/^\[[ x]\] /.test(text) && marker === '- ') marker = '- '
    out += `${'  '.repeat(depth)}${marker}${text}\n`
    for (const c of nested) out += list(c as HTMLElement, opts, depth + 1)
  }
  return out
}

function block(el: HTMLElement, opts: HtmlOptions, depth: number): string {
  const tag = el.tagName
  if (/^H[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${inline(el, opts).replace(/\n+/g, ' ').trim()}\n\n`
  if (tag === 'UL' || tag === 'OL') return `${list(el, opts, depth)}\n`
  if (tag === 'HR') return '---\n\n'
  if (tag === 'PRE') return `\`\`\`\n${(el.textContent ?? '').replace(/\n$/, '')}\n\`\`\`\n\n`
  if (tag === 'BLOCKQUOTE') {
    const inner = blocks(el, opts, depth).trim()
    return `${inner
      .split('\n')
      .map((l) => (l ? `> ${l}` : '>'))
      .join('\n')}\n\n`
  }
  if (tag === 'TABLE') return table(el, opts)
  // Apple Notes and Evernote write one <div> per line: keep the lines together, not as paragraphs.
  if (tag === 'DIV') {
    const hasBlocks = Array.from(el.children).some((c) => BLOCK.has(c.tagName))
    if (!hasBlocks) {
      let line = inline(el, opts).replace(/^\n+|\n+$/g, '')
      // A checkbox line (Evernote): a task.
      if (/^\[[ x]\] /.test(line)) line = `- ${line}`
      return line.trim() ? `${line}\n` : '\n'
    }
  }
  if (tag === 'LI') return `- ${inline(el, opts).trim()}\n`
  return blocks(el, opts, depth)
}

function table(el: HTMLElement, opts: HtmlOptions): string {
  const rows = Array.from(el.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.children)
      .filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
      .map((c) => inline(c, opts).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim() || ' ')
  )
  if (rows.length === 0) return ''
  const cols = Math.max(...rows.map((r) => r.length))
  const line = (r: string[]): string => `| ${[...r, ...Array(cols - r.length).fill(' ')].join(' | ')} |`
  return [line(rows[0]), `| ${Array(cols).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n') + '\n\n'
}
