import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  Columns2,
  Plus,
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
  FileArchive,
  File,
  FilePlus,
  FileText,
  Film,
  Folder,
  FolderInput,
  FolderOpen,
  FolderOutput,
  FolderPlus,
  FolderSearch,
  HardDrive,
  House,
  Image as ImageIcon,
  Laptop,
  LayoutGrid,
  Link,
  List,
  Loader2,
  Lock,
  Monitor,
  Music,
  NotebookPen,
  Pencil,
  RefreshCw,
  Scissors,
  Search,
  Smartphone,
  Star,
  StarOff,
  Tag,
  Trash2,
  Undo2,
  X
} from 'lucide-react'
import {
  crumbsOf,
  describeBytes,
  describeModified,
  explorerUrl,
  filterEntries,
  nameProblem,
  parentPath,
  describeCount,
  describeFolderSize,
  previewKind,
  PC_SEARCH_LIMIT,
  SEARCH_LIMIT,
  sortEntries,
  whereIn,
  type ExplorerEntry,
  type ExplorerPlace,
  type ExplorerSort,
  type PasteMode,
  type PcIndexStatus
} from '@shared/explorer'
import type { BinItem, BinListing } from '@shared/recycleBin'
import { sharedTags, TAG_COLOURS, TAG_DEFAULT_NAMES, TAG_HEX, tagCounts, tagName, type FileTagStore, type TagColour } from '@shared/fileTags'
import { loadFileTags, moveFavourite, toggleFavourite, useFileTags } from '../../store/fileTags'
import { useFilesPcSearch } from '../../store/filesReveal'
import { FILE_MANAGER, TRASH_NAME } from '@shared/platform'
import { computerPaths, dragFilesOut, getDrag, getTreeDrag, setDrag, setTreeDrag } from '../../lib/dnd'
import { recordUndo, undoChanged, useUndoChanges } from '../../lib/undo'
import { explorerStartDirs, openExplorerTab, openFileTab, openNote, EXPLORER_TAB } from '../../lib/editorController'
import { setExplorerTabDir } from '../../store/explorerTabs'
import { fileKind } from '../../lib/fileKinds'
import { isComicBookFile } from '@shared/comics'
import { shelveComicFile } from '../../store/comics'
import { useFilesReveal } from '../../store/filesReveal'
import { notify } from '../../store/notify'
import { openInPdfEditor } from '../../store/pdfEditor'
import { FilePen } from 'lucide-react'
import ContextMenu, { type MenuItem } from '../ContextMenu'
import FileIcon from '../FileIcon'
import { sendToDevice, useDropTargets } from '../Share/DeviceDrop'
import { isVideoFile } from '@shared/videoPlayer'
import { queueVideo } from '../../store/videoPlayer'
import { archiveFolderName, isArchiveFile } from '@shared/archive'
import { releaseOnUnmount } from '../../lib/media'
import ArchivePreview, { CompressDialog } from './ArchivePreview'

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


/** Where typing in the search box looks: this folder, every folder inside it, or the whole computer. */
type SearchScope = 'here' | 'subfolders' | 'pc'
type Remembered = { dir: string | null; view: 'list' | 'grid'; sort: ExplorerSort; showHidden: boolean; scope: SearchScope }
/** Where you were and how you liked it, kept while the app is open: a new Files tab starts like this. */
const last: Remembered = {
  dir: null,
  view: 'list',
  sort: 'name',
  showHidden: false,
  scope: 'here'
}
/** The same, for each Files tab, so switching between them keeps each one's folder. */
const tabsLast = new Map<string, Remembered>()
const rememberedFor = (tab: string): Remembered => {
  let r = tabsLast.get(tab)
  if (!r) {
    const start = explorerStartDirs.get(tab)
    explorerStartDirs.delete(tab)
    r = { ...last, dir: start ?? last.dir }
    tabsLast.set(tab, r)
  }
  return r
}

type FolderSize = { bytes: number; files: number; folders: number; complete: boolean; counting?: boolean }
/** Folder sizes as they come in (shared by every Files tab); null when the folder couldn't be read. */
const folderSizeCache = new Map<string, FolderSize | null>()

/** Cut or copied items, shared by every explorer tab while the app is open. */
let clip: { paths: string[]; mode: PasteMode } | null = null

const nameOf = (path: string): string => crumbsOf(path).pop()?.name ?? path
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
const what = (paths: string[]): string => (paths.length === 1 ? `“${nameOf(paths[0])}”` : plural(paths.length, 'item'))

// ---- undo (Ctrl+Z outside a text box; lib/undo.ts) ----

/** Undo for something new here (a new file, or copies): it goes into Orbit's short-term bin, and redo brings it back. */
function recordAdded(label: string, paths: string[]): void {
  let at = paths
  recordUndo({
    label,
    undo: async () => {
      await window.api.undoHold(at, false)
      undoChanged('explorer')
    },
    redo: async () => {
      at = await window.api.undoRestore(at, false)
      undoChanged('explorer')
    },
    forget: (done) => !done && void window.api.undoRelease(at, false)
  })
}

function recordMoved(label: string, moves: { from: string; to: string }[]): void {
  let last = moves
  const flip = async (): Promise<void> => {
    last = await window.api.undoMoveBack(last)
    undoChanged('explorer')
  }
  recordUndo({ label, undo: flip, redo: flip })
}

async function recordDeleted(paths: string[]): Promise<void> {
  const held = await window.api.undoHeld(paths, false).catch(() => [] as string[])
  if (!held.length) return
  let at = held
  recordUndo({
    label: `Deleted ${what(held)}`,
    undo: async () => {
      at = await window.api.undoRestore(at, false)
      undoChanged('explorer')
    },
    redo: async () => {
      await window.api.undoHold(at, false)
      undoChanged('explorer')
    },
    forget: (done) => done && void window.api.undoRelease(at, false)
  })
}

