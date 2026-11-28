import { useEffect, useState } from 'react'
import { FolderOpen, Save, Trash2, X } from 'lucide-react'
import { clockText, dayOf, type SurvivalWorld } from '@shared/survival'
import { AUTOSAVE, deleteSave, listSaves, readSave, writeSave, type SaveMeta } from './saveFiles'

function ago(t: number): string {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(t).toLocaleDateString()
}

/**
 * Save and load, like a game: pick a save to overwrite it or load it, or type a new name to make a
 * new one. The autosave has its own slot that's rewritten every 5 minutes.
 */
export default function SavesDialog({ world, onLoad, onClose, onSaved }: { world: SurvivalWorld; onLoad: (w: SurvivalWorld, name: string) => void; onClose: () => void; onSaved: () => void }) {
  const [saves, setSaves] = useState<SaveMeta[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  const reload = (): void => {
    listSaves()
      .then(setSaves)
      .catch(() => setError("Couldn't read the saves."))
  }
  useEffect(reload, [])

  const trimmed = name.trim()
  const exists = !!saves?.some((s) => s.name === trimmed)
  const reserved = trimmed.toLowerCase() === AUTOSAVE.toLowerCase()

  const save = async (): Promise<void> => {
    if (!trimmed || reserved) return
    setBusy(true)
    setError('')
    try {
      await writeSave(trimmed, world)
      onSaved()
      reload()
    } catch {
      setError("Couldn't save. The disk might be full.")
    }
    setBusy(false)
  }

  const load = async (n: string): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const w = await readSave(n)
      if (w) onLoad(w, n)
      else setError("That save couldn't be opened. It may be from an older version of Orbit.")
    } catch {
      setError("Couldn't load that save.")
    }
    setBusy(false)
  }

  return (
    <div className="sv-decision" role="dialog" aria-label="Save and load" data-sv-saves>
      <div className="sv-decision-card sv-saves">
        <div className="evo-card-head">
          <h3>Save and load</h3>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={15} />
          </button>
        </div>
        <p className="muted">
          It's Day {dayOf(world.tick)}, {clockText(world.tick)}. Click a save to overwrite it, or type a new name. Loading replaces what's on the map now. It also autosaves every 5 minutes.
        </p>
        <div className="sv-save-list">
          {saves === null && <p className="muted">Reading saves…</p>}
          {saves?.length === 0 && <p className="muted">No saves yet.</p>}
          {saves?.map((s) => (
            <div key={s.name} className={`sv-save ${trimmed === s.name ? 'on' : ''}`} onClick={() => !s.auto && setName(s.name)} data-sv-save={s.name}>
              <div className="sv-save-info">
                <b>{s.name}</b>
                <em>
                  Day {dayOf(s.tick)}, {clockText(s.tick)} · saved {ago(s.savedAt)} · {s.walkers} walkers
                </em>
                <span className="sv-save-groups">
                  {s.groups.length
                    ? s.groups.map((g) => (
                        <span key={g.name}>
                          <i style={{ background: g.color }} /> {g.name} ({g.people})
                        </span>
                      ))
                    : 'No groups'}
                </span>
              </div>
              {deleting === s.name ? (
                <div className="sv-save-actions">
                  <button
                    className="btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteSave(s.name).then(reload)
                      setDeleting(null)
                      if (trimmed === s.name) setName('')
                    }}
                  >
                    Delete it
                  </button>
                  <button
                    className="btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleting(null)
                    }}
                  >
                    Keep
                  </button>
                </div>
              ) : (
                <div className="sv-save-actions">
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation()
                      load(s.name)
                    }}
                    data-sv-load={s.name}
                  >
                    <FolderOpen size={13} /> Load
                  </button>
                  <button
                    className="icon-btn"
                    title="Delete this save"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleting(s.name)
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        <form
          className="sv-save-new"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <input className="text-input" placeholder="Save name, e.g. Before the raiders" value={name} onChange={(e) => setName(e.target.value)} autoFocus data-sv-save-name />
          <button className="btn btn-primary" type="submit" disabled={!trimmed || reserved || busy} data-sv-save-button>
            <Save size={13} /> {exists ? 'Overwrite' : 'Save'}
          </button>
        </form>
        {reserved && <p className="muted">"Autosave" is kept for the autosave. Pick another name.</p>}
        {error && <p className="sv-bitten">{error}</p>}
      </div>
    </div>
  )
}
