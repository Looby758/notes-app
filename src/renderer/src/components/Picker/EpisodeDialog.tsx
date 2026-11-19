import { useEffect, useMemo, useState } from 'react'
import { FileText, Tv } from 'lucide-react'
import { useNoteIndex, getNoteText } from '../../store/noteIndex'
import { ensureScreenshots, useScreenshots } from '../../store/screenshots'
import { openNote } from '../../lib/editorController'
import { openAttachment } from '../../lib/fileKinds'
import { compareEpisodes, episodeMatches, findEpisodes, isEpisodeQuery, normalizeEpisode } from '../../lib/episodes'
import { noteTitle, toVaultUrl } from '../../lib/paths'
import { useUI } from '../../store/ui'
import Picker, { type PickerItem } from './Picker'

let startWith = ''

/** Opens "find everything from an episode", already searching for `episode` ("S4E9"). */
export function openEpisode(episode: string): void {
  startWith = episode
  useUI.setState({ modal: 'episode' })
}

// Ctrl+click on "S4E9" in a note (see Editor/scriptTools.ts).
window.addEventListener('note:open-episode', (e) => openEpisode((e as CustomEvent<{ episode: string }>).detail.episode))

/** Every episode each note mentions (in its text or its `episodes:` property). */
function notesByEpisode(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const path of useNoteIndex.getState().notes.keys()) {
    const text = getNoteText(path)
    if (!text || !/S\d|issue|twd/i.test(text)) continue
    for (const label of new Set(findEpisodes(text).map((e) => e.label))) {
      const list = out.get(label)
      if (list) list.push(path)
      else out.set(label, [path])
    }
  }
  return out
}

/**
 * Type an episode (S4E9), a season (S4) or a comic issue (Issue 115) to see every note that
 * mentions it and every picture tagged with it. With nothing typed, every episode you've used.
 */
export default function EpisodeDialog({ close }: { close: () => void }) {
  const [query, setQuery] = useState(() => {
    const q = startWith
    startWith = ''
    return q
  })
  const version = useNoteIndex((s) => s.version)
  const pictures = useScreenshots((s) => s.pictures)
  useEffect(() => {
    void ensureScreenshots()
  }, [])
  const notes = useMemo(() => notesByEpisode(), [version])

  const items = useMemo<PickerItem[]>(() => {
    const q = query.trim()
    if (isEpisodeQuery(q)) {
      const label = normalizeEpisode(q) ?? q
      const notePaths = [...new Set([...notes].filter(([ep]) => episodeMatches(ep, q)).flatMap(([, paths]) => paths))].sort((a, b) => noteTitle(a).localeCompare(noteTitle(b)))
      const pics = Object.entries(pictures).filter(([, t]) => t.episodes.some((e) => episodeMatches(e, q)))
      return [
        ...notePaths.map(
          (path): PickerItem => ({
            id: `n:${path}`,
            icon: <FileText size={15} />,
            label: noteTitle(path),
            detail: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : undefined,
            run: () => {
              close()
              openNote(path)
            }
          })
        ),
        ...pics.map(
          ([path, t]): PickerItem => ({
            id: `p:${path}`,
            icon: <img className="image-cue-thumb" src={toVaultUrl(path)} alt="" loading="lazy" draggable={false} />,
            label: path.slice(path.lastIndexOf('/') + 1),
            detail: [...t.characters, ...t.episodes.filter((e) => e !== label)].join(' · ') || undefined,
            run: () => {
              close()
              openAttachment(path)
            }
          })
        )
      ]
    }
    // Every episode used, to pick from.
    const counts = new Map<string, { notes: number; pictures: number }>()
    for (const [ep, paths] of notes) counts.set(ep, { notes: paths.length, pictures: 0 })
    for (const t of Object.values(pictures)) {
      for (const ep of t.episodes) {
        const c = counts.get(ep) ?? { notes: 0, pictures: 0 }
        c.pictures++
        counts.set(ep, c)
      }
    }
    const lower = q.toLowerCase()
    return [...counts]
      .filter(([ep]) => !lower || ep.toLowerCase().includes(lower))
      .sort(([a], [b]) => compareEpisodes(a, b))
      .map(
        ([ep, c]): PickerItem => ({
          id: `e:${ep}`,
          icon: <Tv size={15} />,
          label: ep,
          detail: [c.notes && `${c.notes} ${c.notes === 1 ? 'note' : 'notes'}`, c.pictures && `${c.pictures} ${c.pictures === 1 ? 'picture' : 'pictures'}`].filter(Boolean).join(', '),
          run: () => setQuery(ep)
        })
      )
  }, [query, notes, pictures, close])

  return (
    <div className="image-cue-dialog" data-episode-dialog>
      <Picker
        query={query}
        onQuery={setQuery}
        items={items}
        placeholder="An episode (S4E9), a season (S4) or a comic issue (Issue 115)…"
        empty={isEpisodeQuery(query) ? 'Nothing from that episode yet.' : 'No episodes mentioned in your notes yet. Write one like S4E9 in a note, or tag a screenshot.'}
        onEscape={close}
      />
    </div>
  )
}
