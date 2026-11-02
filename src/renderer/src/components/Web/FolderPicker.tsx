import { useEffect, useState } from 'react'
import { ArrowUp, ChevronRight, Folder, FolderPlus, HardDrive, Home, Loader2, Monitor, NotebookText, Download, FileText, Image, Music, Video, Cloud } from 'lucide-react'
import type { ExplorerEntry, ExplorerPlace } from '@shared/explorer'
import { notify } from '../../store/notify'

const PLACE_ICONS: Record<ExplorerPlace['kind'], typeof Folder> = {
  home: Home,
  desktop: Monitor,
  documents: FileText,
  downloads: Download,
  pictures: Image,
  music: Music,
  videos: Video,
  drive: HardDrive,
  google: Cloud,
  notes: NotebookText
}

/** The folder above `path` ('' at the top of a drive). */
function parentFolder(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (i <= 0) return trimmed.startsWith('/') && trimmed !== '' ? '/' : ''
  const up = trimmed.slice(0, i)
  return /^[A-Za-z]:$/.test(up) ? `${up}\\` : up
}

const nameOf = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path

/**
 * Picks a folder on the computer from inside Orbit, using the Files tab's own listing: your usual
 * places down the side, the folders in the one you're in, and a button to make a new one. No
 * Windows or Mac file window.
 */
export default function FolderPicker({ start, onPick, onCancel, pickLabel = 'Save here' }: { start: string; onPick: (folder: string) => void; onCancel?: () => void; pickLabel?: string }) {
  const [places, setPlaces] = useState<ExplorerPlace[]>([])
  const [dir, setDir] = useState(start)
  const [folders, setFolders] = useState<ExplorerEntry[] | null>(null)
  const [naming, setNaming] = useState<string | null>(null)

  useEffect(() => {
    void window.api.explorerPlaces().then(setPlaces).catch(() => setPlaces([]))
  }, [])

  useEffect(() => {
    let live = true
    setFolders(null)
    window.api
      .explorerList(dir)
      .then((list) => live && setFolders(list.filter((e) => e.isDir && !e.hidden).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))))
      .catch(() => live && setFolders([]))
    return () => {
      live = false
    }
  }, [dir])

  const makeFolder = async (): Promise<void> => {
    const name = naming?.trim()
    setNaming(null)
    if (!name) return
    try {
      setDir(await window.api.explorerCreate(dir, name, 'folder'))
    } catch (err) {
      notify(err)
    }
  }

  const up = parentFolder(dir)
  return (
    <div className="folder-picker" data-folder-picker>
      <div className="folder-picker-places">
        {places.map((p) => {
          const Icon = PLACE_ICONS[p.kind] ?? Folder
          return (
            <button type="button" key={p.id} className={p.path === dir ? 'on' : ''} onClick={() => setDir(p.path)} title={p.path}>
              <Icon size={14} /> {p.label}
            </button>
          )
        })}
      </div>
      <div className="folder-picker-main">
        <div className="folder-picker-where">
          <button type="button" className="icon-btn" title="Up a folder" disabled={!up || up === dir} onClick={() => setDir(up)}>
            <ArrowUp size={14} />
          </button>
          {/* Long paths lose their start rather than their end (the folder you're in). */}
          <span title={dir}>
            <bdi>{dir}</bdi>
          </span>
          <button type="button" className="icon-btn" title="New folder" onClick={() => setNaming('')}>
            <FolderPlus size={14} />
          </button>
        </div>
        <div className="folder-picker-list">
          {naming !== null && (
            <form
              className="folder-picker-new"
              onSubmit={(e) => {
                e.preventDefault()
                void makeFolder()
              }}
            >
              <FolderPlus size={14} />
              <input autoFocus className="text-input" value={naming} placeholder="New folder name" onChange={(e) => setNaming(e.target.value)} onBlur={() => void makeFolder()} onKeyDown={(e) => e.key === 'Escape' && setNaming(null)} />
            </form>
          )}
          {folders === null ? (
            <p className="folder-picker-empty">
              <Loader2 size={14} className="spin" />
            </p>
          ) : folders.length === 0 && naming === null ? (
            <p className="folder-picker-empty">No folders in here.</p>
          ) : (
            folders.map((f) => (
              <button type="button" key={f.path} onClick={() => setDir(f.path)} onDoubleClick={() => onPick(f.path)}>
                <Folder size={14} /> <span>{f.name}</span> <ChevronRight size={13} className="folder-picker-go" />
              </button>
            ))
          )}
        </div>
        <div className="folder-picker-foot">
          {onCancel && (
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => onPick(dir)} data-folder-picker-pick>
            {pickLabel} ({nameOf(dir)})
          </button>
        </div>
      </div>
    </div>
  )
}
