import { formatDate } from './dates'

/**
 * Fills in a template. Placeholders:
 * {{title}} the note's name · {{date}} 2026-10-26 · {{time}} 14:05 · {{weekday}} Monday
 * {{date:dddd D MMMM}} any date format (see lib/dates.ts) · {{cursor}} where the cursor goes.
 * Returns the text and the cursor offset (or null if there's no {{cursor}}).
 */
export function fillTemplate(template: string, vars: { title: string; date?: Date }): { text: string; cursor: number | null } {
  const date = vars.date ?? new Date()
  let cursor: number | null = null
  let out = ''
  let last = 0
  for (const m of template.matchAll(/\{\{\s*(\w+)(?::([^}]*))?\s*\}\}/g)) {
    out += template.slice(last, m.index)
    last = m.index + m[0].length
    const [, name, arg] = m
    switch (name.toLowerCase()) {
      case 'title':
        out += vars.title
        break
      case 'date':
        out += formatDate(date, arg?.trim() || 'YYYY-MM-DD')
        break
      case 'time':
        out += formatDate(date, arg?.trim() || 'HH:mm')
        break
      case 'weekday':
        out += formatDate(date, 'dddd')
        break
      case 'cursor':
        if (cursor === null) cursor = out.length
        break
      default:
        out += m[0] // unknown placeholder: leave it as typed
    }
  }
  out += template.slice(last)
  return { text: out, cursor }
}

/** A starter template written when you first set up templates. */
export const EXAMPLE_TEMPLATE = `# {{title}}

**Date:** {{date:dddd D MMMM YYYY}}
**Attendees:**

## Agenda

- {{cursor}}

## Notes

## Actions

- [ ]
`
