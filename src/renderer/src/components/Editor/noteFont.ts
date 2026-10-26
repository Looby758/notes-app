import { EditorView } from '@codemirror/view'
import { readFrontmatter } from '../../lib/properties'

/**
 * A note's own font, from a `font:` property: serif, sans, mono, handwriting, or the name of any
 * font installed on your computer (e.g. `font: Georgia`).
 */

export const FONT_OPTIONS = ['serif', 'sans', 'mono', 'handwriting']

const STACKS: Record<string, string> = {
  serif: "'Iowan Old Style', 'Charter', Georgia, Cambria, 'Times New Roman', serif",
  sans: 'var(--font-ui)',
  mono: 'var(--font-mono)',
  handwriting: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', 'Chalkboard SE', cursive"
}

/** The CSS font stack for a `font:` value, or null for none / something unusable. */
export function fontStackFor(value: string): string | null {
  const v = value.trim()
  if (!v) return null
  const named = STACKS[v.toLowerCase()]
  if (named) return named
  // A font's name: only characters a name can have (it goes into CSS).
  const clean = v.replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 80)
  return clean ? `'${clean}', var(--font-ui)` : null
}

export const noteFont = EditorView.editorAttributes.compute(['doc'], (state): Record<string, string> => {
  if (!state.doc.sliceString(0, 4).startsWith('---')) return {}
  const head = state.doc.sliceString(0, 3000)
  const font = readFrontmatter(head)?.properties.find((p) => p.key.toLowerCase() === 'font')?.value
  const stack = typeof font === 'string' ? fontStackFor(font) : null
  return stack ? { style: `--font-editor: ${stack}`, class: 'cm-note-font' } : {}
})
