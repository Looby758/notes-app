import { useEffect, useState } from 'react'
import { Download, FolderOpen, Pause, Play, RotateCw, Trash2, X, ExternalLink } from 'lucide-react'
import { previewKind } from '@shared/explorer'
import { isComicBookFile } from '@shared/comics'
import { isVideoFile } from '@shared/videoPlayer'
import { isArchiveFile } from '@shared/archive'
import type { WebDownload } from '@shared/browser'
import { useBrowser } from '../../store/browser'
import { usePrefs } from '../../store/prefs'
import { notify } from '../../store/notify'
import { showInFiles } from '../../store/filesReveal'
import { queueVideo } from '../../store/videoPlayer'
import { shelveComicFile } from '../../store/comics'
import { describeSize } from '../../lib/convert/formats'
import { openWebTab } from '../../lib/editorController'
import FolderPicker from './FolderPicker'

/** Opens a finished download inside Orbit where it can (pictures, PDFs, videos, comics, zips…). */
export function openDownload(d: WebDownload): void {
  if (!d.path) return
  if (isVideoFile(d.name)) {
    queueVideo(d.path)
    notify('Added to the video player’s Up next.', 'info')
    return
  }
  if (isComicBookFile(d.name)) {
    void shelveComicFile(d.path)
    return
  }
  // Pictures, PDFs, sound, text and zips show in the Files tab's preview.
  if (previewKind(d.name) !== 'none' || isArchiveFile(d.name)) return showInFiles(d.path)
  window.api.explorerOpen(d.path, true).catch(notify)
}

const folderOf = (path: string): string => path.replace(/[\\/][^\\/]*$/, '')

/** "Save to": where a download goes, picked inside Orbit while it downloads. */
export function DownloadPrompt() {
  const downloads = useBrowser((s) => s.downloads)
  const asking = downloads.find((d) => d.asking && d.state !== 'cancelled' && d.state !== 'failed')
  const [start, setStart] = useState<string | null>(null)
  const [remember, setRemember] = useState(false)
  useEffect(() => {
    if (asking) void window.api.webDownloadFolder().then((f) => setStart(f.folder))
  }, [asking?.id])
  if (!asking || !start) return null
  return (
    <div className="download-prompt" data-download-prompt>
      <div className="download-prompt-head">
        <Download size={16} />
        <div>
          <strong title={asking.name}>{asking.name}</strong>
          <span>{progressText(asking)} · pick where it goes</span>
        </div>
        <button className="icon-btn" title="Cancel the download" onClick={() => void window.api.webDownloadCancel(asking.id)}>
          <X size={14} />
        </button>
      </div>
      <FolderPicker
        key={asking.id}
        start={start}
        onPick={(folder) => void window.api.webDownloadTo(asking.id, folder, remember).catch(notify)}
        onCancel={() => void window.api.webDownloadCancel(asking.id)}
        pickLabel="Save in"
      />
      <label className="download-prompt-remember">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Always save downloads in this folder (change it in Settings → Web browser)
      </label>
    </div>
  )
}

function progressText(d: WebDownload): string {
  if (d.state === 'done') return describeSize(d.received || d.total)
  if (d.state === 'failed') return 'Failed'
  if (d.state === 'cancelled') return 'Cancelled'
  const of = d.total ? ` of ${describeSize(d.total)}` : ''
  return `${d.state === 'paused' ? 'Paused · ' : ''}${describeSize(d.received)}${of}`
}

/** The recent downloads, with open and show-in-folder buttons that stay inside Orbit. */
export function DownloadsList() {
  const downloads = useBrowser((s) => s.downloads)
  const ask = usePrefs((s) => s.prefs.webAskDownloadFolder)
  if (!downloads.length) {
    return (
      <p className="web-panel-empty">
        Nothing downloaded yet. {ask ? 'Each download asks which folder it goes in.' : 'Downloads go straight to your downloads folder.'}
      </p>
    )
  }
  return (
    <>
      <div className="web-downloads" data-web-downloads>
        {downloads.map((d) => {
          const busy = d.state === 'downloading' || d.state === 'paused'
          const pct = d.total ? Math.min(100, Math.round((d.received / d.total) * 100)) : null
          return (
            <div key={d.id} className={`web-download ${d.state}`} data-download={d.state}>
              <div className="web-download-name">
                <strong title={d.path || d.name}>{d.name}</strong>
                <span>
                  {progressText(d)}
                  {d.state === 'done' && d.path ? ` · ${folderOf(d.path)}` : d.asking ? ' · waiting for a folder' : ''}
                </span>
                {busy && (
                  <div className="web-download-bar">
                    <div style={{ width: pct === null ? '35%' : `${pct}%` }} className={pct === null ? 'unknown' : ''} />
                  </div>
                )}
              </div>
              <div className="web-download-actions">
                {d.state === 'done' && (
                  <>
                    <button className="icon-btn" title="Open (inside Orbit where it can)" onClick={() => openDownload(d)}>
                      <ExternalLink size={14} />
                    </button>
                    <button className="icon-btn" title="Show in folder (the Files tab)" onClick={() => showInFiles(d.path)}>
                      <FolderOpen size={14} />
                    </button>
                  </>
                )}
                {busy && (
                  <button className="icon-btn" title={d.state === 'paused' ? 'Carry on' : 'Pause'} onClick={() => void window.api.webDownloadPause(d.id, d.state !== 'paused')}>
                    {d.state === 'paused' ? <Play size={14} /> : <Pause size={14} />}
                  </button>
                )}
                {(d.state === 'failed' || d.state === 'cancelled') && (
                  <button className="icon-btn" title="Download again" onClick={() => openWebTab(d.url)}>
                    <RotateCw size={14} />
                  </button>
                )}
                <button className="icon-btn" title={busy ? 'Cancel' : 'Take off the list (the file stays)'} onClick={() => void (busy ? window.api.webDownloadCancel(d.id) : window.api.webDownloadForget(d.id))}>
                  {busy ? <X size={14} /> : <Trash2 size={13} />}
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <button className="btn web-panel-foot" onClick={() => void window.api.webDownloadsClear()}>
        Clear the list
      </button>
    </>
  )
}
