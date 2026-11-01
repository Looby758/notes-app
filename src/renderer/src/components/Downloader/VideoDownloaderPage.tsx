import { useEffect, useRef, useState } from 'react'
import { Check, CloudDownload, Download, FileInput, FolderOpen, Loader2, Music, Play, RotateCcw, Video, X } from 'lucide-react'
import type { VideoDownload, VideoDownloaderState } from '@shared/types'
import { DOWNLOAD_QUALITIES, parseVideoLink, type DownloadQuality } from '@shared/videoDownload'
import { usePrefs } from '../../store/prefs'
import { notify } from '../../store/notify'
import { openVaultVideo } from '../../store/videoPlayer'
import { insertIntoActiveNote, openFileTab } from '../../lib/editorController'
import { describeSize } from '../../lib/convert/formats'

/**
 * The video downloader tab: paste a link from YouTube, X, Instagram, TikTok and lots more, and the
 * video is saved into the attachments folder. The downloading happens in main/videoDownload.ts, so
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

export default function VideoDownloaderPage() {
  const folder = usePrefs((s) => s.prefs.attachmentFolder)
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

  const start = (url = link, q = quality): void => {
    if (!parseVideoLink(url)) {
      notify('That doesn’t look like a link. Copy the video’s address and paste it here.')
      return
    }
    window.api
      .downloadVideo({ url, quality: q, folder })
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
          Paste a link from YouTube, X, Instagram, TikTok, Reddit, Twitch and lots more, and the video is saved into your attachments folder. Only download videos you’re
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
            onPaste={(e) => {
              // Pasting a link into the empty box starts it straight away.
              const text = e.clipboardData.getData('text')
              if (!link && parseVideoLink(text) && setup?.state === 'ready') {
                e.preventDefault()
                start(text.trim())
              }
            }}
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
                    <div className="vdl-bar">
                      <div className={d.progress === undefined || d.stage === 'starting' ? 'vdl-bar-busy' : ''} style={{ width: d.progress === undefined || d.stage === 'starting' ? undefined : `${d.progress * 100}%` }} />
                    </div>
                  )}
                </div>
                <div className="vdl-actions">
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
                  <button
                    className="icon-btn"
                    title={d.status === 'working' ? 'Stop' : 'Take off the list (the file stays)'}
                    onClick={() => void (d.status === 'working' ? window.api.cancelVideoDownload(d.id) : window.api.forgetVideoDownload(d.id))}
                    data-vdl-remove
                  >
                    <X size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
