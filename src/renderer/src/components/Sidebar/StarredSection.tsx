import { useCallback, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { ChevronRight, Columns2, FileText, Star, StarOff } from 'lucide-react'
import Private from '../Streamer/Private'
import { useHideNames } from '../../store/streamer'
import { useStarred, placeStar, toggleStar, justStarred } from '../../store/starred'
import { useVault } from '../../store/vault'
import { useEditor } from '../../store/editor'
import { useUI } from '../../store/ui'
import { notePaths, noteTitle, parentOf } from '../../lib/paths'
import { openNote, splitPane } from '../../lib/editorController'
import { getDrag, setDrag } from '../../lib/dnd'
import ContextMenu, { type MenuItem } from '../ContextMenu'

/** Starred notes at the top of the Files view. Drag to reorder; drop a note from the tree here to star it. */
export default function StarredSection() {
  const hideNames = useHideNames()
  const paths = useStarred((s) => s.paths)
  const tree = useVault((s) => s.tree)
  const active = useEditor((s) => s.active)
  const open = useUI((s) => s.starredOpen)
  const list = useRef<HTMLDivElement>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  // Only show stars for notes that exist right now (a note can vanish if another app deletes it).
  const existing = new Set(notePaths(tree))
  const shown = paths.filter((p) => existing.has(p))

  const indexAt = (y: number): number => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>('.starred-row') ?? [])]
    const i = rows.findIndex((r) => {
      const b = r.getBoundingClientRect()
      return y < b.top + b.height / 2
    })
    // Convert from position among shown rows to position in the full list.
    const target = i === -1 ? null : shown[i]
    return target ? paths.indexOf(target) : paths.length
  }

  const onDragOver = (e: DragEvent): void => {
    const drag = getDrag()
    if (drag?.kind !== 'note') return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = drag.fromStarred ? 'move' : 'link'
    const index = indexAt(e.clientY)
    setDropIndex(index === paths.length ? shown.length : shown.indexOf(paths[index]))
  }

  const onDrop = (e: DragEvent): void => {
    const drag = getDrag()
    setDropIndex(null)
    if (drag?.kind !== 'note') return
    e.preventDefault()
    e.stopPropagation()
    let index = indexAt(e.clientY)
    const from = paths.indexOf(drag.path)
    if (from !== -1 && from < index) index -= 1 // account for its own old slot
    placeStar(drag.path, index)
    if (!open) useUI.setState({ starredOpen: true })
    setDrag(null)
  }

  const onContextMenu = (e: MouseEvent, path: string): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, path })
  }

  const items = (path: string): MenuItem[] => [
    { label: 'Open in new tab', icon: <FileText size={15} />, onClick: () => openNote(path, { newTab: true }) },
    { label: 'Open to the right', icon: <Columns2 size={15} />, onClick: () => splitPane('right', { tab: path }) },
    'separator',
    { label: 'Unstar', icon: <StarOff size={15} />, onClick: () => toggleStar(path) }
  ]

  // Nothing starred: a thin drop target (only visible while dragging a note) so you can star by dragging.
  if (shown.length === 0) {
    return (
      <div
        className={`starred-empty ${dropIndex !== null ? 'drop' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={() => setDropIndex(null)}
        onDrop={onDrop}
      >
        <Star size={12} /> Drop a note here to star it
      </div>
    )
  }

  return (
    <div className="starred" onDragOver={onDragOver} onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropIndex(null)} onDrop={onDrop}>
      <button className="starred-header" onClick={() => useUI.setState({ starredOpen: !open })}>
        <ChevronRight size={13} className={`tree-chevron ${open ? 'open' : ''}`} />
        Starred
        <span className="panel-count">{shown.length}</span>
      </button>
      {open && (
        <div className="starred-list" ref={list}>
          {shown.map((path, i) => (
            <div
              key={path}
              className={`starred-row tree-row ${path === active ? 'selected' : ''} ${dropIndex === i ? 'drop-above' : ''}`}
              draggable
              title={hideNames ? undefined : path}
              onDragStart={(e) => {
                setDrag({ kind: 'note', path, fromStarred: true })
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', path)
              }}
              onDragEnd={() => {
                setDrag(null)
                setDropIndex(null)
              }}
              onClick={(e) => openNote(path, { newTab: e.ctrlKey || e.metaKey })}
              onAuxClick={(e) => e.button === 1 && openNote(path, { newTab: true })}
              onContextMenu={(e) => onContextMenu(e, path)}
            >
              <Star size={13} className={`tree-icon starred-icon ${justStarred(path) ? 'pop' : ''}`} />
              <span className="tree-label">
                <Private when={hideNames}>{noteTitle(path)}</Private>
              </span>
              {parentOf(path) && <span className="starred-folder">{parentOf(path)}</span>}
            </div>
          ))}
          <div className={`starred-end ${dropIndex === shown.length ? 'drop-above' : ''}`} />
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items(menu.path)} onClose={closeMenu} />}
    </div>
  )
}
