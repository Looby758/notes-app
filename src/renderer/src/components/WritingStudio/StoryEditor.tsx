import { useEffect, useRef } from 'react'
import { EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, keymap, placeholder, type DecorationSet } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { search, searchKeymap } from '@codemirror/search'
import type { EntityKind } from '@shared/writing'

/**
 * The page you write a scene on: plain text with soft wrapping (no markdown symbols to get in the
 * way, though *italics* and **bold** carry through to exports). Names from the story brain are
 * lightly underlined, things that go against a character's page get a wavy line, and a quote can be
 * picked out (from the ghost reader).
 */

export interface Mark {
  from: number
  to: number
  kind: 'name' | 'issue' | 'quote'
  entityKind?: EntityKind
  title?: string
}

const setMarks = StateEffect.define<Mark[]>()

const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(setMarks)) continue
      const len = tr.state.doc.length
      const list = e.value
        .filter((m) => m.from < m.to && m.to <= len)
        .sort((a, b) => a.from - b.from || (a.kind === 'name' ? -1 : 1))
      const b = new RangeSetBuilder<Decoration>()
      for (const m of list) {
        const cls = m.kind === 'name' ? `ws-name ws-name-${m.entityKind ?? 'character'}` : m.kind === 'issue' ? 'ws-issue' : 'ws-quote'
        b.add(m.from, m.to, Decoration.mark({ class: cls, attributes: m.title ? { title: m.title } : undefined }))
      }
      deco = b.finish()
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f)
})

const theme = EditorView.theme({
  '&': { height: '100%', background: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--ws-font)', lineHeight: '1.85', overflow: 'auto' },
  '.cm-content': { maxWidth: 'var(--ws-width)', margin: '0 auto', padding: '28px 32px 40vh', caretColor: 'var(--accent)', fontSize: 'var(--ws-size)' },
  '.cm-line': { padding: 0 },
  '.cm-placeholder': { color: 'var(--text-faint)', fontStyle: 'italic' }
})

export default function StoryEditor({
  docKey,
  text,
  onChange,
  marks,
  focusRange,
  readOnly = false,
  hint = 'Start writing…'
}: {
  /** Changes when a different take is shown, which starts the editor afresh (its own undo too). */
  docKey: string
  text: string
  onChange?: (text: string) => void
  marks: Mark[]
  /** Scrolls to and selects this part of the text when it changes. */
  focusRange?: { from: number; to: number; nonce: number } | null
  readOnly?: boolean
  hint?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  useEffect(() => {
    const extensions: Extension[] = [
      history(),
      search({ top: true }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      EditorView.lineWrapping,
      placeholder(hint),
      marksField,
      theme,
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) changeRef.current?.(u.state.doc.toString())
      })
    ]
    const v = new EditorView({ state: EditorState.create({ doc: text, extensions }), parent: host.current! })
    view.current = v
    if (!readOnly) v.focus()
    return () => {
      v.destroy()
      view.current = null
    }
    // A new editor only for a different take; text changes from typing stay in the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, readOnly])

  // Text changed from outside (the time-lapse slider on a read-only view).
  useEffect(() => {
    const v = view.current
    if (!v) return
    const now = v.state.doc.toString()
    if (now !== text) v.dispatch({ changes: { from: 0, to: now.length, insert: text } })
  }, [text])

  useEffect(() => {
    view.current?.dispatch({ effects: setMarks.of(marks) })
  }, [marks, docKey])

  useEffect(() => {
    const v = view.current
    if (!v || !focusRange) return
    const len = v.state.doc.length
    const from = Math.min(focusRange.from, len)
    const to = Math.min(focusRange.to, len)
    v.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) })
    v.focus()
  }, [focusRange])

  return <div className="ws-editor" ref={host} data-ws-editor />
}
