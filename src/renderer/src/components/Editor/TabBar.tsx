import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { ArrowRightLeft, AudioLines, Headphones, Bomb, CalendarDays, Clapperboard, Columns2, Copy, ExternalLink, FileDown, Film, FolderSearch, Gamepad2, GitCompare, Globe, Globe2, Hourglass, Grid3x3, HardDrive, House, KeyRound, Layers, LibraryBig, Mail, MessageSquare, MessagesSquare, Monitor, Network, Orbit, Pin, PinOff, Plus, PoundSterling, Replace, Rows2, Scissors, Settings, Sparkles, SquareTerminal, Star, StarOff, X, CloudDownload } from 'lucide-react'
import Private from '../Streamer/Private'
import { useHideNames } from '../../store/streamer'
import { useEditor } from '../../store/editor'
import { toggleStar, useStarred } from '../../store/starred'
import { useNoteIndex } from '../../store/noteIndex'
import { isMindMap, openExport, toggleMindMap, useUI } from '../../store/ui'
import {
  activateTab,
  AI_TAB,
  CHAT_TAB,
  CALENDAR_TAB,
  GRAPH_TAB,
  REPLACE_TAB,
  CONFLICTS_TAB,
  FLASHCARDS_TAB,
  TERMINAL_TAB,
  PASSWORDS_TAB,
  EMAIL_TAB,
  HOME_TAB,
  MONEY_TAB,
  CONVERT_TAB,
  isExplorerTab,
  SUDOKU_TAB,
  COMICS_TAB,
  MINESWEEPER_TAB,
  CLOCKS_TAB,
  COUNTDOWNS_TAB,
  SCREENS_TAB,
  DOWNLOADER_TAB,
  STUDIO_TAB,
  CLIPS_TAB,
  SOUNDBOARD_TAB,
  DISCORD_TAB,
  MESSAGES_TAB,
  GAMES_TAB,
  VIDEO_TAB,
  closePane,
  closeTab,
  closeTabUnlessPinned,
  fileOfTab,
  isBlankTab,
  isFileTab,
  isNoteTab,
  isWebTab,
  moveTab,
  newTab,
  openNote,
  openWebTab,
  SETTINGS_TAB,
  splitPane,
  togglePin
} from '../../lib/editorController'

const NO_PINS: string[] = []
import { getDrag, setDrag } from '../../lib/dnd'
import { noteTitle } from '../../lib/paths'
import ContextMenu, { type MenuItem } from '../ContextMenu'
import FileIcon from '../FileIcon'
import { UnreadBadge } from '../Messages/MessagesPage'
import { useWeb, type WebPage } from '../../store/web'
import { displayUrl } from '@shared/web'
import { FILE_MANAGER, showKeys } from '@shared/platform'
import { animateOut } from '../../lib/motion'
import { playSound } from '../../lib/sounds'
import { useVideoPlayer } from '../../store/videoPlayer'
import { useExplorerTabs } from '../../store/explorerTabs'

/** Closing with the mouse lets the tab shrink away first. (Ctrl+W stays instant, so it can be pressed quickly.) */
function closeWithAnimation(el: HTMLElement | null, id: string, pane: string, unlessPinned = false): void {
  // Shrink from the tab's real width, not its 200px limit.
  if (el) el.style.maxWidth = `${el.offsetWidth}px`
  playSound('whooshOut')
  animateOut(el, 'closing', () => (unlessPinned ? closeTabUnlessPinned(id, pane) : closeTab(id, pane)))
}

