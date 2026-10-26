import { EditorSelection, type EditorState, type Line } from '@codemirror/state'
import type { Command } from '@codemirror/view'

/**
 * Wraps the selection in `marker` (e.g. ** for bold), or unwraps it if it's already wrapped.
 * Spaces at the edges of the selection stay outside the markers: markdown ignores `**bold **`.
 */
export function toggleWrap(marker: string): Command {
  return (view) => {
    const { state } = view
    const n = marker.length
    view.dispatch(
      state.changeByRange((range) => {
        const text = state.sliceDoc(range.from, range.to)
        const from = range.from + (text.length - text.trimStart().length)
        const to = Math.max(from, range.to - (text.length - text.trimEnd().length))
        const inner = state.sliceDoc(from, to)

        // Selection includes the markers: "**bold**" → "bold"
        if (inner.length >= 2 * n && inner.startsWith(marker) && inner.endsWith(marker)) {
          return {
            changes: [
              { from, to: from + n },
              { from: to - n, to }
            ],
            range: EditorSelection.range(from, to - 2 * n)
          }
        }
        // Markers sit just outside the selection: **[bold]** → bold
        if (state.sliceDoc(from - n, from) === marker && state.sliceDoc(to, to + n) === marker) {
          return {
            changes: [
              { from: from - n, to: from },
              { from: to, to: to + n }
            ],
            range: EditorSelection.range(from - n, to - n)
          }
        }
        return {
          changes: [
            { from, insert: marker },
            { from: to, insert: marker }
          ],
          range: EditorSelection.range(from + n, to + n)
        }
      })
    )
    return true
  }
}

/** Highlighter colours besides the plain ==yellow==. */
export const HIGHLIGHT_COLOURS = ['green', 'blue', 'pink', 'purple', 'orange'] as const

const MARK_TAG = /<mark class="hl-(\w+)">([\s\S]*?)<\/mark>/g

/**
 * A coloured highlight: <mark class="hl-green">text</mark> (plain HTML, so other apps still show
 * a highlight). On text that's already highlighted, the same colour removes it and another changes it.
 */
export function toggleColourHighlight(colour: string): Command {
  return (view) => {
    const { state } = view
    view.dispatch(
      state.changeByRange((range) => {
        const line = state.doc.lineAt(range.from)
        // Already inside a coloured highlight on this line?
        for (const m of line.text.matchAll(MARK_TAG)) {
          const from = line.from + m.index
          const to = from + m[0].length
          if (range.from >= from && range.to <= to) {
            const inner = m[2]
            const replacement = m[1] === colour ? inner : `<mark class="hl-${colour}">${inner}</mark>`
            const start = m[1] === colour ? from : from + `<mark class="hl-${colour}">`.length
            return { changes: { from, to, insert: replacement }, range: EditorSelection.range(start, start + inner.length) }
          }
        }
        const text = state.sliceDoc(range.from, range.to)
        const from = range.from + (text.length - text.trimStart().length)
        const to = Math.max(from, range.to - (text.length - text.trimEnd().length))
        const open = `<mark class="hl-${colour}">`
        return {
          changes: [
            { from, insert: open },
            { from: to, insert: '</mark>' }
          ],
          range: EditorSelection.range(from + open.length, to + open.length)
        }
      })
    )
    return true
  }
}

/**
 * Turns the current line into a task with a reminder in an hour's time (on the hour), and selects
 * the time so you can type over it: "- [ ] Call Sam ⏰ 2026-10-26 16:00".
 */
