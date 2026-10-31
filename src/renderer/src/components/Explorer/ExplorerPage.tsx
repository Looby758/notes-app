import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  ClipboardPaste,
  Cloud,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  File,
  FilePlus,
  FileText,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  HardDrive,
  House,
  Image as ImageIcon,
  LayoutGrid,
  Link,
  List,
  Loader2,
  Monitor,
  Music,
  NotebookPen,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Scissors,
  Search,
  Trash2
} from 'lucide-react'
import {
  crumbsOf,
  describeBytes,
  describeModified,
  explorerUrl,
  filterEntries,
  nameProblem,
  parentPath,
  previewKind,
  SEARCH_LIMIT,
  sortEntries,
  whereIn,
  type ExplorerEntry,
  type ExplorerPlace,
  type ExplorerSort,
  type PasteMode
} from '@shared/explorer'
import { FILE_MANAGER, TRASH_NAME } from '@shared/platform'
import { computerPaths, dragFilesOut, getDrag, setDrag } from '../../lib/dnd'
import { openFileTab, openNote } from '../../lib/editorController'
import { fileKind } from '../../lib/fileKinds'
import { notify } from '../../store/notify'
import ContextMenu, { type MenuItem } from '../ContextMenu'
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

/** Cut or copied items, shared by every explorer tab while the app is open. */
let clip: { paths: string[]; mode: PasteMode } | null = null

