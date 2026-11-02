import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { ArrowLeft, Bookmark as BookmarkIcon, ChevronDown, ChevronsRight, Copy, Folder, Pencil, Trash2 } from 'lucide-react'
import { childrenOf, descendantIds, hostOf, type Bookmark } from '@shared/browser'
import { showKeys } from '@shared/platform'
import { addBookmark, placeBookmark, removeBookmark, useBrowser } from '../../store/browser'
import { openWebTab } from '../../lib/editorController'
import ContextMenu, { type MenuItem } from '../ContextMenu'
import SiteIcon from './SiteIcon'

/** What a dragged bookmark carries (its id), alongside its address for dropping into notes or pages. */
export const BOOKMARK_DRAG = 'application/x-orbit-bookmark'

/** Starts dragging a bookmark: Orbit's own id, plus the link for anywhere else it's dropped. */
export function dragBookmark(e: DragEvent, b: Bookmark): void {
  e.dataTransfer.setData(BOOKMARK_DRAG, b.id)
  if (b.url) {
    e.dataTransfer.setData('text/uri-list', b.url)
    e.dataTransfer.setData('text/plain', b.url)
    e.dataTransfer.setData('text/html', `<a href="${b.url.replace(/"/g, '&quot;')}">${(b.title || b.url).replace(/</g, '&lt;')}</a>`)
  }
  e.dataTransfer.effectAllowed = 'copyMove'
}

const canDrop = (e: DragEvent): boolean => e.dataTransfer.types.includes(BOOKMARK_DRAG) || e.dataTransfer.types.includes('text/uri-list')