export const addReminder: Command = (view) => {
  const { state } = view
  const line = state.doc.lineAt(state.selection.main.head)
  const at = new Date(Date.now() + 60 * 60_000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  const time = `${pad(at.getHours())}:00`
  const text = line.text.replace(/\s*(⏰️?|\bremind:)\s*(\d{4}-\d{2}-\d{2}\s+)?\d{1,2}:\d{2}/u, '')
  const isTask = /^\s*[-*+]\s+\[[ xX]\]\s/.test(text)
  const isItem = /^\s*[-*+]\s/.test(text)
  const body = isTask ? text : isItem ? text.replace(/^(\s*[-*+]\s)/, '$1[ ] ') : `- [ ] ${text.trimStart()}`
  const next = `${body.trimEnd()} ⏰ ${date} ${time}`
  view.dispatch({ changes: { from: line.from, to: line.to, insert: next }, selection: EditorSelection.range(line.from + next.length - 5, line.from + next.length) })
  return true
}

// ---------- whole lines: headings, lists, quotes, callouts ----------

const BLOCK_MARK = /^(\s*)(#{1,6}\s|[-*+]\s\[[ xX]\]\s|[-*+]\s|\d+[.)]\s|>\s?)?/

/** The lines the selection touches (just the cursor's line when nothing is selected). */
function selectedLines(state: EditorState): Line[] {
  const seen = new Map<number, Line>()
  for (const r of state.selection.ranges) {
    const last = state.doc.lineAt(r.to).number
    for (let n = state.doc.lineAt(r.from).number; n <= last; n++) seen.set(n, state.doc.line(n))
  }
  const lines = [...seen.values()]
  // Several lines: leave the empty ones between paragraphs alone.
  return lines.length > 1 ? lines.filter((l) => l.text.trim()) : lines
}

/**
 * Makes the selected lines headings, list items or quotes (replacing any other such marker).
 * If they all have this one already, it's removed instead.
 */
export function toggleLinePrefix(prefix: string): Command {
  return (view) => {
    const lines = selectedLines(view.state)
    const has = (l: Line): boolean => (BLOCK_MARK.exec(l.text)![2] ?? '').trimEnd() === prefix.trimEnd()
    const remove = lines.every(has)
    view.dispatch({
      changes: lines.map((l) => {
        const m = BLOCK_MARK.exec(l.text)!
        const from = l.from + m[1].length
        return { from, to: from + (m[2]?.length ?? 0), insert: remove ? '' : prefix }
      })
    })
    return true
  }
}

/** Puts the selected lines in a callout box, with its title selected to type over. */
export const makeCallout: Command = (view) => {
  const { state } = view
  const first = state.doc.lineAt(state.selection.main.from)
  const last = state.doc.lineAt(state.selection.main.to)
  const body = state
    .sliceDoc(first.from, last.to)
    .split('\n')
    .map((l) => `> ${l.replace(/^>\s?/, '')}`.trimEnd() || '>')
    .join('\n')
  const head = '> [!note] '
  view.dispatch({
    changes: { from: first.from, to: last.to, insert: `${head}Note\n${body === '>' ? '> ' : body}` },
    selection: EditorSelection.range(first.from + head.length, first.from + head.length + 4)
  })
  return true
}

// ---------- links ----------

/** [[selection]]: a link to the note with that name (or unlinks it). */
export const linkToNote: Command = (view) => {
  const { state } = view
  view.dispatch(
    state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to)
      if (state.sliceDoc(range.from - 2, range.from) === '[[' && state.sliceDoc(range.to, range.to + 2) === ']]') {
        return { changes: [{ from: range.from - 2, to: range.from }, { from: range.to, to: range.to + 2 }], range: EditorSelection.range(range.from - 2, range.to - 2) }
      }
      const m = /^\[\[([^\]]*)\]\]$/.exec(text)
      if (m) return { changes: { from: range.from, to: range.to, insert: m[1] }, range: EditorSelection.range(range.from, range.from + m[1].length) }
      return { changes: [{ from: range.from, insert: '[[' }, { from: range.to, insert: ']]' }], range: EditorSelection.range(range.from + 2, range.to + 2) }
    })
  )
  return true
}

const URL_RE = /^https?:\/\/\S+$/i

/**
 * [selection](url). A copied web address is used for the url; otherwise "url" is selected to
 * type over. Selecting a web address gives [](address) with the cursor in the brackets.
 */
