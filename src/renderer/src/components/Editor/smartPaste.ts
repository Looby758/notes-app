import { syntaxTree } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { linkText, tableFromTsv } from '@shared/paste'

/**
 * Smart paste: a web address becomes [Page title](address) (or links the selected text), and a
 * table copied from Excel or a web page becomes a markdown table. Ctrl+Shift+V pastes plain text.
 */

const URL_RE = /^https?:\/\/[^\s<>"]+$/i

let plainUntil = 0

const inCode = (view: EditorView, pos: number): boolean => {
  for (let node = syntaxTree(view.state).resolveInner(pos, -1); node; node = node.parent!) {
    if (/Code/.test(node.name)) return true
    if (!node.parent) break
  }
  return false
}

/** Swaps a pasted address for [title](address) once the title arrives (if it's still there). */
async function addTitle(view: EditorView, from: number, url: string): Promise<void> {
  const title = await window.api.webTitle(url).catch(() => null)
  if (!title || !view.dom.isConnected) return
  const doc = view.state.doc.toString()
  // Edits since may have moved it: look for the bare address nearby.
  let at = doc.slice(from, from + url.length) === url ? from : -1
  if (at === -1) {
    const near = doc.indexOf(url, Math.max(0, from - 2000))
    if (near !== -1 && Math.abs(near - from) < 4000) at = near
  }
  if (at === -1 || doc.slice(at - 2, at) === '](' || doc[at - 1] === '<') return
  view.dispatch({ changes: { from: at, to: at + url.length, insert: `[${linkText(title)}](${url})` } })
}

export const smartPaste = EditorView.domEventHandlers({
  keydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') plainUntil = Date.now() + 1000
    return false
  },
  paste(e, view) {
    if (Date.now() < plainUntil || view.state.readOnly) return false
    const data = e.clipboardData
    if (!data || data.files.length) return false
    const text = data.getData('text/plain')
    if (!text) return false
    const sel = view.state.selection.main
    if (inCode(view, sel.from)) return false

    const url = text.trim()
    if (URL_RE.test(url)) {
      // Pasting into a link's (…) or after "<": just the address.
      const before = view.state.sliceDoc(Math.max(0, sel.from - 2), sel.from)
      if (before.endsWith('(') || before.endsWith('<')) return false
      e.preventDefault()
      const selected = view.state.sliceDoc(sel.from, sel.to)
      if (selected.trim() && !selected.includes('\n')) {
        const insert = `[${selected}](${url})`
        view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: sel.from + insert.length }, userEvent: 'input.paste' })
        return true
      }
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert: url }, selection: { anchor: sel.from + url.length }, userEvent: 'input.paste' })
      void addTitle(view, sel.from, url)
      return true
    }

    const table = tableFromTsv(text)
    if (table) {
      e.preventDefault()
      const line = view.state.doc.lineAt(sel.from)
      const before = sel.from > line.from ? '\n\n' : ''
      const insert = `${before}${table}\n`
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: sel.from + insert.length }, userEvent: 'input.paste' })
      return true
    }
    return false
  }
})
