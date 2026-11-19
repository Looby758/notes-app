import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, showPanel, ViewPlugin, WidgetType, type DecorationSet, type Panel, type ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { notePath } from './facets'
import { embedDepth } from './embeds'
import { useVault } from '../../store/vault'
import { usePrefs, setPrefs } from '../../store/prefs'
import { relativePath } from '../../lib/links'
import { parentOf, toVaultUrl } from '../../lib/paths'
import type { FileNode } from '@shared/types'
import {
  findMarkers,
  formatLength,
  IMAGE_FILE,
  isScriptNote,
  MARKER_INFO,
  MAX_WPM,
  MIN_WPM,
  resolveImage,
  scriptStats,
  type MarkerType
} from '../../lib/script'
import './script.css'

/**
 * Script tools in the editor:
 *  - markers ([IMAGE: …], [PAUSE], [SECTION: …] …) show as coloured chips, with a small picture for image cues;
 *  - script notes get a bar along the bottom with the word count and how long the video will run
 *    at your speaking pace, and a list of its sections.
 * The text itself is never changed: the chips are styling over the plain markers.
 */

// ---------- Pictures in your notes ----------

let imagesFor: FileNode[] | null = null
let imageList: string[] = []

/** Every picture in the notes folder (worked out again only when the file list changes). */
export function vaultImages(): string[] {
  const tree = useVault.getState().tree
  if (tree !== imagesFor) {
    const out: string[] = []
    const walk = (nodes: FileNode[]): void => {
      for (const n of nodes) {
        if (n.type === 'attachment' && IMAGE_FILE.test(n.name)) out.push(n.path)
        else if (n.children) walk(n.children)
      }
    }
    walk(tree)
    imagesFor = tree
    imageList = out
  }
  return imageList
}

// ---------- Marker chips ----------

class MarkerIcon extends WidgetType {
  constructor(
    readonly type: MarkerType,
    readonly image: string | null,
    readonly note: string
  ) {
    super()
  }

  eq(other: MarkerIcon): boolean {
    return other.type === this.type && other.image === this.image && other.note === this.note
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = `cm-script-icon cm-script-icon-${this.type.toLowerCase()}`
    wrap.setAttribute('aria-hidden', 'true')
    if (this.image) {
      const img = document.createElement('img')
      img.src = toVaultUrl(this.image)
      img.alt = ''
      img.draggable = false
      img.className = 'cm-script-thumb'
      wrap.append(img)
      // A bigger look on hover.
      const big = document.createElement('img')
      big.src = img.src
      big.alt = ''
      big.draggable = false
      big.className = 'cm-script-preview'
      wrap.append(big)
      wrap.title = 'Click to open the picture'
      wrap.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const href = relativePath(parentOf(this.note), this.image!).split('/').map(encodeURIComponent).join('/')
        window.dispatchEvent(new CustomEvent('note:open-link', { detail: { href, from: this.note } }))
      })
    } else {
      wrap.textContent = MARKER_INFO[this.type].icon
    }
    return wrap
  }

  ignoreEvent(): boolean {
    return !!this.image
  }
}

function inCode(state: EditorState, pos: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/Code|Comment/.test(node.name)) return true
  }
  return false
}

function buildChips(view: EditorView): DecorationSet {
  const out: Range<Decoration>[] = []
  const { state } = view
  const note = state.facet(notePath)
  const folder = usePrefs.getState().prefs.attachmentFolder
  let images: string[] | null = null
  for (const { from, to } of view.visibleRanges) {
    const text = state.sliceDoc(from, to)
    if (!text.includes('[')) continue
    for (const m of findMarkers(text, from)) {
      if (inCode(state, m.from)) continue
      let image: string | null = null
      let missing = false
      if (m.type === 'IMAGE') {
        images ??= vaultImages()
        image = resolveImage(m.value, images, folder)
        missing = !image
      }
      const info = MARKER_INFO[m.type]
      out.push(Decoration.widget({ widget: new MarkerIcon(m.type, image, note), side: 1 }).range(m.from))
      out.push(
        Decoration.mark({
          class: `cm-script-marker cm-script-${m.type.toLowerCase()}${missing ? ' cm-script-missing' : ''}`,
          attributes: { title: missing ? `${info.label}: no picture called “${m.value}” in your notes` : `${info.label}: ${info.hint}` }
        }).range(m.from, m.to)
      )
    }
  }
  return Decoration.set(out, true)
}

const chips = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    private tree = useVault.getState().tree
    constructor(view: EditorView) {
      this.decorations = buildChips(view)
    }
    update(u: ViewUpdate): void {
      const tree = useVault.getState().tree
      if (u.docChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState) || tree !== this.tree || u.transactions.some((t) => t.reconfigured)) {
        this.tree = tree
        this.decorations = buildChips(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations }
)

