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
import { linksChanged, notePath, readingFacet } from './facets'
import { parentOf, resolveRelative, toVaultUrl } from '../../lib/paths'
import { parseWikiInner } from '../../lib/links'
import { parseFrontmatter } from '../../lib/tags'
import { parseEventText } from '../../lib/schedule'
import { dailyDateOf } from '../../lib/dailyPaths'
import { properties } from './properties'
import { calloutIcon } from './calloutIcons'
import { TableWidget } from './tableEditor'
import { AUDIO_EXT } from '../../lib/voice'
import { looksLikeSketch, withSketchVersion } from '../../lib/sketch'
import { useUI } from '../../store/ui'
import { CLICK_MOD } from '@shared/platform'
import { mathDiagrams } from './mathDiagrams'

/** The time at the start of a schedule line: "09:30", "9am", "09:30-10:30", "2pm – 3pm". */
const EVENT_TIME = /^(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?(?:\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)?)\s/i
import { useNoteIndex } from '../../store/noteIndex'
import { playSound } from '../../lib/sounds'
import { petCheer } from '../../lib/pet'

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

/** When a task was last ticked by a click, so the new tick can be drawn in (styles/motion.css). */
let tickedAt = -Infinity

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
    box.className = this.checked && performance.now() - tickedAt < 300 ? 'cm-task-checkbox cm-task-pop' : 'cm-task-checkbox'
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

/** Pictures the picture editor can open (the ones Orbit can read the bytes of). */
const EDITABLE_IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    /** The picture's path in the notes folder (offers Edit); null for pictures on the web. */
    readonly file: string | null = null,
    /** It's a sketch drawn in Notes, so Edit opens the sketch pad instead of the picture editor. */
    readonly sketch = false
  ) {
    super()
  }
  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt && other.file === this.file && other.sketch === this.sketch
  }
  toDOM(): HTMLElement {
    const img = document.createElement('img')
    img.className = 'cm-image'
    img.src = this.src
    img.alt = this.alt
    let wrap: HTMLElement | null = null
    img.onerror = () => {
      const missing = document.createElement('span')
      missing.className = 'cm-image-missing'
      missing.textContent = `Image not found: ${this.alt || this.src}`
      ;(wrap ?? img).replaceWith(missing)
    }
    const file = this.file
    if (!file || !EDITABLE_IMAGE.test(file)) return img
    const sketch = this.sketch
    wrap = document.createElement('span')
    wrap.className = sketch ? 'cm-sketch' : 'cm-picture'
    const edit = document.createElement('button')
    edit.className = 'cm-sketch-edit'
    edit.textContent = sketch ? '✏️ Edit sketch' : '✏️ Edit'
    edit.title = sketch ? 'Draw more on this sketch' : 'Crop, resize, add arrows, blur or text'
    edit.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (sketch) useUI.setState({ sketch: { path: file } })
      else useUI.setState({ picEdit: { path: file } })
    })
    wrap.append(img, edit)
    return wrap
  }
}

/** A voice note in a note: its name and a player. */
class AudioWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly label: string
  ) {
    super()
  }
  eq(other: AudioWidget): boolean {
    return other.src === this.src && other.label === this.label
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-audio'
    const name = document.createElement('span')
    name.className = 'cm-audio-name'
    name.textContent = `🎙 ${this.label || 'Voice note'}`
    const audio = document.createElement('audio')
    audio.controls = true
    audio.preload = 'metadata'
    audio.src = this.src
    wrap.append(name, audio)
    return wrap
  }
  ignoreEvent(): boolean {
    return true
  }
}

// ---------- callouts ----------

