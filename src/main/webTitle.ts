import { ipcMain, net } from 'electron'
import { titleFromHtml } from '@shared/paste'

/** Reads a web page's title, so a pasted link can become [Title](url). */

async function fetchTitle(url: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 6000)
  try {
    const res = await net.fetch(url, { signal: abort.signal, headers: { Accept: 'text/html' } })
    if (!res.ok || !/html/i.test(res.headers.get('content-type') ?? '')) return null
    // The title is near the top; don't read huge pages to the end.
    const reader = res.body?.getReader()
    if (!reader) return null
    const decoder = new TextDecoder()
    let html = ''
    while (html.length < 400_000) {
      const { done, value } = await reader.read()
      if (done) break
      html += decoder.decode(value, { stream: true })
      if (/<\/head>/i.test(html)) break
    }
    void reader.cancel().catch(() => undefined)
    return titleFromHtml(html)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function setupWebTitle(): void {
  ipcMain.handle('web:title', (_e, url: string) => fetchTitle(String(url)))
}
