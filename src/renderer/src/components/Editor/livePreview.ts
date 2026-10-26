import { syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { linksChanged, notePath } from './facets'
import { parentOf, resolveRelative, toVaultUrl } from '../../lib/paths'
import { parseWikiInner } from '../../lib/links'
import { parseFrontmatter } from '../../lib/tags'
import { parseEventText } from '../../lib/schedule'
import { dailyDateOf } from '../../lib/dailyPaths'
import { properties } from './properties'
import { CLICK_MOD } from '@shared/platform'

/** The time at the start of a schedule line: "09:30", "9am", "09:30-10:30", "2pm – 3pm". */
const EVENT_TIME = /^(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?(?:\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)?)\s/i
import { useNoteIndex } from '../../store/noteIndex'

/**
 * Live preview: markdown renders in place, and the raw syntax reappears on whichever lines
 * the cursor or selection touches.
 */

// ---------- widgets ----------

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-bullet'
    el.textContent = '•'
    return el
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked
  }
  toDOM(): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = this.checked
    box.className = 'cm-task-checkbox'
    box.tabIndex = -1
    return box
  }
  ignoreEvent(): boolean {
    return false
  }
}

class HrWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-hr'
    return el
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string
  ) {
    super()
  }
  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt
  }
  toDOM(): HTMLElement {
    const img = document.createElement('img')
    img.className = 'cm-image'
    img.src = this.src
    img.alt = this.alt
    img.onerror = () => {
      const missing = document.createElement('span')
      missing.className = 'cm-image-missing'
      missing.textContent = `Image not found: ${this.alt || this.src}`
      img.replaceWith(missing)
    }
    return img
  }
}

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

class TableWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly from: number
  ) {
    super()
  }
  eq(other: TableWidget): boolean {
    return other.text === this.text && other.from === this.from
  }
  toDOM(view: EditorView): HTMLElement {
    const lines = this.text.split('\n')
    const header = splitRow(lines[0] ?? '')
    const align = splitRow(lines[1] ?? '').map((d) =>
      d.startsWith(':') && d.endsWith(':') ? 'center' : d.endsWith(':') ? 'right' : 'left'
    )
    const wrap = document.createElement('div')
    wrap.className = 'cm-table-wrap'
    wrap.title = 'Click to edit'
    const table = document.createElement('table')
    const addRow = (cells: string[], tag: 'th' | 'td', parent: HTMLElement): void => {
      const tr = document.createElement('tr')
      header.forEach((_, i) => {
        const cell = document.createElement(tag)
        cell.textContent = cells[i] ?? ''
        cell.style.textAlign = align[i] ?? 'left'
        tr.appendChild(cell)
      })
      parent.appendChild(tr)
    }
    const thead = document.createElement('thead')
    addRow(header, 'th', thead)
    const tbody = document.createElement('tbody')
    for (const line of lines.slice(2)) addRow(splitRow(line), 'td', tbody)
    table.append(thead, tbody)
    wrap.appendChild(table)
    // Clicking a rendered table puts the cursor in it, which reveals the markdown for editing.
    wrap.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({ selection: { anchor: this.from } })
      view.focus()
    })
    return wrap
  }
  ignoreEvent(): boolean {
    return true
  }
}

// ---------- helpers ----------

const hidden = Decoration.replace({})
const mark = (cls: string): Decoration => Decoration.mark({ class: cls })
const line = (cls: string): Decoration => Decoration.line({ class: cls })

/** Line numbers the selection touches (none while the editor isn't focused, so everything renders). */
function activeLines(state: EditorState, focused: boolean): Set<number> {
  const lines = new Set<number>()
  if (!focused) return lines
  for (const r of state.selection.ranges) {
    const last = state.doc.lineAt(r.to).number
    for (let n = state.doc.lineAt(r.from).number; n <= last; n++) lines.add(n)
  }
  return lines
}

