import JSZip from 'jszip'
import { chapterHtml, chapterPlain, epubFiles, fileNameFor, storyPlain, type Chapter, type Story } from '@shared/writing'

/** Writing Studio exports: an e-book file, a text file, and chapters copied ready to paste into AO3 or Wattpad. */

/** The story as an EPUB e-book (opens in Apple Books, Google Play Books, Kindle via Send to Kindle, Calibre…). */
export async function buildEpub(story: Story, now = new Date()): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const f of epubFiles(story, story.author, now)) {
    // The e-book rules: "mimetype" first and not compressed.
    zip.file(f.path, f.text, f.path === 'mimetype' ? { compression: 'STORE' } : { compression: 'DEFLATE' })
  }
  return zip.generateAsync({ type: 'uint8array', mimeType: 'application/epub+zip' })
}

export async function saveEpub(story: Story): Promise<string | null> {
  return window.api.exportFile(`${fileNameFor(story.title)}.epub`, 'epub', await buildEpub(story))
}

export function saveText(story: Story): Promise<string | null> {
  return window.api.exportFile(`${fileNameFor(story.title)}.txt`, 'txt', storyPlain(story))
}

async function copy(html: string, plain: string): Promise<void> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })])
  } catch {
    await navigator.clipboard.writeText(plain)
  }
}

/**
 * For AO3: pasted into the Rich Text box it arrives formatted, and pasted into the HTML box (which
 * takes plain text) it arrives as AO3's own HTML. Either way the italics survive.
 */
export function copyForAo3(chapter: Chapter): Promise<void> {
  const html = chapterHtml(chapter)
  return copy(html, html)
}

/** For Wattpad (and most sites): plain paragraphs, with italics kept when the box takes formatting. */
export function copyForWattpad(chapter: Chapter): Promise<void> {
  return copy(chapterHtml(chapter), chapterPlain(chapter))
}
