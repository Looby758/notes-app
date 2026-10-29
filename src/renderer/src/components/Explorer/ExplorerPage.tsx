import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  File,
  FileText,
  Film,
  Folder,
  FolderOpen,
  FolderSearch,
  HardDrive,
  House,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Loader2,
  Monitor,
  Music,
  NotebookPen,
  RefreshCw,
  Search
} from 'lucide-react'
import {
  crumbsOf,
  describeBytes,
  describeModified,
  explorerUrl,
  filterEntries,
  parentPath,
  previewKind,
  sortEntries,
  type ExplorerEntry,
  type ExplorerPlace,
  type ExplorerSort
} from '@shared/explorer'
import { FILE_MANAGER } from '@shared/platform'
import { setDrag } from '../../lib/dnd'
import { openFileTab, openNote } from '../../lib/editorController'
import { fileKind } from '../../lib/fileKinds'
import { notify } from '../../store/notify'
import FileIcon from '../FileIcon'

const PLACE_ICONS: Record<ExplorerPlace['kind'], typeof Folder> = {
  home: House,
  desktop: Monitor,
  documents: FileText,
  downloads: Download,
  pictures: ImageIcon,
  music: Music,
  videos: Film,
  google: Cloud,
  notes: NotebookPen,
  drive: HardDrive
}

/** Big folders are drawn this many at a time (typing in the search box narrows them). */
const MAX_SHOWN = 2000

/** Where you were and how you liked it, kept while the app is open. */
const last: { dir: string | null; view: 'list' | 'grid'; sort: ExplorerSort; showHidden: boolean } = {
  dir: null,
  view: 'list',
  sort: 'name',
  showHidden: false
}

