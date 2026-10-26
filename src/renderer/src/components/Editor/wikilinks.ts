import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { MarkdownConfig } from '@lezer/markdown'
import { tags } from '@lezer/highlight'
import { useNoteIndex } from '../../store/noteIndex'
import { noteTitle, parentOf } from '../../lib/paths'
import { isValidTag, TAG_BODY } from '../../lib/tags'
import { notePath } from './facets'

const BRACKET_OPEN = 91 // [
const BRACKET_CLOSE = 93 // ]
const BANG = 33 // !
const NEWLINE = 10

/**
 * Teaches the markdown parser about [[wikilinks]] and ![[embeds]], so they get their own syntax
 * node. (An embed is a WikiLink with an EmbedMark child for the "!". It has to be handled here:
 * otherwise "![" is taken as the start of an image and the [[…]] is never seen.)
 */
export const wikiLinkSyntax: MarkdownConfig = {
  // WikiLink itself gets no highlight colour: the live preview colours it (purple, or grey if the note is missing).
  defineNodes: ['WikiLink', { name: 'WikiLinkMark', style: tags.processingInstruction }, 'EmbedMark'],
  parseInline: [
    {
      name: 'WikiLink',
      before: 'Link',
      parse(cx, next, pos) {
        const embed = next === BANG
        const open = embed ? pos + 1 : pos
        if ((embed ? cx.char(open) : next) !== BRACKET_OPEN || cx.char(open + 1) !== BRACKET_OPEN) return -1
        let end = open + 2
        for (; end < cx.end; end++) {
          const ch = cx.char(end)
          if (ch === BRACKET_CLOSE && cx.char(end + 1) === BRACKET_CLOSE) break
          if (ch === NEWLINE || ch === BRACKET_OPEN || ch === BRACKET_CLOSE) return -1
        }
        if (end >= cx.end || end === open + 2) return -1
        const children = [cx.elt('WikiLinkMark', open, open + 2), cx.elt('WikiLinkMark', end, end + 2)]
        if (embed) children.unshift(cx.elt('EmbedMark', pos, open))
        return cx.addElement(cx.elt('WikiLink', pos, end + 2, children))
      }
    }
  ]
}

const HASH = 35 // #
/** Characters that may come right before a #tag (so "page#anchor" and "##" aren't tags). */
const TAG_PRECEDERS = new Set([-1, 9, 10, 32, 40, 44, 59, 33, 63, 34, 39]) // start, tab, \n, space ( , ; ! ? " '

/** #tags as their own syntax node, so the editor can style them and skip them inside code. */
export const hashtagSyntax: MarkdownConfig = {
  defineNodes: ['Hashtag'],
  parseInline: [
    {
      name: 'Hashtag',
      before: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== HASH || !TAG_PRECEDERS.has(pos === cx.offset ? -1 : cx.char(pos - 1))) return -1
        const m = TAG_BODY.exec(cx.slice(pos + 1, Math.min(cx.end, pos + 101)))
        if (!m) return -1
        const tag = m[0].replace(/\/+$/, '')
        if (!isValidTag(tag)) return -1
        return cx.addElement(cx.elt('Hashtag', pos, pos + 1 + tag.length))
      }
    }
  ]
}

const EQUALS = 61 // =
const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' }

/** ==highlighted text==, parsed like ~~strikethrough~~. */
export const highlightSyntax: MarkdownConfig = {
  defineNodes: ['Highlight', { name: 'HighlightMark', style: tags.processingInstruction }],
  parseInline: [
    {
      name: 'Highlight',
      after: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS || cx.char(pos + 2) === EQUALS) return -1
        if (pos > cx.offset && cx.char(pos - 1) === EQUALS) return -1
        const before = pos === cx.offset ? ' ' : cx.slice(pos - 1, pos)
        const after = cx.slice(pos + 2, pos + 3) || ' '
        const spaceBefore = /\s/.test(before)
        const spaceAfter = /\s/.test(after)
        return cx.addDelimiter(HighlightDelim, pos, pos + 2, !spaceAfter, !spaceBefore)
      }
    }
  ]
}

/** Typing `[[` suggests notes; picking one completes the link. */
export function wikiLinkCompletions(ctx: CompletionContext): CompletionResult | null {
  const match = ctx.matchBefore(/\[\[[^[\]|#\n]*$/)
  if (!match) return null
  const closing = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === ']]' ? '' : ']]'
  const { lookup } = useNoteIndex.getState()
  const current = ctx.state.facet(notePath)
  return {
    from: match.from + 2,
    options: lookup.paths
      .filter((p) => p !== current)
      .map((p) => {
        const title = noteTitle(p)
        // Use the short name when it's unambiguous, otherwise the path.
        const label = lookup.isUnique(title) ? title : p.replace(/\.md$/i, '')
        return { label, detail: parentOf(p) || undefined, type: 'note', apply: label + closing }
      }),
    validFor: /^[^[\]|#\n]*$/
  }
}
