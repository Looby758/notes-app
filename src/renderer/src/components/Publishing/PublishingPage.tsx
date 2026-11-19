import { useEffect, useState } from 'react'
import { Check, Pencil, Plus, Trash2, Upload, Video, X } from 'lucide-react'
import { deleteVideo, renameVideo, usePublishing, usePublishingOpen } from '../../store/publishing'
import { renameProject, selectProject, useVideos } from '../../store/videos'
import { draftsForProject, ensureVideoData, newVideoFromPublishing, publishingRows, type PublishingRow } from '../../store/videoLinks'
import { stageLabel, uploadDateOf } from '../../lib/videos'
import { openSpecialTab, VIDEOS_TAB } from '../../lib/editorController'
import { chosenThumbnailCard, chosenTitleText, draftProgress, isYouTubePlaceholder, youTubeThumbnailUrls, type VideoDraft } from '../../lib/publishing'
import { vaultUrl } from '../../lib/fileKinds'
import { UNDO_KEY } from '../../lib/undo'
import { formatDate } from '../../lib/dates'
import { notify } from '../../store/notify'
import PublishingDrafts from './PublishingDrafts'
import './publishing.css'

/**
 * Once a video is up and has its link, its thumbnail from YouTube; if YouTube can't be reached
 * (offline) or doesn't have one, the picture starred on its thumbnail board.
 */
function VideoThumb({ v }: { v: VideoDraft }) {
  const fromYouTube = v.uploaded?.url ? youTubeThumbnailUrls(v.uploaded.url) : []
  const starred = chosenThumbnailCard(v)?.file
  const sources = [...fromYouTube, ...(starred ? [vaultUrl(starred)] : [])]
  const [i, setI] = useState(0)
  if (!v.uploaded?.url || i >= sources.length) return null
  const youTube = i < fromYouTube.length
  return (
    <span className="pub-list-thumb" data-pub-list-thumb={youTube ? 'youtube' : 'starred'}>
      <img
        src={sources[i]}
        alt=""
        draggable={false}
        referrerPolicy="no-referrer"
        onLoad={(e) => youTube && isYouTubePlaceholder(e.currentTarget.naturalWidth) && setI(i + 1)}
        onError={() => setI(i + 1)}
      />
    </span>
  )
}

function NewVideo({ onMade, onClose }: { onMade: (id: string) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const make = (): void => {
    if (!name.trim()) return notify('Give the video a working name first.', 'info')
    void newVideoFromPublishing(name.trim()).then(onMade, notify)
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

const day = (key: string): string => formatDate(new Date(`${key}T12:00`), 'D MMM')

/** The line under a video in the list: how far through the checklist it is, or when it went up. */
function rowStatus({ project, draft }: PublishingRow): { text: string; tone: '' | 'ready' | 'up' } {
  if (draft?.uploaded) return { text: `Uploaded ${day(draft.uploaded.on)}`, tone: 'up' }
  const upDay = project && uploadDateOf(project)
  if (project?.stage === 'uploaded') return { text: upDay ? `Uploaded ${day(upDay)}` : 'Uploaded', tone: 'up' }
  if (!draft) return { text: project ? `${stageLabel(project.stage)} · not started here yet` : '', tone: '' }
  const p = draftProgress(draft)
  return p.done === p.total ? { text: 'Ready to upload', tone: 'ready' } : { text: `${p.done}/${p.total} steps done`, tone: '' }
}

function openInVideos(id: string): void {
  selectProject(id)
  openSpecialTab(VIDEOS_TAB)
}

function VideoName({ id, name, isProject }: { id: string; name: string; isProject: boolean }) {
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
          const to = e.target.value.trim()
          if (to && to !== name) (isProject ? renameProject : renameVideo)(id, to)
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
      {isProject ? (
        <button className="link-button" onClick={() => openInVideos(id)} title="Its script, research, pictures, stage and upload date" data-pub-open-project>
          <Video size={13} /> Open its video project
        </button>
      ) : confirming ? (
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

const setOpenId = (id: string): void => usePublishingOpen.setState({ id })

/**
 * Publishing: getting each video ready for YouTube. The list is your video projects (a video made
 * here is a project too, so it's on the Videos board), plus any videos made here before the two
 * were joined.
 */
export default function PublishingPage() {
  const drafts = usePublishing((s) => s.videos)
  const projects = useVideos((s) => s.projects)
  const pubLoaded = usePublishing((s) => s.loaded)
  const videosLoaded = useVideos((s) => s.loaded)
  const loaded = pubLoaded && videosLoaded
  const openId = usePublishingOpen((s) => s.id)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    void ensureVideoData()
  }, [])

  const rows = publishingRows(projects, drafts)
  const open = rows.find((r) => r.id === openId) ?? rows[0]
  useEffect(() => {
    if (open && open.id !== openId) setOpenId(open.id)
    // A project opened here for the first time gets its (empty) drafts.
    if (loaded && open?.project && !open.draft) void draftsForProject(open.id)
  }, [open?.id, open?.draft, loaded])

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
        {rows.map((r) => {
          const status = rowStatus(r)
          return (
            <button key={r.id} className={`pub-list-item ${open?.id === r.id ? 'on' : ''}`} onClick={() => setOpenId(r.id)} data-pub-video={r.id}>
              {r.draft && <VideoThumb key={`${r.draft.uploaded?.url ?? ''}|${r.draft.chosenThumbnail ?? ''}`} v={r.draft} />}
              <span className="pub-list-name">{r.name}</span>
              <span className="pub-list-sub">{(r.draft && chosenTitleText(r.draft)) || 'No title yet'}</span>
              <span className={`pub-list-progress ${status.tone}`} title="How far through the upload checklist">
                {status.text}
              </span>
            </button>
          )
        })}
      </aside>
      <main className="pub-main">
        {open ? (
          <div className="pub-main-inner">
            <VideoName key={open.id} id={open.id} name={open.name} isProject={!!open.project} />
            {open.draft && <PublishingDrafts videoId={open.id} />}
          </div>
        ) : (
          loaded &&
          !adding && (
            <div className="pub-empty">
              <span aria-hidden>🎬</span>
              <p>Title options, a thumbnail board, the description, tags and chapters for each video, ready to copy into YouTube Studio, and a checklist to go through before it goes up.</p>
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
