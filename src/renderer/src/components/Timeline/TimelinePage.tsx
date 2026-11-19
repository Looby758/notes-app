import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactElement } from 'react'
import { ArrowDown, ArrowUp, Check, Clock, Inbox, Plus, Search, Trash2, X } from 'lucide-react'
import {
  addEntry,
  addEra,
  deleteEntry,
  deleteEra,
  ensureTimeline,
  moveEntry,
  moveEra,
  renameEra,
  updateEntry,
  useTimeline
} from '../../store/timeline'
import { ensureScreenshots, useScreenshots } from '../../store/screenshots'
import { allCharacters } from '../../lib/screenshots'
import { normalizeEpisode } from '../../lib/episodes'
import { notify } from '../../store/notify'
import {
  cleanAt,
  entryMatches,
  entryScriptText,
  hasCharacter,
  parseCapture,
  sourceLabel,
  storyOrder,
  tellingOrder,
  timelineCharacters,
  TELLINGS,
  type Medium,
  type Telling,
  type TimelineEntry
} from '../../lib/timeline'
import './timeline.css'

type View = 'story' | 'told' | 'side'
type MediumFilter = 'all' | Medium

let focusCapture = false
/** Opens on the quick-capture box (Ctrl+K "Add to the timeline"). */
export function captureNext(): void {
  focusCapture = true
}

const TELLING_LABEL: Record<Telling, string> = { shown: 'Shown', told: 'Told', flashback: 'Flashback' }

/**
 * The story timeline: what happened in the story, in story order by era, with where each thing
 * was shown or told. Filter to one character ("the life of Maggie Rhee"), the show or the
 * comics, or put several characters side by side. Drag an entry into a script to write it up
 * with a Source marker; drag it between entries to put it in order.
 */
