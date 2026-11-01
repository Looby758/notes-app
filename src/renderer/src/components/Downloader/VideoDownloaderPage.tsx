import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, CloudDownload, Download, FileInput, Folder, FolderOpen, FolderPlus, Loader2, Music, Play, RotateCcw, Video, X } from 'lucide-react'
import type { FileNode, VideoDownload, VideoDownloaderState } from '@shared/types'
import { DOWNLOAD_QUALITIES, parseVideoLink, type DownloadQuality } from '@shared/videoDownload'
import { usePrefs } from '../../store/prefs'
import { useVault } from '../../store/vault'
import { fuzzyFilter } from '../../lib/fuzzy'
import { notify } from '../../store/notify'
import { openVaultVideo } from '../../store/videoPlayer'
import { insertIntoActiveNote, openFileTab } from '../../lib/editorController'
import { describeSize } from '../../lib/convert/formats'

/**
 * The video downloader tab: paste a link from YouTube, X, Instagram, TikTok and lots more, pick a
 * folder in the notes folder (the attachments folder to start with), and press Download. The downloading happens in main/videoDownload.ts, so
 * it carries on if this tab is closed.
 */

const STAGES: Record<VideoDownload['stage'], string> = {
  starting: 'Finding the video…',
  video: 'Downloading the picture',
  sound: 'Downloading the sound',
  joining: 'Putting it together…',
  saving: 'Saving…'
}

const percent = (n: number | undefined): string => (n === undefined ? '' : ` ${Math.round(n * 100)}%`)

function SetupBox({ setup, onGet }: { setup: VideoDownloaderState; onGet: () => void }) {
  if (setup.state === 'unsupported') return <div className="convert-ffmpeg">Downloading videos isn’t available on this kind of computer yet.</div>
  const busy = setup.state === 'downloading' || setup.ffmpeg === 'downloading'
  if (busy) {
    const p = setup.state === 'downloading' ? setup.progress : setup.ffmpegProgress
    return (
      <div className="convert-ffmpeg" data-vdl-setup>
        <span className="convert-working">
          <Loader2 size={14} className="spin" /> Setting up the downloader…{percent(p)}
        </span>
      </div>
    )
  }
  const needsTool = setup.state === 'missing'
  const needsFfmpeg = setup.ffmpeg === 'missing'
  if (!needsTool && !needsFfmpeg) return null
  return (
    <div className="convert-ffmpeg" data-vdl-setup>
      <span>
        {needsTool
          ? 'Orbit downloads videos with yt-dlp, a free downloader that keeps up with these sites, and ffmpeg to join HD picture and sound. It’s a one-time download of about 60 MB.'
          : 'For HD videos, Orbit needs ffmpeg to join the picture and sound (about 25 MB, once). Without it, videos come in lower quality.'}
        {setup.error && <small className="convert-ffmpeg-error">{setup.error}</small>}
      </span>
      <button className="btn btn-primary" onClick={onGet} data-vdl-get>
        <Download size={13} /> {needsTool ? 'Set up' : 'Get ffmpeg'}
      </button>
    </div>
  )
}

const FOLDER_KEY = 'orbit.videoDownloader.folder'

function folderList(nodes: FileNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type !== 'folder') continue
    out.push(n.path)
    folderList(n.children ?? [], out)
  }
  return out
}

const folderLabel = (f: string): string => f || 'Top level of your notes'

/**
 * "Save to": the folders in the notes folder, in a list inside Orbit (no system window). Typing a
 * name that isn't there offers to make it; the download makes the folder when it's saved.
 */
