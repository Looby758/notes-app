import { snippet, startCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { notePath } from './facets'
import { pickAndAttach } from './attachments'
import { fuzzyFilter } from '../../lib/fuzzy'
import { formatDate } from '../../lib/dates'
import { fillTemplate } from '../../lib/templates'
import { isWithin, noteTitle, notePaths } from '../../lib/paths'
import { useVault } from '../../store/vault'
import { usePrefs } from '../../store/prefs'
import { getNoteText } from '../../store/noteIndex'
import { useUI } from '../../store/ui'
import { addReminder, HIGHLIGHT_COLOURS } from './formatting'
import { CALLOUT_TYPES, calloutLabel } from './livePreview'

/**
 * Type "/" at the start of a line (or after a space) for a menu of things to insert:
 * headings, lists, tables, code, links, images, dates and your templates.
 */

interface SlashItem {
  label: string
  /** Extra words that find this item, e.g. "todo" for Checklist. */
  keywords: string
  section: 'Format' | 'Insert' | 'Placeholders' | 'Templates'
  detail?: string
  /** Replaces the typed "/query" (from..to) with this item. */
  apply: (view: EditorView, from: number, to: number) => void
}

/** Removes the "/query" and puts `prefix` at the start of the line (headings, lists, quotes). */
function linePrefix(prefix: string) {
  return (view: EditorView, from: number, to: number): void => {
    const line = view.state.doc.lineAt(from)
    // Replace any existing heading/list/quote marker rather than stacking them.
    const existing = /^(\s*)(#{1,6}\s|[-*+]\s(\[[ xX]\]\s)?|\d+[.)]\s|>\s)?/.exec(line.text)!
    const markerFrom = line.from + existing[1].length
    const markerTo = markerFrom + (existing[2]?.length ?? 0)
    view.dispatch({
      changes: [
        { from: markerFrom, to: Math.min(markerTo, from), insert: prefix },
        { from, to, insert: '' }
      ]
    })
  }
}

/** Replaces the "/query" with plain text. */
function text(insert: () => string) {
  return (view: EditorView, from: number, to: number): void => {
    const value = insert()
    view.dispatch({ changes: { from, to, insert: value }, selection: { anchor: from + value.length } })
  }
}

/** Replaces the "/query" with a snippet; Tab jumps between the ${} fields. */
function tpl(template: string) {
  const apply = snippet(template)
  return (view: EditorView, from: number, to: number): void => apply(view, null as unknown as Completion, from, to)
}

/** Block snippets start on their own line. */
function block(template: string) {
  return (view: EditorView, from: number, to: number): void => {
    const line = view.state.doc.lineAt(from)
    const needsBreak = view.state.sliceDoc(line.from, from).trim() !== ''
    tpl((needsBreak ? '\n' : '') + template)(view, from, to)
  }
}

const ITEMS: SlashItem[] = [
  { label: 'Heading 1', keywords: 'h1 title big', section: 'Format', detail: '#', apply: linePrefix('# ') },
  { label: 'Heading 2', keywords: 'h2 subtitle', section: 'Format', detail: '##', apply: linePrefix('## ') },
  { label: 'Heading 3', keywords: 'h3', section: 'Format', detail: '###', apply: linePrefix('### ') },
  { label: 'Bullet list', keywords: 'ul unordered points dash', section: 'Format', detail: '-', apply: linePrefix('- ') },
  { label: 'Numbered list', keywords: 'ol ordered 1.', section: 'Format', detail: '1.', apply: linePrefix('1. ') },
  { label: 'Checklist', keywords: 'todo task checkbox tick', section: 'Format', detail: '- [ ]', apply: linePrefix('- [ ] ') },
  { label: 'Quote', keywords: 'blockquote cite', section: 'Format', detail: '>', apply: linePrefix('> ') },
  { label: 'Code block', keywords: 'pre fence snippet programming', section: 'Insert', detail: '```', apply: block('```${language}\n${}\n```') },
  {
    label: 'Table',
    keywords: 'grid columns rows',
    section: 'Insert',
    detail: '2 × 2',
    apply: block('| ${Column 1} | ${Column 2} |\n| --- | --- |\n| ${} |  |\n')
  },
  { label: 'Divider', keywords: 'hr rule line separator', section: 'Insert', detail: '---', apply: block('---\n${}') },
  {
    label: 'Link to note',
    keywords: 'wikilink [[ reference',
    section: 'Insert',
    detail: '[[ ]]',
    apply: (view, from, to) => {
      text(() => '[[')(view, from, to)
      startCompletion(view)
    }
  },
  {
    label: 'Embed note',
    keywords: 'transclude include show ![[',
    section: 'Insert',
    detail: '![[ ]]',
    apply: (view, from, to) => {
      text(() => '![[')(view, from, to)
      startCompletion(view)
    }
  },
  {
    label: 'Image…',
    keywords: 'picture photo screenshot png jpg',
    section: 'Insert',
    detail: 'from a file',
    apply: (view, from, to) => {
      view.dispatch({ changes: { from, to, insert: '' } })
      pickAndAttach(view, true)
    }
  },
  {
    label: 'Attach file…',
    keywords: 'pdf document attachment upload',
    section: 'Insert',
    detail: 'link to a file',
    apply: (view, from, to) => {
      view.dispatch({ changes: { from, to, insert: '' } })
      pickAndAttach(view, false)
    }
  },
  { label: "Today's date", keywords: 'date day now', section: 'Insert', detail: formatDate(new Date(), 'YYYY-MM-DD'), apply: text(() => formatDate(new Date(), 'YYYY-MM-DD')) },
  { label: 'Current time', keywords: 'time clock now', section: 'Insert', detail: formatDate(new Date(), 'HH:mm'), apply: text(() => formatDate(new Date(), 'HH:mm')) },
  {
    label: 'Date and time',
    keywords: 'timestamp now',
    section: 'Insert',
    apply: text(() => formatDate(new Date(), 'YYYY-MM-DD HH:mm'))
  },
  { label: 'Tag', keywords: 'hashtag #', section: 'Insert', detail: '#', apply: text(() => '#') },
  {
    label: 'Voice note',
    keywords: 'record audio microphone speak mic',
    section: 'Insert',
    detail: 'record',
    apply: (view, from, to) => {
      view.dispatch({ changes: { from, to, insert: '' } })
      useUI.setState({ voiceOpen: true })
    }
  },
  {
    label: 'Sketch',
    keywords: 'draw drawing handwriting pen doodle diagram picture',
    section: 'Insert',
    detail: 'draw',
    apply: (view, from, to) => {
      view.dispatch({ changes: { from, to, insert: '' } })
      useUI.setState({ sketch: { path: null } })
    }
  },
  {
    label: 'Reminder',
    keywords: 'remind alarm notify alert time ⏰',
    section: 'Insert',
    detail: '⏰ in an hour',
    apply: (view, from, to) => {
      view.dispatch({ changes: { from, to, insert: '' } })
      addReminder(view)
    }
  },
  { label: 'Highlight', keywords: 'marker yellow ==', section: 'Format', detail: '==', apply: tpl('==${}==') },
  ...HIGHLIGHT_COLOURS.map(
    (c): SlashItem => ({ label: `Highlight ${c}`, keywords: `marker colour color ${c}`, section: 'Format', apply: tpl(`<mark class="hl-${c}">\${}</mark>`) })
  ),
  // One per callout type, e.g. "/tip" or "/callout warning".
  ...CALLOUT_TYPES.map(
    (t): SlashItem => ({
      label: `Callout: ${calloutLabel(t)}`,
      keywords: `callout box admonition ${t}`,
      section: 'Insert',
      detail: `[!${t}]`,
      apply: block(`> [!${t}] \${${calloutLabel(t)}}\n> \${}`)
    })
  ),
  {
    label: 'Callout: foldable',
    keywords: 'callout box collapse fold toggle details',
    section: 'Insert',
    detail: '[!note]-',
    apply: block('> [!note]- ${Title}\n> ${}')
  }
]

/** One item per note in the templates folder. */
function templateItems(): SlashItem[] {
  const folder = usePrefs.getState().prefs.templatesFolder
  return notePaths(useVault.getState().tree)
    .filter((p) => (folder ? isWithin(p, folder) : false))
    .map((path) => ({
      label: `Template: ${noteTitle(path)}`,
      keywords: 'template insert',
      section: 'Templates' as const,
      apply: (view: EditorView, from: number, to: number) => {
        const { text: filled, cursor } = fillTemplate(getNoteText(path) ?? '', { title: noteTitle(view.state.facet(notePath)) })
        view.dispatch({ changes: { from, to, insert: filled }, selection: { anchor: from + (cursor ?? filled.length) } })
      }
    }))
}

/** In a template: {{date}} and friends, each with what it becomes today. */
export const PLACEHOLDERS: { code: string; label: string; keywords: string }[] = [
  { code: '{{date:dddd D MMMM YYYY}}', label: 'Date, written out', keywords: 'day weekday long heading' },
  { code: '{{date:D MMMM YYYY}}', label: 'Date without the weekday', keywords: 'day month year' },
  { code: '{{date:ddd D MMM}}', label: 'Short date', keywords: 'day abbreviated' },
  { code: '{{date}}', label: 'Date (YYYY-MM-DD)', keywords: 'iso day number' },
  { code: '{{date:DD/MM/YYYY}}', label: 'Date with slashes', keywords: 'uk numbers' },
  { code: '{{weekday}}', label: 'Weekday', keywords: 'day name monday' },
  { code: '{{date:MMMM YYYY}}', label: 'Month and year', keywords: 'month' },
  { code: '{{time}}', label: 'Time', keywords: 'clock hour now' },
  { code: '{{title}}', label: 'Note name', keywords: 'title name file' },
  { code: '{{cursor}}', label: 'Cursor starts here', keywords: 'caret start typing' }
]

function placeholderItems(): SlashItem[] {
  return PLACEHOLDERS.map((p) => ({
    label: `Placeholder: ${p.label}`,
    keywords: `placeholder template variable ${p.keywords} ${p.code}`,
    section: 'Placeholders' as const,
    detail: p.code.startsWith('{{date') || p.code.startsWith('{{weekday') || p.code.startsWith('{{time')
      ? fillTemplate(p.code, { title: '' }).text
      : p.code,
    apply: text(() => p.code)
  }))
}

const SECTION_ORDER = { Format: 0, Insert: 1, Placeholders: 2, Templates: 3 }

/**
 * Best matches first: a word in the name starting with what you typed ("/check"), then a keyword
 * starting with it ("/todo" → Checklist), then looser fuzzy matches ("/hd2" → Heading 2).
 */
function rank(items: SlashItem[], query: string): SlashItem[] {
  const q = query.toLowerCase()
  const words = (s: string): string[] => s.toLowerCase().split(/[\s:]+/).filter(Boolean)
  const tier = (item: SlashItem): number => {
    if (words(item.label).some((w) => w.startsWith(q)) || item.label.toLowerCase().startsWith(q)) return 0
    if (words(item.keywords).some((w) => w.startsWith(q))) return 1
    return 2
  }
  const fuzzy = fuzzyFilter(items, query, (i) => `${i.label} ${i.keywords}`).map((r) => r.item)
  return fuzzy.map((item, order) => ({ item, order, t: tier(item) })).sort((a, b) => a.t - b.t || a.order - b.order).map((r) => r.item)
}

export function slashCompletions(ctx: CompletionContext): CompletionResult | null {
  const match = ctx.matchBefore(/(?:^|\s)\/[\w' -]{0,30}$/)
  if (!match) return null
  const slash = match.from + match.text.indexOf('/')
  const query = ctx.state.sliceDoc(slash + 1, ctx.pos)
  // A space right after "/" or a long phrase means you're just writing a slash.
  if (/^\s/.test(query) || query.split(' ').length > 3) return null
  // Not inside code.
  for (let node = syntaxTree(ctx.state).resolveInner(slash, -1); node; node = node.parent!) {
    if (/Code|CodeBlock/.test(node.name)) return null
    if (!node.parent) break
  }

  // Placeholders only make sense in templates.
  const folder = usePrefs.getState().prefs.templatesFolder
  const path = ctx.state.facet(notePath)
  const inTemplate = !!folder && !!path && isWithin(path, folder)
  const items = [...ITEMS, ...(inTemplate ? placeholderItems() : []), ...templateItems()]
  const ranked = query.trim() ? rank(items, query.trim()) : items
  if (ranked.length === 0) return null

  return {
    from: slash,
    to: ctx.pos,
    filter: false,
    options: ranked.slice(0, 30).map(
      (item, i): Completion => ({
        label: item.label,
        detail: item.detail,
        type: 'slash',
        // Keep the best fuzzy match first; with no query, group by section.
        boost: query.trim() ? 99 - i : -SECTION_ORDER[item.section],
        section: query.trim() ? undefined : { name: item.section, rank: SECTION_ORDER[item.section] },
        apply: (view, _c, from, to) => item.apply(view, from, to)
      })
    )
  }
}