export default function TimelinePage() {
  const { eras, entries, loaded } = useTimeline()
  const shotPictures = useScreenshots((s) => s.pictures)
  const [view, setView] = useState<View>('story')
  const [medium, setMedium] = useState<MediumFilter>('all')
  const [people, setPeople] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<{ era: string; index: number } | null>(null)

  useEffect(() => {
    void ensureTimeline()
    void ensureScreenshots()
  }, [])

  const characters = useMemo(() => timelineCharacters(entries), [entries])
  // Names you've used in the timeline or the screenshot organiser, for suggestions and quick capture.
  const knownNames = useMemo(() => [...new Set([...characters, ...allCharacters(shotPictures).map((c) => c.name)])], [characters, shotPictures])

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) => (medium === 'all' || e.medium === medium) && entryMatches(e, query) && (view === 'side' || people.every((p) => hasCharacter(e, p)))
      ),
    [entries, medium, query, people, view]
  )
  const inbox = storyOrder({ eras, entries }, filtered.filter((e) => e.inbox))
  const filtering = medium !== 'all' || !!query.trim() || (view !== 'side' && people.length > 0)

  const togglePerson = (name: string): void => setPeople((p) => (p.some((x) => x.toLowerCase() === name.toLowerCase()) ? p.filter((x) => x.toLowerCase() !== name.toLowerCase()) : [...p, name]))

  // ---------- dragging ----------
  const startDrag = (e: DragEvent, entry: TimelineEntry): void => {
    // Into a note: the story plus where it's from. Within the timeline: put it in order.
    e.dataTransfer.setData('text/plain', entryScriptText(entry))
    e.dataTransfer.effectAllowed = 'copyMove'
    setDragging(entry.id)
  }
  const endDrag = (): void => {
    setDragging(null)
    setDropAt(null)
  }
  const overSlot = (e: DragEvent, era: string, index: number): void => {
    if (!dragging) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (dropAt?.era !== era || dropAt.index !== index) setDropAt({ era, index })
  }
  const drop = (e: DragEvent): void => {
    if (!dragging || !dropAt) return
    e.preventDefault()
    e.stopPropagation()
    moveEntry(dragging, dropAt.era, dropAt.index)
    const moved = entries.find((x) => x.id === dragging)
    if (moved?.inbox) updateEntry(dragging, { inbox: false }, 'Tidied a timeline entry')
    endDrag()
  }

  const card = (entry: TimelineEntry, era?: string, index?: number): ReactElement => (
    <EntryCard
      key={entry.id}
      entry={entry}
      open={open === entry.id}
      toggle={() => setOpen(open === entry.id ? null : entry.id)}
      eras={eras}
      knownNames={knownNames}
      dragging={dragging === entry.id}
      dropBefore={!!era && dropAt?.era === era && dropAt.index === index}
      onDragStart={(e) => startDrag(e, entry)}
      onDragEnd={endDrag}
      onDragOver={era !== undefined && index !== undefined ? (e) => overSlot(e, era, index) : undefined}
      onDrop={drop}
      onPerson={togglePerson}
    />
  )

  return (
    <div className="tl-page" data-timeline-page>
      <div className="tl-inner">
        <header className="tl-head">
          <h2>
            <Clock size={18} /> Timeline
          </h2>
          <QuickCapture knownNames={knownNames} />
        </header>

        <div className="tl-toolbar">
          <div className="tl-seg" role="tablist">
            {(
              [
                ['story', 'Story order'],
                ['told', 'As shown and told'],
                ['side', 'Side by side']
              ] as const
            ).map(([id, label]) => (
              <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)} data-tl-view={id}>
                {label}
              </button>
            ))}
          </div>
          <div className="tl-seg">
            {(
              [
                ['all', 'Show and comics'],
                ['show', 'Show'],
                ['comic', 'Comics']
              ] as const
            ).map(([id, label]) => (
              <button key={id} className={medium === id ? 'active' : ''} onClick={() => setMedium(id)}>
                {label}
              </button>
            ))}
          </div>
          <label className="tl-search">
            <Search size={13} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search (words, S4E9, S4)…" spellCheck={false} />
          </label>
        </div>

        {characters.length > 0 && (
          <div className="tl-people">
            {characters.slice(0, 30).map((c) => (
              <button key={c} className={`tl-person ${people.some((p) => p.toLowerCase() === c.toLowerCase()) ? 'active' : ''}`} onClick={() => togglePerson(c)} data-tl-person={c}>
                {c}
              </button>
            ))}
            {people.length > 0 && (
              <button className="tl-clear" onClick={() => setPeople([])}>
                Clear
              </button>
            )}
          </div>
        )}

        {view !== 'side' && people.length > 0 && <h3 className="tl-life">The life of {people.join(' and ')}</h3>}

        {!loaded ? null : entries.length === 0 ? (
          <div className="tl-empty">
            <Clock size={30} strokeWidth={1.3} />
            <p>
              Nothing on the timeline yet. Type into the box above while you watch, like <code>S4E9 12:30 Maggie and Glenn find the cell block</code>, and tidy it into an era later.
            </p>
          </div>
        ) : view === 'side' ? (
          <SideBySide eras={eras} entries={filtered} people={people} />
        ) : view === 'told' ? (
          <div className="tl-list">
            {tellingOrder(filtered).map((e) => card(e))}
            {filtered.length === 0 && <p className="tl-none">Nothing matches.</p>}
          </div>
        ) : (
          <>
            {inbox.length > 0 && (
              <section className="tl-era tl-inbox">
                <div className="tl-era-head">
                  <Inbox size={14} /> <b>To tidy</b> <span className="tl-count">{inbox.length}</span>
                  <span className="tl-hint">Drag each into its era, or open it and pick one.</span>
                </div>
                <div className="tl-list">{inbox.map((e) => card(e))}</div>
              </section>
            )}
            {eras.map((era, i) => {
              const list = storyOrder({ eras, entries }, filtered.filter((e) => e.era === era.id && !e.inbox))
              if (filtering && !list.length) return null
              return (
                <section key={era.id} className="tl-era" onDragOver={(e) => overSlot(e, era.id, list.length)} onDrop={drop} data-tl-era={era.name}>
                  <EraHead
                    name={era.name}
                    count={list.length}
                    first={i === 0}
                    last={i === eras.length - 1}
                    rename={(n) => renameEra(era.id, n)}
                    move={(by) => moveEra(era.id, by)}
                    remove={() => deleteEra(era.id)}
                    add={() => setOpen(addEntry({ era: era.id, characters: people.slice(), medium: medium === 'comic' ? 'comic' : 'show' }))}
                  />
                  <div className="tl-list">
                    {list.map((e, index) => card(e, era.id, index))}
                    {dragging && dropAt?.era === era.id && dropAt.index === list.length && <div className="tl-drop-line" />}
                  </div>
                </section>
              )
            })}
            <AddEra />
          </>
        )}
      </div>
    </div>
  )
}