/** The file explorer: browse every folder on the computer (and Google Drive), manage files, preview them and drag them into notes. */
export default function ExplorerPage({ autoFocus, tab = EXPLORER_TAB }: { autoFocus?: boolean; tab?: string }) {
  const mine = rememberedFor(tab)
  const [places, setPlaces] = useState<ExplorerPlace[]>([])
  const tags = useFileTags()
  const pins = tags.favourites
  /** Showing everything with this colour tag, from all over the computer. */
  const [tagView, setTagView] = useState<TagColour | null>(null)
  const [tagged, setTagged] = useState<ExplorerEntry[] | null>(null)
  const [indexStatus, setIndexStatus] = useState<(PcIndexStatus & { everything?: boolean; wanted?: boolean }) | null>(null)
  const [systemToo, setSystemToo] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  /** Showing what's in the Recycle Bin / Bin. */
  const [binView, setBinView] = useState(false)
  const [bin, setBin] = useState<BinListing | null>(null)
  /** Folders' total sizes, added up in the background (main/folderSize). */
  const [folderSizes, setFolderSizes] = useState<ReadonlyMap<string, FolderSize | null>>(() => new Map(folderSizeCache))
  /** The next size request counts again rather than using remembered sizes (Refresh). */
  const recount = useRef(false)
  const [dir, setDir] = useState<string | null>(mine.dir)
  const [entries, setEntries] = useState<ExplorerEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The one the preview shows and the arrow keys move from. */
  const [selected, setSelected] = useState<string | null>(null)
  /** Everything picked (Ctrl/Shift+click, Ctrl+A). */
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<SearchScope>(mine.scope)
  const deep = scope !== 'here'
  const [results, setResults] = useState<ExplorerEntry[] | null>(null)
  const [view, setView] = useState(mine.view)
  const [sort, setSort] = useState(mine.sort)
  const [showHidden, setShowHidden] = useState(mine.showHidden)
  const [back, setBack] = useState<string[]>([])
  const [forward, setForward] = useState<string[]>([])
  const [reload, setReload] = useState(0)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entry: ExplorerEntry | null; pin?: string; tag?: TagColour } | null>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)
  const [clipped, setClipped] = useState(clip)
  const devices = useDropTargets()
  /** Items waiting for a password before they're compressed. */
  const [compressing, setCompressing] = useState<string[] | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const crumbsRef = useRef<HTMLDivElement>(null)
  /** What to pick once the folder reloads (a new folder, pasted files). */
  const pickAfter = useRef<{ paths: string[]; rename?: boolean } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  Object.assign(last, { dir, view, sort, showHidden, scope })
  Object.assign(mine, { dir, view, sort, showHidden, scope })
  useEffect(() => void (dir && setExplorerTabDir(tab, dir)), [tab, dir])

  useEffect(() => {
    window.api
      .explorerPlaces()
      .then((list) => {
        setPlaces(list)
        setDir((d) => d ?? list[0]?.path ?? null)
      })
      .catch(notify)
  }, [])

  useEffect(loadFileTags, [])

  useEffect(
    () =>
      window.api.onExplorerFolderSize(({ path, size }) => {
        folderSizeCache.set(path, size)
        setFolderSizes((old) => new Map(old).set(path, size))
      }),
    []
  )

  // Ctrl+K → "Search the whole PC": the search box, looking everywhere.
  useEffect(
    () =>
      useFilesPcSearch.subscribe(() => {
        setScope('pc')
        setTagView(null)
        requestAnimationFrame(() => searchRef.current?.focus())
      }),
    []
  )

  // How the list of every file is getting on, while Whole PC search is in use.
  useEffect(() => {
    if (scope !== 'pc') return
    window.api.explorerIndexStatus().then(setIndexStatus).catch(() => undefined)
    return window.api.onExplorerIndexStatus((s) => setIndexStatus((old) => ({ ...old, ...s })))
  }, [scope])

  // What's in the Recycle Bin / Bin (read again on Refresh and after each change).
  useEffect(() => {
    setBin(null)
    if (!binView) return
    let live = true
    window.api
      .binList()
      .then((b) => live && setBin(b))
      .catch((err) => live && (setBin({ items: [], canRestore: false, blocked: false }), notify(err)))
    return () => {
      live = false
    }
  }, [binView, reload])
  const binItems = useMemo(() => new Map((bin?.items ?? []).map((i) => [i.at, i])), [bin])
  const binEntries = useMemo<ExplorerEntry[] | null>(
    () => (bin ? bin.items.map((i) => ({ name: i.name, path: i.at, isDir: i.isDir, size: i.size, modified: i.deletedAt, hidden: false, vaultPath: null })) : null),
    [bin]
  )

  // Everything with a colour tag (fetched again when tags change).
  const taggedKey = tagView ? Object.entries(tags.items).filter(([, l]) => l.includes(tagView)).map(([p]) => p).join('\n') : ''
  useEffect(() => {
    setTagged(null)
    if (!tagView) return
    let live = true
    window.api
      .explorerTagged(tagView)
      .then((list) => live && setTagged(list))
      .catch((err) => live && (setTagged([]), notify(err)))
    return () => {
      live = false
    }
  }, [tagView, taggedKey, reload])

  // A file to show from elsewhere ("Open in Orbit" on a zip): open its folder with it picked.
  useEffect(() => {
    const show = (path: string | null): void => {
      if (!path) return
      useFilesReveal.setState({ path: null })
      const folder = parentPath(path)
      if (!folder) return
      pickAfter.current = { paths: [path] }
      setQuery('')
      setDir(folder)
      setReload((n) => n + 1)
    }
    show(useFilesReveal.getState().path)
    return useFilesReveal.subscribe((st) => show(st.path))
  }, [])

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

  // Searching subfolders waits for a pause in typing; the whole PC answers as you type (from Orbit's list of every file).
  const [lastQuery, setLastQuery] = useState('')
  useEffect(() => {
    if (!deep || tagView || !query.trim()) return setResults(null)
    // Whole PC keeps showing the last results while the next ones come, so they don't flicker.
    if (scope !== 'pc' || !query.trim().toLowerCase().startsWith(lastQuery.trim().toLowerCase()) || !lastQuery.trim()) setResults(null)
    let live = true
    const timer = setTimeout(
      () => {
        const ask =
          scope === 'pc'
            ? window.api.explorerSearchPc(query, showHidden).then((r) => {
                if (!live) return []
                setIndexStatus((old) => ({ ...old, ...r.status }))
                setSystemToo(r.system)
                return r.entries
              })
            : dir
              ? window.api.explorerSearch(dir, query, showHidden)
              : Promise.resolve([])
        ask
          .then((list) => {
            if (!live) return
            setResults(list)
            setLastQuery(query)
          })
          .catch((err) => live && (setResults([]), notify(err)))
      },
      scope === 'pc' ? 60 : 300
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deep, scope, dir, query, showHidden, reload, tagView])

  // Deep folders keep the end of the path in view.
  useEffect(() => {
    const el = crumbsRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [dir, places, address])

  useEffect(() => {
    if (autoFocus) listRef.current?.focus({ preventScroll: true })
  }, [autoFocus])

  const searching = deep && !!query.trim() && !tagView && !binView
  /** Whole PC results come best match first; sorting by name would bury the one you're after. */
  const ranked = searching && scope === 'pc' && sort === 'name'
  // Biggest first puts the biggest folders first too, once they've been added up.
  const sizesForSort = useMemo(() => {
    if (sort !== 'size') return undefined
    const m = new Map<string, number>()
    for (const [p, s] of folderSizes) if (s) m.set(p, s.bytes)
    return m
  }, [sort, folderSizes])
  const shown = useMemo(
    () =>
      binView
        ? sortEntries(filterEntries(binEntries ?? [], query, true), sort, sizesForSort)
        : tagView
        ? sortEntries(filterEntries(tagged ?? [], query, true), sort, sizesForSort)
        : searching
          ? ranked
            ? results ?? []
            : sortEntries(results ?? [], sort, sizesForSort)
          : entries
            ? sortEntries(filterEntries(entries, query, showHidden), sort, sizesForSort)
            : [],
    [binView, binEntries, tagView, tagged, searching, ranked, results, entries, query, showHidden, sort, sizesForSort]
  )
  /** Search results and tag lists are from all over: each row says where it is. */
  const scattered = searching || !!tagView || binView
  const visible = shown.slice(0, MAX_SHOWN)

  // The folders on show get their sizes added up, the first ones first; leaving stops the rest.
  const shownDirs = visible.filter((e) => e.isDir).map((e) => e.path)
  const shownDirsKey = shownDirs.join('\n')
  useEffect(() => {
    const fresh = recount.current
    recount.current = false
    window.api.explorerFolderSizes(shownDirs, fresh).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownDirsKey, reload])
  // Leaving the Files tab stops any counting.
  useEffect(() => () => void window.api.explorerFolderSizes([]).catch(() => undefined), [])
  const current = shown.find((e) => e.path === selected) ?? null
  const pickedEntries = shown.filter((e) => picked.has(e.path))
  const refresh = (): void => setReload((n) => n + 1)
  /** Refresh (F5, the button): folder sizes are counted again too. */
  const refreshAll = (): void => {
    recount.current = true
    refresh()
  }
  useUndoChanges('explorer', refresh)
  useUndoChanges('files', refresh)

  const pickOnly = (path: string | null): void => {
    setSelected(path)
    setAnchor(path)
    setPicked(new Set(path ? [path] : []))
  }

  const go = (to: string, from: 'click' | 'back' | 'forward' = 'click'): void => {
    setAddress(null)
    if (tagView || binView) {
      setTagView(null)
      setBinView(false)
      setQuery('')
      if (to === dir) return
    }
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
    // In the Recycle Bin, things are only looked at (and put back), not opened.
    if (binView) return pickOnly(entry.path)
    if (entry.isDir) return go(entry.path)
    // Opening a file never kicks off something unexpected.
    // Videos (anywhere on the computer) go in the video player's Up next, without playing.
    if (isVideoFile(entry.name)) return queueVideo(entry.path)
    // Notes and files in the notes folder open here, in a tab of their own.
    if (entry.vaultPath && /\.md$/i.test(entry.name)) return openNote(entry.vaultPath, { newTab: true })
    if (entry.vaultPath && fileKind(entry.vaultPath) !== 'other') return openFileTab(entry.vaultPath, { newTab: true })
    // Comics go on Orbit's comic shelf (without opening the comic).
    if (isComicBookFile(entry.name)) return void shelveComicFile(entry.path)
    // Zips, RARs and 7z files show what's inside on the right; nothing is unpacked until you press Extract.
    if (isArchiveFile(entry.name)) {
      pickOnly(entry.path)
      return notify('What’s inside is shown on the right. Press Extract there to unpack it.', 'info')
    }
    // Anything else asks before opening in another app.
    window.api.explorerOpen(entry.path, true).catch(notify)
  }

  // ---- file actions ----

  /** Unpacks an archive (see ArchivePreview). Ctrl+Z puts what came out in the bin. Rejects so the preview can ask for a password. */
  const extract = async (entry: ExplorerEntry, opts: { names?: string[]; password?: string; intoFolder: boolean; go?: boolean }): Promise<boolean> => {
    const folder = parentPath(entry.path) ?? dir
    notify(`Unpacking “${entry.name}”…`, 'info')
    const made = await window.api.explorerExtract(entry.path, opts)
    if (!made.length) return false
    recordAdded(`Unpacked “${entry.name}”`, made)
    if (opts.go && made.length === 1) go(made[0])
    else {
      if (folder === dir) pickAfter.current = { paths: made }
      refresh()
    }
    notify(opts.intoFolder ? `Unpacked into “${nameOf(made[0])}”.` : `Unpacked ${plural(made.length, 'item')} here.`, 'info')
    return true
  }

  /** Packs items into a new zip or 7z next to them, which is then picked. */
  const compress = (paths: string[], format: 'zip' | '7z', password?: string): void => {
    if (!paths.length) return
    notify(`Compressing ${what(paths)}…`, 'info')
    window.api
      .explorerCompress(paths, format, password)
      .then((out) => {
        if (parentPath(out) === dir) pickAfter.current = { paths: [out] }
        refresh()
        recordAdded(`Compressed ${what(paths)}`, [out])
        notify(`Made “${nameOf(out)}”.`, 'info')
      })
      .catch(notify)
  }

  /** The ones an action works on: everything picked, or the one right-clicked. */
  const targets = (entry?: ExplorerEntry | null): ExplorerEntry[] =>
    entry && !picked.has(entry.path) ? [entry] : pickedEntries.length ? pickedEntries : current ? [current] : []

  const create = (kind: 'folder' | 'file'): void => {
    if (!dir) return
    if (searching || tagView) setQuery('')
    setTagView(null)
    window.api
      .explorerCreate(dir, kind === 'folder' ? 'New folder' : 'New text file.txt', kind)
      .then((path) => {
        pickAfter.current = { paths: [path], rename: true }
        refresh()
        recordAdded(`Made “${nameOf(path)}”`, [path])
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
        if (path !== entry.path) recordMoved(`Renamed “${entry.name}” to “${nameOf(path)}”`, [{ from: entry.path, to: path }])
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
      .then((moves) => {
        const done = moves.map((m) => m.to)
        if (into === dir) pickAfter.current = { paths: done }
        refresh()
        if (into !== dir && done.length) notify(`${mode === 'move' ? 'Moved' : 'Copied'} ${plural(done.length, 'item')} to "${nameOf(into)}".`, 'info')
        if (!done.length) return
        if (mode === 'move') recordMoved(`Moved ${what(moves.map((m) => m.from))} to “${nameOf(into)}”`, moves)
        else recordAdded(`Copied ${what(done)} to “${nameOf(into)}”`, done)
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
    if (binView) return forget(list)
    const ok = await window.api.confirm({
      type: 'warning',
      message: list.length === 1 ? `Delete "${list[0].name}"?` : `Delete ${plural(list.length, 'item')}?`,
      detail: list.length === 1 && list[0].isDir ? `The folder and everything in it will be moved to the ${TRASH_NAME}.` : `They'll be moved to the ${TRASH_NAME}, so you can get them back.`,
      ok: `Move to ${TRASH_NAME}`
    })
    if (!ok) return
    try {
      await recordDeleted(await window.api.explorerTrash(list.map((e) => e.path)))
    } catch (err) {
      notify(err)
    }
    if (searching) setResults((r) => r && r.filter((e) => !list.includes(e)))
    refresh()
  }

  const togglePin = toggleFavourite

  // ---- the Recycle Bin / Bin ----

  const showBin = (): void => {
    setBinView(true)
    setTagView(null)
    setQuery('')
    pickOnly(null)
    listRef.current?.focus({ preventScroll: true })
  }
  const binOf = (list: ExplorerEntry[]): BinItem[] => list.map((e) => binItems.get(e.path)).filter((i): i is BinItem => !!i)
  /** Puts things back where they were (a folder that's gone is made again). */
  const putBack = (list: ExplorerEntry[]): void => {
    const items = binOf(list).filter((i) => i.from)
    if (!items.length) return notify(`Only Finder knows where that came from: open the ${TRASH_NAME} in Finder and choose Put Back.`)
    window.api
      .binRestore(items.map((i) => i.id))
      .then((back) => {
        refresh()
        undoChanged('files')
        notify(back.length === 1 ? `Put “${nameOf(back[0])}” back in “${nameOf(parentPath(back[0]) ?? back[0])}”.` : `Put ${plural(back.length, 'item')} back.`, 'info')
      })
      .catch((err) => (notify(err), refresh()))
  }
  /** Deletes for good, after asking. */
  const forget = async (list: ExplorerEntry[]): Promise<void> => {
    const items = binOf(list)
    if (!items.length) return
    const ok = await window.api.confirm({
      type: 'warning',
      message: items.length === 1 ? `Delete “${items[0].name}” for good?` : `Delete ${plural(items.length, 'item')} for good?`,
      detail: 'There’s no getting it back after this.',
      ok: 'Delete for good'
    })
    if (!ok) return
    await window.api.binDelete(items.map((i) => i.id)).catch(notify)
    pickOnly(null)
    refresh()
  }
  const emptyTheBin = async (): Promise<void> => {
    const n = bin?.items.length ?? 0
    if (!n) return
    const ok = await window.api.confirm({
      type: 'warning',
      message: `Empty the ${TRASH_NAME}?`,
      detail: `${plural(n, 'item')} will be deleted for good. There’s no getting them back after this.`,
      ok: `Empty ${TRASH_NAME}`
    })
    if (!ok) return
    const done = await window.api.binEmpty().catch((err) => (notify(err), 0))
    pickOnly(null)
    refresh()
    if (done) notify(`Emptied the ${TRASH_NAME} (${plural(done, 'item')}).`, 'info')
  }
  const binMenu = (entry: ExplorerEntry): MenuItem[] => {
    const list = targets(entry)
    const items = binOf(list)
    const one = items.length === 1 ? items[0] : null
    return [
      ...(items.some((i) => i.from) ? [{ label: list.length > 1 ? `Put ${list.length} items back` : 'Put back', icon: <Undo2 size={14} />, onClick: () => putBack(list) }] : []),
      ...(one?.from
        ? [
            {
              label: 'Show where it was',
              icon: <Folder size={14} />,
              onClick: () => {
                const p = parentPath(one.from!)
                if (p) go(p)
              }
            },
            { label: 'Copy where it was', icon: <Link size={14} />, onClick: () => void navigator.clipboard.writeText(one.from!) }
          ]
        : []),
      'separator',
      { label: list.length > 1 ? `Delete ${list.length} items for good` : 'Delete for good', icon: <Trash2 size={14} />, danger: true, onClick: () => void forget(list) }
    ]
  }

  /** Turns a colour tag on for all of these, or off when they all have it already. */
  const toggleTag = (list: ExplorerEntry[], colour: TagColour): void => {
    if (!list.length) return
    const paths = list.map((x) => x.path)
    const on = !sharedTags(tags, paths).includes(colour)
    window.api.tagsSet(paths, colour, on).catch(notify)
  }
  const clearTags = (list: ExplorerEntry[]): void => {
    const paths = list.map((x) => x.path)
    for (const c of TAG_COLOURS) if (paths.some((p) => tags.items[p]?.includes(c))) window.api.tagsSet(paths, c, false).catch(notify)
  }

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
    if (mod && key === 'f') return void (stop(), searchRef.current?.focus())
    // Alt+1…7 puts a colour tag on (or takes it off) what's picked; Alt+0 takes them all off.
    if (e.altKey && !mod && /^Digit[0-7]$/.test(e.code)) {
      stop()
      const n = Number(e.code.slice(5))
      return n === 0 ? clearTags(targets()) : toggleTag(targets(), TAG_COLOURS[n - 1])
    }
    if (e.key === 'F2' && current) return void (stop(), setRenaming(current.path))
    if (e.key === 'F5') return void (stop(), refreshAll())
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
    const list = picked.has(entry.path) ? pickedEntries : [entry]
    const paths = list.map((x) => x.path)
    // Dragged as real files, so they drop into Discord, a browser or File Explorer / Finder too.
    // In Orbit, files can also be dropped into a note (folders can't); the notes tree in the sidebar takes any of them.
    const files = list.filter((x) => !x.isDir).map((x) => x.path)
    dragFilesOut(e, paths, paths.length === 1 && !entry.isDir ? { kind: 'computer', path: entry.path } : { kind: 'computerMany', paths, files })
  }

  const dropProps = (target: string) => ({
    onDragOver: (e: DragEvent) => {
      const tree = getTreeDrag().length > 0
      if (!tree && !e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      e.stopPropagation()
      // From the notes tree: copied out of your notes (or moved, with Shift held).
      if (tree) {
        e.dataTransfer.dropEffect = e.shiftKey ? 'move' : 'copy'
        return setDropOn(target)
      }
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
      const tree = getTreeDrag()
      if (tree.length) {
        setTreeDrag([])
        setDrag(null)
        return void window.api
          .getVault()
          .then((root) => {
            if (!root) return
            const sep = root.includes('\\') ? '\\' : '/'
            pasteInto(tree.map((p) => `${root.replace(/[\\/]+$/, '')}${sep}${p.split('/').join(sep)}`), target, e.shiftKey ? 'move' : 'copy')
          })
          .catch(notify)
      }
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
            ...(entry.isDir
              ? [
                  { label: 'Open in a new tab', icon: <Plus size={14} />, onClick: () => openExplorerTab(entry.path) },
                  { label: 'Open beside', icon: <Columns2 size={14} />, onClick: () => openExplorerTab(entry.path, { beside: true }) }
                ]
              : []),
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
      ...(!many && isArchiveFile(entry.name)
        ? [
            { label: `Extract to “${archiveFolderName(entry.name)}”`, icon: <FolderOutput size={14} />, onClick: () => void extract(entry, { intoFolder: true }).catch(notify) },
            { label: 'Extract here', icon: <FolderInput size={14} />, onClick: () => void extract(entry, { intoFolder: false }).catch(notify) }
          ]
        : []),
      { label: 'Compress to .zip', icon: <FileArchive size={14} />, onClick: () => compress(list.map((x) => x.path), 'zip') },
      { label: 'Compress to .7z', icon: <FileArchive size={14} />, onClick: () => compress(list.map((x) => x.path), '7z') },
      { label: 'Compress with a password…', icon: <Lock size={14} />, onClick: () => setCompressing(list.map((x) => x.path)) },
      'separator',
      { custom: (close) => <TagPicker store={tags} paths={list.map((x) => x.path)} onPick={(c) => (close(), toggleTag(list, c))} onClear={() => (close(), clearTags(list))} /> },
      'separator',
      { label: many ? 'Copy paths' : 'Copy path', icon: <Link size={14} />, onClick: () => void navigator.clipboard.writeText(list.map((x) => x.path).join('\n')) },
      ...(entry.isDir && !many ? [{ label: pins.includes(entry.path) ? 'Remove from favourites' : 'Add to favourites', icon: pins.includes(entry.path) ? <StarOff size={14} /> : <Star size={14} />, onClick: () => togglePin(entry.path) }] : []),
      { label: `Show in ${FILE_MANAGER}`, icon: <FolderSearch size={14} />, onClick: () => window.api.explorerReveal(entry.path).catch(notify) },
      // Drop between devices: the other computer takes folders too; the phone only files.
      ...devices
        .filter((d) => d.id === 'computer' || list.every((x) => !x.isDir))
        .map((d) => ({
          label: `Send to ${d.name}`,
          icon: d.id === 'phone' ? <Smartphone size={14} /> : <Laptop size={14} />,
          onClick: () => sendToDevice(d, list.map((x) => x.path))
        })),
      'separator',
      { label: `Delete${many ? ` ${list.length} items` : ''}`, icon: <Trash2 size={14} />, danger: true, onClick: () => void remove(list) }
    ]
  }

  const folderMenu = (): MenuItem[] => [
    { label: 'New folder', icon: <FolderPlus size={14} />, onClick: () => create('folder') },
    { label: 'New text file', icon: <FilePlus size={14} />, onClick: () => create('file') },
    ...(clipped ? [{ label: `Paste ${clipped.paths.length === 1 ? '' : `${clipped.paths.length} items`}`.trim(), icon: <ClipboardPaste size={14} />, onClick: () => paste() }] : []),
    'separator',
    ...(dir
      ? [
          { label: 'Open this folder in a new tab', icon: <Plus size={14} />, onClick: () => openExplorerTab(dir) },
          { label: 'Open this folder beside', icon: <Columns2 size={14} />, onClick: () => openExplorerTab(dir, { beside: true }) }
        ]
      : []),
    { label: 'Refresh', icon: <RefreshCw size={14} />, onClick: refreshAll },
    ...(dir ? [{ label: pins.includes(dir) ? 'Remove this folder from favourites' : 'Add this folder to favourites', icon: <Star size={14} />, onClick: () => togglePin(dir) }] : []),
    ...(dir ? [{ label: `Open in ${FILE_MANAGER}`, icon: <FolderSearch size={14} />, onClick: () => window.api.explorerOpen(dir).catch(notify) }] : [])
  ]

  const pinMenu = (path: string): MenuItem[] => {
    const at = pins.indexOf(path)
    return [
      { label: 'Open', icon: <FolderOpen size={14} />, onClick: () => go(path) },
      { label: 'Open in a new tab', icon: <Plus size={14} />, onClick: () => openExplorerTab(path) },
      ...(at > 0 ? [{ label: 'Move up', icon: <ArrowUp size={14} />, onClick: () => moveFavourite(path, -1) }] : []),
      ...(at < pins.length - 1 ? [{ label: 'Move down', icon: <ArrowDown size={14} />, onClick: () => moveFavourite(path, 1) }] : []),
      { custom: (close) => <TagPicker store={tags} paths={[path]} onPick={(c) => (close(), window.api.tagsSet([path], c, !tags.items[path]?.includes(c)).catch(notify))} onClear={() => (close(), TAG_COLOURS.forEach((c) => tags.items[path]?.includes(c) && window.api.tagsSet([path], c, false).catch(notify)))} /> },
      { label: 'Remove from favourites', icon: <StarOff size={14} />, onClick: () => togglePin(path) }
    ]
  }

  /** Right-clicking a tag in the sidebar: give the colour a name. */
  const [naming, setNaming] = useState<TagColour | null>(null)
  const tagMenu = (c: TagColour): MenuItem[] => [
    { label: `Show everything tagged “${tagName(tags, c)}”`, icon: <Tag size={14} />, onClick: () => showTag(c) },
    { label: 'Rename this tag…', icon: <Pencil size={14} />, onClick: () => setNaming(c) },
    ...(tags.labels[c] ? [{ label: `Call it “${c[0].toUpperCase()}${c.slice(1)}” again`, icon: <X size={14} />, onClick: () => void window.api.tagsLabel(c, '').catch(notify) }] : [])
  ]
  const showTag = (c: TagColour): void => {
    setTagView(c)
    setQuery('')
    pickOnly(null)
    listRef.current?.focus({ preventScroll: true })
  }
  const counts = tagCounts(tags)
  const home = places.find((p) => p.kind === 'home')?.path ?? null
  /** Where a result is: "Documents › School" inside the folder searched, or the folder's path (from Home) for the whole PC. */
  const whereOf = (entry: ExplorerEntry): string => {
    if (searching && scope === 'subfolders' && dir) return whereIn(entry.path, dir) || nameOf(dir)
    const item = binView ? binItems.get(entry.path) : null
    if (binView && !item?.from) return item?.kind === 'orbit' ? 'Deleted in Orbit' : 'Put back from Finder'
    const at = item?.from ?? entry.path
    const folder = parentPath(at) ?? at
    if (home && folder.toLowerCase().startsWith(home.toLowerCase())) return ['Home', ...crumbsOf(folder).slice(crumbsOf(home).length).map((c) => c.name)].join(' › ')
    return crumbsOf(folder).map((c) => c.name).filter((n) => n !== '/').join(' › ') || folder
  }

  const placeOf = (p: string): ExplorerPlace | undefined => places.find((pl) => pl.path === p)
  // Inside Home, Google Drive or the like, the breadcrumbs start there rather than at the top of the drive.
  const allCrumbs = dir ? crumbsOf(dir) : []
  const from = allCrumbs.findIndex((c) => placeOf(c.path) && placeOf(c.path)!.kind !== 'drive')
  const crumbs = from > 0 ? allCrumbs.slice(from) : allCrumbs
  const cut = clipped?.mode === 'move' ? new Set(clipped.paths) : null

  const placeButton = (key: string, path: string, label: string, Icon: typeof Folder, kind: string, pinned = false) => (
    <button
      key={key}
      className={`explorer-place ${kind} ${dir === path && !tagView ? 'active' : ''} ${dropOn === path ? 'drop' : ''}`}
      style={tags.items[path]?.length ? { ['--tag' as string]: TAG_HEX[tags.items[path][0]] } : undefined}
      onClick={() => go(path)}
      onAuxClick={(e) => e.button === 1 && openExplorerTab(path)}
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
          <div className="explorer-group" data-explorer-favourites>
            <div className="explorer-group-title">Favourites</div>
            {pins.map((p) => placeButton(`pin-${p}`, p, nameOf(p), Star, 'pinned', true))}
            {!pins.length && <div className="explorer-group-hint">Star a folder (☆ at the top, or right-click it) to keep it here.</div>}
          </div>
          {(['folders', 'drives'] as const).map((group) => (
            <div key={group} className="explorer-group">
              <div className="explorer-group-title">{group === 'folders' ? 'Places' : 'Drives'}</div>
              {places.filter((p) => (p.kind === 'drive') === (group === 'drives')).map((p) => placeButton(p.id, p.path, p.label, PLACE_ICONS[p.kind], p.kind))}
              {group === 'folders' && (
                <button
                  className={`explorer-place bin ${binView ? 'active' : ''} ${dropOn === '::bin' ? 'drop' : ''}`}
                  onClick={showBin}
                  title={`What’s in the ${TRASH_NAME}: put things back, or delete them for good. Drop files here to delete them.`}
                  onDragOver={(e) => {
                    if (!computerPaths(getDrag()).length) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    setDropOn('::bin')
                  }}
                  onDragLeave={() => setDropOn((d) => (d === '::bin' ? null : d))}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDropOn(null)
                    const paths = computerPaths(getDrag())
                    setDrag(null)
                    if (paths.length) void remove(paths.map((p) => shown.find((x) => x.path === p) ?? { name: nameOf(p), path: p, isDir: false, size: 0, modified: 0, hidden: false, vaultPath: null }))
                  }}
                  data-explorer-bin
                >
                  <Trash2 size={15} />
                  <span>{TRASH_NAME}</span>
                </button>
              )}
            </div>
          ))}
          <div className="explorer-group" data-explorer-tags>
            <div className="explorer-group-title">Tags</div>
            {TAG_COLOURS.map((c) => (
              <button
                key={c}
                className={`explorer-place tag ${tagView === c ? 'active' : ''} ${counts[c] ? '' : 'unused'}`}
                onClick={() => showTag(c)}
                onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, entry: null, tag: c }))}
                title={counts[c] ? `Everything tagged ${tagName(tags, c)} (right-click to rename the tag)` : `Nothing is tagged ${tagName(tags, c)} yet. Right-click a file and pick this colour, or press Alt+${TAG_COLOURS.indexOf(c) + 1}.`}
              >
                <span className="tag-dot" style={{ background: TAG_HEX[c] }} />
                <span>{tagName(tags, c)}</span>
                {counts[c] > 0 && <small>{counts[c]}</small>}
              </button>
            ))}
          </div>
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
            <button className="icon-btn" onClick={() => openExplorerTab(dir ?? undefined)} title="Open this folder in a new tab (or middle-click any folder)">
              <Plus size={15} />
            </button>
            <button className="icon-btn" onClick={() => openExplorerTab(dir ?? undefined, { beside: true })} title="Open this folder beside, to drag files between the two">
              <Columns2 size={15} />
            </button>
            {binView ? (
              <div className="explorer-crumbs explorer-tag-title explorer-bin-title">
                <Trash2 size={14} />
                <strong>{TRASH_NAME}</strong>
                <span>{bin ? plural(bin.items.length, 'item') : ''}</span>
                <button className="btn" disabled={!binOf(targets()).some((i) => i.from)} onClick={() => putBack(targets())} title="Put the picked items back where they were" data-bin-restore>
                  <Undo2 size={13} /> Put back
                </button>
                <button className="btn danger" disabled={!bin?.items.length} onClick={() => void emptyTheBin()} data-bin-empty>
                  <Trash2 size={13} /> Empty {TRASH_NAME}
                </button>
                <button className="icon-btn" onClick={() => void window.api.binOpenSystem().catch(notify)} title={`Open the ${TRASH_NAME} in ${FILE_MANAGER}`}>
                  <ExternalLink size={14} />
                </button>
              </div>
            ) : tagView ? (
              <div className="explorer-crumbs explorer-tag-title">
                <span className="tag-dot" style={{ background: TAG_HEX[tagView] }} />
                <strong>{tagName(tags, tagView)}</strong>
                <span>everything with this tag, from anywhere on the computer</span>
                <button className="icon-btn" onClick={() => go(dir ?? '')} title="Back to the folder">
                  <X size={14} />
                </button>
              </div>
            ) : address !== null ? (
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
            {dir && !tagView && !binView && (
              <button className={`icon-btn explorer-star ${pins.includes(dir) ? 'on' : ''}`} onClick={() => togglePin(dir)} title={pins.includes(dir) ? 'Remove this folder from favourites' : 'Add this folder to favourites'} data-explorer-star>
                <Star size={15} fill={pins.includes(dir) ? 'currentColor' : 'none'} />
              </button>
            )}
          </div>

          <div className="explorer-tools">
            {!binView && (
              <>
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
              </>
            )}
            <span className="explorer-count">
              {picked.size > 1
                ? `${picked.size} picked`
                : binView
                  ? ' '
                  : tagView
                  ? tagged
                    ? plural(shown.length, 'item')
                    : ' '
                  : searching
                    ? results
                      ? `${results.length >= (scope === 'pc' ? PC_SEARCH_LIMIT : SEARCH_LIMIT) ? `${scope === 'pc' ? PC_SEARCH_LIMIT : SEARCH_LIMIT}+` : results.length} found`
                      : 'Searching…'
                    : entries
                      ? plural(shown.length, 'item')
                      : ' '}
            </span>
            <div className="explorer-spacer" />
            <label className={`explorer-search ${scope === 'pc' ? 'pc' : ''}`}>
              <Search size={13} />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') return void (setQuery(''), listRef.current?.focus())
                  // Down arrow (or Enter) goes to the results, to pick one with the keyboard.
                  if ((e.key === 'ArrowDown' || e.key === 'Enter') && visible.length) {
                    e.preventDefault()
                    pickOnly(visible[0].path)
                    listRef.current?.focus({ preventScroll: true })
                  }
                }}
                placeholder={binView ? `Search the ${TRASH_NAME}` : tagView ? `Search ${tagName(tags, tagView)}` : scope === 'pc' ? 'Search the whole PC' : scope === 'subfolders' ? 'Search all subfolders' : 'Search here'}
                spellCheck={false}
                data-explorer-search
              />
            </label>
            {!tagView && !binView && (
              <div className="explorer-scope" role="radiogroup" title="Where to search">
                {(
                  [
                    ['here', 'Here', 'Only this folder'],
                    ['subfolders', 'Subfolders', 'This folder and every folder inside it'],
                    ['pc', 'Whole PC', 'Every file and folder on this computer, as you type (Ctrl+K → “Search the whole PC”)']
                  ] as const
                ).map(([id, label, title]) => (
                  <button key={id} role="radio" aria-checked={scope === id} className={scope === id ? 'on' : ''} onClick={() => (setScope(id), searchRef.current?.focus())} title={title} data-scope={id}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            <select className="select explorer-sort" value={sort} onChange={(e) => setSort(e.target.value as ExplorerSort)} title="Sort by">
              <option value="name">Name</option>
              <option value="modified">Newest first</option>
              <option value="size">Biggest first</option>
            </select>
            <button className="icon-btn" onClick={() => setShowHidden(!showHidden)} title={showHidden ? 'Hide hidden files' : 'Show hidden files'}>
              {showHidden ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <button className="icon-btn" onClick={refreshAll} title="Refresh (F5)">
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
            {...(dir && !scattered ? dropProps(dir) : {})}
            data-explorer-list
          >
            {(binView ? !bin : tagView ? !tagged : searching ? !results : !entries) && (
              <div className="explorer-empty">
                <Loader2 size={18} className="spin" />
              </div>
            )}
            {(binView ? bin : tagView ? tagged : searching ? results : entries) && !shown.length && (
              <div className="explorer-empty">
                {binView
                  ? bin?.blocked
                    ? (
                      <span className="explorer-bin-blocked">
                        macOS only lets apps look in the Bin once you allow it: System Settings → Privacy &amp; Security → Full Disk Access → turn on Orbit.{' '}
                        <button className="link-btn" onClick={() => void window.api.binMacPrivacy()}>
                          Open that setting
                        </button>{' '}
                        or{' '}
                        <button className="link-btn" onClick={() => void window.api.binOpenSystem()}>
                          open the Bin in Finder
                        </button>
                      </span>
                    )
                    : query
                      ? `Nothing in the ${TRASH_NAME} matches that.`
                      : `The ${TRASH_NAME} is empty.`
                  : tagView
                  ? query
                    ? 'Nothing with this tag matches that.'
                    : `Nothing is tagged ${tagName(tags, tagView)} yet. Right-click any file or folder and pick this colour (or press Alt+${TAG_COLOURS.indexOf(tagView) + 1}).`
                  : searching && scope === 'pc' && indexStatus && indexStatus.state !== 'ready' && !systemToo
                    ? indexStatus.state === 'off'
                      ? 'Whole PC search is off. Turn it on in Settings → Files.'
                      : 'Orbit is still making its list of your files. Results will show here as soon as it’s ready.'
                    : (error ?? (query ? (scope === 'pc' ? 'Nothing on this computer is called that.' : 'Nothing here matches that.') : 'This folder is empty. Drop files here to copy them in.'))}
              </div>
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
                // Middle-click a folder: it opens in a new Files tab, like in a browser.
                onMouseDown={(e) => entry.isDir && e.button === 1 && e.preventDefault()}
                onAuxClick={(e) => entry.isDir && e.button === 1 && openExplorerTab(entry.path)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (!picked.has(entry.path)) pickOnly(entry.path)
                  else setSelected(entry.path)
                  setMenu({ x: e.clientX, y: e.clientY, entry })
                }}
                {...(entry.isDir ? dropProps(entry.path) : {})}
                title={entry.path}
              >
                <span className="explorer-icon" style={entry.isDir && tags.items[entry.path]?.length ? { color: TAG_HEX[tags.items[entry.path][0]] } : undefined}>
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
                    {scattered && view === 'list' && <small className="explorer-in">{whereOf(entry)}</small>}
                  </span>
                )}
                {!binView && <TagDots colours={tags.items[entry.path]} store={tags} />}
                {view === 'list' && (
                  <>
                    <span className="explorer-date">{describeModified(entry.modified)}</span>
                    <span className="explorer-size">{entry.isDir ? <FolderSizeText size={folderSizes.get(entry.path)} /> : describeBytes(entry.size)}</span>
                  </>
                )}
              </div>
            ))}
            {shown.length > MAX_SHOWN && <div className="explorer-more">Showing the first {MAX_SHOWN}. Search to find the rest.</div>}
            {searching && scope !== 'pc' && results && results.length >= SEARCH_LIMIT && <div className="explorer-more">Showing the first {SEARCH_LIMIT} matches. Type more to narrow it down.</div>}
            {searching && scope === 'pc' && results && results.length >= PC_SEARCH_LIMIT && <div className="explorer-more">Showing the best {PC_SEARCH_LIMIT} matches. Type more to narrow it down.</div>}
          </div>
          {scope === 'pc' && !tagView && <IndexFooter status={indexStatus} system={systemToo} />}
        </section>

        <Preview binItem={current && binView ? binItems.get(current.path) : undefined} onPutBack={(e) => putBack([e])} onForget={(e) => void forget([e])} entry={picked.size > 1 ? null : current} count={picked.size} folderSize={current?.isDir ? folderSizes.get(current.path) : undefined} tags={tags} onTag={(e, c) => toggleTag([e], c)} onClearTags={(e) => clearTags([e])} onOpen={open} onRename={(e) => setRenaming(e.path)} onDelete={(e) => void remove([e])} onExtract={extract} />
      </div>
      {naming && <TagNameDialog colour={naming} store={tags} onClose={() => setNaming(null)} />}
      {compressing && (
        <CompressDialog
          count={compressing.length}
          onClose={() => setCompressing(null)}
          onDone={(format, password) => {
            compress(compressing, format, password)
            setCompressing(null)
          }}
        />
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.tag ? tagMenu(menu.tag) : menu.pin ? pinMenu(menu.pin) : menu.entry ? (binView ? binMenu(menu.entry) : itemMenu(menu.entry)) : binView ? [] : folderMenu()} onClose={closeMenu} />
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
  onDelete,
  onExtract,
  tags,
  onTag,
  onClearTags,
  folderSize,
  binItem,
  onPutBack,
  onForget
}: {
  binItem?: BinItem
  onPutBack: (e: ExplorerEntry) => void
  onForget: (e: ExplorerEntry) => void
  folderSize?: FolderSize | null
  entry: ExplorerEntry | null
  count: number
  tags: FileTagStore
  onTag: (e: ExplorerEntry, c: TagColour) => void
  onClearTags: (e: ExplorerEntry) => void
  onOpen: (e: ExplorerEntry) => void
  onRename: (e: ExplorerEntry) => void
  onDelete: (e: ExplorerEntry) => void
  onExtract: (e: ExplorerEntry, opts: { names?: string[]; password?: string; intoFolder: boolean }) => Promise<boolean>
}) {
  const [text, setText] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const kind = entry && !entry.isDir ? previewKind(entry.name) : 'none'

  // Moving on from a file (or closing the explorer) lets go of it, so it can be deleted or moved.
  useEffect(() => {
    const path = entry && !entry.isDir ? entry.path : null
    return () => void (path && window.api.releaseFile(path).catch(() => undefined))
  }, [entry?.path])

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
  const archive = !entry.isDir && isArchiveFile(entry.name)
  return (
    <aside className="explorer-preview" key={entry.path} data-explorer-preview>
      {archive ? (
        <ArchivePreview entry={entry} onExtract={(opts) => onExtract(entry, opts)} />
      ) : (
        <div className={`explorer-look ${kind}`}>
          {failed || kind === 'none' ? (
            entry.isDir ? <FolderOpen size={56} strokeWidth={1.2} /> : <FileIcon path={entry.name} size={56} />
          ) : kind === 'image' ? (
            <img src={url} alt="" onError={() => setFailed(true)} draggable={false} />
          ) : kind === 'video' ? (
            <video ref={releaseOnUnmount} src={url} controls onError={() => setFailed(true)} />
          ) : kind === 'audio' ? (
            <>
              <Music size={44} strokeWidth={1.2} />
              <audio ref={releaseOnUnmount} src={url} controls onError={() => setFailed(true)} />
            </>
          ) : kind === 'pdf' ? (
            <iframe src={url} title={entry.name} />
          ) : text === null ? (
            <Loader2 size={18} className="spin" />
          ) : (
            <pre>{text || 'This file is empty.'}</pre>
          )}
        </div>
      )}
      <h3 title={entry.name}>{entry.name}</h3>
      <dl>
        {!entry.isDir ? (
          <>
            <dt>Size</dt>
            <dd>{describeBytes(entry.size)}</dd>
          </>
        ) : (
          folderSize !== null && (
            <>
              <dt>Size</dt>
              <dd data-explorer-folder-size>
                {!folderSize
                  ? 'Adding it up…'
                  : `${folderSize.counting ? `${describeBytes(folderSize.bytes)} so far` : describeFolderSize(folderSize)} · ${folderSize.files.toLocaleString()} file${folderSize.files === 1 ? '' : 's'}${folderSize.folders ? `, ${folderSize.folders.toLocaleString()} folder${folderSize.folders === 1 ? '' : 's'}` : ''}`}
              </dd>
            </>
          )
        )}
        {binItem ? (
          <>
            <dt>Deleted</dt>
            <dd>{entry.modified ? new Date(entry.modified).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not known'}</dd>
            <dt>Was in</dt>
            <dd className="explorer-where">{binItem.from ? (parentPath(binItem.from) ?? binItem.from) : binItem.kind === 'orbit' ? 'Deleted in Orbit' : 'Only Finder knows (use Put Back there)'}</dd>
          </>
        ) : (
          <>
        <dt>Changed</dt>
        <dd>{new Date(entry.modified).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</dd>
        <dt>Where</dt>
        <dd className="explorer-where">{entry.path}</dd>
        <dt>Tags</dt>
        <dd>
          <TagPicker store={tags} paths={[entry.path]} onPick={(c) => onTag(entry, c)} onClear={() => onClearTags(entry)} small />
        </dd>
          </>
        )}
      </dl>
      {binItem ? (
        <div className="explorer-actions" data-bin-actions>
          {binItem.from && (
            <button className="btn btn-primary" onClick={() => onPutBack(entry)}>
              <Undo2 size={13} /> Put back
            </button>
          )}
          <button className="btn danger" onClick={() => onForget(entry)}>
            <Trash2 size={13} /> Delete for good
          </button>
        </div>
      ) : (
        <>
      <div className="explorer-actions">
        <button className="btn btn-primary" onClick={() => onOpen(entry)}>
          {entry.isDir ? <FolderOpen size={13} /> : <ExternalLink size={13} />} Open
        </button>
        {kind === 'pdf' && (
          <button className="btn" onClick={() => void openInPdfEditor(entry.name, url).catch(notify)} title="Sign it, fill it in, or change its pages" data-explorer-edit-pdf>
            <FilePen size={13} /> Edit PDF
          </button>
        )}
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
        </>
      )}
    </aside>
  )
}

/** The little coloured dots after a tagged item's name. */
function TagDots({ colours, store }: { colours: TagColour[] | undefined; store: FileTagStore }) {
  if (!colours?.length) return null
  return (
    <span className="explorer-tags" title={colours.map((c) => tagName(store, c)).join(', ')}>
      {colours.map((c) => (
        <span key={c} className="tag-dot" style={{ background: TAG_HEX[c] }} />
      ))}
    </span>
  )
}

/** A row of the seven colours: click one to put it on (or take it off). Used in menus and the preview. */
function TagPicker({ store, paths, onPick, onClear, small }: { store: FileTagStore; paths: string[]; onPick: (c: TagColour) => void; onClear: () => void; small?: boolean }) {
  const on = sharedTags(store, paths)
  const any = paths.some((p) => store.items[p]?.length)
  return (
    <div className={`tag-picker ${small ? 'small' : ''}`} data-tag-picker>
      {!small && <span className="tag-picker-label">Tags</span>}
      {TAG_COLOURS.map((c, i) => (
        <button
          key={c}
          className={`tag-swatch ${on.includes(c) ? 'on' : ''}`}
          style={{ ['--tag' as string]: TAG_HEX[c] }}
          onClick={(e) => (e.stopPropagation(), onPick(c))}
          title={`${tagName(store, c)} (Alt+${i + 1})`}
          aria-pressed={on.includes(c)}
          data-tag={c}
        />
      ))}
      {any && (
        <button className="tag-clear" onClick={(e) => (e.stopPropagation(), onClear())} title="Take all tags off (Alt+0)">
          <X size={12} />
        </button>
      )}
    </div>
  )
}

/** Giving a tag colour a name of its own ("School", "Urgent"). */
function TagNameDialog({ colour, store, onClose }: { colour: TagColour; store: FileTagStore; onClose: () => void }) {
  const [name, setName] = useState(tagName(store, colour))
  const save = (): void => {
    window.api.tagsLabel(colour, name).catch(notify)
    onClose()
  }
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal explorer-compress explorer-tag-dialog"
        role="dialog"
        aria-label="Rename tag"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
        }}
        onSubmit={(e) => (e.preventDefault(), save())}
      >
        <h3>
          <span className="tag-dot" style={{ background: TAG_HEX[colour] }} /> Rename the {TAG_DEFAULT_NAMES[colour].toLowerCase()} tag
        </h3>
        <input autoFocus value={name} maxLength={40} onFocus={(e) => e.target.select()} onChange={(e) => setName(e.target.value)} placeholder={TAG_DEFAULT_NAMES[colour]} />
        <p className="explorer-hint">Like “School” or “Urgent”. Leave it empty to call it {TAG_DEFAULT_NAMES[colour]} again.</p>
        <div className="explorer-actions">
          <button className="btn btn-primary" type="submit">
            Save
          </button>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

/** Under Whole PC results: how many files Orbit knows about, and whether it's still making the list. */
function IndexFooter({ status, system }: { status: (PcIndexStatus & { everything?: boolean; wanted?: boolean }) | null; system: boolean }) {
  if (!status) return null
  const extra = system ? (navigator.userAgent.includes('Mac') ? ' Spotlight’s results are included too.' : ' Everything’s results are included too.') : ''
  let text: string
  if (status.state === 'off') text = 'Whole PC search is off in Settings → Files.'
  else if (status.state === 'loading') text = 'Getting the list of your files ready…'
  else if (status.state === 'building') text = `Making the list of your files: ${describeCount(status.progress)} found so far. This only takes this long the first time.`
  else {
    const updating = status.progress > 0 ? ` Checking for changes (${describeCount(status.progress)} so far).` : ''
    text = `Searching ${describeCount(status.count)} files and folders${status.live ? ', kept up to date as they change' : ''}.${updating}${extra}`
  }
  return (
    <div className="explorer-index" data-explorer-index>
      {status.state === 'building' || status.state === 'loading' || status.progress > 0 ? <Loader2 size={12} className="spin" /> : <HardDrive size={12} />}
      <span>{text}</span>
      {status.state === 'ready' && (
        <button className="link-btn" onClick={() => void window.api.explorerReindex()} title="Walk every drive again now (it also happens each time Orbit starts)">
          Update now
        </button>
      )}
    </div>
  )
}

/** A folder's size in the size column: "…" while it's being added up, then the total. */
function FolderSizeText({ size }: { size: FolderSize | null | undefined }) {
  if (size === null) return null
  if (!size) return <span className="explorer-size-counting" title="Adding up everything inside…">…</span>
  if (size.counting) return <span className="explorer-size-counting" title="Still adding it up">{describeBytes(size.bytes)}…</span>
  return <span title={`${size.files.toLocaleString()} files in ${size.folders.toLocaleString()} folders${size.complete ? '' : '. Some of it is private to the system, so it’s at least this big.'}`}>{describeFolderSize(size)}</span>
}
