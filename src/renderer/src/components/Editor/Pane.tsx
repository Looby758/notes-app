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
  TERMINAL_TAB,
  PASSWORDS_TAB,
  EMAIL_TAB,
  isWebTab,
  HOME_TAB,
  MONEY_TAB,
  CONVERT_TAB,
  SUDOKU_TAB,
  COMICS_TAB,
  MINESWEEPER_TAB,
  CLOCKS_TAB,
  DOWNLOADER_TAB,
  STUDIO_TAB,
  SOUNDBOARD_TAB,
  MESSAGES_TAB,
  GAMES_TAB,
  VIDEO_TAB,
  EXPLORER_TAB,
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
import TerminalPage from '../Terminal/TerminalPage'
import PasswordsPage from '../Passwords/PasswordsPage'
import EmailPage from '../Email/EmailPage'
import MessagesPage from '../Messages/MessagesPage'
import HomePage from '../Home/HomePage'
import MoneyPage from '../Money/MoneyPage'
import ConvertPage from '../Convert/ConvertPage'
import VideoDownloaderPage from '../Downloader/VideoDownloaderPage'
import SudokuPage from '../Sudoku/SudokuPage'
import ComicsPage from '../Comics/ComicsPage'
import WorldClocksPage from '../Clocks/WorldClocksPage'
import StudioPage from '../Studio/StudioPage'
import SoundboardPage from '../Soundboard/SoundboardPage'
import MinesweeperPage from '../Minesweeper/MinesweeperPage'
import GamesPage from '../Games/GamesPage'
import VideoPage from '../Video/VideoPage'
import ExplorerPage from '../Explorer/ExplorerPage'
import MindMap from '../MindMap/MindMap'
import WebPage from '../Web/WebPage'
import { isMindMap, useUI } from '../../store/ui'
import { needsUnlock, useLock } from '../../lib/lock/session'
import ThemePicture, { usePageAccent } from '../Theme/ThemePicture'
import { pageOfTab } from '@shared/themePack'
import { useNoteHidden } from '../../store/streamer'
import NoteCover from '../Streamer/NoteCover'
import { isRestoring, replay } from '../../lib/motion'

/** Panes that have been on screen, so only a brand-new one slides open (splitting remounts the old one). */
const seenPanes = new Set<string>()

/** One pane: its tab bar, and whatever its active tab shows (a note, a blank tab's picker, Settings…). */
export default function Pane({ pane }: { pane: string }) {
  const host = useRef<HTMLDivElement>(null)
  const active = useEditor((s) => s.panes[pane]?.active ?? null)
  // An imported theme can put a picture (and its own accent) behind each part of the app.
  const page = pageOfTab(active)
  const pageAccent = usePageAccent(page)
  const tabs = useEditor((s) => s.panes[pane]?.tabs)
  const isActivePane = useEditor((s) => s.activePane === pane)
  const multiple = useEditor((s) => Object.keys(s.panes).length > 1)
  const conflict = useEditor((s) => (active ? s.status[active] === 'conflict' : false))
  const [zone, setZone] = useState<DropZone | null>(null)
  const lockedNote = useLock((s) => isNoteTab(active) && needsUnlock(active, s))
  const streamerHidden = useNoteHidden(isNoteTab(active) && !lockedNote ? active : null)
  const showingNote = isNoteTab(active) && !lockedNote && !streamerHidden
  const mindMap = useUI((s) => showingNote && isMindMap(s, pane, active))

  useEffect(() => mountPane(pane, host.current!), [pane])

  const [isNew] = useState(() => !seenPanes.has(pane) && !isRestoring())
  seenPanes.add(pane)

  // Switching to another note keeps the same editor, so its fade-in is played again by hand.
  const noteShown = showingNote && !mindMap
  useEffect(() => {
    if (noteShown) replay(host.current, 'page-enter')
  }, [active, noteShown])

  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    // Files from the list are dropped into the note (the editor handles that).
    if (!getDrag() || getDrag()!.kind === 'file' || getDrag()!.kind === 'computer' || getDrag()!.kind === 'computerMany') return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setZone(zoneAt(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY))
  }

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    const drag = getDrag()
    const where = zone ?? zoneAt(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY)
    setZone(null)
    if (!drag || drag.kind === 'file' || drag.kind === 'computer' || drag.kind === 'computerMany') return
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
      className={`pane ${isActivePane && multiple ? 'focused' : ''} ${isActivePane ? 'active-pane' : ''} ${isNew ? 'pane-new' : ''}`}
      data-pane={pane}
      style={pageAccent}
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
        <ThemePicture page={page} />
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
        {streamerHidden && <NoteCover key={active} path={active!} autoFocus={isActivePane} />}
        {lockedNote && <LockScreen key={active} path={active!} autoFocus={isActivePane} />}
        {isFileTab(active) &&
          (isBoard(active) ? (
            <CanvasBoard key={active} path={fileOfTab(active)} />
          ) : (
            <FileViewer key={active} path={fileOfTab(active)} />
          ))}
        {isBlankTab(active) && <NewTabPage key={active} autoFocus={isActivePane} />}
        {/* Web pages stay loaded while you look at another tab, like in a browser. */}
        {tabs?.filter(isWebTab).map((t) => <WebPage key={t} tab={t} hidden={t !== active} autoFocus={isActivePane} />)}
        {/* So do WhatsApp and Discord, so their unread counts keep coming in. */}
        {tabs?.includes(MESSAGES_TAB) && <MessagesPage hidden={active !== MESSAGES_TAB} autoFocus={isActivePane} />}
        {active === SETTINGS_TAB && <SettingsPage />}
        {active === CALENDAR_TAB && <CalendarPage />}
        {active === GRAPH_TAB && <GraphPage />}
        {active === REPLACE_TAB && <ReplacePage />}
        {active === CONFLICTS_TAB && <ConflictsPage />}
        {active === AI_TAB && <AiPage autoFocus={isActivePane} />}
        {active === CHAT_TAB && <ChatPage autoFocus={isActivePane} />}
        {active === FLASHCARDS_TAB && <FlashcardsPage />}
        {active === TERMINAL_TAB && <TerminalPage />}
        {active === PASSWORDS_TAB && <PasswordsPage autoFocus={isActivePane} />}
        {active === EMAIL_TAB && <EmailPage />}
        {(active === HOME_TAB || !active) && <HomePage />}
        {active === MONEY_TAB && <MoneyPage />}
        {active === CONVERT_TAB && <ConvertPage />}
        {active === SUDOKU_TAB && <SudokuPage />}
        {active === COMICS_TAB && <ComicsPage />}
        {active === MINESWEEPER_TAB && <MinesweeperPage />}
        {active === CLOCKS_TAB && <WorldClocksPage />}
        {active === DOWNLOADER_TAB && <VideoDownloaderPage />}
        {active === STUDIO_TAB && <StudioPage />}
        {active === SOUNDBOARD_TAB && <SoundboardPage />}
        {active === GAMES_TAB && <GamesPage />}
        {active === VIDEO_TAB && <VideoPage autoFocus={isActivePane} />}
        {active === EXPLORER_TAB && <ExplorerPage autoFocus={isActivePane} />}
        {zone && <div className={`drop-zone ${zone}`} />}
      </div>
    </div>
  )
}