function SaveTo({ folder, onPick }: { folder: string; onPick: (f: string) => void }) {
  const tree = useVault((s) => s.tree)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const list = useMemo(() => ['', ...folderList(tree)], [tree])
  const typed = query.trim().replace(/^\/+|\/+$/g, '')
  const shown = typed ? fuzzyFilter(list.slice(1), typed, (f) => f).map((r) => r.item) : list
  const isNew = typed !== '' && !list.some((f) => f.toLowerCase() === typed.toLowerCase())

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [open])

  const pick = (f: string): void => {
    onPick(f)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="vdl-saveto" ref={box}>
      <span className="vdl-saveto-label">Save to</span>
      <button type="button" className="btn vdl-saveto-btn" onClick={() => setOpen(!open)} title={folderLabel(folder)} data-vdl-folder>
        <Folder size={13} /> <span>{folderLabel(folder)}</span> <ChevronDown size={13} />
      </button>
      {open && (
        <div className="vdl-saveto-menu" data-vdl-folder-menu>
          <input
            autoFocus
            className="text-input"
            placeholder="Find a folder, or type a new one…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              if (e.key === 'Enter') {
                e.preventDefault()
                if (shown[0] !== undefined) pick(shown[0])
                else if (isNew) pick(typed)
              }
            }}
          />
          <div className="bulk-folders">
            {isNew && (
              <button type="button" onClick={() => pick(typed)} data-vdl-new-folder>
                <FolderPlus size={14} /> Make a new folder “{typed}”
              </button>
            )}
            {shown.slice(0, 60).map((f) => (
              <button type="button" key={f || '/'} className={f === folder ? 'on' : ''} onClick={() => pick(f)} data-folder={f}>
                <Folder size={14} /> {folderLabel(f)}
                {f === folder && <Check size={13} className="vdl-saveto-check" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function VideoDownloaderPage() {
  const attachments = usePrefs((s) => s.prefs.attachmentFolder)
  // The last folder picked here is remembered; to start with it's the attachments folder.
  const [picked, setPicked] = useState<string | null>(() => localStorage.getItem(FOLDER_KEY))
  const folder = picked ?? attachments
  const pickFolder = (f: string): void => {
    setPicked(f)
    localStorage.setItem(FOLDER_KEY, f)
  }
  const [setup, setSetup] = useState<VideoDownloaderState | null>(null)
  const [list, setList] = useState<VideoDownload[]>([])
  const [link, setLink] = useState('')
  const [quality, setQuality] = useState<DownloadQuality>('1080')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.api.videoDownloaderState().then(setSetup)
    void window.api.videoDownloads().then(setList)
    const a = window.api.onVideoDownloaderState(setSetup)
    const b = window.api.onVideoDownloads(setList)
    input.current?.focus()
    return () => {
      a()
      b()
    }
  }, [])

  const start = (url = link, q = quality, where = folder): void => {
    if (!parseVideoLink(url)) {
      notify('That doesn’t look like a link. Copy the video’s address and paste it here.')
      return
    }
    window.api
      .downloadVideo({ url, quality: q, folder: where })
      .then(() => setLink(''))
      .catch(notify)
  }

  const get = (): void => void window.api.getVideoDownloader().then(setSetup).catch(notify)

  const insert = (path: string): void => {
    if (!insertIntoActiveNote(path)) notify('Open a note in the other side first, then try again.', 'info')
  }

  const open = (d: VideoDownload): void => {
    if (!d.path) return
    if (d.quality === 'audio') openFileTab(d.path)
    else openVaultVideo(d.path)
  }

  const ready = setup?.state === 'ready' || setup?.state === 'missing'

  return (
    <div className="convert-page" data-vdl-page>
      <div className="convert-inner">
        <h2>
          <CloudDownload size={18} /> Download a video
        </h2>
        <p className="convert-intro">
          Paste a link from YouTube, X, Instagram, TikTok, Reddit, Twitch and lots more, pick where it goes, and press Download. Only download videos you’re
          allowed to keep, for your own use. For sites that want you signed in (like Instagram), sign in once in an Orbit web tab.
        </p>

        <form
          className="vdl-form"
          onSubmit={(e) => {
            e.preventDefault()
            start()
          }}
        >
          <input
            ref={input}
            className="text-input vdl-link"
            placeholder="https://www.youtube.com/watch?v=…"
            value={link}
            spellCheck={false}
            onChange={(e) => setLink(e.target.value)}
            data-vdl-link
          />
          <select className="select" value={quality} onChange={(e) => setQuality(e.target.value as DownloadQuality)} data-vdl-quality>
            {DOWNLOAD_QUALITIES.map((q) => (
              <option key={q.id} value={q.id}>
                {q.label}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" type="submit" disabled={!ready || !link.trim()} data-vdl-start>
            <Download size={13} /> Download
          </button>
        </form>
        <SaveTo folder={folder} onPick={pickFolder} />

        {setup && <SetupBox setup={setup} onGet={get} />}

        {list.length > 0 && (
          <ul className="convert-list">
            {list.map((d) => (
              <li key={d.id} className={`convert-item ${d.status}`} data-vdl-item>
                {d.quality === 'audio' ? <Music size={16} className="convert-kind" /> : <Video size={16} className="convert-kind" />}
                <div className="convert-name">
                  <span title={d.url}>{d.title ?? d.url}</span>
                  <small>
                    {d.site}
                    {' · '}
                    {d.status === 'working' && STAGES[d.stage] + (d.stage === 'video' || d.stage === 'sound' ? percent(d.progress) : '')}
                    {d.status === 'done' && `Saved in ${d.path?.split('/').slice(0, -1).join('/') || 'your notes folder'}${d.size ? ` · ${describeSize(d.size)}` : ''}`}
                    {d.status === 'failed' && d.error}
                    {d.status === 'cancelled' && 'Stopped'}
                  </small>
                  {d.status === 'working' && (
                    <div className="vdl-progress" data-vdl-progress>
                      <div className="vdl-bar">
                        <div className={d.progress === undefined || d.stage === 'starting' ? 'vdl-bar-busy' : ''} style={{ width: d.progress === undefined || d.stage === 'starting' ? undefined : `${d.progress * 100}%` }} />
                      </div>
                      {d.progress !== undefined && d.stage !== 'starting' && <span className="vdl-percent">{Math.round(d.progress * 100)}%</span>}
                    </div>
                  )}
                </div>
                <div className="vdl-actions">
                  {d.status === 'working' && (
                    <button className="btn vdl-cancel" onClick={() => void window.api.cancelVideoDownload(d.id)} data-vdl-cancel>
                      <X size={13} /> Cancel
                    </button>
                  )}
                  {d.status === 'done' && d.path && (
                    <>
                      <button className="icon-btn" title={d.quality === 'audio' ? 'Play' : 'Watch in the video player'} onClick={() => open(d)} data-vdl-play>
                        <Play size={14} />
                      </button>
                      <button className="icon-btn" title="Put it in the note that's open" onClick={() => insert(d.path!)} data-vdl-insert>
                        <FileInput size={14} />
                      </button>
                      <button className="icon-btn" title="Show in folder" onClick={() => void window.api.reveal(d.path!).catch(notify)}>
                        <FolderOpen size={14} />
                      </button>
                      <Check size={14} className="vdl-done" />
                    </>
                  )}
                  {(d.status === 'failed' || d.status === 'cancelled') && (
                    <button
                      className="icon-btn"
                      title="Try again"
                      onClick={() => {
                        void window.api.forgetVideoDownload(d.id)
                        start(d.url, d.quality)
                      }}
                      data-vdl-retry
                    >
                      <RotateCcw size={14} />
                    </button>
                  )}
                  {d.status !== 'working' && (
                    <button className="icon-btn" title="Take off the list (the file stays)" onClick={() => void window.api.forgetVideoDownload(d.id)} data-vdl-remove>
                      <X size={14} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