/** The file explorer: browse every folder on the computer (and Google Drive), preview files and drag them into notes. */
export default function ExplorerPage({ autoFocus }: { autoFocus?: boolean }) {
  const [places, setPlaces] = useState<ExplorerPlace[]>([])
  const [dir, setDir] = useState<string | null>(last.dir)
  const [entries, setEntries] = useState<ExplorerEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [view, setView] = useState(last.view)
  const [sort, setSort] = useState(last.sort)
  const [showHidden, setShowHidden] = useState(last.showHidden)
  const [back, setBack] = useState<string[]>([])
  const [forward, setForward] = useState<string[]>([])
  const [reload, setReload] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const crumbsRef = useRef<HTMLDivElement>(null)

  Object.assign(last, { dir, view, sort, showHidden })

  useEffect(() => {
    window.api
      .explorerPlaces()
      .then((list) => {
        setPlaces(list)
        setDir((d) => d ?? list[0]?.path ?? null)
      })
      .catch(notify)
  }, [])

  useEffect(() => {
    if (!dir) return
    let live = true
    setError(null)
    window.api
      .explorerList(dir)
      .then((list) => live && setEntries(list))
      .catch((err) => {
        if (!live) return
        setEntries([])
        setError(/EPERM|EACCES/.test(String(err)) ? 'This folder is private to the system, so it can’t be opened.' : 'This folder couldn’t be opened.')
      })
    return () => {
      live = false
    }
  }, [dir, reload])

  // Deep folders keep the end of the path in view.
  useEffect(() => {
    const el = crumbsRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [dir, places])

  useEffect(() => {
    if (autoFocus) listRef.current?.focus({ preventScroll: true })
  }, [autoFocus])

  const shown = useMemo(() => (entries ? sortEntries(filterEntries(entries, query, showHidden), sort) : []), [entries, query, showHidden, sort])
  const visible = shown.slice(0, MAX_SHOWN)
  const current = shown.find((e) => e.path === selected) ?? null

  const go = (to: string, from: 'click' | 'back' | 'forward' = 'click'): void => {
    if (!dir || to === dir) return
    if (from === 'click') {
      setBack((b) => [...b, dir])
      setForward([])
    } else if (from === 'back') {
      setBack((b) => b.slice(0, -1))
      setForward((f) => [dir, ...f])
    } else {
      setForward((f) => f.slice(1))
      setBack((b) => [...b, dir])
    }
    // Coming back up, the folder you were in stays picked.
    setSelected(parentPath(dir) === to ? dir : null)
    setEntries(null)
    setQuery('')
    setDir(to)
    listRef.current?.focus({ preventScroll: true })
  }
  const goBack = (): void => void (back.length && go(back[back.length - 1], 'back'))
  const goForward = (): void => void (forward.length && go(forward[0], 'forward'))
  const up = dir ? parentPath(dir) : null

  const open = (entry: ExplorerEntry): void => {
    if (entry.isDir) return go(entry.path)
    // Notes and files in the notes folder open here, in a tab of their own.
    if (entry.vaultPath && /\.md$/i.test(entry.name)) return openNote(entry.vaultPath, { newTab: true })
    if (entry.vaultPath && fileKind(entry.vaultPath) !== 'other') return openFileTab(entry.vaultPath, { newTab: true })
    window.api.explorerOpen(entry.path).catch(notify)
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if ((e.key === 'ArrowLeft' && e.altKey) || (e.key === 'Backspace' && !query)) {
      e.preventDefault()
      return e.key === 'Backspace' ? void (up && go(up)) : goBack()
    }
    if (e.key === 'ArrowRight' && e.altKey) return goForward()
    if (e.key === 'Enter' && current) return open(current)
    const step = { ArrowDown: 1, ArrowUp: -1, ArrowRight: view === 'grid' ? 1 : 0, ArrowLeft: view === 'grid' ? -1 : 0 }[e.key]
    if (!step || !visible.length) return
    e.preventDefault()
    // In the grid, up and down move a whole row.
    const columns = view === 'grid' ? Math.max(1, Math.floor((listRef.current?.clientWidth ?? 0) / 132)) : 1
    const move = e.key === 'ArrowDown' || e.key === 'ArrowUp' ? step * columns : step
    const at = visible.findIndex((x) => x.path === selected)
    const next = visible[Math.max(0, Math.min(visible.length - 1, at < 0 ? 0 : at + move))]
    setSelected(next.path)
    listRef.current?.querySelector(`[data-path="${CSS.escape(next.path)}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  const onDragStart = (e: DragEvent, entry: ExplorerEntry): void => {
    if (entry.isDir) return e.preventDefault()
    setSelected(entry.path)
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('text/plain', entry.path)
    setDrag({ kind: 'computer', path: entry.path })
  }

  const placeOf = (p: string): ExplorerPlace | undefined => places.find((pl) => pl.path === p)
  // Inside Home, Google Drive or the like, the breadcrumbs start there rather than at the top of the drive.
  const allCrumbs = dir ? crumbsOf(dir) : []
  const from = allCrumbs.findIndex((c) => placeOf(c.path) && placeOf(c.path)!.kind !== 'drive')
  const crumbs = from > 0 ? allCrumbs.slice(from) : allCrumbs

  return (
    <div className="explorer-page" data-explorer-page>
      <div className="explorer-frame">
        <nav className="explorer-places">
          {(['folders', 'drives'] as const).map((group) => (
            <div key={group} className="explorer-group">
              <div className="explorer-group-title">{group === 'folders' ? 'Places' : 'Drives'}</div>
              {places
                .filter((p) => (p.kind === 'drive') === (group === 'drives'))
                .map((p) => {
                  const Icon = PLACE_ICONS[p.kind]
                  return (
                    <button key={p.id} className={`explorer-place ${p.kind} ${dir === p.path ? 'active' : ''}`} onClick={() => go(p.path)} title={p.path}>
                      <Icon size={15} />
                      <span>{p.label}</span>
                    </button>
                  )
                })}
            </div>
          ))}
        </nav>

        <section className="explorer-main">
          <div className="explorer-bar">
            <button className="icon-btn" disabled={!back.length} onClick={goBack} title="Back (Alt+Left)">
              <ArrowLeft size={15} />
            </button>
            <button className="icon-btn" disabled={!forward.length} onClick={goForward} title="Forward (Alt+Right)">
              <ArrowRight size={15} />
            </button>
            <button className="icon-btn" disabled={!up} onClick={() => up && go(up)} title="Up a folder (Backspace)">
              <ArrowUp size={15} />
            </button>
            <div className="explorer-crumbs" ref={crumbsRef}>
              {crumbs.map((c, i) => (
                <span key={c.path} className="explorer-crumb">
                  {i > 0 && <ChevronRight size={13} />}
                  <button onClick={() => go(c.path)} className={i === crumbs.length - 1 ? 'here' : ''}>
                    {placeOf(c.path)?.label ?? c.name}
                  </button>
                </span>
              ))}
            </div>
            </div>

          <div className="explorer-tools">
            <span className="explorer-count">{entries ? `${shown.length} ${shown.length === 1 ? 'item' : 'items'}` : ' '}</span>
            <div className="explorer-spacer" />
          <label className="explorer-search">
              <Search size={13} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search here" spellCheck={false} />
            </label>
            <select className="select explorer-sort" value={sort} onChange={(e) => setSort(e.target.value as ExplorerSort)} title="Sort by">
              <option value="name">Name</option>
              <option value="modified">Newest first</option>
              <option value="size">Biggest first</option>
            </select>
            <button className="icon-btn" onClick={() => setShowHidden(!showHidden)} title={showHidden ? 'Hide hidden files' : 'Show hidden files'}>
              {showHidden ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <button className="icon-btn" onClick={() => setReload((n) => n + 1)} title="Refresh">
              <RefreshCw size={15} />
            </button>
            <div className="explorer-views">
              <button className={`icon-btn ${view === 'list' ? 'on' : ''}`} onClick={() => setView('list')} title="List">
                <List size={15} />
              </button>
              <button className={`icon-btn ${view === 'grid' ? 'on' : ''}`} onClick={() => setView('grid')} title="Pictures">
                <LayoutGrid size={15} />
              </button>
            </div>
          </div>

          <div
            key={`${dir}|${view}`}
            ref={listRef}
            className={`explorer-list ${view}`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onClick={(e) => e.target === e.currentTarget && setSelected(null)}
            data-explorer-list
          >
            {!entries && (
              <div className="explorer-empty">
                <Loader2 size={18} className="spin" />
              </div>
            )}
            {entries && !shown.length && <div className="explorer-empty">{error ?? (query ? 'Nothing here matches that.' : 'This folder is empty.')}</div>}
            {visible.map((entry, i) => (
              <div
                key={entry.path}
                className={`explorer-item ${entry.isDir ? 'dir' : ''} ${entry.hidden ? 'hidden-file' : ''} ${selected === entry.path ? 'selected' : ''}`}
                style={{ ['--i' as string]: Math.min(i, 14) }}
                data-path={entry.path}
                draggable={!entry.isDir}
                onDragStart={(e) => onDragStart(e, entry)}
                onDragEnd={() => setDrag(null)}
                onClick={() => setSelected(entry.path)}
                onDoubleClick={() => open(entry)}
                title={entry.isDir ? entry.name : `${entry.name}\nDrag into a note to add it there.`}
              >
                <span className="explorer-icon">
                  {view === 'grid' && previewKind(entry.name) === 'image' ? (
                    <img src={explorerUrl(entry.path)} alt="" loading="lazy" draggable={false} />
                  ) : entry.isDir ? (
                    <Folder size={view === 'grid' ? 40 : 16} />
                  ) : (
                    <FileIcon path={entry.name} size={view === 'grid' ? 36 : 16} />
                  )}
                </span>
                <span className="explorer-name">{entry.name}</span>
                {view === 'list' && (
                  <>
                    <span className="explorer-date">{describeModified(entry.modified)}</span>
                    <span className="explorer-size">{entry.isDir ? '' : describeBytes(entry.size)}</span>
                  </>
                )}
              </div>
            ))}
            {shown.length > MAX_SHOWN && <div className="explorer-more">Showing the first {MAX_SHOWN}. Search to find the rest.</div>}
          </div>
        </section>

        <Preview entry={current} onOpen={open} />
      </div>
    </div>
  )
}

/** The pane on the right: a look at the picked file, its details and what you can do with it. */
function Preview({ entry, onOpen }: { entry: ExplorerEntry | null; onOpen: (e: ExplorerEntry) => void }) {
  const [text, setText] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const kind = entry && !entry.isDir ? previewKind(entry.name) : 'none'

  useEffect(() => {
    setText(null)
    setFailed(false)
    if (!entry || kind !== 'text') return
    let live = true
    window.api
      .explorerReadText(entry.path)
      .then((t) => live && setText(t))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [entry?.path, kind])

  if (!entry) {
    return (
      <aside className="explorer-preview empty">
        <FolderSearch size={30} strokeWidth={1.4} />
        <p>Pick a file to see it here. Drag one into a note to add it to the note.</p>
      </aside>
    )
  }

  const url = explorerUrl(entry.path)
  return (
    <aside className="explorer-preview" key={entry.path} data-explorer-preview>
      <div className={`explorer-look ${kind}`}>
        {failed || kind === 'none' ? (
          entry.isDir ? <FolderOpen size={56} strokeWidth={1.2} /> : <FileIcon path={entry.name} size={56} />
        ) : kind === 'image' ? (
          <img src={url} alt="" onError={() => setFailed(true)} draggable={false} />
        ) : kind === 'video' ? (
          <video src={url} controls onError={() => setFailed(true)} />
        ) : kind === 'audio' ? (
          <>
            <Music size={44} strokeWidth={1.2} />
            <audio src={url} controls onError={() => setFailed(true)} />
          </>
        ) : kind === 'pdf' ? (
          <iframe src={url} title={entry.name} />
        ) : text === null ? (
          <Loader2 size={18} className="spin" />
        ) : (
          <pre>{text || 'This file is empty.'}</pre>
        )}
      </div>
      <h3 title={entry.name}>{entry.name}</h3>
      <dl>
        {!entry.isDir && (
          <>
            <dt>Size</dt>
            <dd>{describeBytes(entry.size)}</dd>
          </>
        )}
        <dt>Changed</dt>
        <dd>{new Date(entry.modified).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</dd>
        <dt>Where</dt>
        <dd className="explorer-where">{entry.path}</dd>
      </dl>
      <div className="explorer-actions">
        <button className="btn btn-primary" onClick={() => onOpen(entry)}>
          {entry.isDir ? <FolderOpen size={13} /> : <ExternalLink size={13} />} Open
        </button>
        <button className="btn" onClick={() => window.api.explorerReveal(entry.path).catch(notify)}>
          <FolderSearch size={13} /> Show in {FILE_MANAGER}
        </button>
        <button className="btn" onClick={() => void navigator.clipboard.writeText(entry.path)}>
          <Copy size={13} /> Copy path
        </button>
      </div>
      {!entry.isDir && (
        <p className="explorer-hint">
          <File size={12} /> Drag it into a note to add it.{entry.vaultPath ? ' It’s already in your notes folder, so it’s linked where it is.' : ' A copy goes in your attachments folder.'}
        </p>
      )}
    </aside>
  )
}
