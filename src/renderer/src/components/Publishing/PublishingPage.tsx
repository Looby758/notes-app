import { useEffect, useState } from 'react'
import { Check, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { addVideo, deleteVideo, ensurePublishing, renameVideo, usePublishing } from '../../store/publishing'
import { chosenTitleText, draftProgress } from '../../lib/publishing'
import { UNDO_KEY } from '../../lib/undo'
import { notify } from '../../store/notify'
import PublishingDrafts from './PublishingDrafts'
import './publishing.css'

/** Which video was open, so coming back to the page shows it again. */
let lastOpen: string | null = null

function NewVideo({ onMade, onClose }: { onMade: (id: string) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const make = (): void => {
    if (!name.trim()) return notify('Give the video a working name first.', 'info')
    onMade(addVideo(name).id)
  }
  return (
    <div className="pub-new">
      <input
        className="text-input"
        autoFocus
        value={name}
        maxLength={120}
        placeholder="Working name, e.g. Life of Maggie Rhee"
        aria-label="Video name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') make()
          if (e.key === 'Escape') onClose()
        }}
      />
      <button className="icon-btn" onClick={make} title="Add">
        <Check size={14} />
      </button>
      <button className="icon-btn" onClick={onClose} title="Cancel">
        <X size={14} />
      </button>
    </div>
  )
}

function VideoName({ id, name }: { id: string; name: string }) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  if (editing) {
    return (
      <input
        className="text-input pub-name-input"
        autoFocus
        defaultValue={name}
        maxLength={120}
        aria-label="Video name"
        onBlur={(e) => {
          if (e.target.value.trim() && e.target.value.trim() !== name) renameVideo(id, e.target.value.trim())
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    )
  }
  return (
    <div className="pub-name">
      <h2>{name}</h2>
      <button className="icon-btn" onClick={() => setEditing(true)} title="Rename">
        <Pencil size={14} />
      </button>
      {confirming ? (
        <>
          <button
            className="link-button danger"
            onClick={() => {
              deleteVideo(id)
              notify(`Deleted. ${UNDO_KEY} to undo.`, 'info')
            }}
          >
            Delete its drafts
          </button>
          <button className="icon-btn" onClick={() => setConfirming(false)} title="Keep it">
            <X size={14} />
          </button>
        </>
      ) : (
        <button className="icon-btn" onClick={() => setConfirming(true)} title="Delete">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )
}

/**
 * Publishing: getting each video ready for YouTube. Until video projects exist, this keeps its
 * own simple list of videos; a video project can show the same drafts with PublishingDrafts.
 */
export default function PublishingPage() {
  const videos = usePublishing((s) => s.videos)
  const loaded = usePublishing((s) => s.loaded)
  const [openId, setOpenId] = useState<string | null>(lastOpen)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    void ensurePublishing()
  }, [])

  const open = videos.find((v) => v.id === openId) ?? videos[0]
  useEffect(() => {
    lastOpen = open?.id ?? null
  }, [open?.id])

  const made = (id: string): void => {
    setOpenId(id)
    setAdding(false)
  }

  return (
    <div className="pub-page" data-publishing-page>
      <aside className="pub-list">
        <header className="pub-list-head">
          <h2>
            <Upload size={17} /> Publishing
          </h2>
          <button className="icon-btn" onClick={() => setAdding(true)} title="New video" data-pub-new>
            <Plus size={16} />
          </button>
        </header>
        {adding && <NewVideo onMade={made} onClose={() => setAdding(false)} />}
        {videos.map((v) => {
          const p = draftProgress(v)
          return (
            <button key={v.id} className={`pub-list-item ${open?.id === v.id ? 'on' : ''}`} onClick={() => setOpenId(v.id)} data-pub-video>
              <span className="pub-list-name">{v.name}</span>
              <span className="pub-list-sub">{chosenTitleText(v) || 'No title yet'}</span>
              <span className="pub-list-progress" title="Title, description, tags and chapters">
                {p.done}/{p.total} ready
              </span>
            </button>
          )
        })}
      </aside>
      <main className="pub-main">
        {open ? (
          <div className="pub-main-inner">
            <VideoName key={open.id} id={open.id} name={open.name} />
            <PublishingDrafts videoId={open.id} />
          </div>
        ) : (
          loaded &&
          !adding && (
            <div className="pub-empty">
              <span aria-hidden>🎬</span>
              <p>Title options, the description, tags and chapters for each video, ready to copy into YouTube Studio.</p>
              <button className="btn btn-primary" onClick={() => setAdding(true)}>
                <Plus size={14} /> New video
              </button>
            </div>
          )
        )}
      </main>
    </div>
  )
}