export const webLink: Command = (view) => {
  const range = view.state.selection.main
  const text = view.state.sliceDoc(range.from, range.to)
  const apply = (copied: string): void => {
    const { from, to } = view.state.selection.main
    if (URL_RE.test(text.trim())) {
      view.dispatch({ changes: { from, to, insert: `[](${text.trim()})` }, selection: { anchor: from + 1 } })
      return
    }
    const url = URL_RE.test(copied.trim()) ? copied.trim() : 'url'
    const insert = `[${text}](${url})`
    const urlFrom = from + text.length + 3
    view.dispatch({
      changes: { from, to, insert },
      selection: url === 'url' ? EditorSelection.range(urlFrom, urlFrom + 3) : text ? { anchor: from + insert.length } : { anchor: from + 1 }
    })
  }
  navigator.clipboard.readText().then(apply, () => apply(''))
  return true
}

// ---------- clear formatting ----------

const INLINE_MARKS = /<\/?mark\b[^>]*>|\*\*|~~|==|\*|`/g

/** Removes bold, italic, strikethrough, code and highlight marks in (and just around) the selection. */
export const clearFormatting: Command = (view) => {
  const { state } = view
  view.dispatch(
    state.changeByRange((range) => {
      if (range.empty) return { range }
      let from = range.from
      let to = range.to
      // Take in markers that hug the selection: **[bold]**, <mark …>[text]</mark>.
      for (let changed = true; changed; ) {
        changed = false
        const before = state.sliceDoc(Math.max(0, from - 40), from)
        const after = state.sliceDoc(to, to + 10)
        const open = /(<mark\b[^>]*>|\*\*|~~|==|\*|`)$/.exec(before)
        const close = /^(<\/mark>|\*\*|~~|==|\*|`)/.exec(after)
        if (open && close && (open[1] === close[1] || (open[1].startsWith('<mark') && close[1] === '</mark>'))) {
          from -= open[1].length
          to += close[1].length
          changed = true
        }
      }
      const cleaned = state.sliceDoc(from, to).replace(INLINE_MARKS, '')
      return { changes: { from, to, insert: cleaned }, range: EditorSelection.range(from, from + cleaned.length) }
    })
  )
  return true
}

/** Commands that act on the editor; their shortcuts can be changed in Settings like any other. */
export interface EditorCommand {
  id: string
  title: string
  shortcut?: string
  run: Command
}

export const EDITOR_COMMANDS: EditorCommand[] = [
  { id: 'format.bold', title: 'Bold', shortcut: 'Ctrl+B', run: toggleWrap('**') },
  { id: 'format.italic', title: 'Italic', shortcut: 'Ctrl+I', run: toggleWrap('*') },
  { id: 'format.code', title: 'Inline code', shortcut: 'Ctrl+E', run: toggleWrap('`') },
  { id: 'format.strike', title: 'Strikethrough', shortcut: 'Ctrl+Shift+X', run: toggleWrap('~~') },
  { id: 'format.highlight', title: 'Highlight', shortcut: 'Ctrl+Shift+H', run: toggleWrap('==') },
  { id: 'insert.reminder', title: 'Add a reminder to this line', shortcut: 'Ctrl+Alt+R', run: addReminder },
  ...HIGHLIGHT_COLOURS.map((c) => ({ id: `format.highlight.${c}`, title: `Highlight ${c}`, run: toggleColourHighlight(c) })),
  { id: 'format.linkNote', title: 'Link to a note [[ ]]', run: linkToNote },
  { id: 'format.linkWeb', title: 'Web link', run: webLink },
  { id: 'format.h1', title: 'Heading 1', run: toggleLinePrefix('# ') },
  { id: 'format.h2', title: 'Heading 2', run: toggleLinePrefix('## ') },
  { id: 'format.h3', title: 'Heading 3', run: toggleLinePrefix('### ') },
  { id: 'format.bullet', title: 'Bullet list', run: toggleLinePrefix('- ') },
  { id: 'format.numbered', title: 'Numbered list', run: toggleLinePrefix('1. ') },
  { id: 'format.checklist', title: 'Checklist', run: toggleLinePrefix('- [ ] ') },
  { id: 'format.quote', title: 'Quote', run: toggleLinePrefix('> ') },
  { id: 'format.callout', title: 'Callout', run: makeCallout },
  { id: 'format.clear', title: 'Clear formatting', run: clearFormatting }
]