function QuickCapture({ knownNames }: { knownNames: string[] }) {
  const [text, setText] = useState('')
  const box = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusCapture) {
      focusCapture = false
      box.current?.focus()
    }
  }, [])
  const add = (): void => {
    if (!text.trim()) return
    const parsed = parseCapture(text, knownNames)
    if (!parsed.text) return
    addEntry({ ...parsed, inbox: true })
    setText('')
  }
  return (
    <div className="tl-capture">
      <input
        ref={box}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add()
          }
        }}
        placeholder="Quick add while watching: S4E9 12:30 Maggie and Glenn find the cell block"
        spellCheck
        data-tl-capture
      />
      <button className="btn btn-primary" onClick={add} disabled={!text.trim()}>
        <Plus size={14} /> Add
      </button>
    </div>
  )
}

function EraHead({ name, count, first, last, rename, move, remove, add }: { name: string; count: number; first: boolean; last: boolean; rename: (n: string) => void; move: (by: -1 | 1) => void; remove: () => void; add: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  useEffect(() => setValue(name), [name])
  const done = (): void => {
    setEditing(false)
    if (value.trim() && value.trim() !== name) rename(value)
    else setValue(name)
  }
  return (
    <div className="tl-era-head">
      {editing ? (
        <input
          className="tl-era-input"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={done}
          onKeyDown={(e) => {
            if (e.key === 'Enter') done()
            if (e.key === 'Escape') {
              setValue(name)
              setEditing(false)
            }
          }}
        />
      ) : (
        <b onDoubleClick={() => setEditing(true)} title="Double-click to rename">
          {name}
        </b>
      )}
      <span className="tl-count">{count || ''}</span>
      <span className="tl-era-actions">
        <button className="icon-btn" onClick={add} title="Add an entry to this era">
          <Plus size={13} />
        </button>
        <button className="icon-btn" onClick={() => move(-1)} disabled={first} title="Earlier in the story">
          <ArrowUp size={13} />
        </button>
        <button className="icon-btn" onClick={() => move(1)} disabled={last} title="Later in the story">
          <ArrowDown size={13} />
        </button>
        {count === 0 && (
          <button className="icon-btn" onClick={remove} title="Delete this era">
            <Trash2 size={13} />
          </button>
        )}
      </span>
    </div>
  )
}

function AddEra() {
  const [name, setName] = useState('')
  return (
    <div className="tl-add-era">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) {
            addEra(name)
            setName('')
          }
        }}
        placeholder="Add an era (e.g. Hilltop, The Ricktatorship)…"
      />
    </div>
  )
}

interface CardProps {
  entry: TimelineEntry
  open: boolean
  toggle: () => void
  eras: { id: string; name: string }[]
  knownNames: string[]
  dragging: boolean
  dropBefore: boolean
  onDragStart: (e: DragEvent) => void
  onDragEnd: () => void
  onDragOver?: (e: DragEvent) => void
  onDrop: (e: DragEvent) => void
  onPerson: (name: string) => void
}