function tabTitle(id: string, web: Record<string, WebPage>): string {
  if (isBlankTab(id)) return 'New tab'
  if (isWebTab(id)) return web[id]?.title || (web[id]?.url ? displayUrl(web[id].url) : 'New web tab')
  if (id === SETTINGS_TAB) return 'Settings'
  if (id === CALENDAR_TAB) return 'Calendar'
  if (id === GRAPH_TAB) return 'Graph'
  if (id === REPLACE_TAB) return 'Find & replace'
  if (id === CONFLICTS_TAB) return 'Sync copies'
  if (id === AI_TAB) return 'Ask everything'
  if (id === CHAT_TAB) return 'Chat'
  if (id === FLASHCARDS_TAB) return 'Flashcards'
  if (id === TERMINAL_TAB) return 'Terminal'
  if (id === PASSWORDS_TAB) return 'Passwords'
  if (id === EMAIL_TAB) return 'Email'
  if (id === HOME_TAB) return 'Home'
  if (id === MONEY_TAB) return 'Money'
  if (id === CONVERT_TAB) return 'Convert files'
  if (id === SUDOKU_TAB) return 'Sudoku'
  if (id === COMICS_TAB) return 'Comics'
  if (id === MINESWEEPER_TAB) return 'Minesweeper'
  if (id === CLOCKS_TAB) return 'World clocks'
  if (id === COUNTDOWNS_TAB) return 'Countdowns'
  if (id === SCREENS_TAB) return 'Screens'
  if (id === DOWNLOADER_TAB) return 'Download a video'
  if (id === STUDIO_TAB) return 'Studio'
  if (id === CLIPS_TAB) return 'Clips'
  if (id === SOUNDBOARD_TAB) return 'Soundboard'
  if (id === DISCORD_TAB) return 'Discord voice'
  if (id === MESSAGES_TAB) return 'Messages'
  if (id === GAMES_TAB) return 'Games'
  if (id === VIDEO_TAB) {
    const current = useVideoPlayer.getState().current
    return current ? current.slice(Math.max(current.lastIndexOf('/'), current.lastIndexOf('\\')) + 1) : 'Video player'
  }
  if (isExplorerTab(id)) {
    const dir = useExplorerTabs.getState().dirs[id]
    const name = dir?.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
    return name ? `Files: ${name}` : 'Files'
  }
  if (isFileTab(id)) return fileOfTab(id).slice(fileOfTab(id).lastIndexOf('/') + 1).replace(/\.canvas$/i, '')
  return noteTitle(id)
}