/** A link dropped from a web page (or another app): its address and the link's text. */
function droppedLink(e: DragEvent): { url: string; title: string } | null {
  const url = (e.dataTransfer.getData('text/uri-list') || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'))
  if (!url || !hostOf(url)) return null
  const html = e.dataTransfer.getData('text/html')
  const text = html ? (new DOMParser().parseFromString(html, 'text/html').querySelector('a')?.textContent ?? '').replace(/\s+/g, ' ').trim() : ''
  return { url, title: text && !/^https?:\/\//i.test(text) ? text : hostOf(url) }
}

/**
 * Drops something at `index` among `parent`'s bookmarks (or into the folder `into`): a bookmark
 * being moved, or a link dragged from a page, which becomes a bookmark there.
 */
function dropInto(e: DragEvent, parent: string, index: number | undefined, into?: string): void {
  const all = useBrowser.getState().bookmarks
  const id = e.dataTransfer.getData(BOOKMARK_DRAG)
  const target = into ?? parent
  if (id) {
    const item = all.find((b) => b.id === id)
    if (!item || (item.kind === 'folder' && descendantIds(all, id).has(target))) return
    // Moving along the same list: the places after it shift down one once it's taken out.
    let at = index
    if (at !== undefined && !into && item.parent === parent) {
      const from = childrenOf(all, parent).findIndex((b) => b.id === id)
      if (from !== -1 && from < at) at--
    }
    placeBookmark(id, target, into ? undefined : at)
    return
  }
  const link = droppedLink(e)
  if (!link) return
  const b = addBookmark(link.url, link.title, target)
  placeBookmark(b.id, target, into ? undefined : index)
}

interface DropAt {
  /** Before this place in the list (the list's length: at the end). */
  index?: number
  /** Into this folder. */
  into?: string
}

/** Where the pointer is among a list's buttons: between two (by their middle), or over a folder. */
function dropPlace(e: DragEvent, buttons: HTMLElement[], vertical: boolean, folders: Set<string>): DropAt {
  for (let i = 0; i < buttons.length; i++) {
    const r = buttons[i].getBoundingClientRect()
    const pos = vertical ? e.clientY : e.clientX
    const start = vertical ? r.top : r.left
    const size = vertical ? r.height : r.width
    if (pos > start + size) continue
    const id = buttons[i].dataset.bookmark ?? ''
    // The middle half of a folder drops into it.
    if (folders.has(id) && pos > start + size * 0.25 && pos < start + size * 0.75) return { into: id }
    return { index: pos < start + size / 2 ? i : i + 1 }
  }
  return { index: buttons.length }
}

/**
 * A folder's bookmarks as a drop-down (from the bar, or the » menu for what doesn't fit): folders
 * open in place with a way back. Bookmarks can be dragged out (onto the bar, into another folder),
 * and things dragged in are dropped where the line shows.
 */
function FolderMenu({
  root,
  rootItems,
  x,
  y,
  onOpen,
  onMenu,
  onClose
}: {
  root: string
  /** Shown instead of `root`'s own bookmarks at the top (the » menu's overflow). */
  rootItems?: Bookmark[]
  x: number
  y: number
  onOpen: (url: string, newTab: boolean) => void
  onMenu: (e: ReactMouseEvent, b: Bookmark) => void
  onClose: () => void
}) {
  const all = useBrowser((s) => s.bookmarks)
  const [path, setPath] = useState<string[]>([root])
  const [drop, setDrop] = useState<DropAt | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const here = path[path.length - 1]
  const items = path.length === 1 && rootItems ? rootItems : childrenOf(all, here)
  // The » menu's list is the end of the bar: a drop at its place n is the bar's place offset + n.
  const offset = path.length === 1 && rootItems ? childrenOf(all, root).length - rootItems.length : 0
  useEffect(() => {
    const away = (e: MouseEvent): void => {
      if (!(e.target as Element).closest?.('.web-folder-menu, .menu.fixed')) onClose()
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [onClose])
  const buttons = (): HTMLElement[] => [...(list.current?.querySelectorAll<HTMLElement>('[data-bookmark]') ?? [])]
  const folders = new Set(items.filter((b) => b.kind === 'folder').map((b) => b.id))
  return (
    <div
      className="menu web-folder-menu"
      style={{ left: Math.min(x, window.innerWidth - 280), top: y }}
      onDragOver={(e) => {
        if (!canDrop(e)) return
        e.preventDefault()
        setDrop(dropPlace(e, buttons(), true, folders))
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrop(null)}
      onDrop={(e) => {
        e.preventDefault()
        const at = dropPlace(e, buttons(), true, folders)
        setDrop(null)
        dropInto(e, here, at.index === undefined ? undefined : at.index + offset, at.into)
      }}
      data-folder-menu={here}
    >
      {path.length > 1 && (
        <button type="button" onClick={() => setPath(path.slice(0, -1))}>
          <ArrowLeft size={14} /> Back
        </button>
      )}
      <div ref={list}>
        {items.length === 0 && <span className="web-folder-empty">Empty folder. Drag bookmarks here.</span>}
        {items.map((b, i) => (
          <button
            type="button"
            key={b.id}
            data-bookmark={b.id}
            className={`${drop?.into === b.id ? 'drop-into' : ''} ${drop?.index === i ? 'drop-before' : ''} ${drop?.index === items.length && i === items.length - 1 ? 'drop-after' : ''}`}
            title={b.url ?? b.title}
            draggable
            onDragStart={(e) => dragBookmark(e, b)}
            onClick={(e) => (b.kind === 'folder' ? setPath([...path, b.id]) : onOpen(b.url!, e.ctrlKey || e.metaKey))}
            onAuxClick={(e) => e.button === 1 && b.url && onOpen(b.url, true)}
            onContextMenu={(e) => onMenu(e, b)}
          >
            {b.kind === 'folder' ? <Folder size={14} /> : <SiteIcon url={b.url!} size={14} />} <span className="web-folder-title">{b.title || (b.url ? hostOf(b.url) : 'Folder')}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * The bookmarks bar under the address bar, like Chrome's and Opera GX's: each site with its own
 * icon, folders as drop-downs, a » menu for what doesn't fit, and drag and drop: along the bar, in
 * and out of folders, and links dragged in from a page.
 */
export default function BookmarksBar({ isPrivate, onOpen, onManage }: { isPrivate: boolean; onOpen: (url: string, newTab: boolean) => void; onManage: () => void }) {
  const bookmarks = useBrowser((s) => s.bookmarks)
  const items = useMemo(() => childrenOf(bookmarks, 'bar'), [bookmarks])
  const bar = useRef<HTMLDivElement>(null)
  const tail = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<{ root: string; overflow?: boolean; x: number; y: number } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [drop, setDrop] = useState<DropAt | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // How many fit: everything is laid out once for this list (and width), then whatever runs past
  // the end goes in the » menu. The answer is kept with the list it was measured for.
  const [measured, setMeasured] = useState<{ list: Bookmark[] | null; fit: number }>({ list: null, fit: Infinity })
  const fit = measured.list === items ? measured.fit : Infinity
  useLayoutEffect(() => {
    if (measured.list === items || !bar.current) return
    // A tab that's hidden has no width: it's measured when it shows (the resize below).
    if (!bar.current.clientWidth) return
    const room = bar.current.clientWidth - (tail.current?.offsetWidth ?? 0) - 12
    const buttons = [...bar.current.querySelectorAll<HTMLElement>('.web-bookmark[data-bookmark]')]
    const over = buttons.findIndex((b) => b.offsetLeft + b.offsetWidth > room)
    setMeasured({ list: items, fit: over === -1 ? Infinity : over })
  }, [items, measured])
  useEffect(() => {
    const el = bar.current
    if (!el) return
    let width = el.clientWidth
    const watch = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - width) < 2) return
      width = el.clientWidth
      setMeasured({ list: null, fit: Infinity })
    })
    watch.observe(el)
    return () => watch.disconnect()
  }, [])

  const shown = fit === Infinity ? items : items.slice(0, fit)
  const hidden = fit === Infinity ? [] : items.slice(fit)
  const folders = new Set(items.filter((b) => b.kind === 'folder').map((b) => b.id))
  const buttons = (): HTMLElement[] => [...(bar.current?.querySelectorAll<HTMLElement>('.web-bookmark[data-bookmark]') ?? [])]

  const contextMenu = (e: ReactMouseEvent, b: Bookmark): void => {
    e.preventDefault()
    e.stopPropagation()
    const list: MenuItem[] = b.url
      ? [
          { label: 'Open in new tab', onClick: () => openWebTab(b.url!, { privately: isPrivate }) },
          ...(isPrivate ? [] : [{ label: 'Open in private tab', onClick: () => openWebTab(b.url!, { privately: true }) }]),
          { label: 'Copy link', icon: <Copy size={14} />, onClick: () => void navigator.clipboard.writeText(b.url!) },
          'separator'
        ]
      : []
    list.push({ label: 'Edit in Bookmarks…', icon: <Pencil size={14} />, onClick: onManage }, { label: b.kind === 'folder' ? 'Delete folder' : 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => removeBookmark(b.id) })
    setMenu({ x: e.clientX, y: e.clientY, items: list })
  }

  const openFolder = (el: HTMLElement, root: string, overflow = false): void => {
    const r = el.getBoundingClientRect()
    setOpen({ root, overflow, x: r.left, y: r.bottom + 2 })
  }

  return (
    <div
      ref={bar}
      className="web-bookmarks-bar"
      data-bookmarks-bar
      onDragOver={(e) => {
        if (!canDrop(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = e.dataTransfer.types.includes(BOOKMARK_DRAG) ? 'move' : 'copy'
        setDrop(dropPlace(e, buttons(), false, folders))
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setDrop(null)
        clearTimeout(hoverTimer.current)
      }}
      onDrop={(e) => {
        e.preventDefault()
        clearTimeout(hoverTimer.current)
        const at = dropPlace(e, buttons(), false, folders)
        setDrop(null)
        setOpen(null)
        dropInto(e, 'bar', at.index, at.into)
      }}
    >
      {items.length === 0 && <span className="web-bookmarks-hint">Bookmarks you add (☆ or {showKeys('Ctrl+D')}) show here. You can drag links here too.</span>}
      {shown.map((b, i) => (
        <button
          key={b.id}
          data-bookmark={b.id}
          className={`web-bookmark ${drop?.into === b.id ? 'drop-into' : ''} ${drop?.index === i ? 'drop-before' : ''} ${drop?.index === shown.length && i === shown.length - 1 ? 'drop-after' : ''} ${open?.root === b.id ? 'open' : ''}`}
          title={b.url ?? b.title}
          draggable
          onDragStart={(e) => dragBookmark(e, b)}
          onDragEnter={(e) => {
            // Holding something over a folder opens it, so it can be dropped further in.
            if (b.kind !== 'folder' || !canDrop(e)) return
            clearTimeout(hoverTimer.current)
            const el = e.currentTarget
            hoverTimer.current = setTimeout(() => openFolder(el, b.id), 600)
          }}
          onDragLeave={() => clearTimeout(hoverTimer.current)}
          onClick={(e) => (b.kind === 'folder' ? (open?.root === b.id ? setOpen(null) : openFolder(e.currentTarget, b.id)) : onOpen(b.url!, e.ctrlKey || e.metaKey))}
          onAuxClick={(e) => e.button === 1 && b.url && onOpen(b.url, true)}
          onContextMenu={(e) => contextMenu(e, b)}
        >
          {b.kind === 'folder' ? <Folder size={13} /> : <SiteIcon url={b.url!} size={14} />}
          <span>{b.title || (b.url ? hostOf(b.url) : 'Folder')}</span>
          {b.kind === 'folder' && <ChevronDown size={11} />}
        </button>
      ))}
      <div className="web-bookmarks-tail" ref={tail}>
        {hidden.length > 0 && (
          <button className="web-bookmark web-bookmark-more" title={`${hidden.length} more`} onClick={(e) => (open?.overflow ? setOpen(null) : openFolder(e.currentTarget, 'bar', true))} data-bookmarks-more>
            <ChevronsRight size={13} />
          </button>
        )}
        <button className="web-bookmark web-bookmark-all" title="All bookmarks" onClick={onManage}>
          <BookmarkIcon size={12} /> All bookmarks
        </button>
      </div>
      {open && (
        <FolderMenu
          key={`${open.root}${open.overflow ? ':more' : ''}`}
          root={open.root}
          rootItems={open.overflow ? hidden : undefined}
          x={open.overflow ? open.x - 220 : open.x}
          y={open.y}
          onOpen={(url, newTab) => {
            setOpen(null)
            onOpen(url, newTab)
          }}
          onMenu={contextMenu}
          onClose={() => setOpen(null)}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  )
}
