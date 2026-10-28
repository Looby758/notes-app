import { anchorFor, type ExportItem } from '../export/prepare'
import { toHtmlDocument, toPrintablePage } from '../export/html'
import type { DocxImage } from '../export/docx'
import { forWord } from '../export'
import { htmlToMarkdown } from '../import/html'
import { readFrontmatter } from '../properties'
import { extOf, stemOf } from './formats'

export type DocumentFormat = 'pdf' | 'docx' | 'md' | 'txt' | 'html'

/** Plain text as markdown that shows exactly as written. */
export const textToMarkdown = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/([\\`*_[\]#<>|~])/g, '\\$1').replace(/^(\s*)([+-]|\d+\.)(\s)/, '$1\\$2$3') + '  ')
    .join('\n')

/** A Word document's contents as HTML (pictures built in). */
async function wordToHtml(file: File): Promise<string> {
  const mammoth = (await import('mammoth')).default
  try {
    const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
    return result.value
  } catch {
    throw new Error('This Word document couldn’t be opened. It may be damaged or password protected.')
  }
}

async function wordToText(file: File): Promise<string> {
  const mammoth = (await import('mammoth')).default
  return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value
}

/** The file's text as markdown (a note's properties left out). */
async function asMarkdown(file: File): Promise<string> {
  const ext = extOf(file.name)
  if (ext === 'docx') return htmlToMarkdown(await wordToHtml(file), { image: (src, alt) => (src.startsWith('data:') ? `![${alt}](${src})` : null) })
  const text = await file.text()
  if (ext === 'txt') return textToMarkdown(text)
  if (ext === 'html' || ext === 'htm') return htmlToMarkdown(text, { image: (src, alt) => (/^(data:|https?:)/i.test(src) ? `![${alt}](${src})` : null) })
  const fm = readFrontmatter(text)
  return fm ? text.slice(fm.to) : text
}

/** The converted file's title: the heading it opens with (so it isn't shown twice), or the file's name. */
export function titleOf(name: string, markdown: string): string {
  const first = /^\s*#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(markdown)
  return first && !markdown.slice(0, first.index).trim() ? first[1].replace(/[*_~`]/g, '').trim() : stemOf(name)
}

const itemFor = (file: File, markdown: string): ExportItem => ({
  path: file.name,
  title: titleOf(file.name, markdown),
  anchor: anchorFor(file.name),
  markdown,
  properties: []
})

/** A data: URL's contents. */
function dataUrlBlob(url: string): Blob {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url)
  if (!m) throw new Error('Not a picture')
  const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3])
  return new Blob([Uint8Array.from(raw, (c) => c.charCodeAt(0))], { type: m[1] })
}

/** Word wants pictures as files of their own: built-in (data:) pictures are handed over that way. */
async function wordImages(markdown: string): Promise<{ markdown: string; images: Map<string, DocxImage> }> {
  const images = new Map<string, DocxImage>()
  const found: string[] = []
  const rewritten = markdown.replace(/\]\((data:image\/[^)\s]+)\)/g, (_m, url: string) => {
    found.push(url)
    return `](vault:converted-${found.length - 1})`
  })
  for (const [i, url] of found.entries()) {
    try {
      const img = await forWord(dataUrlBlob(url))
      if (img) images.set(`converted-${i}`, img)
    } catch {
      // Shown as "[image]" instead.
    }
  }
  return { markdown: rewritten, images }
}

/** Converts a document: Word to PDF, markdown to Word, and so on. */
export async function convertDocument(file: File, format: DocumentFormat): Promise<Uint8Array | string> {
  const ext = extOf(file.name)
  const title = stemOf(file.name)
  if (format === 'pdf') {
    // Word documents and web pages print as they are; text and markdown look like an exported note.
    if (ext === 'docx') return window.api.printToPdf(toPrintablePage(title, await wordToHtml(file)))
    if (ext === 'html' || ext === 'htm') return window.api.printToPdf(await file.text())
    return window.api.printToPdf(toHtmlDocument({ items: [itemFor(file, await asMarkdown(file))], images: new Map(), title, forPrint: true }))
  }
  if (format === 'txt') return ext === 'docx' ? wordToText(file) : file.text()
  const markdown = await asMarkdown(file)
  if (format === 'md') return markdown.trim() + '\n'
  if (format === 'html') return toHtmlDocument({ items: [itemFor(file, markdown)], images: new Map(), title, forPrint: false })
  const { toDocx } = await import('../export/docx')
  const word = await wordImages(markdown)
  return toDocx({ items: [itemFor(file, word.markdown)], images: word.images, title })
}