/** A pane's tabs. Drag tabs to reorder them, onto another pane's bar to move them, or onto a pane's edge to split. */
export default function TabBar({ pane }: { pane: string }) {
  const tabs = useEditor((s) => s.panes[pane]?.tabs ?? [])
  const active = useEditor((s) => s.panes[pane]?.active ?? null)
  const isActivePane = useEditor((s) => s.activePane === pane)
  const paneCount = useEditor((s) => Object.keys(s.panes).length)
  const status = useEditor((s) => s.status)
  // The video player's tab is named after the video in it.
  useVideoPlayer((s) => s.current)
  // Files tabs are named after the folder they're in.
  useExplorerTabs((s) => s.dirs)
  const pinned = useEditor((s) => s.panes[pane]?.pinned ?? NO_PINS)
  const hideNames = useHideNames()
  const mindMap = useUI((s) => isMindMap(s, pane, active))
  const starred = useStarred((s) => s.paths)
  const web = useWeb((s) => s.pages)
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

  /** Files dragged from a Files tab and held over another tab switch to it, to drop them there. */
  const hover = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  const stopHover = (): void => {
    if (hover.current) clearTimeout(hover.current.timer)
    hover.current = null
  }
  useEffect(() => stopHover, [])

  const onDragOver = (e: DragEvent): void => {
    const drag = getDrag()
    if (drag?.kind === 'computer' || drag?.kind === 'computerMany' || (!drag && e.dataTransfer.types.includes('Files'))) {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.tab')
      const i = el ? [...(bar.current?.querySelectorAll('.tab') ?? [])].indexOf(el) : -1
      const id = i === -1 ? null : tabs[i]
      if (!id || id === active) return stopHover()
      if (hover.current?.id === id) return
      stopHover()
      hover.current = { id, timer: setTimeout(() => (stopHover(), activateTab(id, pane)), 450) }
      return
    }
    if (!drag) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDropIndex(indexAt(e.clientX))
  }

  const onDrop = (e: DragEvent): void => {
    const drag = getDrag()
    setDropIndex(null)
    stopHover()
    if (!drag || drag.kind === 'computer' || drag.kind === 'computerMany') return
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
    const page = isWebTab(id) ? web[id]?.url : ''
    if (page) {
      items.push(
        'separator',
        { label: 'Open in your browser', icon: <ExternalLink size={15} />, onClick: () => window.open(page) },
        { label: 'Copy address', icon: <Copy size={15} />, onClick: () => void navigator.clipboard.writeText(page) },
        { label: 'Duplicate', icon: <Globe size={15} />, onClick: () => openWebTab(page) }
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
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && (setDropIndex(null), stopHover())}
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
              title={hideNames && (isNoteTab(id) || isFileTab(id)) ? undefined : `${isFileTab(id) ? fileOfTab(id) : isWebTab(id) ? web[id]?.url || tabTitle(id, web) : (id as string).includes(':') ? tabTitle(id, web) : id}${isTabPinned ? ' (pinned)' : ''}`}
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
                  if (isTabPinned) closeTabUnlessPinned(id, pane)
                  else closeWithAnimation(e.currentTarget, id, pane, true)
                }
              }}
            >
              {id === SETTINGS_TAB && <Settings size={13} className="tab-icon" />}
              {id === CALENDAR_TAB && <CalendarDays size={13} className="tab-icon" />}
              {id === GRAPH_TAB && <Orbit size={13} className="tab-icon" />}
              {id === REPLACE_TAB && <Replace size={13} className="tab-icon" />}
              {id === CONFLICTS_TAB && <GitCompare size={13} className="tab-icon" />}
              {id === AI_TAB && <Sparkles size={13} className="tab-icon" />}
              {id === CHAT_TAB && <MessageSquare size={13} className="tab-icon" />}
              {id === FLASHCARDS_TAB && <Layers size={13} className="tab-icon" />}
              {id === TERMINAL_TAB && <SquareTerminal size={13} className="tab-icon" />}
              {id === PASSWORDS_TAB && <KeyRound size={13} className="tab-icon" />}
              {id === EMAIL_TAB && <Mail size={13} className="tab-icon" />}
              {isWebTab(id) && <Globe size={13} className="tab-icon" />}
              {id === HOME_TAB && <House size={13} className="tab-icon" />}
              {id === MONEY_TAB && <PoundSterling size={13} className="tab-icon" />}
              {id === CONVERT_TAB && <ArrowRightLeft size={13} className="tab-icon" />}
              {id === SUDOKU_TAB && <Grid3x3 size={13} className="tab-icon" />}
              {id === COMICS_TAB && <LibraryBig size={13} className="tab-icon" />}
              {id === MINESWEEPER_TAB && <Bomb size={13} className="tab-icon" />}
              {id === CLOCKS_TAB && <Globe2 size={13} className="tab-icon" />}
              {id === COUNTDOWNS_TAB && <Hourglass size={13} className="tab-icon" />}
              {id === SCREENS_TAB && <Monitor size={13} className="tab-icon" />}
              {id === DOWNLOADER_TAB && <CloudDownload size={13} className="tab-icon" />}
              {id === STUDIO_TAB && <Clapperboard size={13} className="tab-icon" />}
              {id === CLIPS_TAB && <Scissors size={13} className="tab-icon" />}
              {id === SOUNDBOARD_TAB && <AudioLines size={13} className="tab-icon" />}
              {id === DISCORD_TAB && <Headphones size={13} className="tab-icon" />}
              {id === MESSAGES_TAB && <MessagesSquare size={13} className="tab-icon" />}
              {id === GAMES_TAB && <Gamepad2 size={13} className="tab-icon" />}
              {id === VIDEO_TAB && <Film size={13} className="tab-icon" />}
              {isExplorerTab(id) && <HardDrive size={13} className="tab-icon" />}
              {isFileTab(id) && <FileIcon path={fileOfTab(id)} size={13} className="tab-icon" />}
              {icons.get(id) && <span className="tab-emoji">{icons.get(id)}</span>}
              <span className="tab-title">
                <Private when={hideNames && (isNoteTab(id) || isFileTab(id))}>{tabTitle(id, web)}</Private>
              </span>
              {id === MESSAGES_TAB && <UnreadBadge />}
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
                    closeWithAnimation(e.currentTarget.closest<HTMLElement>('.tab'), id, pane)
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
        {isNoteTab(active) && (
          <button
            className={`icon-btn ${mindMap ? 'active' : ''}`}
            title={mindMap ? `Back to writing (${showKeys('Ctrl+Shift+M')})` : `Mind map of this note (${showKeys('Ctrl+Shift+M')})`}
            onClick={() => toggleMindMap(pane, active)}
            data-mindmap-toggle
          >
            <Network size={14} />
          </button>
        )}
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
