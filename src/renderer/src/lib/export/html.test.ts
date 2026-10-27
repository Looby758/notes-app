import { describe, expect, it } from 'vitest'
import { toHtmlDocument } from './html'
import type { ExportItem } from './prepare'

const note = (markdown: string): ExportItem => ({ path: 'a.md', title: 'A', anchor: 'n-a', markdown, properties: [] })
const page = (markdown: string, diagrams?: Map<string, string>): string =>
  toHtmlDocument({ items: [note(markdown)], images: new Map(), diagrams, title: 'A', forPrint: false })

describe('maths and diagrams in exports', () => {
  it('turns $…$ and $$…$$ into maths', () => {
    const html = page('Area $\\pi r^2$ here.\n\n$$\n\\frac{a}{b}\n$$\n\nCosts $5 and $10.')
    expect(html).toContain('<math')
    expect(html).toContain('<mfrac>')
    expect(html).toContain('class="math-block"')
    expect(html).toContain('Costs $5 and $10.')
  })
  it('puts drawn diagrams in, and keeps the text of ones that could not be drawn', () => {
    const md = '```mermaid\nflowchart TD\n  A --> B\n```\n\n```mermaid\nnot a diagram\n```'
    const html = page(md, new Map([['flowchart TD\n  A --> B', '<svg id="d1"></svg>']]))
    expect(html).toContain('<div class="diagram"><svg id="d1"></svg></div>')
    expect(html).toContain('<code class="language-mermaid">not a diagram')
  })
})
