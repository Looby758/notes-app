import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Images, Search, Tag, X } from 'lucide-react'
import { useVault } from '../../store/vault'
import { ensureScreenshots, tagPictures, useScreenshots } from '../../store/screenshots'
import { notify } from '../../store/notify'
import { toVaultUrl } from '../../lib/paths'
import { openAttachment } from '../../lib/fileKinds'
import { setDrag } from '../../lib/dnd'
import { normalizeEpisode } from '../../lib/episodes'
import { allCharacters, allEpisodes, cleanCharacter, pictureMatches, EMPTY_TAGS, type PictureTags } from '../../lib/screenshots'
import { vaultImages } from '../Editor/scriptTools'
import './screenshots.css'

type Filter = 'all' | 'untagged'

const fileName = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

/**
 * The screenshot organiser: every picture in your notes, to tag with the characters in it and the
 * episode (S4E9) or comic issue it's from. Search by name, character or episode ("maggie s4"); the
 * same search works when adding an image cue to a script. Drag a picture into a script for a cue.
 */
export default function ScreenshotsPage() {
  const tree = useVault((s) => s.tree)
  const pictures = useScreenshots((s) => s.pictures)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<string[]>([])
  const [anchor, setAnchor] = useState<string | null>(null)

  useEffect(() => {
    void ensureScreenshots()
  }, [])

  // vaultImages() is worked out again only when the file list changes.
  const images = useMemo(() => vaultImages(), [tree])
  const shown = useMemo(
    () => images.filter((p) => (filter === 'untagged' ? !pictures[p] : true) && pictureMatches(p, pictures[p], query)),
    [images, pictures, query, filter]
  )
  const characters = useMemo(() => allCharacters(pictures), [pictures])
  const episodes = useMemo(() => allEpisodes(pictures), [pictures])
  const untagged = images.filter((p) => !pictures[p]).length

  // Forget selected pictures that were deleted or renamed.
  useEffect(() => {
    setSelected((sel) => (sel.every((p) => images.includes(p)) ? sel : sel.filter((p) => images.includes(p))))
  }, [images])

  const pick = (path: string, e: MouseEvent): void => {
    if (e.shiftKey && anchor) {
      const a = shown.indexOf(anchor)
      const b = shown.indexOf(path)
      if (a >= 0 && b >= 0) {
        const range = shown.slice(Math.min(a, b), Math.max(a, b) + 1)
        setSelected((sel) => [...new Set([...sel, ...range])])
        return
      }
    }
    setAnchor(path)
    if (e.ctrlKey || e.metaKey) setSelected((sel) => (sel.includes(path) ? sel.filter((p) => p !== path) : [...sel, path]))
    else setSelected([path])
  }

  const addToSearch = (term: string): void => {
    const t = term.includes(' ') ? `"${term}"` : term
    setQuery((q) => (q.toLowerCase().split(/\s+/).includes(t.toLowerCase()) ? q : `${q.trim()} ${t}`.trim()))
  }

  return (
    <div className="shots-page" data-screenshots-page>
      <div className="shots-main">
        <div className="shots-toolbar">
          <h2>
            <Images size={18} /> Screenshots
          </h2>
          <label className="shots-search">
            <Search size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, character or episode (“maggie s4”)" spellCheck={false} data-shots-search />
            {query && (
              <button className="icon-btn" onClick={() => setQuery('')} title="Clear the search">
                <X size={13} />
              </button>
            )}
          </label>
          <div className="shots-filters">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
              All {images.length}
            </button>
            <button className={filter === 'untagged' ? 'active' : ''} onClick={() => setFilter('untagged')} data-shots-untagged>
              Not tagged yet {untagged}
            </button>
          </div>
          {(characters.length > 0 || episodes.length > 0) && (
            <div className="shots-quick">
              {characters.slice(0, 24).map((c) => (
                <button key={c.name} className="shots-chip character" onClick={() => addToSearch(c.name)} title={`Show pictures of ${c.name}`}>
                  {c.name} <span>{c.count}</span>
                </button>
              ))}
              {episodes.slice(0, 40).map((e) => (
                <button key={e} className="shots-chip episode" onClick={() => addToSearch(e)} title={`Show pictures from ${e}`}>
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>

        {images.length === 0 ? (
          <div className="shots-empty">
            <Images size={30} strokeWidth={1.3} />
            <p>No pictures in your notes yet. Paste or drag screenshots into a note and they'll show up here to tag.</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="shots-empty">
            <p>No pictures match.</p>
          </div>
        ) : (
          <div className="shots-grid" onMouseDown={(e) => e.target === e.currentTarget && setSelected([])}>
            {shown.map((path) => {
              const tags = pictures[path]
              return (
                <button
                  key={path}
                  className={`shots-card ${selected.includes(path) ? 'selected' : ''}`}
                  onClick={(e) => pick(path, e)}
                  onDoubleClick={() => openAttachment(path)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', fileName(path))
                    e.dataTransfer.effectAllowed = 'copy'
                    setDrag({ kind: 'file', path })
                  }}
                  onDragEnd={() => setDrag(null)}
                  title={`${path}\nDouble-click to open. Drag into a script for an image cue.`}
                  data-shot={path}
                >
                  <img src={toVaultUrl(path)} alt="" loading="lazy" draggable={false} />
                  <span className="shots-card-name">{fileName(path)}</span>
                  {tags && (
                    <span className="shots-card-tags">
                      {tags.characters.map((c) => (
                        <span key={c} className="character">
                          {c}
                        </span>
                      ))}
                      {tags.episodes.map((e) => (
                        <span key={e} className="episode">
                          {e}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <TagPanel selected={selected} pictures={pictures} knownCharacters={characters.map((c) => c.name)} clear={() => setSelected([])} />
    </div>
  )
}

function TagPanel({ selected, pictures, knownCharacters, clear }: { selected: string[]; pictures: Record<string, PictureTags>; knownCharacters: string[]; clear: () => void }) {
  if (!selected.length) {
    return (
      <aside className="shots-panel shots-panel-empty">
        <Tag size={22} strokeWidth={1.4} />
        <p>Pick a picture to tag it with the characters in it and the episode it's from.</p>
        <p className="faint">Ctrl+click or Shift+click to tag several at once.</p>
      </aside>
    )
  }
  const tagsOf = (p: string): PictureTags => pictures[p] ?? EMPTY_TAGS
  // What every selected picture has, and what only some have.
  const count = (list: (t: PictureTags) => string[]): { name: string; all: boolean }[] => {
    const seen = new Map<string, number>()
    for (const p of selected) for (const v of list(tagsOf(p))) seen.set(v, (seen.get(v) ?? 0) + 1)
    return [...seen].map(([name, n]) => ({ name, all: n === selected.length }))
  }
  const chars = count((t) => t.characters)
  const eps = count((t) => t.episodes)
  const what = selected.length === 1 ? `“${fileName(selected[0])}”` : `${selected.length} pictures`

  return (
    <aside className="shots-panel" data-shots-panel>
      <div className="shots-panel-head">
        <b>{selected.length === 1 ? fileName(selected[0]) : `${selected.length} pictures`}</b>
        <button className="icon-btn" onClick={clear} title="Deselect">
          <X size={14} />
        </button>
      </div>
      {selected.length === 1 ? (
        <img className="shots-preview" src={toVaultUrl(selected[0])} alt="" onDoubleClick={() => openAttachment(selected[0])} />
      ) : (
        <div className="shots-preview-stack">
          {selected.slice(0, 4).map((p) => (
            <img key={p} src={toVaultUrl(p)} alt="" />
          ))}
        </div>
      )}

      <section>
        <h4>Characters</h4>
        <div className="shots-tags">
          {chars.map((c) => (
            <span key={c.name} className={`shots-chip character ${c.all ? '' : 'some'}`} title={c.all ? undefined : 'Only on some of these pictures'}>
              {c.name}
              <button onClick={() => tagPictures(selected, { removeCharacters: [c.name] }, `Took ${c.name} off ${what}`)} title={`Take ${c.name} off`}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
        <TagInput
          placeholder="Add a character…"
          suggestions={knownCharacters}
          listId="shots-characters"
          onAdd={(v) => {
            const name = cleanCharacter(v)
            if (name) tagPictures(selected, { addCharacters: [name] }, `Tagged ${what} with ${name}`)
          }}
        />
      </section>

      <section>
        <h4>Episode or comic issue</h4>
        <div className="shots-tags">
          {eps.map((e) => (
            <span key={e.name} className={`shots-chip episode ${e.all ? '' : 'some'}`}>
              {e.name}
              <button onClick={() => tagPictures(selected, { removeEpisodes: [e.name] }, `Took ${e.name} off ${what}`)} title={`Take ${e.name} off`}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
        <TagInput
          placeholder="S4E9 or Issue 115"
          onAdd={(v) => {
            const ep = normalizeEpisode(v)
            if (!ep) {
              notify('Write an episode like S4E9 (season 4, episode 9) or a comic issue like Issue 115.', 'info')
              return false
            }
            tagPictures(selected, { addEpisodes: [ep] }, `Tagged ${what} with ${ep}`)
          }}
        />
      </section>
    </aside>
  )
}

/** A box that adds what's typed on Enter (or on picking a suggestion). Returning false keeps the text. */
function TagInput({ placeholder, suggestions, listId, onAdd }: { placeholder: string; suggestions?: string[]; listId?: string; onAdd: (v: string) => boolean | void }) {
  const [value, setValue] = useState('')
  const submit = (v = value): void => {
    if (!v.trim()) return
    if (onAdd(v.trim()) !== false) setValue('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }
  return (
    <>
      <input
        className="shots-input"
        value={value}
        list={listId}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => {
          const v = e.target.value
          // Picking from the list adds it straight away.
          if (suggestions?.includes(v) && v.length - value.length > 1) submit(v)
          else setValue(v)
        }}
        onKeyDown={onKey}
      />
      {listId && suggestions?.length ? (
        <datalist id={listId}>
          {suggestions.slice(0, 100).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </>
  )
}
