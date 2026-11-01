import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { accept, setSuggestion, suggestionField } from './autocomplete'

const start = (doc: string, text: string): EditorState =>
  EditorState.create({ doc, selection: EditorSelection.cursor(doc.length), extensions: [suggestionField] }).update({
    effects: setSuggestion.of({ pos: doc.length, text })
  }).state

const type = (state: EditorState, text: string): EditorState => {
  const at = state.selection.main.head
  return state.update({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: 'input.type' }).state
}

function press(state: EditorState, oneWord: boolean): EditorState {
  let s = state
  const view = {
    get state() {
      return s
    },
    dispatch: (...specs: TransactionSpec[]) => {
      s = s.update(...specs).state
    }
  } as unknown as EditorView
  accept(oneWord)(view)
  return s
}

describe('writing autocomplete in the editor', () => {
  it('keeps the rest of the guess while you type the same letters', () => {
    let s = start('Milk and', ' bread and eggs')
    s = type(s, ' br')
    expect(s.field(suggestionField)).toEqual({ pos: 11, text: 'ead and eggs' })
    s = type(s, 'x')
    expect(s.field(suggestionField)).toBeNull()
  })

  it('goes when you move the cursor', () => {
    const s = start('Milk and', ' bread').update({ selection: { anchor: 2 } }).state
    expect(s.field(suggestionField)).toBeNull()
  })

  it('Tab takes it all, Ctrl+→ one word', () => {
    expect(press(start('Milk and', ' bread and eggs'), false).doc.toString()).toBe('Milk and bread and eggs')
    const one = press(start('Milk and', ' bread and eggs'), true)
    expect(one.doc.toString()).toBe('Milk and bread')
    expect(one.selection.main.head).toBe(14)
    expect(one.field(suggestionField)).toEqual({ pos: 14, text: ' and eggs' })
  })
})