const PINS_KEY = 'orbit.explorer.pins'
const loadPins = (): string[] => {
  try {
    const list = JSON.parse(localStorage.getItem(PINS_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((p) => typeof p === 'string') : []
  } catch {
    return []
  }
}
const nameOf = (path: string): string => crumbsOf(path).pop()?.name ?? path
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** The file explorer: browse every folder on the computer (and Google Drive), manage files, preview them and drag them into notes. */
export default function ExplorerPage({ autoFocus }: { autoFocus?: boolean }) {
  const [places, setPlaces] = useState<ExplorerPlace[]>([])
  const [pins, setPins] = useState<string[]>(loadPins)
  const [dir, setDir] = useState<string | null>(last.dir)
  const [entries, setEntries] = useState<ExplorerEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The one the preview shows and the arrow keys move from. */
  const [selected, setSelected] = useState<string | null>(null)
  /** Everything picked (Ctrl/Shift+click, Ctrl+A). */
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [deep, setDeep] = useState(false)
  const [results, setResults] = useState<ExplorerEntry[] | null>(null)
  const [view, setView] = useState(last.view)
  const [sort, setSort] = useState(last.sort)
  const [showHidden, setShowHidden] = useState(last.showHidden)
  const [back, setBack] = useState<string[]>([])
  const [forward, setForward] = useState<string[]>([])
  const [reload, setReload] = useState(0)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entry: ExplorerEntry | null; pin?: string } | null>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)
  const [clipped, setClipped] = useState(clip)
  const listRef = useRef<HTMLDivElement>(null)
  const crumbsRef = useRef<HTMLDivElement>(null)
  /** What to pick once the folder reloads (a new folder, pasted files). */
  const pickAfter = useRef<{ paths: string[]; rename?: boolean } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

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

  useEffect(() => localStorage.setItem(PINS_KEY, JSON.stringify(pins)), [pins])

  useEffect(() => {
    if (!dir) return
    let live = true
    setError(null)
    window.api
      .explorerList(dir)
      .then((list) => {
        if (!live) return
        setEntries(list)
        const after = pickAfter.current
        pickAfter.current = null
        if (after?.paths.length) {
          setPicked(new Set(after.paths))
          setSelected(after.paths[0])
          setAnchor(after.paths[0])
          if (after.rename) setRenaming(after.paths[0])
          requestAnimationFrame(() => listRef.current?.querySelector(`[data-path="${CSS.escape(after.paths[0])}"]`)?.scrollIntoView({ block: 'nearest' }))
        } else {
          // Anything deleted or moved away drops out of the picked ones.
          const there = new Set(list.map((e) => e.path))
          setPicked((p) => new Set([...p].filter((x) => there.has(x))))
        }
      })
      .catch((err) => {
        if (!live) return
        setEntries([])
        setError(/EPERM|EACCES/.test(String(err)) ? 'This folder is private to the system, so it can’t be opened.' : /ENOENT/.test(String(err)) ? 'That folder doesn’t exist.' : 'This folder couldn’t be opened.')
      })
    return () => {
      live = false
    }
  }, [dir, reload])

  // Searching subfolders waits for a pause in typing.
  useEffect(() => {
    setResults(null)
    if (!deep || !dir || !query.trim()) return
    let live = true
    const timer = setTimeout(() => {
      window.api
        .explorerSearch(dir, query, showHidden)
        .then((list) => live && setResults(list))
        .catch((err) => live && (setResults([]), notify(err)))
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [deep, dir, query, showHidden, reload])

  // Deep folders keep the end of the path in view.
  useEffect(() => {
    const el = crumbsRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [dir, places, address])

  useEffect(() => {
    if (autoFocus) listRef.current?.focus({ preventScroll: true })
  }, [autoFocus])

  const searching = deep && !!query.trim()
  const shown = useMemo(
    () => (searching ? sortEntries(results ?? [], sort) : entries ? sortEntries(filterEntries(entries, query, showHidden), sort) : []),
    [searching, results, entries, query, showHidden, sort]
  )
  const visible = shown.slice(0, MAX_SHOWN)
  const current = shown.find((e) => e.path === selected) ?? null
  const pickedEntries = shown.filter((e) => picked.has(e.path))
  const refresh = (): void => setReload((n) => n + 1)

  const pickOnly = (path: string | null): void => {
    setSelected(path)
    setAnchor(path)
    setPicked(new Set(path ? [path] : []))
  }

  const go = (to: string, from: 'click' | 'back' | 'forward' = 'click'): void => {
    setAddress(null)
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
    pickOnly(parentPath(dir) === to ? dir : null)
    setRenaming(null)
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

  // ---- file actions ----

  /** The ones an action works on: everything picked, or the one right-clicked. */
  const targets = (entry?: ExplorerEntry | null): ExplorerEntry[] =>
    entry && !picked.has(entry.path) ? [entry] : pickedEntries.length ? pickedEntries : current ? [current] : []

  const create = (kind: 'folder' | 'file'): void => {
    if (!dir) return
    if (searching) setQuery('')
    window.api
      .explorerCreate(dir, kind === 'folder' ? 'New folder' : 'New text file.txt', kind)
      .then((path) => {
        pickAfter.current = { paths: [path], rename: true }
        refresh()
      })
      .catch(notify)
  }

  const finishRename = (entry: ExplorerEntry, name: string): void => {
    setRenaming(null)
    listRef.current?.focus({ preventScroll: true })
    if (name === entry.name) return
    const problem = nameProblem(name)
    if (problem) return notify(problem)
    window.api
      .explorerRename(entry.path, name)
      .then((path) => {
        pickAfter.current = { paths: [path] }
        refresh()
      })
      .catch(notify)
  }

  const toClip = (list: ExplorerEntry[], mode: PasteMode): void => {
    if (!list.length) return
    clip = { paths: list.map((e) => e.path), mode }
    setClipped(clip)
    notify(`${mode === 'move' ? 'Cut' : 'Copied'} ${list.length === 1 ? `"${list[0].name}"` : plural(list.length, 'item')}. Paste it with Ctrl+V.`, 'info')
  }

  const pasteInto = (paths: string[], into: string, mode: PasteMode): void => {
    if (!paths.length) return
    window.api
      .explorerPaste(paths, into, mode)
      .then((done) => {
        if (into === dir) pickAfter.current = { paths: done }
        refresh()
        if (into !== dir && done.length) notify(`${mode === 'move' ? 'Moved' : 'Copied'} ${plural(done.length, 'item')} to "${nameOf(into)}".`, 'info')
      })
      .catch((err) => {
        notify(err)
        refresh()
      })
  }

  const paste = (into = dir): void => {
    if (!clip || !into) return
    const { paths, mode } = clip
    // A cut is pasted once; a copy can be pasted again and again.
    if (mode === 'move') {
      clip = null
      setClipped(null)
    }
    pasteInto(paths, into, mode)
  }

  const remove = async (list: ExplorerEntry[]): Promise<void> => {
    if (!list.length) return
    const ok = await window.api.confirm({
      type: 'warning',
      message: list.length === 1 ? `Delete "${list[0].name}"?` : `Delete ${plural(list.length, 'item')}?`,
      detail: list.length === 1 && list[0].isDir ? `The folder and everything in it will be moved to the ${TRASH_NAME}.` : `They'll be moved to the ${TRASH_NAME}, so you can get them back.`,
      ok: `Move to ${TRASH_NAME}`
    })
    if (!ok) return
    try {
      await window.api.explorerTrash(list.map((e) => e.path))
    } catch (err) {
      notify(err)
    }
    if (searching) setResults((r) => r && r.filter((e) => !list.includes(e)))
    refresh()
  }

  const togglePin = (path: string): void => setPins((p) => (p.includes(path) ? p.filter((x) => x !== path) : [...p, path]))

  // ---- picking ----

  const onItemClick = (e: MouseEvent, entry: ExplorerEntry): void => {
    if (e.shiftKey && anchor) {
      const a = visible.findIndex((x) => x.path === anchor)
      const b = visible.findIndex((x) => x.path === entry.path)
      if (a >= 0 && b >= 0) {
        const range = visible.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.path)
        setPicked(new Set(e.ctrlKey || e.metaKey ? [...picked, ...range] : range))
        setSelected(entry.path)
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(picked)
      if (next.has(entry.path)) next.delete(entry.path)
      else next.add(entry.path)
      setPicked(next)
      setSelected(entry.path)
      setAnchor(entry.path)
      return
    }
    pickOnly(entry.path)
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (renaming || (e.target as HTMLElement).tagName === 'INPUT') return
    // Shortcuts the explorer uses don't also reach the app's own (Ctrl+Shift+N makes a note folder there).
    const stop = (): void => {
      e.preventDefault()
      e.stopPropagation()
    }
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (mod && key === 'a') {
      stop()
      return setPicked(new Set(visible.map((x) => x.path)))
    }
    if (mod && key === 'c') return void (stop(), toClip(targets(), 'copy'))
    if (mod && key === 'x') return void (stop(), toClip(targets(), 'move'))
    if (mod && key === 'v') return void (stop(), paste())
    if (mod && key === 'd') return void (stop(), dir && pasteInto(targets().map((x) => x.path), dir, 'copy'))
    if (mod && e.shiftKey && key === 'n') return void (stop(), create('folder'))
    if (mod && key === 'l') return void (stop(), setAddress(dir))
    if (e.key === 'F2' && current) return void (stop(), setRenaming(current.path))
    if (e.key === 'F5') return void (stop(), refresh())
    if (e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) return void (stop(), remove(targets()))
    if (e.key === 'Escape' && picked.size) return void (stop(), pickOnly(null))
    if ((e.key === 'ArrowLeft' && e.altKey) || (e.key === 'Backspace' && !query)) {
      stop()
      return e.key === 'Backspace' ? void (up && go(up)) : goBack()
    }
    if (e.key === 'ArrowRight' && e.altKey) return goForward()
    if (e.key === 'ArrowUp' && e.altKey) return void (up && go(up))
    if (e.key === 'Enter' && current) return open(current)
    const step = { ArrowDown: 1, ArrowUp: -1, ArrowRight: view === 'grid' ? 1 : 0, ArrowLeft: view === 'grid' ? -1 : 0 }[e.key]
    if (!step || !visible.length) return
    stop()
    // In the grid, up and down move a whole row.
    const columns = view === 'grid' ? Math.max(1, Math.floor((listRef.current?.clientWidth ?? 0) / 132)) : 1
    const move = e.key === 'ArrowDown' || e.key === 'ArrowUp' ? step * columns : step
    const at = visible.findIndex((x) => x.path === selected)
    const next = visible[Math.max(0, Math.min(visible.length - 1, at < 0 ? 0 : at + move))]
    if (e.shiftKey && anchor) {
      const a = visible.findIndex((x) => x.path === anchor)
      const b = visible.indexOf(next)
      setPicked(new Set(visible.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.path)))
      setSelected(next.path)
    } else pickOnly(next.path)
    listRef.current?.querySelector(`[data-path="${CSS.escape(next.path)}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  // ---- dragging ----

  const onDragStart = (e: DragEvent, entry: ExplorerEntry): void => {
    if (!picked.has(entry.path)) pickOnly(entry.path)
    const paths = (picked.has(entry.path) ? pickedEntries : [entry]).map((x) => x.path)
    // Dragged as real files, so they drop into Discord, a browser or File Explorer / Finder too.
    // In Orbit, a single file can also be dropped into a note; the notes tree in the sidebar takes any of them.
    dragFilesOut(e, paths, paths.length === 1 && !entry.isDir ? { kind: 'computer', path: entry.path } : { kind: 'computerMany', paths })
  }

  const dropProps = (target: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      e.stopPropagation()
      // The computer only lets files dragged out be copied or linked, so the cursor says copy even
      // when moving within the Files tab (the drop below still moves them unless Ctrl / Alt is held).
      e.dataTransfer.dropEffect = 'copy'
      setDropOn(target)
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOn((d) => (d === target ? null : d))
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDropOn(null)
      const ours = computerPaths(getDrag())
      setDrag(null)
      if (ours.length) {
        const paths = ours.filter((p) => p !== target)
        return pasteInto(paths, target, e.ctrlKey || e.altKey ? 'copy' : 'move')
      }
      // Dropped in from File Explorer / Finder: copied here.
      const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean)
      pasteInto(paths, target, 'copy')
    }
  })

  // ---- menus ----

  const itemMenu = (entry: ExplorerEntry): MenuItem[] => {
    const list = targets(entry)
    const many = list.length > 1
    return [
      ...(!many
        ? [
            { label: 'Open', icon: entry.isDir ? <FolderOpen size={14} /> : <ExternalLink size={14} />, onClick: () => open(entry) },
            ...(searching ? [{ label: 'Open the folder it’s in', icon: <Folder size={14} />, onClick: () => { const p = parentPath(entry.path); if (p) { pickAfter.current = { paths: [entry.path] }; go(p) } } }] : []),
            'separator' as const
          ]
        : []),
      { label: many ? `Cut ${list.length} items` : 'Cut', icon: <Scissors size={14} />, onClick: () => toClip(list, 'move') },
      { label: many ? `Copy ${list.length} items` : 'Copy', icon: <Copy size={14} />, onClick: () => toClip(list, 'copy') },
      ...(entry.isDir && !many && clipped ? [{ label: 'Paste into this folder', icon: <ClipboardPaste size={14} />, onClick: () => paste(entry.path) }] : []),
      { label: 'Duplicate', icon: <CopyPlus size={14} />, onClick: () => pasteInto(list.map((x) => x.path), parentPath(entry.path) ?? dir!, 'copy') },
      ...(!many ? [{ label: 'Rename', icon: <Pencil size={14} />, onClick: () => setRenaming(entry.path) }] : []),
      'separator',
      { label: many ? 'Copy paths' : 'Copy path', icon: <Link size={14} />, onClick: () => void navigator.clipboard.writeText(list.map((x) => x.path).join('\n')) },
      ...(entry.isDir && !many ? [{ label: pins.includes(entry.path) ? 'Unpin from sidebar' : 'Pin to sidebar', icon: pins.includes(entry.path) ? <PinOff size={14} /> : <Pin size={14} />, onClick: () => togglePin(entry.path) }] : []),
      { label: `Show in ${FILE_MANAGER}`, icon: <FolderSearch size={14} />, onClick: () => window.api.explorerReveal(entry.path).catch(notify) },
      'separator',
      { label: `Delete${many ? ` ${list.length} items` : ''}`, icon: <Trash2 size={14} />, danger: true, onClick: () => void remove(list) }
    ]
  }

  const folderMenu = (): MenuItem[] => [
    { label: 'New folder', icon: <FolderPlus size={14} />, onClick: () => create('folder') },
    { label: 'New text file', icon: <FilePlus size={14} />, onClick: () => create('file') },
    ...(clipped ? [{ label: `Paste ${clipped.paths.length === 1 ? '' : `${clipped.paths.length} items`}`.trim(), icon: <ClipboardPaste size={14} />, onClick: () => paste() }] : []),
    'separator',
    { label: 'Refresh', icon: <RefreshCw size={14} />, onClick: refresh },
    ...(dir ? [{ label: pins.includes(dir) ? 'Unpin this folder' : 'Pin this folder to the sidebar', icon: <Pin size={14} />, onClick: () => togglePin(dir) }] : []),
    ...(dir ? [{ label: `Open in ${FILE_MANAGER}`, icon: <FolderSearch size={14} />, onClick: () => window.api.explorerOpen(dir).catch(notify) }] : [])
  ]

  const pinMenu = (path: string): MenuItem[] => [
    { label: 'Open', icon: <FolderOpen size={14} />, onClick: () => go(path) },
    { label: 'Unpin', icon: <PinOff size={14} />, onClick: () => togglePin(path) }
  ]

  const placeOf = (p: string): ExplorerPlace | undefined => places.find((pl) => pl.path === p)
  // Inside Home, Google Drive or the like, the breadcrumbs start there rather than at the top of the drive.
  const allCrumbs = dir ? crumbsOf(dir) : []
  const from = allCrumbs.findIndex((c) => placeOf(c.path) && placeOf(c.path)!.kind !== 'drive')
  const crumbs = from > 0 ? allCrumbs.slice(from) : allCrumbs
  const cut = clipped?.mode === 'move' ? new Set(clipped.paths) : null

  const placeButton = (key: string, path: string, label: string, Icon: typeof Folder, kind: string, pinned = false) => (
    <button
      key={key}
      className={`explorer-place ${kind} ${dir === path ? 'active' : ''} ${dropOn === path ? 'drop' : ''}`}
      onClick={() => go(path)}
      onContextMenu={pinned ? (e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, entry: null, pin: path })) : undefined}
      title={path}
      {...dropProps(path)}
    >
      <Icon size={15} />
      <span>{label}</span>
    </button>
  )

  return (
    <div className="explorer-page" data-explorer-page>
      <div className="explorer-frame">
        <nav className="explorer-places">
          {pins.length > 0 && (
            <div className="explorer-group">
              <div className="explorer-group-title">Pinned</div>
              {pins.map((p) => placeButton(`pin-${p}`, p, nameOf(p), Pin, 'pinned', true))}
            </div>
          )}
          {(['folders', 'drives'] as const).map((group) => (
            <div key={group} className="explorer-group">
              <div className="explorer-group-title">{group === 'folders' ? 'Places' : 'Drives'}</div>
              {places.filter((p) => (p.kind === 'drive') === (group === 'drives')).map((p) => placeButton(p.id, p.path, p.label, PLACE_ICONS[p.kind], p.kind))}
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
            {address !== null ? (
              <input
                className="explorer-address"
                autoFocus
                value={address}
                spellCheck={false}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setAddress(e.target.value)}
                onBlur={() => setAddress(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') return setAddress(null)
                  if (e.key !== 'Enter') return
                  const to = address.trim().replace(/^"|"$/g, '')
                  if (to) go(to)
                  else setAddress(null)
                }}
              />
            ) : (
              <div className="explorer-crumbs" ref={crumbsRef} onClick={(e) => e.target === e.currentTarget && setAddress(dir)} title="Click to type a path (Ctrl+L)">
                {crumbs.map((c, i) => (
                  <span key={c.path} className="explorer-crumb">
                    {i > 0 && <ChevronRight size={13} />}
                    <button onClick={() => go(c.path)} className={`${i === crumbs.length - 1 ? 'here' : ''} ${dropOn === c.path ? 'drop' : ''}`} {...dropProps(c.path)}>
                      {placeOf(c.path)?.label ?? c.name}
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="explorer-tools">
            <button className="icon-btn" onClick={() => create('folder')} title="New folder (Ctrl+Shift+N)">
              <FolderPlus size={15} />
            </button>
            <button className="icon-btn" onClick={() => create('file')} title="New text file">
              <FilePlus size={15} />
            </button>
            <span className="explorer-tool-sep" />
            <button className="icon-btn" disabled={!targets().length} onClick={() => toClip(targets(), 'move')} title="Cut (Ctrl+X)">
              <Scissors size={15} />
            </button>
            <button className="icon-btn" disabled={!targets().length} onClick={() => toClip(targets(), 'copy')} title="Copy (Ctrl+C)">
              <Copy size={15} />
            </button>
            <button className="icon-btn" disabled={!clipped} onClick={() => paste()} title="Paste (Ctrl+V)">
              <ClipboardPaste size={15} />
            </button>
            <button className="icon-btn" disabled={targets().length !== 1} onClick={() => current && setRenaming(current.path)} title="Rename (F2)">
              <Pencil size={15} />
            </button>
            <button className="icon-btn danger" disabled={!targets().length} onClick={() => void remove(targets())} title={`Delete to the ${TRASH_NAME} (Delete)`}>
              <Trash2 size={15} />
            </button>
            <span className="explorer-count">
              {picked.size > 1 ? `${picked.size} picked` : searching ? (results ? `${results.length >= SEARCH_LIMIT ? `${SEARCH_LIMIT}+` : results.length} found` : 'Searching…') : entries ? plural(shown.length, 'item') : ' '}
            </span>
            <div className="explorer-spacer" />
            <label className="explorer-search">
              <Search size={13} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), listRef.current?.focus())}
                placeholder={deep ? 'Search all subfolders' : 'Search here'}
                spellCheck={false}
              />
              <button className={`explorer-deep ${deep ? 'on' : ''}`} onClick={(e) => (e.preventDefault(), setDeep(!deep))} title={deep ? 'Searching every folder inside this one' : 'Search every folder inside this one too'}>
                Subfolders
              </button>
            </label>
            <select className="select explorer-sort" value={sort} onChange={(e) => setSort(e.target.value as ExplorerSort)} title="Sort by">
              <option value="name">Name</option>
              <option value="modified">Newest first</option>
              <option value="size">Biggest first</option>
            </select>
            <button className="icon-btn" onClick={() => setShowHidden(!showHidden)} title={showHidden ? 'Hide hidden files' : 'Show hidden files'}>
              {showHidden ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <button className="icon-btn" onClick={refresh} title="Refresh (F5)">
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
            className={`explorer-list ${view} ${dir && dropOn === dir ? 'drop' : ''}`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onClick={(e) => e.target === e.currentTarget && pickOnly(null)}
            onContextMenu={(e) => {
              if (e.target !== e.currentTarget) return
              e.preventDefault()
              pickOnly(null)
              setMenu({ x: e.clientX, y: e.clientY, entry: null })
            }}
            {...(dir ? dropProps(dir) : {})}
            data-explorer-list
          >
            {(searching ? !results : !entries) && (
              <div className="explorer-empty">
                <Loader2 size={18} className="spin" />
              </div>
            )}
            {(searching ? results : entries) && !shown.length && (
              <div className="explorer-empty">{error ?? (query ? 'Nothing here matches that.' : 'This folder is empty. Drop files here to copy them in.')}</div>
            )}
            {visible.map((entry, i) => (
              <div
                key={entry.path}
                className={`explorer-item ${entry.isDir ? 'dir' : ''} ${entry.hidden ? 'hidden-file' : ''} ${picked.has(entry.path) ? 'selected' : ''} ${selected === entry.path ? 'focused' : ''} ${cut?.has(entry.path) ? 'cut' : ''} ${dropOn === entry.path ? 'drop' : ''}`}
                style={{ ['--i' as string]: Math.min(i, 14) }}
                data-path={entry.path}
                draggable={renaming !== entry.path}
                onDragStart={(e) => onDragStart(e, entry)}
                onClick={(e) => onItemClick(e, entry)}
                onDoubleClick={() => renaming !== entry.path && open(entry)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (!picked.has(entry.path)) pickOnly(entry.path)
                  else setSelected(entry.path)
                  setMenu({ x: e.clientX, y: e.clientY, entry })
                }}
                {...(entry.isDir ? dropProps(entry.path) : {})}
                title={entry.path}
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
                {renaming === entry.path ? (
                  <RenameBox entry={entry} onDone={(name) => finishRename(entry, name)} onCancel={() => (setRenaming(null), listRef.current?.focus({ preventScroll: true }))} />
                ) : (
                  <span className="explorer-name">
                    {entry.name}
                    {searching && dir && view === 'list' && <small className="explorer-in">{whereIn(entry.path, dir) || nameOf(dir)}</small>}
                  </span>
                )}
                {view === 'list' && (
                  <>
                    <span className="explorer-date">{describeModified(entry.modified)}</span>
                    <span className="explorer-size">{entry.isDir ? '' : describeBytes(entry.size)}</span>
                  </>
                )}
              </div>
            ))}
            {shown.length > MAX_SHOWN && <div className="explorer-more">Showing the first {MAX_SHOWN}. Search to find the rest.</div>}
            {searching && results && results.length >= SEARCH_LIMIT && <div className="explorer-more">Showing the first {SEARCH_LIMIT} matches. Type more to narrow it down.</div>}
          </div>
        </section>

        <Preview entry={picked.size > 1 ? null : current} count={picked.size} onOpen={open} onRename={(e) => setRenaming(e.path)} onDelete={(e) => void remove([e])} />
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.pin ? pinMenu(menu.pin) : menu.entry ? itemMenu(menu.entry) : folderMenu()} onClose={closeMenu} />
      )}
    </div>
  )
}

/** The name box that replaces an item's name while it's being renamed. The extension isn't picked, like Windows. */
function RenameBox({ entry, onDone, onCancel }: { entry: ExplorerEntry; onDone: (name: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = entry.isDir || entry.name.startsWith('.') ? -1 : entry.name.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : entry.name.length)
  }, [entry.name, entry.isDir])
  const finish = (name: string | null): void => {
    if (done.current) return
    done.current = true
    if (name === null) onCancel()
    else onDone(name)
  }
  return (
    <input
      ref={ref}
      className="explorer-rename"
      defaultValue={entry.name}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  )
}

/** The pane on the right: a look at the picked file, its details and what you can do with it. */
function Preview({
  entry,
  count,
  onOpen,
  onRename,
  onDelete
}: {
  entry: ExplorerEntry | null
  count: number
  onOpen: (e: ExplorerEntry) => void
  onRename: (e: ExplorerEntry) => void
  onDelete: (e: ExplorerEntry) => void
}) {
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
        <p>
          {count > 1
            ? `${count} items picked. Drag them onto a folder to move them (hold Ctrl to copy), or right-click for more.`
            : 'Pick a file to see it here. Drag one into a note to add it to the note. Right-click for everything else.'}
        </p>
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
        <button className="btn" onClick={() => onRename(entry)}>
          <Pencil size={13} /> Rename
        </button>
        <button className="btn danger" onClick={() => onDelete(entry)}>
          <Trash2 size={13} /> Delete
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
