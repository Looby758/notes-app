import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFrontmatter } from '../../lib/properties'
import { readingFacet } from './facets'
import PropertiesPanel from './PropertiesPanel'

/**
 * The properties panel: in live preview, a note's frontmatter shows as a small form at the top
 * of the note instead of YAML. "Edit as text" shows the YAML again until the cursor leaves it.
 */

/** Show this note's frontmatter as plain YAML (true) or as the panel (false). */
export const setRawProperties = StateEffect.define<boolean>()

const rawProperties = StateField.define<boolean>({
  create: () => false,
  update(raw, tr) {
    for (const e of tr.effects) if (e.is(setRawProperties)) return e.value
    // Leaving the YAML (cursor below it) brings the panel back.
    if (raw && tr.selection) {
      const fm = readFrontmatter(tr.state.doc.sliceString(0, Math.min(tr.state.doc.length, 20000)))
      if (!fm || tr.state.selection.main.head > fm.to) return false
    }
    return raw
  }
})

const roots = new WeakMap<HTMLElement, Root>()

/** Replaces the frontmatter part of the note's text with what `change` returns. */
function applyTo(view: EditorView, change: (text: string) => string): void {
  const doc = view.state.doc
  const old = doc.sliceString(0, Math.min(doc.length, 20000))
  const next = change(old)
  if (next === old) return
  // Only the changed stretch, so undo and the rest of the note are untouched.
  let start = 0
  while (start < old.length && start < next.length && old[start] === next[start]) start++
  let endOld = old.length
  let endNew = next.length
  while (endOld > start && endNew > start && old[endOld - 1] === next[endNew - 1]) {
    endOld--
    endNew--
  }
  view.dispatch({ changes: { from: start, to: endOld, insert: next.slice(start, endNew) }, userEvent: 'input.properties' })
}

class PropertiesWidget extends WidgetType {
  constructor(
    readonly yaml: string | null,
    readonly readOnly = false
  ) {
    super()
  }
  eq(other: PropertiesWidget): boolean {
    return other.yaml === this.yaml && other.readOnly === this.readOnly
  }
  private render(dom: HTMLElement, view: EditorView): void {
    const fm = this.yaml === null ? null : readFrontmatter(`---\n${this.yaml}\n---\n`)
    roots.get(dom)!.render(
      createElement(PropertiesPanel, {
        properties: fm ? fm.properties : null,
        readOnly: this.readOnly,
        apply: (change: (text: string) => string) => applyTo(view, change),
        showRaw: () => {
          const end = readFrontmatter(view.state.doc.sliceString(0, Math.min(view.state.doc.length, 20000)))?.to ?? 0
          view.dispatch({ effects: setRawProperties.of(true), selection: { anchor: Math.max(0, end - 5) } })
          view.focus()
        }
      })
    )
  }
  toDOM(view: EditorView): HTMLElement {
    const dom = document.createElement('div')
    dom.className = this.yaml === null ? 'cm-props cm-props-none' : 'cm-props'
    roots.set(dom, createRoot(dom))
    this.render(dom, view)
    return dom
  }
  // Re-render in place, so a field you're typing in keeps its focus.
  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    if (!roots.has(dom) || dom.classList.contains('cm-props-none') !== (this.yaml === null)) return false
    this.render(dom, view)
    return true
  }
  destroy(dom: HTMLElement): void {
    const root = roots.get(dom)
    roots.delete(dom)
    // React can't unmount while it's rendering; wait a tick.
    if (root) setTimeout(() => root.unmount(), 0)
  }
  ignoreEvent(): boolean {
    return true
  }
}

function build(state: EditorState): DecorationSet {
  // Embedded notes have none; reading mode shows them without editing.
  const reading = state.facet(readingFacet)
  if ((state.readOnly && !reading) || state.field(rawProperties, false)) return Decoration.none
  const fm = readFrontmatter(state.doc.sliceString(0, Math.min(state.doc.length, 20000)))
  if (!fm) {
    if (reading) return Decoration.none
    // No properties yet: a quiet "Add property" above the note (shown on hover).
    return Decoration.set([Decoration.widget({ widget: new PropertiesWidget(null), block: true, side: -1 }).range(0)])
  }
  // Cover whole lines: up to the end of the closing --- line.
  const end = state.doc.lineAt(Math.max(0, fm.to - 1)).to
  return Decoration.set([Decoration.replace({ widget: new PropertiesWidget(fm.yaml, reading), block: true }).range(0, end)])
}

const panel = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.effects.some((e) => e.is(setRawProperties)) ||
      tr.startState.field(rawProperties, false) !== tr.state.field(rawProperties, false) ||
      tr.startState.facet(readingFacet) !== tr.state.facet(readingFacet)
    ) {
      return build(tr.state)
    }
    return value
  },
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))]
})

/** Keeps the cursor out of the hidden YAML, so typing never lands inside it. */
const keepCursorOut = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.check(view)
    }
    update(u: { view: EditorView; selectionSet: boolean; docChanged: boolean }): void {
      if (u.selectionSet || u.docChanged) this.check(u.view)
    }
    check(view: EditorView): void {
      const { state } = view
      // The panel can be switched off (live preview off) between now and the timeout below.
      if (state.readOnly || state.field(rawProperties, false) !== false) return
      const fm = readFrontmatter(state.doc.sliceString(0, Math.min(state.doc.length, 20000)))
      if (!fm) return
      const after = Math.min(state.doc.length, fm.to)
      if (state.selection.main.head < after) {
        // Can't dispatch during an update; right after is fine.
        setTimeout(() => {
          if (view.state.field(rawProperties, false) === false && view.state.selection.main.head < after) view.dispatch({ selection: { anchor: after } })
        }, 0)
      }
    }
  }
)

export const properties: Extension = [rawProperties, panel, keepCursorOut]
