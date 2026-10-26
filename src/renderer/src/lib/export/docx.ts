import {
  AlignmentType,
  BorderStyle,
  Bookmark,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild
} from 'docx'
import { Lexer, type Token, type Tokens } from 'marked'
import { anchorFor, headingAnchor, parseNoteHref, type ExportItem } from './prepare'

/**
 * Notes as a Word document. Headings, lists, task lists, quotes, code, tables, images and links
 * all come across; links to other notes in the document jump to them (as bookmarks).
 */

export interface DocxImage {
  data: Uint8Array
  type: 'png' | 'jpg' | 'gif'
  width: number
  height: number
}

export interface DocxOptions {
  items: ExportItem[]
  images: Map<string, DocxImage>
  title: string
}

interface Fmt {
  bold?: boolean
  italics?: boolean
  strike?: boolean
  code?: boolean
  /** Word highlighter colour. */
  highlight?: string
}

/** Highlighter colours in the app → the nearest ones Word has. */
const WORD_HIGHLIGHT: Record<string, string> = { green: 'green', blue: 'cyan', pink: 'magenta', purple: 'magenta', orange: 'yellow' }
const CALLOUT_LINE = /^\[!([A-Za-z-]+)\]([+-]?)[ \t]*(.*)$/
const CALLOUT_COLOURS: Record<string, string> = { tip: '22A35A', success: '22A35A', warning: 'D98A2B', important: '8B6CF0', question: '1FA6A6', danger: 'E0524A', quote: '8A8E9C' }

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6]
const MONO = 'Consolas'
const MAX_IMAGE_WIDTH = 600

/** Word bookmark names: letters, digits and _, starting with a letter, at most 40 characters. */
const bookmarkName = (anchor: string): string => `b_${anchor.replace(/[^A-Za-z0-9_]/g, '_')}`.slice(0, 40)

const decode = (s: string): string =>
  s.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_m, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" })[e]!)

