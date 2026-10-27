import { useCallback, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { CalendarDays, GitCompare, Columns2, FileDown, Layers, Orbit, Replace, FolderSearch, Pin, PinOff, Plus, Rows2, Settings, Sparkles, Star, StarOff, X } from 'lucide-react'
import { useEditor } from '../../store/editor'
import { toggleStar, useStarred } from '../../store/starred'
import { useNoteIndex } from '../../store/noteIndex'
import { openExport } from '../../store/ui'
import {
  activateTab,
  AI_TAB,
  CALENDAR_TAB,
  GRAPH_TAB,
  REPLACE_TAB,
  CONFLICTS_TAB,
  FLASHCARDS_TAB,
  closePane,
  closeTab,
  closeTabUnlessPinned,
  fileOfTab,
  isBlankTab,
  isFileTab,
  isNoteTab,
  moveTab,
  newTab,
  openNote,
  SETTINGS_TAB,
  splitPane,
  togglePin
} from '../../lib/editorController'

const NO_PINS: string[] = []
import { getDrag, setDrag } from '../../lib/dnd'
import { noteTitle } from '../../lib/paths'
import ContextMenu, { type MenuItem } from '../ContextMenu'
import FileIcon from '../FileIcon'
import { FILE_MANAGER, showKeys } from '@shared/platform'

function tabTitle(id: string): string {
  if (isBlankTab(id)) return 'New tab'
  if (id === SETTINGS_TAB) return 'Settings'
  if (id === CALENDAR_TAB) return 'Calendar'
  if (id === GRAPH_TAB) return 'Graph'
  if (id === REPLACE_TAB) return 'Find & replace'
  if (id === CONFLICTS_TAB) return 'Sync copies'
  if (id === AI_TAB) return 'Ask my notes'
  if (id === FLASHCARDS_TAB) return 'Flashcards'
  if (isFileTab(id)) return fileOfTab(id).slice(fileOfTab(id).lastIndexOf('/') + 1)
  return noteTitle(id)
}

/** A pane's tabs. Drag tabs to reorder them, onto another pane's bar to move them, or onto a pane's edge to split. */
export default function TabBar({ pane }: { pane: string }) {
  const tabs = useEditor((s) => s.panes[pane]?.tabs ?? [])
  const active = useEditor((s) => s.panes[pane]?.active ?? null)
  const isActivePane = useEditor((s) => s.activePane === pane)
  const paneCount = useEditor((s) => Object.keys(s.panes).length)
  const status = useEditor((s) => s.status)
  const pinned = useEditor((s) => s.panes[pane]?.pinned ?? NO_PINS)
  const starred = useStarred((s) => s.paths)
  // Notes' emoji icons, shown before their names.
  const notesIndex = useNoteIndex((s) => s.notes)
  const icons = new Map(tabs.map((t) => [t, notesIndex.get(t)?.icon]))
  const bar = useRef<HTMLDivElement>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  /** Where a dragged tab would land, from the pointer's x position. */
  const indexAt = (x: number): number => {
    const els = [...(bar.current?.querySelectorAll<HTMLElement>('.tab') ?? [])]
    const i = els.findIndex((el) => {
      const r = el.getBoundingClientRect()
      return x < r.left + r.width / 2
    })
    return i === -1 ? els.length : i
  }

  const onDragOver = (e: DragEvent): void => {
    if (!getDrag()) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDropIndex(indexAt(e.clientX))
  }

  const onDrop = (e: DragEvent): void => {
    const drag = getDrag()
    setDropIndex(null)
    if (!drag) return
    e.preventDefault()
    e.stopPropagation()
    const index = indexAt(e.clientX)
    if (drag.kind === 'tab') {
      // Moving within the same bar: account for the tab's own old position.
      const from = useEditor.getState().panes[drag.pane]?.tabs.indexOf(drag.id) ?? -1
      const adjusted = drag.pane === pane && from !== -1 && from < index ? index - 1 : index
      moveTab(drag.id, drag.pane, pane, adjusted)
    } else {
      // Dropped on the tab bar: always its own tab.
      openNote(drag.path, { pane, newTab: true })
    }
    setDrag(null)
  }

  const openMenu = (e: MouseEvent, id: string): void => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, id })
  }

  const menuItems = (id: string): MenuItem[] => {
    // "Close others" and "to the right" leave pinned tabs alone.
    const others = tabs.filter((t) => t !== id && !pinned.includes(t))
    const right = tabs.slice(tabs.indexOf(id) + 1).filter((t) => !pinned.includes(t))
    const isTabPinned = pinned.includes(id)
    const items: MenuItem[] = [
      isTabPinned
        ? { label: 'Unpin tab', icon: <PinOff size={15} />, onClick: () => togglePin(id, pane) }
        : { label: 'Pin tab', icon: <Pin size={15} />, onClick: () => togglePin(id, pane) },
      ...(isNoteTab(id)
        ? [
            starred.includes(id)
              ? ({ label: 'Unstar note', icon: <StarOff size={15} />, onClick: () => toggleStar(id) } as MenuItem)
              : ({ label: 'Star note', icon: <Star size={15} />, onClick: () => toggleStar(id) } as MenuItem)
          ]
        : []),
      'separator',
      ...(isTabPinned ? [] : [{ label: 'Close', icon: <X size={15} />, onClick: () => closeTab(id, pane) } as MenuItem]),
      { label: 'Close others', onClick: () => others.forEach((t) => closeTab(t, pane)) },
      { label: 'Close tabs to the right', onClick: () => right.forEach((t) => closeTab(t, pane)) },
      'separator',
      { label: 'Split right', icon: <Columns2 size={15} />, onClick: () => splitPane('right', { pane, tab: id }) },
      { label: 'Split down', icon: <Rows2 size={15} />, onClick: () => splitPane('down', { pane, tab: id }) }
    ]
    if (tabs.length > 1) {
      items.push(
        {
          label: 'Move to new pane on the right',
          onClick: () => splitPane('right', { pane, tab: id, moveFrom: pane })
        },
        { label: 'Move to new pane below', onClick: () => splitPane('down', { pane, tab: id, moveFrom: pane }) }
      )
    }
    if (isNoteTab(id)) {
      items.push('separator', {
        label: `Show in ${FILE_MANAGER}`,
        icon: <FolderSearch size={15} />,
        onClick: () => window.api.reveal(id)
      }, { label: 'Export…', icon: <FileDown size={15} />, onClick: () => openExport(id, false) })
    }
    return items
  }

  return (
    <div
      ref={bar}
      className={`tabbar ${isActivePane ? 'pane-active' : ''}`}
      // Double-clicking empty space in the bar opens a new tab, like a browser.
      onDoubleClick={(e) => e.target === e.currentTarget && newTab(pane)}
      onDragOver={onDragOver}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropIndex(null)}
      onDrop={onDrop}
    >
      {/* Tabs scroll on their own so the pane buttons on the right always stay visible. */}
      <div className="tabs" onDoubleClick={(e) => e.target === e.currentTarget && newTab(pane)}>
        {tabs.map((id, i) => {
          const unsaved = status[id] === 'unsaved' || status[id] === 'saving'
          const isTabPinned = pinned.includes(id)
          return (
            <div
              key={id}
              className={`tab ${id === active ? 'active' : ''} ${unsaved ? 'unsaved' : ''} ${isBlankTab(id) ? 'blank' : ''} ${isTabPinned ? 'pinned' : ''} ${dropIndex === i ? 'drop-before' : ''}`}
              title={`${isFileTab(id) ? fileOfTab(id) : (id as string).includes(':') ? tabTitle(id) : id}${isTabPinned ? ' (pinned)' : ''}`}
              draggable
              onDragStart={(e) => {
                setDrag({ kind: 'tab', pane, id })
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', id)
              }}
              onDragEnd={() => {
                setDrag(null)
                setDropIndex(null)
              }}
              onClick={() => activateTab(id, pane)}
              onContextMenu={(e) => openMenu(e, id)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  closeTabUnlessPinned(id, pane)
                }
              }}
            >
              {id === SETTINGS_TAB && <Settings size={13} className="tab-icon" />}
              {id === CALENDAR_TAB && <CalendarDays size={13} className="tab-icon" />}
              {id === GRAPH_TAB && <Orbit size={13} className="tab-icon" />}
              {id === REPLACE_TAB && <Replace size={13} className="tab-icon" />}
              {id === CONFLICTS_TAB && <GitCompare size={13} className="tab-icon" />}
              {id === AI_TAB && <Sparkles size={13} className="tab-icon" />}
              {id === FLASHCARDS_TAB && <Layers size={13} className="tab-icon" />}
              {isFileTab(id) && <FileIcon path={fileOfTab(id)} size={13} className="tab-icon" />}
              {icons.get(id) && <span className="tab-emoji">{icons.get(id)}</span>}
              <span className="tab-title">{tabTitle(id)}</span>
              {isTabPinned ? (
                // Pinned tabs show a pin instead of ✕; clicking it unpins.
                <button
                  className="tab-close tab-pin"
                  title="Unpin tab"
                  onClick={(e) => {
                    e.stopPropagation()
                    togglePin(id, pane)
                  }}
                >
                  <span className="tab-dot" />
                  <Pin size={12} />
                </button>
              ) : (
                <button
                  className="tab-close"
                  title={`Close (${showKeys('Ctrl+W')})`}
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(id, pane)
                  }}
                >
                  <span className="tab-dot" />
                  <X size={13} />
                </button>
              )}
            </div>
          )
        })}
        <div className={`tab-drop-end ${dropIndex === tabs.length ? 'drop-before' : ''}`} />
        <button className="icon-btn tab-new" title={`New tab (${showKeys('Ctrl+T')})`} onClick={() => newTab(pane)}>
          <Plus size={15} />
        </button>
        <div className="tabbar-spacer" onDoubleClick={() => newTab(pane)} />
      </div>
      <div className="pane-actions">
        <button className="icon-btn" title={`Split right (${showKeys('Ctrl+Alt+\\')})`} onClick={() => splitPane('right', { pane })}>
          <Columns2 size={14} />
        </button>
        <button className="icon-btn" title={`Split down (${showKeys('Ctrl+Alt+-')})`} onClick={() => splitPane('down', { pane })}>
          <Rows2 size={14} />
        </button>
        {paneCount > 1 && (
          <button className="icon-btn" title="Close pane" onClick={() => closePane(pane)}>
            <X size={14} />
          </button>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.id)} onClose={closeMenu} />}
    </div>
  )
}
