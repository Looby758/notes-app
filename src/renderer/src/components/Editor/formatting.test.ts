import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'
import { clearFormatting, linkToNote, makeCallout, toggleLinePrefix } from './formatting'

/** Runs a command on `doc` with [anchor, head] selected; returns the text and selection after. */
function run(cmd: Command, doc: string, anchor: number, head = anchor): { doc: string; sel: string } {
  let state = EditorState.create({ doc, selection: EditorSelection.single(anchor, head) })
  const view = {
    get state() {
      return state
    },
    dispatch: (...specs: TransactionSpec[]) => {
      state = state.update(...specs).state
    }
  } as unknown as EditorView
  cmd(view)
  const r = state.selection.main
  return { doc: state.doc.toString(), sel: state.sliceDoc(r.from, r.to) }
}

describe('line formatting', () => {
  it('makes every selected line a heading or list item, replacing other markers', () => {
    expect(run(toggleLinePrefix('## '), '# One\n- two\n\nthree', 0, 15).doc).toBe('## One\n## two\n\n## three')
    expect(run(toggleLinePrefix('- [ ] '), '- a\n1. b', 0, 8).doc).toBe('- [ ] a\n- [ ] b')
  })
  it('removes it again when they all have it', () => {
    expect(run(toggleLinePrefix('> '), '> a\n> b', 0, 7).doc).toBe('a\nb')
  })
  it('puts lines in a callout with the title selected', () => {
    const r = run(makeCallout, 'first\nsecond', 0, 12)
    expect(r.doc).toBe('> [!note] Note\n> first\n> second')
    expect(r.sel).toBe('Note')
  })
})

describe('inline formatting', () => {
  it('links and unlinks a note name', () => {
    const linked = run(linkToNote, 'see Jack today', 4, 8)
    expect(linked.doc).toBe('see [[Jack]] today')
    expect(run(linkToNote, linked.doc, 6, 10).doc).toBe('see Jack today')
  })
  it('clears marks inside and hugging the selection', () => {
    expect(run(clearFormatting, 'a **bold** and ==hi== *x*', 0, 25).doc).toBe('a bold and hi x')
    const r = run(clearFormatting, 'say **loud** now', 6, 10)
    expect(r.doc).toBe('say loud now')
    expect(r.sel).toBe('loud')
    expect(run(clearFormatting, 'a <mark class="hl-green">green</mark> b', 25, 30).doc).toBe('a green b')
  })
})
