import type { Mermaid } from 'mermaid'

/**
 * Diagrams from text (Mermaid): flowcharts, sequence diagrams, timelines, pie charts, mind maps…
 *   ```mermaid
 *   flowchart TD
 *     A[Idea] --> B[Plan] --> C[Done]
 *   ```
 * Mermaid is large, so it's only loaded the first time a note has a diagram.
 */

let loading: Promise<Mermaid> | null = null
let theme: 'dark' | 'default' | null = null
let count = 0
/** One diagram at a time: Mermaid's settings are shared, and it draws in the page while measuring. */
let queue: Promise<unknown> = Promise.resolve()
const cache = new Map<string, string>()

const key = (code: string, dark: boolean): string => `${dark ? 'd' : 'l'}\n${code}`

/** A diagram already drawn (so it can show straight away), or undefined. */
export const cachedDiagram = (code: string, dark: boolean): string | undefined => cache.get(key(code, dark))

/** Draws a diagram as SVG. Throws (with Mermaid's message) if the text isn't a diagram it understands. */
export function renderDiagram(code: string, dark: boolean): Promise<string> {
  const k = key(code, dark)
  const hit = cache.get(k)
  if (hit) return Promise.resolve(hit)
  const job = queue.then(async () => {
    const mermaid = await (loading ??= import('mermaid').then((m) => m.default))
    const want = dark ? 'dark' : 'default'
    if (theme !== want) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: want, fontFamily: 'inherit' })
      theme = want
    }
    const id = `note-diagram-${++count}`
    try {
      const { svg } = await mermaid.render(id, code)
      cache.set(k, svg)
      if (cache.size > 200) cache.delete(cache.keys().next().value!)
      return svg
    } finally {
      // A diagram that fails can leave its scratch copy in the page.
      document.getElementById(id)?.remove()
      document.getElementById(`d${id}`)?.remove()
    }
  })
  queue = job.catch(() => undefined)
  return job
}

/** The ```mermaid blocks in some markdown. */
export function diagramsIn(markdown: string): string[] {
  const out: string[] = []
  for (const m of markdown.matchAll(/^ {0,3}(`{3,}|~{3,})[ \t]*mermaid[ \t]*\n([\s\S]*?)\n {0,3}\1[ \t]*$/gm)) out.push(m[2])
  return out
}
