import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, Inbox, CalendarDays, Check, Columns3, LayoutGrid, FileText, FolderOpen, Image as ImageIcon, Lightbulb, Link2, Mic, NotebookPen, Plus, Trash2, Upload, Video, X } from 'lucide-react'
import type { FileNode } from '@shared/types'
import { useVault } from '../../store/vault'
import { usePrefs } from '../../store/prefs'
import { notify } from '../../store/notify'
import {
  addItems,
  addThumbnailText,
  addIdea,
  deleteIdea,
  promoteIdea,
  updateIdea,
  createProject,
  deleteProject,
  ensureVideos,
  folderForProject,
  removeItem,
  renameProject,
  selectProject,
  setScript,
  setStage,
  setSummary,
  setUploadDate,
  useVideos
} from '../../store/videos'
import { boardColumns, fitsSection, projectCounts, stageLabel, uploadDateOf, VIDEO_STAGES, type VideoIdea, type VideoItem, type VideoItemKind, type VideoProject, type VideoStage } from '../../lib/videos'
import { fileKind, openAttachment, vaultUrl } from '../../lib/fileKinds'
import { openNote, openSpecialTab, PUBLISHING_TAB, SETTINGS_TAB } from '../../lib/editorController'
import { usePublishing, usePublishingOpen } from '../../store/publishing'
import { draftsForProject } from '../../store/videoLinks'
import { chosenTitleText, draftProgress } from '../../lib/publishing'
import { useUI } from '../../store/ui'
import { computerFiles, getDrag } from '../../lib/dnd'
import { noteTitle } from '../../lib/paths'
import { fuzzyFilter } from '../../lib/fuzzy'
import { dayKey, formatDate, fromDayKey } from '../../lib/dates'
import { UNDO_KEY } from '../../lib/undo'
import Private from '../Streamer/Private'

type Section = VideoItemKind | 'script'

/** Every note and file path in the notes folder. */
function allFiles(nodes: FileNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === 'folder') allFiles(n.children ?? [], out)
    else out.push(n.path)
  }
  return out
}

function useFileSet(): { list: string[]; has: (p: string) => boolean } {
  const tree = useVault((s) => s.tree)
  return useMemo(() => {
    const list = allFiles(tree)
    const set = new Set(list)
    // Before the tree has loaded, assume everything is there.
    return { list, has: (p: string) => !list.length || set.has(p) }
  }, [tree])
}

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const shown = (path: string): string => (/\.md$/i.test(path) ? noteTitle(path) : fileName(path))

const openPath = (path: string): void => (/\.md$/i.test(path) ? openNote(path) : openAttachment(path))

/** A note name in `folder` that isn't taken: "Research", then "Research 2"… */
function freeNotePath(folder: string, name: string, taken: string[]): string {
  const used = new Set(taken.map((t) => t.toLowerCase()))
  for (let n = 1; ; n++) {
    const path = `${folder}/${n === 1 ? name : `${name} ${n}`}.md`
    if (!used.has(path.toLowerCase())) return path
  }
}

// ---------- the page ----------

export default function VideosPage() {
  const loaded = useVideos((s) => s.loaded)
  const selected = useVideos((s) => s.selected)
  const project = useVideos((s) => s.projects.find((p) => p.id === s.selected))
  useEffect(() => {
    void ensureVideos()
  }, [])
  // A project deleted elsewhere (or undone away): back to the list.
  useEffect(() => {
    if (loaded && selected && !project) selectProject(null)
  }, [loaded, selected, project])
  return <div className="videos-page">{project ? <ProjectView project={project} /> : <ProjectList />}</div>
}

