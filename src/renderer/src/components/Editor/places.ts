import { StateField, type EditorState, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { notePath } from './facets'
import { parsePlaceLine, tileAt, TILE_SIZE, type MapsTarget } from '@shared/places'

/**
 * Places: a line that's only a Google Maps link shows as a card with the place's name, address
 * and a small map (when the link has the place's coordinates). Clicking it opens Google Maps;
 * the link's markdown shows again while the cursor is on that line, so it can be edited.
 */

const ZOOM = 15
const MAP_HEIGHT = 150

// Map squares already fetched (or being fetched), shared by every card.
const tiles = new Map<string, Promise<string | null>>()
function tile(z: number, x: number, y: number): Promise<string | null> {
  const key = `${z}/${x}/${y}`
  let found = tiles.get(key)
  if (!found) {
    found = window.api.mapTile(z, x, y).catch(() => null)
    void found.then((url) => url === null && tiles.delete(key))
    tiles.set(key, found)
  }
  return found
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const PIN_SVG =
  '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z" fill="#e5484d" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="9" r="2.6" fill="#fff"/></svg>'

/** A 3 × 3 block of map squares, slid so the place sits in the middle of the card. */
function mapPreview(target: MapsTarget & { lat: number; lon: number }): HTMLElement {
  const map = el('div', 'cm-place-map')
  map.style.height = `${MAP_HEIGHT}px`
  const { x, y, px, py } = tileAt(target.lat, target.lon, ZOOM)
  const grid = el('div', 'cm-place-tiles')
  grid.style.width = grid.style.height = `${TILE_SIZE * 3}px`
  grid.style.left = `calc(50% - ${TILE_SIZE + px}px)`
  grid.style.top = `${MAP_HEIGHT / 2 - (TILE_SIZE + py)}px`
  const n = 2 ** ZOOM
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const img = el('img', 'cm-place-tile')
      img.alt = ''
      img.draggable = false
      img.style.left = `${(dx + 1) * TILE_SIZE}px`
      img.style.top = `${(dy + 1) * TILE_SIZE}px`
      grid.append(img)
      const ty = y + dy
      if (ty < 0 || ty >= n) continue
      void tile(ZOOM, (x + dx + n) % n, ty).then((src) => {
        if (src) img.src = src
      })
    }
  }
  const pin = el('span', 'cm-place-pin')
  pin.innerHTML = PIN_SVG
  map.append(grid, pin, el('span', 'cm-place-credit', '© OpenStreetMap'))
  return map
}

class PlaceWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly url: string,
    readonly address: string,
    readonly target: MapsTarget,
    readonly lineFrom: number
  ) {
    super()
  }

  eq(other: PlaceWidget): boolean {
    return other.name === this.name && other.url === this.url && other.address === this.address && other.lineFrom === this.lineFrom
  }

  toDOM(view: EditorView): HTMLElement {
    const open = (e: MouseEvent): void => {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('note:open-link', { detail: { href: this.url, from: view.state.facet(notePath) } }))
    }
    const card = el('div', 'cm-place')
    card.title = 'Open in Google Maps'
    const { lat, lon } = this.target
    if (lat !== undefined && lon !== undefined) card.append(mapPreview({ ...this.target, lat, lon }))

    const info = el('div', 'cm-place-info')
    const text = el('div', 'cm-place-text')
    text.append(el('span', 'cm-place-name', this.name))
    const where = this.address || (lat === undefined ? 'Google Maps search' : '')
    if (where) text.append(el('span', 'cm-place-address', where))
    info.append(el('span', 'cm-place-icon', '📍'), text)

    const actions = el('div', 'cm-place-actions')
    actions.append(el('span', 'cm-place-open', 'Open in Google Maps ↗'))
    if (!view.state.readOnly) {
      const edit = el('button', 'cm-place-edit', 'Edit')
      edit.title = 'Show the link so you can change it'
      edit.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        view.dispatch({ selection: { anchor: this.lineFrom } })
        view.focus()
      })
      actions.append(edit)
    }
    info.append(actions)
    card.append(info)
    card.addEventListener('mousedown', open)
    return card
  }

  ignoreEvent(): boolean {
    return true
  }

  get estimatedHeight(): number {
    return this.target.lat === undefined ? 56 : MAP_HEIGHT + 56
  }
}

function inCode(state: EditorState, pos: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/Code/.test(node.name)) return true
  }
  return false
}

function buildPlaces(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = []
  const { doc, selection } = state
  let pos = 0
  for (const text of doc.iterLines()) {
    const lineFrom = pos
    const lineTo = pos + text.length
    pos = lineTo + 1
    if (!text.includes('http')) continue
    const place = parsePlaceLine(text)
    if (!place) continue
    // Show the raw link while the cursor is on that line.
    if (selection.ranges.some((r) => r.from <= lineTo && r.to >= lineFrom)) continue
    if (inCode(state, lineFrom + text.search(/\S/))) continue
    out.push(
      Decoration.replace({
        widget: new PlaceWidget(place.name, place.url, place.address, place.target, lineFrom),
        block: true
      }).range(lineFrom, lineTo)
    )
  }
  return Decoration.set(out)
}

export const places = StateField.define<DecorationSet>({
  create: buildPlaces,
  update(value, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState)) return buildPlaces(tr.state)
    return value
  },
  provide: (f) => EditorView.decorations.from(f)
})