function EntryCard({ entry, open, toggle, eras, knownNames, dragging, dropBefore, onDragStart, onDragEnd, onDragOver, onDrop, onPerson }: CardProps) {
  const source = sourceLabel({ ...entry, telling: 'shown' })
  return (
    <>
      {dropBefore && <div className="tl-drop-line" />}
      <div
        className={`tl-entry ${entry.telling} ${open ? 'open' : ''} ${dragging ? 'dragging' : ''}`}
        draggable={!open}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
        data-tl-entry={entry.id}
      >
        <div className="tl-entry-row" onClick={toggle} title={open ? undefined : 'Click to edit. Drag into a script to write it up with its source.'}>
          <span className={`tl-telling ${entry.telling}`}>{TELLING_LABEL[entry.telling]}</span>
          <span className="tl-entry-text">{entry.text || <i>Nothing written yet</i>}</span>
          <span className="tl-entry-meta">
            {entry.when && <span className="tl-when">{entry.when}</span>}
            {source && <span className={`tl-source ${entry.medium}`}>{source}</span>}
          </span>
        </div>
        {entry.characters.length > 0 && !open && (
          <div className="tl-entry-people">
            {entry.characters.map((c) => (
              <button key={c} onClick={() => onPerson(c)} title={`Only ${c}`}>
                {c}
              </button>
            ))}
          </div>
        )}
        {open && <EntryEditor entry={entry} eras={eras} knownNames={knownNames} close={toggle} />}
      </div>
    </>
  )
}