export async function toDocx(opts: DocxOptions): Promise<Uint8Array> {
  const inDoc = new Set(opts.items.map((i) => i.path))
  let listInstance = 0
  const children: (Paragraph | Table)[] = []

  const run = (t: string, f: Fmt): TextRun =>
    new TextRun({
      text: decode(t),
      bold: f.bold,
      italics: f.italics,
      strike: f.strike,
      font: f.code ? MONO : undefined,
      highlight: f.highlight as 'yellow' | undefined,
      shading: f.code ? { type: ShadingType.CLEAR, fill: 'F1F1F4', color: 'auto' } : undefined
    })
  /** Plain text, with any ==highlights== in it. */
  const text = (t: string, f: Fmt): TextRun | TextRun[] => {
    if (!t.includes('==')) return run(t, f)
    return t.split(/(==[^=\n]+==)/).filter(Boolean).map((part) => (/^==[^=\n]+==$/.test(part) ? run(part.slice(2, -2), { ...f, highlight: 'yellow' }) : run(part, f)))
  }

  const linkRun = (t: string, f: Fmt): TextRun =>
    new TextRun({ text: decode(t), bold: f.bold, italics: f.italics, color: '5B4BD0', underline: {} })

  const inline = (tokens: Token[] | undefined, outer: Fmt = {}): ParagraphChild[] => {
    const out: ParagraphChild[] = []
    let f = outer
    for (const t of tokens ?? []) {
      switch (t.type) {
        case 'strong':
          out.push(...inline((t as Tokens.Strong).tokens, { ...f, bold: true }))
          break
        case 'em':
          out.push(...inline((t as Tokens.Em).tokens, { ...f, italics: true }))
          break
        case 'del':
          out.push(...inline((t as Tokens.Del).tokens, { ...f, strike: true }))
          break
        case 'codespan':
          out.push(run((t as Tokens.Codespan).text, { ...f, code: true }))
          break
        case 'br':
          out.push(new TextRun({ break: 1 }))
          break
        case 'link': {
          const l = t as Tokens.Link
          const note = parseNoteHref(l.href)
          if (note && !inDoc.has(note.path)) {
            // A note that isn't in this document: just its text.
            out.push(...inline(l.tokens, f))
          } else if (note) {
            const anchor = bookmarkName(note.heading ? headingAnchor(note.path, note.heading) : anchorFor(note.path))
            out.push(new InternalHyperlink({ anchor, children: [linkRun(l.text, f)] }))
          } else {
            out.push(new ExternalHyperlink({ link: l.href, children: [linkRun(l.text, f)] }))
          }
          break
        }
        case 'image': {
          const im = t as Tokens.Image
          const img = im.href.startsWith('vault:') ? opts.images.get(decodeURI(im.href.slice(6))) : undefined
          if (img) {
            const scale = Math.min(1, MAX_IMAGE_WIDTH / img.width)
            out.push(new ImageRun({ type: img.type, data: img.data, transformation: { width: Math.round(img.width * scale), height: Math.round(img.height * scale) } }))
          } else out.push(run(`[image: ${im.text || im.href}]`, { italics: true }))
          break
        }
        case 'html': {
          // <mark class="hl-green"> … </mark> highlights what's between; other tags are dropped.
          const tag = (t as Tokens.HTML).text
          const open = /^<mark(?:\s+class="hl-(\w+)")?>$/.exec(tag.trim())
          if (open) f = { ...f, highlight: WORD_HIGHLIGHT[open[1] ?? ''] ?? 'yellow' }
          else if (/^<\/mark>$/.test(tag.trim())) f = { ...f, highlight: outer.highlight }
          else {
            const plain = tag.replace(/<[^>]+>/g, '')
            if (plain) out.push(...[text(plain, f)].flat())
          }
          break
        }
        case 'text':
        case 'escape': {
          const tt = t as Tokens.Text
          if (tt.tokens?.length) out.push(...inline(tt.tokens, f))
          else out.push(...[text(tt.text, f)].flat())
          break
        }
        default:
          if ('text' in t && typeof t.text === 'string') out.push(...[text(t.text, f)].flat())
      }
    }
    return out
  }

  const block = (tokens: Token[], ctx: { quote?: boolean; list?: { ordered: boolean; level: number; instance: number } } = {}, item?: ExportItem): void => {
    const quote = ctx.quote
      ? { indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'B9B2EE', space: 10 } } }
      : {}
    for (const t of tokens) {
      switch (t.type) {
        case 'heading': {
          const h = t as Tokens.Heading
          const runs = inline(h.tokens)
          const id = item ? bookmarkName(headingAnchor(item.path, h.text.replace(/[*_~`]/g, ''))) : ''
          children.push(new Paragraph({ heading: HEADINGS[h.depth - 1], children: id ? [new Bookmark({ id, children: runs })] : runs, ...quote }))
          break
        }
        case 'paragraph':
          children.push(new Paragraph({ children: inline((t as Tokens.Paragraph).tokens), spacing: { after: 120 }, ...quote }))
          break
        case 'text': {
          // Text inside a tight list item.
          const tt = t as Tokens.Text
          children.push(new Paragraph({ children: inline(tt.tokens ?? [tt]), ...quote }))
          break
        }
        case 'list': {
          const l = t as Tokens.List
          const level = ctx.list ? ctx.list.level + 1 : 0
          const instance = l.ordered ? ++listInstance : 0
          for (const it of l.items) {
            const [first, ...rest] = it.tokens
            const box = it.task ? (it.checked ? '☑ ' : '☐ ') : ''
            const firstRuns = first && (first.type === 'text' || first.type === 'paragraph') ? inline((first as Tokens.Text).tokens ?? [first]) : []
            children.push(
              new Paragraph({
                children: [...(box ? [new TextRun({ text: box })] : []), ...firstRuns],
                ...(l.ordered ? { numbering: { reference: 'numbers', level: Math.min(level, 5), instance } } : { bullet: { level: Math.min(level, 5) } }),
                ...quote
              })
            )
            const remaining = first && (first.type === 'text' || first.type === 'paragraph') ? rest : it.tokens
            block(remaining, { ...ctx, list: { ordered: l.ordered, level, instance } }, item)
          }
          break
        }
        case 'blockquote': {
          const bq = t as Tokens.Blockquote
          const first = bq.tokens[0] as Tokens.Paragraph | undefined
          const m = first?.type === 'paragraph' ? CALLOUT_LINE.exec(first.raw.split('\n')[0]) : null
          if (!m) {
            block(bq.tokens, { ...ctx, quote: true }, item)
            break
          }
          // A callout: its title in bold and colour, then its text, inside the quote bar.
          const type = m[1].toLowerCase()
          const colour = CALLOUT_COLOURS[type] ?? '5E8BD8'
          const title = m[3] || type[0].toUpperCase() + type.slice(1)
          children.push(
            new Paragraph({
              children: [new TextRun({ text: decode(title), bold: true, color: colour })],
              indent: { left: 360 },
              border: { left: { style: BorderStyle.SINGLE, size: 18, color: colour, space: 10 } },
              shading: { type: ShadingType.CLEAR, fill: 'F6F6F9', color: 'auto' }
            })
          )
          const rest = first!.raw.split('\n').slice(1).join('\n').trim()
          block([...(rest ? new Lexer({ gfm: true }).lex(rest) : []), ...bq.tokens.slice(1)], { ...ctx, quote: true }, item)
          break
        }
        case 'code': {
          const lines = (t as Tokens.Code).text.split('\n')
          lines.forEach((line, i) =>
            children.push(
              new Paragraph({
                children: [new TextRun({ text: line || ' ', font: MONO, size: 19 })],
                shading: { type: ShadingType.CLEAR, fill: 'F3F3F6', color: 'auto' },
                spacing: { before: i === 0 ? 120 : 0, after: i === lines.length - 1 ? 160 : 0 },
                ...quote
              })
            )
          )
          break
        }
        case 'table': {
          const tb = t as Tokens.Table
          const cell = (c: Tokens.TableCell, header: boolean): TableCell =>
            new TableCell({
              children: [new Paragraph({ children: inline(c.tokens, header ? { bold: true } : {}) })],
              shading: header ? { type: ShadingType.CLEAR, fill: 'F3F3F6', color: 'auto' } : undefined,
              margins: { top: 60, bottom: 60, left: 100, right: 100 }
            })
          children.push(
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [new TableRow({ tableHeader: true, children: tb.header.map((c) => cell(c, true)) }), ...tb.rows.map((r) => new TableRow({ children: r.map((c) => cell(c, false)) }))]
            }),
            new Paragraph({ children: [] })
          )
          break
        }
        case 'hr':
          children.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'DDDDE3', space: 1 } }, spacing: { after: 200 } }))
          break
        case 'html': {
          const plain = (t as Tokens.HTML).text.replace(/<[^>]+>/g, '').trim()
          if (plain) children.push(new Paragraph({ children: [new TextRun(decode(plain))], ...quote }))
          break
        }
        default:
          break
      }
    }
  }

  opts.items.forEach((item, index) => {
    const tokens = new Lexer({ gfm: true }).lex(item.markdown)
    const firstHeading = tokens.find((t) => t.type !== 'space')
    const opensWithTitle = firstHeading?.type === 'heading' && (firstHeading as Tokens.Heading).depth === 1 && (firstHeading as Tokens.Heading).text.trim().toLowerCase() === item.title.toLowerCase()
    const anchor = bookmarkName(item.anchor)
    // A banner image goes above the title (colour banners don't carry over to Word).
    const bannerImg = item.banner ? opts.images.get(item.banner.replace(/^\[\[|\]\]$/g, '').replace(/^\/+/, '')) : undefined
    if (bannerImg) {
      const scale = Math.min(1, MAX_IMAGE_WIDTH / bannerImg.width)
      children.push(
        new Paragraph({
          pageBreakBefore: index > 0,
          children: [new ImageRun({ type: bannerImg.type, data: bannerImg.data, transformation: { width: Math.round(bannerImg.width * scale), height: Math.round(bannerImg.height * scale) } })]
        })
      )
    }
    const icon = item.icon ? [new TextRun(`${item.icon} `)] : []
    const breakBefore = index > 0 && !bannerImg
    if (opensWithTitle) {
      const h = firstHeading as Tokens.Heading
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: breakBefore, children: [new Bookmark({ id: anchor, children: [...icon, ...inline(h.tokens)] })] }))
      tokens.splice(tokens.indexOf(firstHeading!), 1)
    } else {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: breakBefore, children: [new Bookmark({ id: anchor, children: [...icon, new TextRun(item.title)] })] }))
    }
    if (item.properties.length) {
      for (const [k, v] of item.properties) {
        children.push(new Paragraph({ children: [new TextRun({ text: `${k}: `, color: '8A8E9C' }), new TextRun({ text: v })], spacing: { after: 0 } }))
      }
      children.push(new Paragraph({ children: [] }))
    }
    block(tokens, {}, item)
  })

  const doc = new Document({
    title: opts.title,
    creator: 'Notes',
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 }, paragraph: { spacing: { line: 300 } } } }
    },
    numbering: {
      config: [
        {
          reference: 'numbers',
          levels: [0, 1, 2, 3, 4, 5].map((level) => ({
            level,
            format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3],
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } }
          }))
        }
      ]
    },
    sections: [{ children }]
  })
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer())
}
