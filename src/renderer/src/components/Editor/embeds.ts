import { Facet, StateEffect, StateField, type EditorState, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { linksChanged, notePath } from './facets'
import { parseWikiInner } from '../../lib/links'
import { extractSection, withoutFrontmatter } from '../../lib/outline'
import { noteTitle } from '../../lib/paths'
import { getNoteText, useNoteIndex } from '../../store/noteIndex'

/**
 * Note embeds: a line containing only `![[Note]]` or `![[Note#Heading]]` shows that note (or
 * that section) as a card, using a read-only editor so it looks exactly like the real note and
 * updates when the note changes. Embeds can nest one level; deeper ones show as links.
 */

/** How deeply nested this editor is (0 = a normal note, 1 = inside an embed…). */
export const embedDepth = Facet.define<number, number>({ combine: (values) => values[0] ?? 0 })

/** Dispatched when notes change on disk, so embeds re-read their content. */
export const embedsChanged = StateEffect.define<null>()

const MAX_DEPTH = 2
const EMBED_LINE = /^\s*!\[\[([^[\]\n]+)\]\]\s*$/

// The editor setup registers how to build an embed's read-only editor (avoids a circular import).
let makeState: ((text: string, path: string, depth: number) => EditorState) | null = null
export function setEmbedStateFactory(factory: (text: string, path: string, depth: number) => EditorState): void {
  makeState = factory
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

class EmbedWidget extends WidgetType {
  constructor(
    readonly inner: string,
    readonly path: string | null,
    readonly heading: string,
    /** The embedded text, or null if the note/heading wasn't found. */
    readonly content: string | null,
    readonly problem: string,
    readonly depth: number,
    readonly lineFrom: number
  ) {
    super()
  }

  eq(other: EmbedWidget): boolean {
    return (
      other.inner === this.inner &&
      other.path === this.path &&
      other.content === this.content &&
      other.depth === this.depth &&
      other.lineFrom === this.lineFrom
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const card = el('div', 'cm-embed')
    const header = el('div', 'cm-embed-header')
    const title = el('button', 'cm-embed-title', this.path ? noteTitle(this.path) : parseWikiInner(this.inner).target)
    title.title = 'Open this note'
    if (this.heading) title.append(el('span', 'cm-embed-heading', ` › ${this.heading}`))
    title.addEventListener('mousedown', (e) => {
      e.preventDefault()
      window.dispatchEvent(
        new CustomEvent('note:open-wikilink', { detail: { inner: this.inner, from: view.state.facet(notePath) } })
      )
    })
    const edit = el('button', 'cm-embed-edit', 'Edit')
    edit.title = 'Show the ![[…]] line so you can change it'
    edit.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({ selection: { anchor: this.lineFrom } })
      view.focus()
    })
    header.append(el('span', 'cm-embed-icon', '↳'), title, edit)
    card.append(header)

    const body = el('div', 'cm-embed-body')
    if (this.content === null || !makeState || !this.path) {
      body.append(el('p', 'cm-embed-missing', this.problem))
    } else if (this.content.trim() === '') {
      body.append(el('p', 'cm-embed-missing', 'This note is empty.'))
    } else {
      const nested = new EditorView({ state: makeState(this.content, this.path, this.depth + 1), parent: body })
      ;(card as HTMLElement & { nested?: EditorView }).nested = nested
    }
    card.append(body)
    return card
  }

  destroy(dom: HTMLElement): void {
    ;(dom as HTMLElement & { nested?: EditorView }).nested?.destroy()
  }

  ignoreEvent(): boolean {
    return true
  }

  get estimatedHeight(): number {
    return 140
  }
}

function inCode(state: EditorState, pos: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/Code/.test(node.name)) return true
  }
  return false
}

function buildEmbeds(state: EditorState): DecorationSet {
  const depth = state.facet(embedDepth)
  if (depth >= MAX_DEPTH) return Decoration.none
  const from = state.facet(notePath)
  const { lookup } = useNoteIndex.getState()
  const out: Range<Decoration>[] = []
  const { doc, selection } = state

  let pos = 0
  for (const text of doc.iterLines()) {
    const lineFrom = pos
    const lineTo = pos + text.length
    pos = lineTo + 1
    if (!text.includes('![[')) continue
    const m = EMBED_LINE.exec(text)
    if (!m) continue
    // Show the raw ![[…]] while the cursor is on that line, so it can be edited.
    if (selection.ranges.some((r) => r.from <= lineTo && r.to >= lineFrom)) continue
    if (inCode(state, lineFrom + text.indexOf('!'))) continue

    const inner = m[1]
    const { target, heading } = parseWikiInner(inner)
    const path = lookup.resolve({ kind: 'wiki', target }, from)
    let content: string | null = null
    let problem = ''
    if (!path) problem = `"${target}" doesn't exist yet. Click the title to create it.`
    else if (path === from) problem = "A note can't embed itself."
    else {
      const full = getNoteText(path)
      if (full === undefined) problem = 'Loading…'
      else if (heading) {
        content = extractSection(full, heading)
        if (content === null) problem = `"${heading}" isn't a heading in ${noteTitle(path)}.`
      } else content = withoutFrontmatter(full)
    }
    out.push(
      Decoration.replace({
        widget: new EmbedWidget(inner, path, heading, content, problem, depth, lineFrom),
        block: true
      }).range(lineFrom, lineTo)
    )
  }
  return Decoration.set(out)
}

export const embeds = StateField.define<DecorationSet>({
  create: buildEmbeds,
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(embedsChanged) || e.is(linksChanged)) ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState)
    ) {
      return buildEmbeds(tr.state)
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f)
})
