import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { findSnippet, useSnippets, type Snippet } from '../../store/snippets'
import { fillTemplate } from '../../lib/templates'
import { noteTitle } from '../../lib/paths'
import { notePath } from './facets'

/**
 * Text snippets in the editor: type ;sig and a space (or pick from the list that appears after ;)
 * and it's replaced by the saved text. Snippets can use {{date}}, {{time}}, {{title}} and {{cursor}}.
 */

const inCode = (state: EditorState, pos: number): boolean => {
  for (let node = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent!) {
    if (/Code|CodeBlock|URL/.test(node.name)) return true
    if (!node.parent) break
  }
  return false
}

function expand(view: EditorView, snip: Snippet, from: number, to: number, after = ''): void {
  const { text, cursor } = fillTemplate(snip.text, { title: noteTitle(view.state.facet(notePath) || 'Untitled.md') })
  const insert = text + after
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + (cursor ?? insert.length) },
    userEvent: 'input.complete'
  })
}

/** The list after ";" (only when you have snippets). */
export function snippetCompletions(ctx: CompletionContext): CompletionResult | null {
  const { snippets } = useSnippets.getState()
  if (!snippets.length) return null
  const match = ctx.matchBefore(/(?:^|[\s(]);[\p{L}\p{N}_-]*$/u)
  if (!match) return null
  const semi = match.from + match.text.indexOf(';')
  if (inCode(ctx.state, semi)) return null
  return {
    from: semi,
    to: ctx.pos,
    // Matches what's typed after ";" against the snippet names.
    validFor: /^;[\p{L}\p{N}_-]*$/u,
    options: snippets.map(
      (s): Completion => ({
        label: `;${s.trigger}`,
        detail: s.text.replace(/\s+/g, ' ').slice(0, 40),
        type: 'snippet',
        apply: (view, _c, from, to) => expand(view, s, from, to)
      })
    )
  }
}

/** Typing a space, Enter or punctuation right after ;trigger expands it. */
export const snippetExpander = EditorView.inputHandler.of((view, from, to, text) => {
  if (!/^[\s.,!?;:)]$/.test(text) || from !== to) return false
  const line = view.state.doc.lineAt(from)
  const m = /(?:^|[\s(]);([\p{L}\p{N}_-]+)$/u.exec(line.text.slice(0, from - line.from))
  if (!m) return false
  const snip = findSnippet(m[1])
  if (!snip) return false
  const start = from - m[1].length - 1
  if (inCode(view.state, start)) return false
  // With a {{cursor}} the cursor lands inside the snippet: then the typed space isn't wanted.
  expand(view, snip, start, from, /\{\{\s*cursor\s*\}\}/.test(snip.text) ? '' : text)
  return true
})