const CALLOUT = /^\s*>\s?\[!([A-Za-z-]+)\]([+-]?)\s*(.*)$/
export const CALLOUT_TYPES = ['note', 'tip', 'warning', 'important', 'question', 'success', 'danger', 'quote'] as const
const CALLOUT_ALIASES: Record<string, (typeof CALLOUT_TYPES)[number]> = {
  info: 'note',
  abstract: 'note',
  summary: 'note',
  todo: 'note',
  hint: 'tip',
  example: 'tip',
  check: 'success',
  done: 'success',
  caution: 'warning',
  attention: 'warning',
  faq: 'question',
  help: 'question',
  error: 'danger',
  bug: 'danger',
  failure: 'danger',
  fail: 'danger',
  cite: 'quote'
}
export const calloutType = (raw: string): string => {
  const t = raw.toLowerCase()
  return (CALLOUT_TYPES as readonly string[]).includes(t) ? t : (CALLOUT_ALIASES[t] ?? 'note')
}
export const calloutLabel = (type: string): string => type[0].toUpperCase() + type.slice(1)

class CalloutIconWidget extends WidgetType {
  constructor(
    readonly type: string,
    readonly fold: '' | '+' | '-',
    /** Where the fold sign (+ or -) is, right after "[!type]". */
    readonly foldPos: number
  ) {
    super()
  }
  eq(o: CalloutIconWidget): boolean {
    return o.type === this.type && o.fold === this.fold && o.foldPos === this.foldPos
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('span')
    el.className = `cm-callout-icon${this.fold ? ' foldable' : ''}${this.fold === '-' ? ' folded' : ''}`
    el.innerHTML = calloutIcon(this.type)
    if (this.fold) {
      el.title = this.fold === '-' ? 'Open' : 'Fold'
      el.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        view.dispatch({ changes: { from: this.foldPos, to: this.foldPos + 1, insert: this.fold === '-' ? '+' : '-' } })
      })
    }
    return el
  }
  ignoreEvent(): boolean {
    return true
  }
}