function ProjectList() {
  const projects = useVideos((s) => s.projects)
  const loaded = useVideos((s) => s.loaded)
  const videosFolder = usePrefs((s) => s.prefs.videosFolder)
  const [adding, setAdding] = useState(false)
  const [view, setViewState] = useState<ListView>(savedView)
  const setView = (v: ListView): void => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // only a convenience
    }
  }
  const board = view === 'board' && projects.length > 0
  return (
    <div className={`videos-inner ${board ? 'videos-inner-wide' : ''}`}>
      <div className="videos-head">
        <h2>
          <Video size={20} /> Videos
        </h2>
        {projects.length > 0 && (
          <div className="videos-head-actions">
            <div className="videos-view" role="radiogroup" aria-label="Show videos as">
              <button role="radio" aria-checked={view === 'board'} className={view === 'board' ? 'on' : ''} onClick={() => setView('board')} data-video-view="board">
                <Columns3 size={14} /> Pipeline
              </button>
              <button role="radio" aria-checked={view === 'cards'} className={view === 'cards' ? 'on' : ''} onClick={() => setView('cards')} data-video-view="cards">
                <LayoutGrid size={14} /> Cards
              </button>
            </div>
            {!adding && (
              <button className="btn btn-primary" onClick={() => setAdding(true)} data-video-new>
                <Plus size={14} /> New video
              </button>
            )}
          </div>
        )}
      </div>
      <p className="videos-intro">
        Each video gets one place for its script, research notes, pictures, recordings and thumbnail ideas. New script and research notes go in a folder for each video inside <strong>{videosFolder || 'the top of your notes'}</strong>.{' '}
        <button
          className="link-button"
          onClick={() => {
            openSpecialTab(SETTINGS_TAB)
            useUI.setState({ settingsSection: 'files' })
          }}
          data-video-folder-setting
        >
          Change
        </button>
      </p>
      {adding && <NewProjectForm onClose={() => setAdding(false)} />}
      {loaded && <IdeaInbox />}
      {loaded && !projects.length && !adding ? (
        <div className="videos-empty">
          <span aria-hidden>🎬</span>
          <p>No video projects yet.</p>
          <button className="btn btn-primary" onClick={() => setAdding(true)} data-video-new>
            <Plus size={14} /> Start your first video
          </button>
        </div>
      ) : board ? (
        <PipelineBoard projects={projects} />
      ) : (
        <div className="videos-grid">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- the idea inbox ----------

const INBOX_KEY = 'videosInboxOpen'

/** "just now", "3 days ago", "12 Oct". */
function agoText(ms: number): string {
  const mins = (Date.now() - ms) / 60000
  if (mins < 1) return 'just now'
  if (mins < 60) return `${Math.floor(mins)} min ago`
  const hours = mins / 60
  if (hours < 24) return `${Math.floor(hours)} h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return days === 1 ? 'yesterday' : `${days} days ago`
  const d = new Date(ms)
  return formatDate(d, d.getFullYear() === new Date().getFullYear() ? 'D MMM' : 'D MMM YYYY')
}

/** Quick-capture ideas for future videos; one click turns an idea into a project. */
function IdeaInbox() {
  const ideas = useVideos((s) => s.ideas)
  const focus = useVideos((s) => s.ideaFocus)
  const [text, setText] = useState('')
  const [open, setOpenState] = useState(() => {
    try {
      return localStorage.getItem(INBOX_KEY) !== 'closed'
    } catch {
      return true
    }
  })
  const setOpen = (on: boolean): void => {
    setOpenState(on)
    try {
      localStorage.setItem(INBOX_KEY, on ? 'open' : 'closed')
    } catch {
      // only a convenience
    }
  }
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!focus) return
    setOpenState(true)
    requestAnimationFrame(() => box.current?.focus())
  }, [focus])
  const add = (): void => {
    if (addIdea(text)) setText('')
  }
  return (
    <section className={`video-inbox ${open ? 'open' : ''}`} data-video-inbox>
      <button className="video-inbox-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Inbox size={15} />
        <span>Idea inbox</span>
        {ideas.length > 0 && <span className="video-section-count">{ideas.length}</span>}
        <span className="video-inbox-tip">Jot ideas here, or type “video idea: …” in Ctrl+K or the summon bar</span>
        <ChevronDown size={14} className="video-inbox-chevron" />
      </button>
      {open && (
        <div className="video-inbox-body">
          <div className="video-inbox-add">
            <textarea
              ref={box}
              className="text-input"
              rows={Math.min(5, text.split('\n').length)}
              value={text}
              maxLength={1000}
              placeholder="An idea for a video, e.g. Was Negan right? (Enter adds it, Shift+Enter for another line)"
              aria-label="New video idea"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  add()
                }
              }}
              data-video-idea-text
            />
            <button className="btn" onClick={add} disabled={!text.trim()}>
              <Plus size={13} /> Add
            </button>
          </div>
          {ideas.length > 0 ? (
            <ul className="video-ideas">
              {ideas.map((i) => (
                <IdeaRow key={i.id} idea={i} />
              ))}
            </ul>
          ) : (
            <p className="video-inbox-empty">No ideas waiting. When one comes to you, jot it here before it’s gone.</p>
          )}
        </div>
      )}
    </section>
  )
}

function IdeaRow({ idea }: { idea: VideoIdea }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(idea.text)
  useEffect(() => {
    if (!editing) setDraft(idea.text)
  }, [idea.text, editing])
  const [first, ...rest] = idea.text.split('\n')
  return (
    <li className="video-idea" data-video-idea={idea.id}>
      <Lightbulb size={14} className="video-idea-bulb" />
      {editing ? (
        <textarea
          className="text-input video-idea-edit"
          autoFocus
          rows={Math.min(5, draft.split('\n').length)}
          value={draft}
          maxLength={1000}
          aria-label="Edit idea"
          onChange={(e) => {
            setDraft(e.target.value)
            if (e.target.value.trim()) updateIdea(idea.id, e.target.value)
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            }
          }}
        />
      ) : (
        <button className="video-idea-text" onClick={() => setEditing(true)} title="Click to edit">
          <span className="video-idea-first">{first}</span>
          {rest.length > 0 && <span className="video-idea-rest">{rest.join(' ')}</span>}
        </button>
      )}
      <span className="video-idea-when">{agoText(idea.created)}</span>
      <button
        className="btn video-idea-promote"
        title="Make a video project from this idea (it starts at the Idea stage)"
        onClick={() => {
          const made = promoteIdea(idea.id)
          if (made) selectProject(made.id)
        }}
        data-video-idea-promote
      >
        <ArrowRight size={13} /> Make it a video
      </button>
      <button className="icon-btn" title={`Delete this idea (${UNDO_KEY} brings it back)`} onClick={() => deleteIdea(idea.id)}>
        <X size={13} />
      </button>
    </li>
  )
}

// ---------- the pipeline board ----------

type ListView = 'board' | 'cards'
const VIEW_KEY = 'videosView'
const savedView = (): ListView => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'board'
  } catch {
    return 'board'
  }
}

/** The video being dragged across the board (drop targets can't read drag data until the drop). */
let draggingVideo: string | null = null

/** "Fri 5 Dec", with the year if it isn't this one. */
function dayText(date: string): string {
  const d = fromDayKey(date)
  if (!d) return date
  return formatDate(d, d.getFullYear() === new Date().getFullYear() ? 'ddd D MMM' : 'ddd D MMM YYYY')
}

function UploadChip({ project: p }: { project: VideoProject }) {
  const date = uploadDateOf(p)
  if (!date) return null
  const today = dayKey(new Date())
  const late = p.stage !== 'uploaded' && date < today
  return (
    <span className={`video-upload-chip ${late ? 'late' : ''} ${p.stage === 'uploaded' ? 'done' : ''}`} title={p.stage === 'uploaded' ? 'Went up on YouTube' : late ? 'The planned upload day has passed' : 'Planned upload day'}>
      <CalendarDays size={11} /> {p.stage === 'uploaded' ? 'Up ' : ''}
      {date === today ? 'Today' : dayText(date)}
    </span>
  )
}

function PipelineBoard({ projects }: { projects: VideoProject[] }) {
  const columns = boardColumns(projects)
  const [over, setOver] = useState<VideoStage | null>(null)
  return (
    <div className="video-board" data-video-board>
      {columns.map((col, i) => (
        <section
          key={col.stage}
          className={`video-column stage-${col.stage} ${over === col.stage ? 'drop-over' : ''}`}
          data-video-column={col.stage}
          onDragOver={(e) => {
            if (!draggingVideo) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            if (over !== col.stage) setOver(col.stage)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setOver(null)
            if (draggingVideo) setStage(draggingVideo, col.stage)
            draggingVideo = null
          }}
        >
          <h3>
            <span className="video-column-step">{i + 1}</span> {col.label}
            {col.projects.length > 0 && <span className="video-section-count">{col.projects.length}</span>}
          </h3>
          <div className="video-column-cards">
            {col.projects.map((p) => (
              <BoardCard key={p.id} project={p} />
            ))}
            {!col.projects.length && <div className="video-column-empty">Drag a video here</div>}
          </div>
        </section>
      ))}
    </div>
  )
}

function BoardCard({ project: p }: { project: VideoProject }) {
  const files = useFileSet()
  const cover = p.items.find((i) => i.kind === 'thumbnail' && i.path) ?? p.items.find((i) => i.kind === 'image' && i.path)
  const at = VIDEO_STAGES.findIndex((s) => s.id === p.stage)
  const step = (dir: 1 | -1): void => {
    const next = VIDEO_STAGES[at + dir]
    if (next) setStage(p.id, next.id)
  }
  return (
    <div
      className="video-board-card"
      draggable
      tabIndex={0}
      role="button"
      title={`${p.title || 'Untitled video'}\nAlt+← / Alt+→ moves it along`}
      data-video-board-card={p.id}
      onDragStart={(e) => {
        draggingVideo = p.id
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', p.title)
      }}
      onDragEnd={() => (draggingVideo = null)}
      onClick={() => selectProject(p.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') selectProject(p.id)
        if (e.altKey && e.key === 'ArrowRight') step(1)
        if (e.altKey && e.key === 'ArrowLeft') step(-1)
      }}
    >
      {cover?.path && files.has(cover.path) && <img className="video-board-cover" src={vaultUrl(cover.path)} alt="" loading="lazy" draggable={false} />}
      <div className="video-board-title">
        <Private>{p.title || 'Untitled video'}</Private>
      </div>
      <div className="video-board-meta">
        <UploadChip project={p} />
        {p.script && <span className="video-board-script">Script ✓</span>}
      </div>
    </div>
  )
}

/** Where a video is in the pipeline, and when it goes up: on the video's own page. */
function StageAndDate({ project: p }: { project: VideoProject }) {
  const date = uploadDateOf(p)
  return (
    <div className="video-stage-row">
      <div className="video-stages" role="radiogroup" aria-label="Where this video is">
        {VIDEO_STAGES.map((s, i) => {
          const at = VIDEO_STAGES.findIndex((x) => x.id === p.stage)
          return (
            <button key={s.id} role="radio" aria-checked={p.stage === s.id} className={`video-stage ${p.stage === s.id ? 'on' : ''} ${i < at ? 'past' : ''}`} onClick={() => setStage(p.id, s.id)} data-video-stage={s.id}>
              {i < at && <Check size={11} />}
              {s.label}
            </button>
          )
        })}
      </div>
      <label className="video-upload-date">
        <CalendarDays size={14} />
        <span>{p.stage === 'uploaded' ? 'Went up' : 'Upload on'}</span>
        <input type="date" value={date ?? ''} onChange={(e) => setUploadDate(p.id, e.target.value || null)} aria-label={p.stage === 'uploaded' ? 'Day it went up' : 'Planned upload day'} data-video-upload-date />
        {date && (
          <button className="icon-btn" title="Clear the date" onClick={() => setUploadDate(p.id, null)}>
            <X size={12} />
          </button>
        )}
      </label>
    </div>
  )
}

/** The video's titles, thumbnail board, description and upload checklist, on the Publishing page. */
function PublishingLink({ project: p }: { project: VideoProject }) {
  const draft = usePublishing((s) => s.videos.find((v) => v.id === p.id))
  const progress = draft && draftProgress(draft)
  const title = draft && chosenTitleText(draft)
  const open = async (): Promise<void> => {
    await draftsForProject(p.id)
    usePublishingOpen.setState({ id: p.id })
    openSpecialTab(PUBLISHING_TAB)
  }
  return (
    <div className="video-publishing" data-video-publishing>
      <Upload size={15} />
      <span className="video-publishing-text">
        <strong>Publishing</strong>
        <span>
          {!draft || !progress
            ? 'Title options, thumbnail board, description, tags, chapters and the upload checklist'
            : draft.uploaded
              ? `Uploaded ${formatDate(new Date(`${draft.uploaded.on}T12:00`), 'D MMM')}`
              : `${title ? `“${title}” · ` : ''}${progress.done}/${progress.total} checklist steps done`}
        </span>
      </span>
      <button className="btn" onClick={() => void open().catch(notify)} data-video-open-publishing>
        Open in Publishing <ArrowRight size={13} />
      </button>
    </div>
  )
}

function NewProjectForm({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('')
  const submit = (): void => {
    if (!title.trim()) return notify('Give the video a working title first, e.g. “The life of Maggie Rhee”.', 'info')
    const made = createProject(title)
    onClose()
    selectProject(made.id)
  }
  return (
    <div className="videos-new" data-video-form>
      <input
        className="text-input"
        autoFocus
        value={title}
        maxLength={120}
        placeholder="Working title, e.g. The life of Maggie Rhee"
        aria-label="Video title"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') onClose()
        }}
      />
      <button className="btn btn-primary" onClick={submit}>
        Make it
      </button>
      <button className="btn" onClick={onClose}>
        Cancel
      </button>
    </div>
  )
}

function ProjectCard({ project: p }: { project: VideoProject }) {
  const counts = projectCounts(p)
  const cover = p.items.find((i) => i.kind === 'thumbnail' && i.path) ?? p.items.find((i) => i.kind === 'image' && i.path)
  const files = useFileSet()
  const bits = [
    counts.research && `${counts.research} research`,
    counts.image && `${counts.image} ${counts.image === 1 ? 'picture' : 'pictures'}`,
    counts.recording && `${counts.recording} ${counts.recording === 1 ? 'recording' : 'recordings'}`,
    counts.thumbnail && `${counts.thumbnail} thumbnail ${counts.thumbnail === 1 ? 'idea' : 'ideas'}`
  ].filter(Boolean)
  return (
    <button className="video-card" onClick={() => selectProject(p.id)} data-video-card={p.id}>
      <div className="video-card-cover">{cover?.path && files.has(cover.path) ? <img src={vaultUrl(cover.path)} alt="" loading="lazy" /> : <Video size={28} />}</div>
      <div className="video-card-body">
        <div className="video-card-title">
          <Private>{p.title || 'Untitled video'}</Private>
        </div>
        {p.summary && <div className="video-card-summary">{p.summary}</div>}
        <div className="video-card-meta">
          <span className="video-card-stage">{stageLabel(p.stage)}</span>
          <UploadChip project={p} />
          <span className={p.script ? 'has' : ''}>{p.script ? 'Script ✓' : 'No script yet'}</span>
          {bits.length > 0 && <span>{bits.join(' · ')}</span>}
        </div>
      </div>
    </button>
  )
}

// ---------- one project ----------

function ProjectView({ project: p }: { project: VideoProject }) {
  const files = useFileSet()
  const [picking, setPicking] = useState<Section | null>(null)
  const [title, setTitle] = useState(p.title)
  const [summary, setSummaryText] = useState(p.summary)
  // Follow undo/redo (and other changes) while not typing in the box.
  const titleBox = useRef<HTMLInputElement>(null)
  const summaryBox = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (document.activeElement !== titleBox.current) setTitle(p.title)
  }, [p.title])
  useEffect(() => {
    if (document.activeElement !== summaryBox.current) setSummaryText(p.summary)
  }, [p.summary])

  const items = (kind: VideoItemKind): VideoItem[] => p.items.filter((i) => i.kind === kind)

  const newNote = async (kind: 'script' | 'research'): Promise<void> => {
    const folder = folderForProject(p)
    const path = freeNotePath(folder, kind === 'script' ? 'Script' : 'Research', files.list)
    const heading = kind === 'script' ? `# ${p.title || 'Script'}\n\n` : `# Research: ${p.title || 'video'}\n\n`
    const made = await useVault.getState().createNoteAt(path, heading, heading.length)
    if (!made) return
    if (kind === 'script') setScript(p.id, made)
    else addItems(p.id, 'research', [made])
  }

  const fromComputer = async (kind: VideoItemKind): Promise<void> => {
    try {
      const saved = await window.api.pickAttachment(usePrefs.getState().prefs.attachmentFolder, kind !== 'recording')
      if (!saved.length) return
      void useVault.getState().refresh()
      const fit = saved.filter((s) => fitsSection(kind, s, fileKind))
      if (fit.length < saved.length) notify(kind === 'recording' ? 'Only sound and video files go in Recordings; the others were saved to your attachments.' : 'Only pictures go here; the others were saved to your attachments.', 'info')
      addItems(p.id, kind, fit)
    } catch (err) {
      notify(err)
    }
  }

  const remove = (item: VideoItem): void => {
    removeItem(p.id, item.id)
    notify(`Taken out of this video (the file is still in your notes). ${UNDO_KEY} puts it back.`, 'info')
  }

  return (
    <div className="videos-inner video-project" data-video-project={p.id}>
      <div className="video-project-top">
        <button className="btn" onClick={() => selectProject(null)} data-video-back>
          <ArrowLeft size={14} /> All videos
        </button>
        <span className="video-project-dates">Started {formatDate(new Date(p.created), 'D MMM YYYY')}</span>
        <button
          className="icon-btn danger"
          title="Delete this video project (its notes and files stay in your notes)"
          onClick={() => {
            deleteProject(p.id)
            notify(`Deleted the video project. Its notes and files are still in your notes. ${UNDO_KEY} brings it back.`, 'info')
          }}
          data-video-delete
        >
          <Trash2 size={15} />
        </button>
      </div>
      <input
        ref={titleBox}
        className="video-title-input"
        value={title}
        maxLength={120}
        placeholder="Untitled video"
        aria-label="Video title"
        onChange={(e) => {
          setTitle(e.target.value)
          renameProject(p.id, e.target.value)
        }}
      />
      <textarea
        ref={summaryBox}
        className="video-summary-input"
        value={summary}
        rows={2}
        maxLength={2000}
        placeholder="What’s this video about? A line or two."
        aria-label="What the video is about"
        onChange={(e) => {
          setSummaryText(e.target.value)
          setSummary(p.id, e.target.value)
        }}
      />

      <StageAndDate project={p} />
      <PublishingLink project={p} />

      <DropSection project={p} kind="script" icon={<NotebookPen size={15} />} title="Script" hint="Drop a note here">
        {p.script ? (
          <ItemRow path={p.script} missing={!files.has(p.script)} onRemove={() => setScript(p.id, null)} removeTitle="Unlink the script (the note stays)" />
        ) : (
          <div className="video-actions">
            <button className="btn btn-primary" onClick={() => void newNote('script')} data-video-new-script>
              <Plus size={13} /> Start a script note
            </button>
            <button className="btn" onClick={() => setPicking('script')}>
              <Link2 size={13} /> Use a note you have
            </button>
          </div>
        )}
      </DropSection>

      <DropSection project={p} kind="research" icon={<FileText size={15} />} title="Research notes" count={items('research').length} hint="Drop notes here">
        {items('research').map((i) => (
          <ItemRow key={i.id} path={i.path!} missing={!files.has(i.path!)} onRemove={() => remove(i)} />
        ))}
        <div className="video-actions">
          <button className="btn" onClick={() => void newNote('research')} data-video-new-research>
            <Plus size={13} /> New research note
          </button>
          <button className="btn" onClick={() => setPicking('research')}>
            <Link2 size={13} /> Add notes you have
          </button>
        </div>
      </DropSection>

      <DropSection project={p} kind="image" icon={<ImageIcon size={15} />} title="Pictures" count={items('image').length} hint="Drop pictures here">
        <PictureGrid items={items('image')} has={files.has} onRemove={remove} />
        <div className="video-actions">
          <button className="btn" onClick={() => setPicking('image')}>
            <FolderOpen size={13} /> From your notes
          </button>
          <button className="btn" onClick={() => void fromComputer('image')}>
            <Upload size={13} /> From the computer
          </button>
        </div>
      </DropSection>

      <DropSection project={p} kind="recording" icon={<Mic size={15} />} title="Recordings" count={items('recording').length} hint="Drop recordings here">
        {items('recording').map((i) => (
          <ItemRow key={i.id} path={i.path!} missing={!files.has(i.path!)} onRemove={() => remove(i)} />
        ))}
        <div className="video-actions">
          <button className="btn" onClick={() => setPicking('recording')}>
            <FolderOpen size={13} /> From your notes
          </button>
          <button className="btn" onClick={() => void fromComputer('recording')}>
            <Upload size={13} /> From the computer
          </button>
        </div>
      </DropSection>

      <DropSection project={p} kind="thumbnail" icon={<Lightbulb size={15} />} title="Thumbnail ideas" count={items('thumbnail').length} hint="Drop pictures here">
        <PictureGrid items={items('thumbnail')} has={files.has} onRemove={remove} />
        <ThumbnailText project={p} />
        <div className="video-actions">
          <button className="btn" onClick={() => setPicking('thumbnail')}>
            <FolderOpen size={13} /> Picture from your notes
          </button>
          <button className="btn" onClick={() => void fromComputer('thumbnail')}>
            <Upload size={13} /> From the computer
          </button>
        </div>
      </DropSection>

      {picking && (
        <FilePicker
          kind={picking}
          files={files.list}
          already={picking === 'script' ? [] : items(picking).map((i) => i.path!)}
          onPick={(paths) => {
            setPicking(null)
            if (picking === 'script') setScript(p.id, paths[0])
            else addItems(p.id, picking, paths)
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}

/** A section of a project that notes or files can be dropped on (from the notes list, the Files tab or the computer). */
function DropSection({ project, kind, icon, title, count, hint, children }: { project: VideoProject; kind: Section; icon: ReactNode; title: string; count?: number; hint: string; children: ReactNode }) {
  const [over, setOver] = useState(false)
  const accepts = (e: DragEvent): boolean => {
    const drag = getDrag()
    if (drag?.kind === 'note' || drag?.kind === 'file') return fitsSection(kind, drag.path, fileKind)
    if (kind === 'script' || kind === 'research') return false
    return computerFiles(drag).length > 0 || e.dataTransfer.types.includes('Files')
  }
  const drop = async (e: DragEvent): Promise<void> => {
    e.preventDefault()
    setOver(false)
    const drag = getDrag()
    const take = (paths: string[]): void => {
      if (kind === 'script') setScript(project.id, paths[0])
      else addItems(project.id, kind, paths)
    }
    if (drag?.kind === 'note' || drag?.kind === 'file') {
      if (fitsSection(kind, drag.path, fileKind)) take([drag.path])
      return
    }
    // From the Files tab or the computer: copied into your attachments folder first.
    const folder = usePrefs.getState().prefs.attachmentFolder
    const saved: string[] = []
    const fromFilesTab = computerFiles(drag)
    try {
      if (fromFilesTab.length) {
        for (const source of fromFilesTab) if (fitsSection(kind, source, fileKind)) saved.push(await window.api.attachFromComputer(folder, source))
      } else {
        for (const file of Array.from(e.dataTransfer.files)) {
          if (!fitsSection(kind, file.name, fileKind)) continue
          saved.push(await window.api.saveAttachment(folder, file.name, new Uint8Array(await file.arrayBuffer())))
        }
      }
    } catch (err) {
      notify(err)
    }
    if (saved.length) {
      void useVault.getState().refresh()
      take(saved)
    } else notify(kind === 'recording' ? 'Only sound and video files go in Recordings.' : 'Only pictures go here.', 'info')
  }
  return (
    <section
      className={`video-section ${over ? 'drop-over' : ''}`}
      data-video-section={kind}
      onDragOver={(e) => {
        if (!accepts(e)) return
        e.preventDefault()
        if (!over) setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
      }}
      onDrop={(e) => void drop(e)}
    >
      <h3>
        {icon} {title}
        {count ? <span className="video-section-count">{count}</span> : null}
        <span className="video-section-hint">{hint}</span>
      </h3>
      {children}
    </section>
  )
}

function ItemRow({ path, missing, onRemove, removeTitle = 'Take out of this video (the file stays in your notes)' }: { path: string; missing: boolean; onRemove: () => void; removeTitle?: string }) {
  const kind = /\.md$/i.test(path) ? 'note' : fileKind(path)
  return (
    <div className={`video-item ${missing ? 'missing' : ''}`}>
      <button className="video-item-open" onClick={() => !missing && openPath(path)} title={missing ? `Can’t find ${path} in your notes any more` : path} disabled={missing}>
        {kind === 'note' ? <FileText size={14} /> : kind === 'video' ? <Video size={14} /> : <Mic size={14} />}
        <span className="video-item-name">
          <Private>{shown(path)}</Private>
        </span>
        {missing && <span className="video-item-missing">missing</span>}
      </button>
      <button className="icon-btn" title={removeTitle} onClick={onRemove}>
        <X size={13} />
      </button>
    </div>
  )
}

function PictureGrid({ items, has, onRemove }: { items: VideoItem[]; has: (p: string) => boolean; onRemove: (i: VideoItem) => void }) {
  const pics = items.filter((i) => i.path)
  if (!pics.length) return null
  return (
    <div className="video-pictures">
      {pics.map((i) => (
        <div key={i.id} className={`video-picture ${has(i.path!) ? '' : 'missing'}`} title={i.path}>
          {has(i.path!) ? (
            <button className="video-picture-open" onClick={() => openAttachment(i.path!)}>
              <img src={vaultUrl(i.path!)} alt={fileName(i.path!)} loading="lazy" />
            </button>
          ) : (
            <span className="video-picture-gone">missing</span>
          )}
          <button className="icon-btn video-picture-remove" title="Take out of this video (the picture stays in your notes)" onClick={() => onRemove(i)}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

function ThumbnailText({ project: p }: { project: VideoProject }) {
  const [text, setText] = useState('')
  const ideas = p.items.filter((i) => i.kind === 'thumbnail' && i.text)
  const add = (): void => {
    if (!text.trim()) return
    addThumbnailText(p.id, text)
    setText('')
  }
  return (
    <>
      {ideas.length > 0 && (
        <ul className="video-thumb-ideas">
          {ideas.map((i) => (
            <li key={i.id}>
              <Lightbulb size={13} />
              <span>{i.text}</span>
              <button className="icon-btn" title="Remove this idea" onClick={() => removeItem(p.id, i.id)}>
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="video-thumb-add">
        <input
          className="text-input"
          value={text}
          maxLength={500}
          placeholder="Write an idea, e.g. Maggie close-up, red text “SHE WAS RIGHT”"
          aria-label="Thumbnail idea"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          data-video-thumb-text
        />
        <button className="btn" onClick={add} disabled={!text.trim()}>
          Add
        </button>
      </div>
    </>
  )
}

// ---------- picking notes and files ----------

const PICK_TEXT: Record<Section, string> = {
  script: 'Pick the script note…',
  research: 'Add research notes…',
  image: 'Add pictures…',
  recording: 'Add recordings…',
  thumbnail: 'Add a thumbnail picture…'
}

function FilePicker({ kind, files, already, onPick, onClose }: { kind: Section; files: string[]; already: string[]; onPick: (paths: string[]) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [chosen, setChosen] = useState<string[]>([])
  const many = kind !== 'script'
  const list = useMemo(() => {
    const have = new Set(already)
    const fit = files.filter((f) => !have.has(f) && fitsSection(kind, f, fileKind)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    return query.trim() ? fuzzyFilter(fit, query, (f) => f).map((r) => r.item) : fit
  }, [files, already, kind, query])
  const shownList = list.slice(0, 200)
  const toggle = (path: string): void => {
    if (!many) return onPick([path])
    setChosen((c) => (c.includes(path) ? c.filter((x) => x !== path) : [...c, path]))
  }
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal video-picker" onMouseDown={(e) => e.stopPropagation()} data-video-picker={kind}>
        <div className="picker">
          <div className="picker-input">
            {kind === 'image' || kind === 'thumbnail' ? <ImageIcon size={15} /> : kind === 'recording' ? <Mic size={15} /> : <FileText size={15} />}
            <input
              autoFocus
              value={query}
              placeholder={PICK_TEXT[kind]}
              onChange={(e) => {
                setQuery(e.target.value)
                setIndex(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose()
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setIndex((i) => Math.min(i + 1, shownList.length - 1))
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setIndex((i) => Math.max(i - 1, 0))
                }
                if (e.key === 'Enter') {
                  if ((e.ctrlKey || e.metaKey) && chosen.length) onPick(chosen)
                  else if (shownList[index]) toggle(shownList[index])
                }
              }}
            />
          </div>
          <div className="picker-list">
            {shownList.map((path, i) => (
              <button key={path} className={`picker-item ${i === index ? 'selected' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => toggle(path)}>
                {many && <input type="checkbox" readOnly checked={chosen.includes(path)} tabIndex={-1} />}
                {(kind === 'image' || kind === 'thumbnail') && <img className="video-picker-thumb" src={vaultUrl(path)} alt="" loading="lazy" />}
                <span className="picker-label">{shown(path)}</span>
                <span className="picker-detail">{path}</span>
              </button>
            ))}
            {!shownList.length && <div className="picker-empty">{query ? 'Nothing matches.' : kind === 'script' || kind === 'research' ? 'No notes to add.' : kind === 'recording' ? 'No sound or video files in your notes yet. Use “From the computer” instead.' : 'No pictures in your notes yet. Use “From the computer” instead.'}</div>}
          </div>
          {many && (
            <div className="video-picker-foot">
              <span>{chosen.length ? `${chosen.length} chosen` : 'Click to choose one or more'}</span>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={!chosen.length} onClick={() => onPick(chosen)}>
                Add
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