/** `![x](a b.png)` and `<a b.png>` style URLs → the URL itself. */
function cleanUrl(raw: string): string {
  return raw.trim().replace(/^<(.*)>$/, '$1')
}

function imageSrc(url: string, path: string): string {
  if (/^(https?:|data:)/i.test(url)) return url
  let rel = url
  try {
    rel = decodeURI(url)
  } catch {
    // keep as typed
  }
  return toVaultUrl(resolveRelative(parentOf(path), rel))
}

// ---------- inline decorations (visible range only) ----------

function buildInline(view: EditorView): DecorationSet {
  const { state } = view
  const doc = state.doc
  const active = activeLines(state, view.hasFocus)
  const isActive = (pos: number): boolean => active.has(doc.lineAt(pos).number)
  const path = state.facet(notePath)
  const isDaily = dailyDateOf(path) !== null
  const out: Range<Decoration>[] = []

  /** Hides a syntax mark plus one following space (e.g. "# " or "> "). */
  const hideWithSpace = (from: number, to: number): void => {
    out.push(hidden.range(from, doc.sliceString(to, to + 1) === ' ' ? to + 1 : to))
  }

  // YAML frontmatter at the top shows as a quiet monospace block, with no markdown styling inside.
  const frontmatterEnd = parseFrontmatter(doc.sliceString(0, Math.min(doc.length, 8000))).end
  if (frontmatterEnd > 0) {
    const last = doc.lineAt(frontmatterEnd - 1).number
    for (let n = 1; n <= last; n++) {
      const cls = `cm-frontmatter${n === 1 ? ' cm-frontmatter-start' : ''}${n === last ? ' cm-frontmatter-end' : ''}`
      out.push(line(cls).range(doc.line(n).from))
    }
  }

  for (const range of view.visibleRanges) {
    const from = Math.max(range.from, frontmatterEnd)
    const to = range.to
    if (from >= to) continue
    syntaxTree(state).iterate({
      from,
      to,
      enter: (ref) => {
        const node = ref.node
        const name = node.name
        const lineActive = isActive(node.from)

        const heading = /^(ATX|Setext)Heading(\d)$/.exec(name)
        if (heading) {
          out.push(line(`cm-h cm-h${heading[2]}`).range(doc.lineAt(node.from).from))
          return
        }

        switch (name) {
          case 'HeaderMark':
            if (!isActive(node.from)) {
              if (node.parent?.name.startsWith('ATX')) hideWithSpace(node.from, node.to)
              else out.push(hidden.range(node.from, node.to))
            }
            return

          case 'EmphasisMark':
          case 'StrikethroughMark':
            if (!lineActive) out.push(hidden.range(node.from, node.to))
            return

          case 'Strikethrough':
            out.push(mark('cm-strike').range(node.from, node.to))
            return

          case 'InlineCode':
            out.push(mark('cm-inline-code').range(node.from, node.to))
            return

          case 'CodeMark':
            if (node.parent?.name === 'InlineCode') {
              if (!lineActive) out.push(hidden.range(node.from, node.to))
            } else {
              out.push(mark('cm-code-fence').range(node.from, node.to))
            }
            return

          case 'CodeInfo':
            out.push(mark('cm-code-fence').range(node.from, node.to))
            return

          case 'FencedCode':
          case 'CodeBlock': {
            const first = doc.lineAt(node.from).number
            const last = doc.lineAt(node.to).number
            for (let n = first; n <= last; n++) {
              const cls = `cm-codeblock${n === first ? ' cm-codeblock-start' : ''}${n === last ? ' cm-codeblock-end' : ''}`
              out.push(line(cls).range(doc.line(n).from))
            }
            return
          }

          case 'QuoteMark':
            out.push(line('cm-quote').range(doc.lineAt(node.from).from))
            if (!lineActive) hideWithSpace(node.from, node.to)
            return

          case 'HorizontalRule':
            if (!lineActive) out.push(Decoration.replace({ widget: new HrWidget() }).range(node.from, node.to))
            return

          case 'ListMark':
            listMark(node, lineActive)
            return

          case 'TaskMarker': {
            const checked = /x/i.test(doc.sliceString(node.from, node.to))
            const task = node.parent
            const textFrom = doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
            if (checked && task && task.to > textFrom) out.push(mark('cm-task-done').range(textFrom, task.to))
            if (!lineActive) {
              out.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(node.from, node.to))
            }
            return
          }

          case 'Link':
            link(node, lineActive)
            return

          case 'WikiLink':
            wikiLink(node, lineActive)
            return false

          case 'Hashtag': {
            const tag = doc.sliceString(node.from + 1, node.to)
            out.push(
              Decoration.mark({
                class: 'cm-hashtag',
                attributes: { 'data-tag': tag, title: `#${tag}\n${CLICK_MOD} to see all notes with this tag` }
              }).range(node.from, node.to)
            )
            return false
          }

          case 'Image':
            if (!lineActive) {
              const url = node.getChild('URL')
              const marks = node.getChildren('LinkMark')
              if (url && marks.length >= 2) {
                const alt = doc.sliceString(marks[0].to, marks[1].from)
                const src = imageSrc(cleanUrl(doc.sliceString(url.from, url.to)), path)
                out.push(Decoration.replace({ widget: new ImageWidget(src, alt) }).range(node.from, node.to))
                return false
              }
            }
            return

          case 'URL': {
            // Bare links like https://example.com (links and images handle their own URLs).
            const parent = node.parent?.name
            if (parent !== 'Link' && parent !== 'Image') {
              const href = cleanUrl(doc.sliceString(node.from, node.to))
              out.push(linkMark(href).range(node.from, node.to))
            }
            return
          }
        }
        return
      }
    })
  }

  function listMark(node: SyntaxNode, lineActive: boolean): void {
    const item = node.parent
    const list = item?.parent?.name
    const task = item?.getChild('Task')
    // In a daily note, "- 09:30-10:30 Standup" shows its time as a chip.
    if (isDaily) {
      const textFrom = (task?.getChild('TaskMarker')?.to ?? node.to) + 1
      const rest = doc.sliceString(textFrom, doc.lineAt(node.from).to)
      const time = EVENT_TIME.exec(rest)
      if (time && parseEventText(rest).start) out.push(mark('cm-event-time').range(textFrom, textFrom + time[1].length))
    }
    if (task) {
      if (!lineActive) out.push(hidden.range(node.from, task.from))
    } else if (list === 'BulletList') {
      if (!lineActive) out.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to))
    } else {
      out.push(mark('cm-list-number').range(node.from, node.to))
    }
  }

  function link(node: SyntaxNode, lineActive: boolean): void {
    const marks = node.getChildren('LinkMark')
    if (marks.length < 2) return
    const url = node.getChild('URL')
    const textFrom = marks[0].to
    const textTo = marks[1].from
    if (url) {
      const href = cleanUrl(doc.sliceString(url.from, url.to))
      if (textTo > textFrom) out.push(linkMark(href).range(textFrom, textTo))
    }
    if (lineActive) {
      out.push(mark('cm-link-syntax').range(textTo, node.to))
    } else {
      out.push(hidden.range(node.from, textFrom))
      out.push(hidden.range(textTo, node.to))
    }
  }

  /** [[Target#Heading|Alias]] shows as just "Alias" (or "Target#Heading"); dimmed if the note doesn't exist. */
  function wikiLink(node: SyntaxNode, lineActive: boolean): void {
    const marks = node.getChildren('WikiLinkMark')
    if (marks.length < 2) return
    const innerFrom = marks[0].to
    const innerTo = marks[1].from
    const inner = doc.sliceString(innerFrom, innerTo)
    const { target } = parseWikiInner(inner)
    const exists = useNoteIndex.getState().lookup.resolve({ kind: 'wiki', target }, path) !== null
    const bar = inner.indexOf('|')
    const shownFrom = !lineActive && bar !== -1 && innerFrom + bar + 1 < innerTo ? innerFrom + bar + 1 : innerFrom
    // "![[Note]]" in the middle of a line is an inline embed: shown as a link with an embed marker.
    // (On a line of its own, embeds.ts turns it into a card instead.)
    const embed = node.getChild('EmbedMark') !== null
    out.push(
      Decoration.mark({
        class: `cm-link cm-wikilink${exists ? '' : ' cm-unresolved'}${embed ? ' cm-embed-inline' : ''}`,
        attributes: {
          'data-wikilink': inner,
          title: exists ? `${target}\n${CLICK_MOD} to open` : `"${target}" doesn't exist yet\n${CLICK_MOD} to create it`
        }
      }).range(shownFrom, innerTo)
    )
    if (lineActive) {
      for (const m of marks) out.push(mark('cm-link-syntax').range(m.from, m.to))
    } else {
      out.push(hidden.range(node.from, shownFrom))
      out.push(hidden.range(innerTo, node.to))
    }
  }

  // A plugin may not hide line breaks (CodeMirror throws), so drop any replacement that would.
  const safe = out.filter((r) => !r.value.point || r.from === r.to || doc.lineAt(r.from).to >= r.to)
  return Decoration.set(safe, true)
}

