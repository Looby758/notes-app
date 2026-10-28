/// <reference types="vite/client" />
import type { PdfItem } from './pdfStatement'

/** Thrown when a PDF needs a password (or the one given was wrong). */
export class PdfPasswordError extends Error {
  constructor(readonly wrong: boolean) {
    super(wrong ? 'That password is not right.' : 'This PDF is protected with a password.')
  }
}

/**
 * The text on each page of a PDF, with where it sits. Read on this computer: nothing is sent
 * anywhere. The PDF reader is only loaded the first time it's needed.
 */
export async function pdfPages(data: ArrayBuffer, password?: string): Promise<PdfItem[][]> {
  // The "legacy" build works on the version of Chrome inside the app; the standard one needs newer.
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const task = pdfjs.getDocument({ data: new Uint8Array(data), password })
  let doc
  try {
    doc = await task.promise
  } catch (err) {
    void task.destroy()
    if ((err as { name?: string }).name === 'PasswordException') throw new PdfPasswordError(!!password)
    throw new Error("That PDF couldn't be opened. It may be damaged.")
  }
  try {
    const pages: PdfItem[][] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const height = page.getViewport({ scale: 1 }).height
      const content = await page.getTextContent()
      const items: PdfItem[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        // PDF positions count up from the bottom of the page; turn them into top-down.
        items.push({
          str: item.str,
          x: item.transform[4],
          y: height - item.transform[5],
          width: item.width,
          size: Math.hypot(item.transform[2], item.transform[3])
        })
      }
      pages.push(items)
    }
    return pages
  } finally {
    void task.destroy()
  }
}
