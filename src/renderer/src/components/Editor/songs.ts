import { StateField, type EditorState, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { parseSongLine, type SongCard } from '@shared/songLinks'
import { playSongTarget } from '../../store/music'

/**
 * Songs: a line that's only a Spotify or My music link (the player's "Add to note" makes these) shows
 * as a card with the song, artist and picture. Clicking it plays the song in the music player; the
 * link's markdown shows again while the cursor is on that line, so it can be edited.
 */

const NOTE_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
const PLAY_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

class SongWidget extends WidgetType {
  constructor(
    readonly song: SongCard,
    readonly lineFrom: number
  ) {
    super()
  }

  eq(other: SongWidget): boolean {
    return other.song.href === this.song.href && other.song.name === this.song.name && other.song.artist === this.song.artist && other.song.art === this.song.art && other.lineFrom === this.lineFrom
  }

  toDOM(view: EditorView): HTMLElement {
    const { song } = this
    const card = el('div', 'cm-song')
    card.title = `Play ${song.name}`
    card.dataset.songCard = song.name

    const art = el('span', 'cm-song-art')
    art.innerHTML = NOTE_SVG
    if (song.art) {
      const img = el('img', '')
      img.alt = ''
      img.draggable = false
      img.addEventListener('load', () => art.replaceChildren(img))
      img.src = song.art
    }
    const text = el('div', 'cm-song-text')
    text.append(el('span', 'cm-song-name', song.name))
    const where = song.target.kind === 'local' ? 'My music' : 'Spotify'
    text.append(el('span', 'cm-song-artist', song.artist ? `${song.artist} · ${where}` : where))

    const actions = el('div', 'cm-place-actions')
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
    const play = el('span', 'cm-song-play')
    play.innerHTML = PLAY_SVG
    actions.append(play)

    card.append(art, text, actions)
    card.addEventListener('mousedown', (e) => {
      e.preventDefault()
      void playSongTarget(song.target)
    })
    return card
  }

  ignoreEvent(): boolean {
    return true
  }

  get estimatedHeight(): number {
    return 62
  }
}

function inCode(state: EditorState, pos: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/Code/.test(node.name)) return true
  }
  return false
}

function buildSongs(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = []
  const { doc, selection } = state
  let pos = 0
  for (const text of doc.iterLines()) {
    const lineFrom = pos
    const lineTo = pos + text.length
    pos = lineTo + 1
    const song = parseSongLine(text)
    if (!song) continue
    if (selection.ranges.some((r) => r.from <= lineTo && r.to >= lineFrom)) continue
    if (inCode(state, lineFrom + text.search(/\S/))) continue
    out.push(Decoration.replace({ widget: new SongWidget(song, lineFrom), block: true }).range(lineFrom, lineTo))
  }
  return Decoration.set(out)
}

export const songs = StateField.define<DecorationSet>({
  create: buildSongs,
  update(value, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState)) return buildSongs(tr.state)
    return value
  },
  provide: (f) => EditorView.decorations.from(f)
})
