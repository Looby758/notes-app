import { useEffect, useRef, useState, type DragEvent } from 'react'
import { AlertTriangle, FileText } from 'lucide-react'
import { useEditor } from '../../store/editor'
import {
  focusPane,
  isBlankTab,
  isNoteTab,
  mountPane,
  moveTab,
  openNote,
  resolveConflict,
  CALENDAR_TAB,
  GRAPH_TAB,
  REPLACE_TAB,
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
import { IS_MAC, showKeys } from '@shared/platform'

/** A shortcut as keycaps: "Ctrl" "P" on Windows, "⌘P" on a Mac. */
function Keys({ s }: { s: string }) {
  if (IS_MAC) return <kbd>{showKeys(s)}</kbd>
  return (
    <>
      {s.split('+').map((k, i) => (
        <span key={i}>
          {i > 0 && ' '}
          <kbd>{k}</kbd>
        </span>
      ))}
    </>
  )
}

/** One pane: its tab bar, and whatever its active tab shows (a note, a blank tab's picker, Settings…). */
export default function Pane({ pane }: { pane: string }) {
  const host = useRef<HTMLDivElement>(null)
  const active = useEditor((s) => s.panes[pane]?.active ?? null)
  const isActivePane = useEditor((s) => s.activePane === pane)
  const multiple = useEditor((s) => Object.keys(s.panes).length > 1)
  const conflict = useEditor((s) => (active ? s.status[active] === 'conflict' : false))
  const [zone, setZone] = useState<DropZone | null>(null)
  const showingNote = isNoteTab(active)

  useEffect(() => mountPane(pane, host.current!), [pane])

  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (!getDrag()) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setZone(zoneAt(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY))
  }

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    const drag = getDrag()
    const where = zone ?? zoneAt(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY)
    setZone(null)
    if (!drag) return
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
      className={`pane ${isActivePane && multiple ? 'focused' : ''}`}
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
        <div ref={host} className={`editor-host ${showingNote ? '' : 'hidden'}`} />
        {isBlankTab(active) && <NewTabPage key={active} autoFocus={isActivePane} />}
        {active === SETTINGS_TAB && <SettingsPage />}
        {active === CALENDAR_TAB && <CalendarPage />}
        {active === GRAPH_TAB && <GraphPage />}
        {active === REPLACE_TAB && <ReplacePage />}
        {!active && (
          <div className="editor-empty">
            <FileText size={36} strokeWidth={1.2} />
            <p>No note open</p>
            <span>
              <Keys s="Ctrl+P" /> open a note · <Keys s="Ctrl+T" /> new tab · <Keys s="Ctrl+N" /> new note
            </span>
            <span>
              <Keys s="Ctrl+K" /> all commands · <Keys s="Ctrl+\" /> focus mode
            </span>
          </div>
        )}
        {zone && <div className={`drop-zone ${zone}`} />}
      </div>
    </div>
  )
}