// ---------- Length bar (script notes only) ----------

/** A script note being edited (not one shown inside another note). */
const scriptHere = (state: EditorState): boolean => state.facet(embedDepth) === 0 && isScriptNote(state.facet(notePath), state.sliceDoc(0, 4000))

const isScript = StateField.define<boolean>({
  create: scriptHere,
  update: (value, tr) => (tr.docChanged || tr.reconfigured ? scriptHere(tr.state) : value)
})

const nf = new Intl.NumberFormat()

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** "about 8 minutes", "about 45 seconds". */
function roughly(seconds: number): string {
  if (seconds < 60) return `about ${Math.max(0, Math.round(seconds))} seconds`
  const mins = Math.round(seconds / 60)
  return `about ${mins} ${mins === 1 ? 'minute' : 'minutes'}`
}

function lengthPanel(view: EditorView): Panel {
  const dom = el('div', 'cm-script-bar')
  dom.dataset.scriptBar = ''
  const row = el('div', 'cm-script-bar-row')
  const summary = el('span', 'cm-script-bar-summary')
  const pace = el('label', 'cm-script-bar-pace')
  pace.title = 'Your speaking pace, in words a minute. Read a paragraph out loud against a timer to find yours (most people are around 130–160).'
  const paceInput = el('input', 'cm-script-bar-input')
  paceInput.type = 'number'
  paceInput.min = String(MIN_WPM)
  paceInput.max = String(MAX_WPM)
  paceInput.step = '5'
  paceInput.dataset.scriptPace = ''
  pace.append('at ', paceInput, ' words a minute')
  const toggle = el('button', 'cm-script-bar-toggle')
  toggle.dataset.scriptSectionsToggle = ''
  row.append(summary, pace, toggle)
  const list = el('div', 'cm-script-sections')
  list.hidden = true
  dom.append(row, list)

  let open = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const render = (): void => {
    const wpm = usePrefs.getState().prefs.scriptWpm
    if (document.activeElement !== paceInput) paceInput.value = String(wpm)
    const stats = scriptStats(view.state.doc.toString(), wpm)
    summary.textContent = ''
    summary.append(el('b', '', formatLength(stats.seconds)), ` · ${nf.format(stats.words)} ${stats.words === 1 ? 'word' : 'words'}`)
    summary.title = `${roughly(stats.seconds)} read out${stats.pauses ? `, with ${stats.pauses} ${stats.pauses === 1 ? 'pause' : 'pauses'}` : ''}${stats.images ? `. ${stats.images} ${stats.images === 1 ? 'picture' : 'pictures'}` : ''}`
    const named = stats.sections.filter((s) => s.title)
    toggle.hidden = named.length === 0
    toggle.textContent = `${named.length} ${named.length === 1 ? 'section' : 'sections'} ${open ? '▾' : '▸'}`
    list.hidden = !open || named.length === 0
    if (list.hidden) return
    list.textContent = ''
    for (const s of stats.sections) {
      const item = el('button', 'cm-script-part')
      item.dataset.scriptSection = s.title
      item.append(el('span', 'cm-script-part-title', s.title || 'Before the first section'), el('span', 'cm-script-part-words', `${nf.format(s.words)} words${s.images ? ` · ${s.images} 🖼` : ''}`), el('span', 'cm-script-part-time', formatLength(s.seconds)))
      item.addEventListener('click', () => {
        view.dispatch({ selection: { anchor: s.from }, effects: EditorView.scrollIntoView(s.from, { y: 'start', yMargin: 40 }) })
        view.focus()
      })
      list.append(item)
    }
  }

  toggle.addEventListener('click', () => {
    open = !open
    render()
  })
  paceInput.addEventListener('change', () => {
    const n = Math.round(Number(paceInput.value))
    if (Number.isFinite(n) && n >= MIN_WPM && n <= MAX_WPM) setPrefs({ scriptWpm: n })
    else paceInput.value = String(usePrefs.getState().prefs.scriptWpm)
  })
  const unsubscribe = usePrefs.subscribe((s, prev) => {
    if (s.prefs.scriptWpm !== prev.prefs.scriptWpm) render()
  })
  render()

  return {
    dom,
    update(u) {
      if (!u.docChanged) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(render, 200)
    },
    destroy() {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }
}

const lengthBar = showPanel.from(isScript, (on) => (on ? lengthPanel : null))

export const scriptTools: Extension = [chips, isScript, lengthBar]

/** Whether the editor is showing a script note (the "/" menu puts script markers first there). */
export const inScript = (state: EditorState): boolean => state.field(isScript, false) ?? false
