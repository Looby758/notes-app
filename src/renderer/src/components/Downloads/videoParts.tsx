import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Download, Folder, FolderPlus, Loader2 } from 'lucide-react'
import type { FileNode, VideoDownloaderState } from '@shared/types'
import { useVault } from '../../store/vault'
import { fuzzyFilter } from '../../lib/fuzzy'

/**
 * The video downloader's pieces used by the Downloads page: setting up yt-dlp and ffmpeg (once),
 * and picking a folder in the notes folder for a video. The downloading is in main/videoDownload.ts.
 */

const percent = (n: number | undefined): string => (n === undefined ? '' : ` ${Math.round(n * 100)}%`)

export function SetupBox({ setup, onGet }: { setup: VideoDownloaderState; onGet: () => void }) {
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
export function SaveTo({ folder, onPick }: { folder: string; onPick: (f: string) => void }) {
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
