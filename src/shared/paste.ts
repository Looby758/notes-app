/** Pure helpers for smart paste (shared so they can be tested without Electron or the editor). */

/** Tab-separated rows (as Excel, Google Sheets and browsers copy tables) as a markdown table. */
export function tableFromTsv(text: string): string | null {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')
  if (lines.length < 2) return null
  const rows = lines.map((l) => l.split('\t'))
  const cols = rows[0].length
  if (cols < 2 || rows.some((r) => r.length !== cols)) return null
  const cell = (c: string): string => c.trim().replace(/\|/g, '\\|') || ' '
  const line = (r: string[]): string => `| ${r.map(cell).join(' | ')} |`
  return [line(rows[0]), `| ${rows[0].map(() => '---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n')
}

/** Markdown link text: square brackets would end it early. */
export const linkText = (title: string): string => title.replace(/([[\]])/g, '\\$1')

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** The best title in a page's HTML: its og:title, else its <title>. */
export function titleFromHtml(html: string): string | null {
  const og =
    /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html) ??
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(html)
  const raw = og?.[1] ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  const title = raw ? decodeEntities(raw).replace(/\s+/g, ' ').trim() : ''
  return title ? title.slice(0, 200) : null
}