/** A callout without a title of its own shows its type ("Tip"). */
class CalloutTitleWidget extends WidgetType {
  constructor(readonly type: string) {
    super()
  }
  eq(o: CalloutTitleWidget): boolean {
    return o.type === this.type
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-callout-title'
    el.textContent = calloutLabel(this.type)
    return el
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

/** The picture's path in the notes folder; null for pictures on the web. */
function imagePath(url: string, path: string): string | null {
  if (/^(https?:|data:)/i.test(url)) return null
  let rel = url
  try {
    rel = decodeURI(url)
  } catch {
    // keep as typed
  }
  return resolveRelative(parentOf(path), rel)
}

function imageSrc(url: string, path: string): string {
  const file = imagePath(url, path)
  return file === null ? url : withSketchVersion(toVaultUrl(file), file)
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
  const calloutLines = new Set<number>()
  const calloutFirst = new Set<number>()

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
          case 'HighlightMark':
            if (!lineActive) out.push(hidden.range(node.from, node.to))
            return

          case 'Highlight':
            out.push(mark('cm-hl').range(node.from, node.to))
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

          case 'Blockquote':
            callout(node)
            return

          case 'QuoteMark': {
            const ln = doc.lineAt(node.from).number
            if (calloutLines.has(ln)) {
              // Callout lines: the box styling comes from callout(); the first line's marker is its icon.
              if (!lineActive && !calloutFirst.has(ln)) hideWithSpace(node.from, node.to)
              return
            }
            out.push(line('cm-quote').range(doc.lineAt(node.from).from))
            if (!lineActive) hideWithSpace(node.from, node.to)
            return
          }

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
                const raw = cleanUrl(doc.sliceString(url.from, url.to))
                const src = imageSrc(raw, path)
                // A voice note (or other audio) gets a player; pictures are shown.
                const file = imagePath(raw, path)
                const widget = AUDIO_EXT.test(raw)
                  ? new AudioWidget(src, alt)
                  : new ImageWidget(src, alt, file, !!file && looksLikeSketch(file))
                out.push(Decoration.replace({ widget }).range(node.from, node.to))
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

  /**
   * > [!tip] Title       a callout: a coloured box with an icon and a title.
   * > [!tip]- Title      folded (only the title shows; click the icon to open it).
   */
  function callout(node: SyntaxNode): void {
    const first = doc.lineAt(node.from)
    const m = CALLOUT.exec(first.text)
    if (!m) return
    const type = calloutType(m[1])
    const fold = m[2] as '' | '+' | '-'
    const firstN = first.number
    const lastN = doc.lineAt(node.to).number
    // The whole box shows its markdown while the cursor is anywhere in it.
    let anyActive = false
    for (let n = firstN; n <= lastN; n++) if (active.has(n)) anyActive = true
    const folded = fold === '-' && !anyActive
    for (let n = firstN; n <= lastN; n++) {
      calloutLines.add(n)
      const cls = `cm-callout cm-callout-${type}${n === firstN ? ' cm-callout-first' : ''}${n === lastN || (folded && n === firstN) ? ' cm-callout-last' : ''}${folded && n > firstN ? ' cm-callout-folded' : ''}`
      out.push(line(cls).range(doc.line(n).from))
    }
    calloutFirst.add(firstN)
    const title = m[3]
    const markerEnd = first.to - title.length
    if (!anyActive) {
      const foldPos = first.from + first.text.indexOf(']') + 1
      out.push(Decoration.replace({ widget: new CalloutIconWidget(type, fold, foldPos) }).range(first.from, markerEnd))
      if (!title.trim()) out.push(Decoration.widget({ widget: new CalloutTitleWidget(type), side: 1 }).range(markerEnd))
    }
    if (title.trim()) out.push(mark('cm-callout-title').range(markerEnd, first.to))
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

  // Coloured highlights: <mark class="hl-green">text</mark> shows as just the highlighted text.
  for (const range of view.visibleRanges) {
    const text = doc.sliceString(range.from, range.to)
    for (const m of text.matchAll(/<mark class="hl-(\w+)">([^<\n]*)<\/mark>/g)) {
      const from = range.from + m.index
      const to = from + m[0].length
      if (/Code/.test(syntaxTree(state).resolveInner(from, 1).name)) continue
      const openEnd = from + m[0].indexOf('>') + 1
      const closeStart = to - '</mark>'.length
      // Empty while you're about to type into it (the slash menu's "Highlight green").
      if (closeStart > openEnd) out.push(mark(`cm-hl cm-hl-${m[1]}`).range(openEnd, closeStart))
      if (!isActive(from)) {
        out.push(hidden.range(from, openEnd))
        out.push(hidden.range(closeStart, to))
      }
    }
  }

  // Reminders: "⏰ 2026-10-28 15:00" shows as a small chip.
  for (const range of view.visibleRanges) {
    const text = doc.sliceString(range.from, range.to)
    for (const m of text.matchAll(/(?:⏰️?|\bremind:)\s*(?:\d{4}-\d{2}-\d{2}\s+)?\d{1,2}:\d{2}/gu)) {
      const from = range.from + m.index
      if (/Code/.test(syntaxTree(state).resolveInner(from, 1).name)) continue
      out.push(Decoration.mark({ class: 'cm-reminder', attributes: { title: 'Reminder: Orbit will show a notification at this time' } }).range(from, from + m[0].length))
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
    // While writing, a table the cursor is in shows its markdown (reading mode always shows the table).
    if (!state.readOnly && selection.ranges.some((r) => r.to >= from && r.from <= to)) continue
    out.push(
      Decoration.replace({ widget: new TableWidget(doc.sliceString(from, to), from, state.readOnly), block: true }).range(from, to)
    )
  }
  return Decoration.set(out)
}

const tablePreview = StateField.define<DecorationSet>({
  create: buildTables,
  update(value, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState) || tr.startState.readOnly !== tr.state.readOnly) {
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
      if (current === ' ') {
        tickedAt = performance.now()
        playSound('tick')
        petCheer()
      }
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: current === ' ' ? 'x' : ' ' } })
      e.preventDefault()
      return true
    }
    // Links and tags open with Ctrl/⌘+click while writing, or a plain click in reading mode.
    if (e.ctrlKey || e.metaKey || view.state.facet(readingFacet)) {
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

// Maths and diagrams first, so a formula's own symbols (like * and _) aren't styled as markdown.
export const livePreview = [mathDiagrams, inlinePreview, tablePreview, clickHandlers, properties]