function linkMark(href: string): Decoration {
  return Decoration.mark({ class: 'cm-link', attributes: { 'data-href': href, title: `${href}\n${CLICK_MOD} to open` } })
}

const inlinePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildInline(view)
    }
    update(u: ViewUpdate): void {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        u.focusChanged ||
        syntaxTree(u.state) !== syntaxTree(u.startState) ||
        u.transactions.some((tr) => tr.effects.some((e) => e.is(linksChanged)))
      ) {
        this.decorations = buildInline(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations }
)

// ---------- tables (multi-line, so they must come from a state field) ----------

function buildTables(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = []
  const { doc, selection } = state
  for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) {
    if (node.name !== 'Table') continue
    const from = doc.lineAt(node.from).from
    const endLine = doc.lineAt(node.to)
    const to = endLine.from === node.to && node.to > node.from ? doc.lineAt(node.to - 1).to : endLine.to
    if (selection.ranges.some((r) => r.to >= from && r.from <= to)) continue
    out.push(
      Decoration.replace({ widget: new TableWidget(doc.sliceString(from, to), from), block: true }).range(from, to)
    )
  }
  return Decoration.set(out)
}

const tablePreview = StateField.define<DecorationSet>({
  create: buildTables,
  update(value, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      return buildTables(tr.state)
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f)
})

