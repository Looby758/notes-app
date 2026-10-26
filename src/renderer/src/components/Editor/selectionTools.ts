import { EditorSelection, StateEffect, StateField, type Extension } from '@codemirror/state'
import { EditorView, showTooltip, ViewPlugin, type Tooltip } from '@codemirror/view'
import { EDITOR_COMMANDS } from './formatting'
import { formatMenu, highlightMenu, popupFormat, turnIntoMenu } from '../../lib/formatMenu'
import { effectiveShortcut } from '../../store/prefs'
import { showKeys } from '@shared/platform'

// ---------- wrap the selection when typing a marker ----------

const WRAP: Record<string, string> = { '*': '*', '=': '==', '~': '~~', '`': '`' }

/** Select a word and type * (again for **bold**), = for ==highlight==, ~ for ~~strike~~ or ` for code. */
export const wrapOnType = EditorView.inputHandler.of((view, _from, _to, text) => {
  const marker = WRAP[text]
  if (!marker || view.state.selection.ranges.every((r) => r.empty) || view.state.readOnly) return false
  view.dispatch(
    view.state.changeByRange((range) => {
      if (range.empty) return { changes: { from: range.from, insert: text }, range: EditorSelection.cursor(range.from + text.length) }
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker }
        ],
        range: EditorSelection.range(range.from + marker.length, range.to + marker.length)
      }
    }),
    { userEvent: 'input.type' }
  )
  return true
})

// ---------- the toolbar above selected text ----------

const setDragging = StateEffect.define<boolean>()

/** Hidden while the mouse is still selecting (it'd flicker), shown once you let go. */
const dragging = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(setDragging) ? e.value : acc), v)
})

const toolbarField = StateField.define<Tooltip | null>({
  create: () => null,
  update(tip, tr) {
    const sel = tr.state.selection.main
    if (sel.empty || tr.state.field(dragging) || tr.state.readOnly || !tr.state.sliceDoc(sel.from, sel.to).trim()) return null
    if (tip && tip.pos === sel.from && !tr.docChanged) return tip
    return { pos: sel.from, end: sel.to, above: true, strictSide: false, arrow: false, create: buildToolbar }
  },
  provide: (f) => showTooltip.from(f)
})

const mouseWatcher = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {}
    destroy(): void {
      document.removeEventListener('mouseup', this.up, true)
    }
    up = (): void => {
      document.removeEventListener('mouseup', this.up, true)
      // After CodeMirror has handled the click itself.
      setTimeout(() => this.view.dispatch({ effects: setDragging.of(false) }), 0)
    }
  },
  {
    eventHandlers: {
      mousedown(e) {
        if (e.button !== 0) return
        this.view.dispatch({ effects: setDragging.of(true) })
        document.addEventListener('mouseup', this.up, true)
      }
    }
  }
)

interface Button {
  /** A formatting command, or a menu to pop up. */
  run: string | (() => ReturnType<typeof formatMenu>)
  html: string
  title: string
}

// Small inline icons (lucide shapes) so the toolbar doesn't need React.
const svg = (path: string): string =>
  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`

const BUTTONS: (Button | '|')[] = [
  { run: 'format.bold', html: '<b>B</b>', title: 'Bold' },
  { run: 'format.italic', html: '<i>I</i>', title: 'Italic' },
  { run: 'format.strike', html: '<s>S</s>', title: 'Strikethrough' },
  { run: 'format.code', html: svg('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'), title: 'Inline code' },
  { run: 'format.highlight', html: svg('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'), title: 'Highlight' },
  { run: highlightMenu, html: '<span class="sel-caret">▾</span>', title: 'Highlight colour' },
  '|',
  { run: 'format.linkNote', html: '<span class="sel-text">[[ ]]</span>', title: 'Link to a note' },
  { run: 'format.linkWeb', html: svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'), title: 'Web link' },
  '|',
  { run: turnIntoMenu, html: '<span class="sel-text">H</span><span class="sel-caret">▾</span>', title: 'Heading, list, quote…' },
  { run: 'format.bullet', html: svg('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>'), title: 'Bullet list' },
  { run: 'format.checklist', html: svg('<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>'), title: 'Checklist' },
  { run: 'format.clear', html: svg('<path d="M4 7V4h16v3"/><path d="M5 20h6"/><path d="M13 4 8 20"/><path d="m15 15 5 5"/><path d="m20 15-5 5"/>'), title: 'Clear formatting' },
  { run: formatMenu, html: '<span class="sel-text">⋯</span>', title: 'More' }
]

function tooltipTitle(b: Button): string {
  if (typeof b.run !== 'string') return b.title
  const cmd = EDITOR_COMMANDS.find((c) => c.id === b.run)
  const key = cmd && effectiveShortcut(cmd.id, cmd.shortcut)
  return key ? `${b.title} (${showKeys(key)})` : b.title
}

function buildToolbar(view: EditorView): { dom: HTMLElement } {
  const dom = document.createElement('div')
  dom.className = 'cm-selection-toolbar'
  dom.setAttribute('data-selection-toolbar', '')
  for (const b of BUTTONS) {
    if (b === '|') {
      dom.appendChild(Object.assign(document.createElement('span'), { className: 'sel-sep' }))
      continue
    }
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.innerHTML = b.html
    btn.title = tooltipTitle(b)
    if (typeof b.run === 'string') btn.dataset.format = b.run
    // Keep the selection: don't let the button take focus.
    btn.addEventListener('mousedown', (e) => e.preventDefault())
    btn.addEventListener('click', () => {
      if (typeof b.run === 'string') {
        EDITOR_COMMANDS.find((c) => c.id === b.run)?.run(view)
        view.focus()
      } else {
        void popupFormat(b.run(), btn)
      }
    })
    dom.appendChild(btn)
  }
  return { dom }
}

export const selectionToolbar: Extension = [dragging, toolbarField, mouseWatcher]
