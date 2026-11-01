import { describe, expect, it } from 'vitest'
import { withDateHeading } from './daily'
import { fillTemplate } from './templates'
import { readFrontmatter } from './properties'

const props = (text: string): Record<string, unknown> =>
  Object.fromEntries((readFrontmatter(text)?.properties ?? []).map((p) => [p.key, p.value]))

describe('daily template properties carry over', () => {
  it('keeps the icon, banner and other properties on top, under the date heading', () => {
    const template = '---\nicon: 🌞\nbanner: aurora\nbanner_y: 30\ntags: [daily]\n---\n## Tasks\n\n- [ ] {{cursor}}\n'
    const { text } = fillTemplate(withDateHeading(template, true), { title: 'x', date: new Date(2026, 10, 1) })
    expect(props(text)).toEqual({ icon: '🌞', banner: 'aurora', banner_y: '30', tags: ['daily'] })
    expect(text).toContain('---\n# Sunday 1 November 2026\n\n## Tasks')
  })

  it('keeps properties when the template ends right after the closing ---', () => {
    const out = withDateHeading('---\nicon: 📓\n---', true)
    expect(props(out)).toEqual({ icon: '📓' })
    expect(out.startsWith('---\nicon: 📓\n---\n# {{date')).toBe(true)
  })

  it('handles spaces after the fences and a ... closing line', () => {
    const out = withDateHeading('--- \nicon: 📓\n...\nBody', true)
    expect(props(out)).toEqual({ icon: '📓' })
    expect(out).toContain('# {{date:dddd D MMMM YYYY}}\n\nBody')
  })

  it('leaves a template with its own heading alone', () => {
    const t = '---\nicon: 📓\n---\n# {{title}}\n'
    expect(withDateHeading(t, true)).toBe(t)
    expect(withDateHeading(t, false)).toBe(t)
  })
})