function EntryEditor({ entry, eras, knownNames, close }: { entry: TimelineEntry; eras: { id: string; name: string }[]; knownNames: string[]; close: () => void }) {
  const set = (patch: Partial<TimelineEntry>, label?: string): void => updateEntry(entry.id, patch, label)
  const [person, setPerson] = useState('')
  const [episode, setEpisode] = useState(entry.episode)
  const [at, setAt] = useState(entry.at)
  useEffect(() => setEpisode(entry.episode), [entry.episode])
  useEffect(() => setAt(entry.at), [entry.at])

  const addPerson = (name = person): void => {
    const n = name.trim().slice(0, 60)
    setPerson('')
    if (n && !hasCharacter(entry, n)) set({ characters: [...entry.characters, n] }, `Added ${n} to a timeline entry`)
  }
  const saveEpisode = (): void => {
    const v = episode.trim()
    if (!v) return void (entry.episode && set({ episode: '' }))
    const ep = normalizeEpisode(v)
    if (!ep) {
      notify('Write an episode like S4E9 or a comic issue like Issue 115.', 'info')
      setEpisode(entry.episode)
      return
    }
    if (ep !== entry.episode) set({ episode: ep, medium: ep.startsWith('Issue') ? 'comic' : 'show' })
    setEpisode(ep)
  }
  const saveAt = (): void => {
    const v = cleanAt(at)
    if (at.trim() && !v) {
      notify('Write the time in the episode like 12:30 (or 1:02:05).', 'info')
      setAt(entry.at)
      return
    }
    if (v !== entry.at) set({ at: v })
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>, run: () => void): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      run()
    }
  }

  return (
    <div className="tl-editor" onDragStart={(e) => e.stopPropagation()}>
      <textarea autoFocus value={entry.text} onChange={(e) => set({ text: e.target.value })} placeholder="What happened?" rows={3} data-tl-text />
      <div className="tl-editor-grid">
        <label>
          Era
          <select value={entry.era} onChange={(e) => set({ era: e.target.value }, 'Moved a timeline entry to another era')}>
            {eras.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          When in the story
          <input value={entry.when} onChange={(e) => set({ when: e.target.value.slice(0, 120) })} placeholder="Day 3, winter, years before…" />
        </label>
        <label>
          How it's told
          <select value={entry.telling} onChange={(e) => set({ telling: e.target.value as Telling })}>
            {TELLINGS.map((t) => (
              <option key={t.id} value={t.id} title={t.hint}>
                {t.label}: {t.hint.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label>
          Show or comics
          <select value={entry.medium} onChange={(e) => set({ medium: e.target.value as Medium })}>
            <option value="show">Show</option>
            <option value="comic">Comics</option>
          </select>
        </label>
        <label>
          Episode or issue
          <input value={episode} onChange={(e) => setEpisode(e.target.value)} onBlur={saveEpisode} onKeyDown={(e) => onKey(e, saveEpisode)} placeholder="S4E9 or Issue 115" />
        </label>
        <label>
          Time in the episode
          <input value={at} onChange={(e) => setAt(e.target.value)} onBlur={saveAt} onKeyDown={(e) => onKey(e, saveAt)} placeholder="12:30" />
        </label>
      </div>
      <div className="tl-editor-people">
        <span className="tl-label">Characters</span>
        {entry.characters.map((c) => (
          <span key={c} className="tl-chip">
            {c}
            <button onClick={() => set({ characters: entry.characters.filter((x) => x !== c) }, `Took ${c} off a timeline entry`)} title={`Take ${c} off`}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          value={person}
          list="tl-people-list"
          onChange={(e) => {
            const v = e.target.value
            if (knownNames.includes(v) && v.length - person.length > 1) addPerson(v)
            else setPerson(v)
          }}
          onKeyDown={(e) => onKey(e, () => addPerson())}
          onBlur={() => person.trim() && addPerson()}
          placeholder="Add a character…"
        />
        <datalist id="tl-people-list">
          {knownNames.slice(0, 100).map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </div>
      <div className="tl-editor-actions">
        <button className="btn" onClick={() => deleteEntry(entry.id)}>
          <Trash2 size={13} /> Delete
        </button>
        <span className="tl-spacer" />
        {entry.inbox && (
          <button
            className="btn"
            onClick={() => {
              set({ inbox: false }, 'Tidied a timeline entry')
              close()
            }}
            data-tl-tidied
          >
            <Check size={13} /> Tidied: put it in its era
          </button>
        )}
        <button className="btn btn-primary" onClick={close}>
          Done
        </button>
      </div>
    </div>
  )
}

/** Several characters in columns, eras down the side: what each was doing at the same time. */
function SideBySide({ eras, entries, people }: { eras: { id: string; name: string }[]; entries: TimelineEntry[]; people: string[] }) {
  if (people.length < 2) return <p className="tl-none">Pick two or more characters above to see their stories side by side.</p>
  const rows = eras
    .map((era) => ({ era, cells: people.map((p) => storyOrder({ eras, entries }, entries.filter((e) => e.era === era.id && !e.inbox && hasCharacter(e, p)))) }))
    .filter((r) => r.cells.some((c) => c.length))
  return (
    <div className="tl-side" style={{ gridTemplateColumns: `minmax(110px, 160px) repeat(${people.length}, minmax(0, 1fr))` }} data-tl-side>
      <div className="tl-side-corner" />
      {people.map((p) => (
        <div key={p} className="tl-side-person">
          {p}
        </div>
      ))}
      {rows.map(({ era, cells }) => (
        <div key={era.id} className="tl-side-row">
          <div className="tl-side-era">{era.name}</div>
          {cells.map((list, i) => (
            <div key={people[i]} className="tl-side-cell">
              {list.map((e) => (
                <div
                  key={e.id}
                  className={`tl-side-entry ${e.telling}`}
                  draggable
                  onDragStart={(ev) => {
                    ev.dataTransfer.setData('text/plain', entryScriptText(e))
                    ev.dataTransfer.effectAllowed = 'copy'
                  }}
                  title={[sourceLabel(e), e.when].filter(Boolean).join(' · ') || undefined}
                >
                  {e.text}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
      {rows.length === 0 && <p className="tl-none">None of them are on the timeline together yet.</p>}
    </div>
  )
}
