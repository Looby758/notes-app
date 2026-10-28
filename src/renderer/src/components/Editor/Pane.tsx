import { useEffect, useRef, useState, type DragEvent } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useEditor } from '../../store/editor'
import {
  focusPane,
  fileOfTab,
  isBlankTab,
  isFileTab,
  isNoteTab,
  mountPane,
  moveTab,
  openNote,
  resolveConflict,
  CALENDAR_TAB,
  GRAPH_TAB,
  REPLACE_TAB,
  CONFLICTS_TAB,
  AI_TAB,
  CHAT_TAB,
  FLASHCARDS_TAB,
  PASSWORDS_TAB,
  HOME_TAB,
  SETTINGS_TAB,
  splitPane
} from '../../lib/editorController'
import { getDrag, setDrag, zoneAt, type DropZone } from '../../lib/dnd'
import NewTabPage from '../Picker/NewTabPage'
import SettingsPage from '../Settings/SettingsPage'
import CalendarPage from '../Calendar/CalendarPage'
import GraphPage from '../Graph/GraphPage'
import ReplacePage from '../Replace/ReplacePage'
import TabBar from './TabBar'
import LockScreen from '../Lock/LockScreen'
import FileViewer from './FileViewer'
import CanvasBoard from '../Canvas/CanvasBoard'
import { isBoard } from '../../lib/canvas'
import ConflictsPage from '../Conflicts/ConflictsPage'
import AiPage from '../Ai/AiPage'
import ChatPage from '../Ai/ChatPage'
import FlashcardsPage from '../Flashcards/FlashcardsPage'
import PasswordsPage from '../Passwords/PasswordsPage'
import HomePage from '../Home/HomePage'
import MindMap from '../MindMap/MindMap'
import { isMindMap, useUI } from '../../store/ui'
import { needsUnlock, useLock } from '../../lib/lock/session'

/** One pane: its tab bar, and whatever its active tab shows (a note, a blank tab's picker, Settings…). */
export default function Pane({ pane }: { pane: string }) {
  const host = useRef<HTMLDivElement>(null)
  const active = useEditor((s) => s.panes[pane]?.active ?? null)
  const isActivePane = useEditor((s) => s.activePane === pane)
  const multiple = useEditor((s) => Object.keys(s.panes).length > 1)
  const conflict = useEditor((s) => (active ? s.status[active] === 'conflict' : false))
  const [zone, setZone] = useState<DropZone | null>(null)
  const lockedNote = useLock((s) => isNoteTab(active) && needsUnlock(active, s))
  const showingNote = isNoteTab(active) && !lockedNote
  const mindMap = useUI((s) => showingNote && isMindMap(s, pane, active))

  useEffect(() => mountPane(pane, host.current!), [pane])

  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    // Files from the list are dropped into the note (the editor handles that).
    if (!getDrag() || getDrag()!.kind === 'file') return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setZone(zoneAt(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY))
  }

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    const drag = getDrag()
    const where = zone ?? zoneAt(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY)
    setZone(null)
    if (!drag || drag.kind === 'file') return
    e.preventDefault()
    if (drag.kind === 'tab') {
      if (where === 'center') moveTab(drag.id, drag.pane, pane)
      else splitPane(where, { pane, tab: drag.id, moveFrom: drag.pane })
    } else if (where === 'center') {
      openNote(drag.path, { pane })
    } else {
      splitPane(where, { pane, tab: drag.path })
    }
    setDrag(null)
  }

  return (
    <div
      className={`pane ${isActivePane && multiple ? 'focused' : ''} ${isActivePane ? 'active-pane' : ''}`}
      data-pane={pane}
      onMouseDownCapture={() => focusPane(pane)}
      onFocusCapture={() => focusPane(pane)}
    >
      <TabBar pane={pane} />
      <div
        className="pane-body"
        onDragOver={onDragOver}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setZone(null)}
        onDrop={onDrop}
      >
        {conflict && active && (
          <div className="conflict-banner">
            <AlertTriangle size={15} />
            <span>This note was changed on disk while you were editing it.</span>
            <button className="btn" onClick={() => resolveConflict(active, 'disk')}>
              Load disk version
            </button>
            <button className="btn" onClick={() => resolveConflict(active, 'mine')}>
              Keep mine
            </button>
          </div>
        )}
        <div ref={host} className={`editor-host ${showingNote && !mindMap ? '' : 'hidden'}`} />
        {mindMap && <MindMap key={active} pane={pane} path={active!} />}
        {lockedNote && <LockScreen key={active} path={active!} autoFocus={isActivePane} />}
        {isFileTab(active) &&
          (isBoard(active) ? (
            <CanvasBoard key={active} path={fileOfTab(active)} />
          ) : (
            <FileViewer key={active} path={fileOfTab(active)} />
          ))}
        {isBlankTab(active) && <NewTabPage key={active} autoFocus={isActivePane} />}
        {active === SETTINGS_TAB && <SettingsPage />}
        {active === CALENDAR_TAB && <CalendarPage />}
        {active === GRAPH_TAB && <GraphPage />}
        {active === REPLACE_TAB && <ReplacePage />}
        {active === CONFLICTS_TAB && <ConflictsPage />}
        {active === AI_TAB && <AiPage autoFocus={isActivePane} />}
        {active === CHAT_TAB && <ChatPage autoFocus={isActivePane} />}
        {active === FLASHCARDS_TAB && <FlashcardsPage />}
        {active === PASSWORDS_TAB && <PasswordsPage autoFocus={isActivePane} />}
        {(active === HOME_TAB || !active) && <HomePage />}
        {zone && <div className={`drop-zone ${zone}`} />}
      </div>
    </div>
  )
}
