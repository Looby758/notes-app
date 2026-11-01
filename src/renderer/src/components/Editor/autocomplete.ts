import { Prec, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { completionStatus } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { shouldSuggest } from '@shared/localAi'
import { notePath } from './facets'

/**
 * Writing autocomplete: stop typing for a moment and the offline AI's guess at the next few
 * words shows in grey after the cursor. Tab takes it all, Ctrl+→ (⌥→ on a Mac) one word, Esc
 * hides it, and typing on carries on through it while you type the same letters.
 */

interface Suggestion {
  pos: number
  text: string
}

export const setSuggestion = StateEffect.define<Suggestion | null>()

export const suggestionField = StateField.define<Suggestion | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setSuggestion)) return e.value
    if (!value) return null
    if (tr.docChanged) {
      // Typing the letters it suggested keeps the rest of it.
      const changes: { from: number; to: number; text: string }[] = []
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => changes.push({ from: fromA, to: toA, text: inserted.toString() }))
      if (changes.length !== 1) return null
      const [c] = changes
      if (c.from !== value.pos || c.to !== c.from || !c.text || !value.text.startsWith(c.text) || c.text === value.text) return null
      const pos = value.pos + c.text.length
      if (tr.newSelection.main.head !== pos || !tr.newSelection.main.empty) return null
      return { pos, text: value.text.slice(c.text.length) }
    }
    if (tr.selection && (tr.newSelection.main.head !== value.pos || !tr.newSelection.main.empty)) return null
    return value
  },
  provide: (f) =>
    EditorView.decorations.from(f, (s): DecorationSet => (s ? Decoration.set([Decoration.widget({ widget: new GhostText(s.text), side: 1 }).range(s.pos)]) : Decoration.none))
})

class GhostText extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  eq(other: GhostText): boolean {
    return other.text === this.text
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-ghost-text'
    span.textContent = this.text
    span.setAttribute('aria-hidden', 'true')
    return span
  }
  ignoreEvent(): boolean {
    return false
  }
}

// Whether the offline AI is downloaded and allowed to run right now (not paused for a game).
let aiReady = false
let watching = false
function watchAi(): void {
  if (watching || typeof window === 'undefined' || !window.api) return
  watching = true
  const take = (s: { state: string; gamePaused: boolean }): void => {
    aiReady = s.state === 'ready' && !s.gamePaused
  }
  window.api.localAiState().then(take, () => undefined)
  window.api.onLocalAiState(take)
}

/** Code (fenced, inline or indented) and front matter aren't writing. */
function inCode(state: EditorState, pos: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (/^(FencedCode|CodeBlock|InlineCode|CodeText|Frontmatter|HTMLBlock|URL|Link)$/.test(node.name)) return true
  }
  return false
}

/** Where a guess could go now, or null: one cursor at the end of a line of writing. */
function suggestSpot(state: EditorState): number | null {
  const sel = state.selection
  if (sel.ranges.length !== 1 || !sel.main.empty) return null
  if (completionStatus(state) !== null) return null
  const pos = sel.main.head
  const line = state.doc.lineAt(pos)
  if (!shouldSuggest(line.text.slice(0, pos - line.from), line.text.slice(pos - line.from))) return null
  if (inCode(state, pos)) return null
  return pos
}

const WAIT_MS = 450

const fetcher = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | null = null
    asked = 0
    constructor(readonly view: EditorView) {
      watchAi()
    }
    update(u: ViewUpdate): void {
      const typed = u.transactions.some((tr) => tr.isUserEvent('input.type') || tr.isUserEvent('delete.backward'))
      if (u.docChanged || u.selectionSet || u.focusChanged) this.cancel()
      if (u.focusChanged && !u.view.hasFocus && u.state.field(suggestionField)) {
        queueMicrotask(() => u.view.dispatch({ effects: setSuggestion.of(null) }))
      }
      // Only after you type (not after opening, pasting or moving about), and not while one is showing.
      if (!typed || u.state.field(suggestionField) || !aiReady) return
      this.timer = setTimeout(() => this.ask(), WAIT_MS)
    }
    cancel(): void {
      if (this.timer) clearTimeout(this.timer)
      this.timer = null
      this.asked++
    }
    ask(): void {
      this.timer = null
      const { view } = this
      if (!view.hasFocus || !aiReady) return
      const state = view.state
      const pos = suggestSpot(state)
      if (pos === null) return
      const id = ++this.asked
      const doc = state.doc
      const title = (state.facet(notePath).split('/').pop() ?? '').replace(/\.md$/i, '')
      window.api.aiSuggest(title, doc.sliceString(Math.max(0, pos - 6000), pos)).then(
        (text) => {
          // Too late if you've typed or moved since.
          if (!text || id !== this.asked || view.state.doc !== doc || view.state.selection.main.head !== pos || !view.hasFocus) return
          if (suggestSpot(view.state) !== pos) return
          view.dispatch({ effects: setSuggestion.of({ pos, text }) })
        },
        () => undefined
      )
    }
    destroy(): void {
      this.cancel()
    }
  }
)

/** Puts all of the guess (or its next word) into the note. */
export function accept(oneWord: boolean) {
  return (view: EditorView): boolean => {
    const s = view.state.field(suggestionField, false)
    if (!s || view.state.selection.main.head !== s.pos || completionStatus(view.state) === 'active') return false
    const text = oneWord ? (/^\s*\S+/.exec(s.text)?.[0] ?? s.text) : s.text
    view.dispatch({
      changes: { from: s.pos, insert: text },
      selection: { anchor: s.pos + text.length },
      userEvent: 'input.complete',
      scrollIntoView: true
    })
    return true
  }
}

function dismiss(view: EditorView): boolean {
  if (!view.state.field(suggestionField, false)) return false
  view.dispatch({ effects: setSuggestion.of(null) })
  return true
}

export const autocomplete: Extension = [
  suggestionField,
  fetcher,
  // Above indenting with Tab and the link / command popups (which hide the guess anyway).
  Prec.highest(
    keymap.of([
      { key: 'Tab', run: accept(false) },
      { key: 'Ctrl-ArrowRight', mac: 'Alt-ArrowRight', run: accept(true) },
      { key: 'Escape', run: dismiss }
    ])
  ),
  EditorView.baseTheme({
    '.cm-ghost-text': { color: 'var(--text-faint)', opacity: '0.75', pointerEvents: 'none' }
  })
]