// ---------- clicks ----------

const clickHandlers = EditorView.domEventHandlers({
  mousedown(e, view) {
    const target = e.target as HTMLElement
    if (target.matches('.cm-task-checkbox')) {
      const pos = view.posAtDOM(target)
      const current = view.state.sliceDoc(pos + 1, pos + 2)
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: current === ' ' ? 'x' : ' ' } })
      e.preventDefault()
      return true
    }
    if (e.ctrlKey || e.metaKey) {
      const tag = target.closest('[data-tag]')
      if (tag) {
        window.dispatchEvent(new CustomEvent('note:open-tag', { detail: { tag: tag.getAttribute('data-tag') } }))
        e.preventDefault()
        return true
      }
      const wiki = target.closest('[data-wikilink]')
      if (wiki) {
        window.dispatchEvent(
          new CustomEvent('note:open-wikilink', {
            detail: { inner: wiki.getAttribute('data-wikilink'), from: view.state.facet(notePath) }
          })
        )
        e.preventDefault()
        return true
      }
      const el = target.closest('[data-href]')
      if (el) {
        window.dispatchEvent(
          new CustomEvent('note:open-link', {
            detail: { href: el.getAttribute('data-href'), from: view.state.facet(notePath) }
          })
        )
        e.preventDefault()
        return true
      }
    }
    return false
  }
})

export const livePreview = [inlinePreview, tablePreview, clickHandlers, properties]
