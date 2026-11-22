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
  SCREENSHOTS_TAB,
  TIMELINE_TAB,
  TERMINAL_TAB,
  PASSWORDS_TAB,
  EMAIL_TAB,
  isWebTab,
  HOME_TAB,
  MONEY_TAB,
  CONVERT_TAB,
  FILESENDER_TAB,
  PDF_EDITOR_TAB,
  COMICS_TAB,
  WIKI_TAB,
  MINIGAMES_TAB,
  CLOCKS_TAB,
  COUNTDOWNS_TAB,
  SKYBLOCK_GOALS_TAB,
  PUBLISHING_TAB,
  SCREENS_TAB,
  MIXER_TAB,
  TASKS_TAB,
  MUSIC_TAB,
  DOWNLOADS_TAB,
  STUDIO_TAB,
  APPSTUDIO_TAB,
  CLIPS_TAB,
  VIDEOS_TAB,
  SOUNDBOARD_TAB,
  MACROS_TAB,
  KEYREMAP_TAB,
  DISCORD_TAB,
  MESSAGES_TAB,
  GROK_TAB,
  CLAUDE_TAB,
  GAMES_TAB,
  VIDEO_TAB,
  isExplorerTab,
  SETTINGS_TAB,
  splitPane
} from '../../lib/editorController'
import { getDrag, setDrag, zoneAt, type DropZone } from '../../lib/dnd'
import NewTabPage from '../Picker/NewTabPage'
import SettingsPage from '../Settings/SettingsPage'
import ScreenshotsPage from '../Screenshots/ScreenshotsPage'
import TimelinePage from '../Timeline/TimelinePage'
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
import GrokPage from '../Grok/GrokPage'
import ChatSitePage from '../ChatSite/ChatSite'
import HomePage from '../Home/HomePage'
import MoneyPage from '../Money/MoneyPage'
import ConvertPage from '../Convert/ConvertPage'
import FileSenderPage from '../FileSender/FileSenderPage'
import DownloadsPage from '../Downloads/DownloadsPage'
import PdfEditorPage from '../PdfEditor/PdfEditorPage'
import MiniGamesPage from '../MiniGames/MiniGamesPage'
import ComicsPage from '../Comics/ComicsPage'
import WikiPage from '../Wiki/WikiPage'
import WorldClocksPage from '../Clocks/WorldClocksPage'
import CountdownsPage from '../Countdowns/CountdownsPage'
import SkyblockGoalsPage from '../Games/SkyblockGoalsPage'
import PublishingPage from '../Publishing/PublishingPage'
import ScreensPage from '../Screens/ScreensPage'
import MixerPage from '../Mixer/MixerPage'
import TaskManagerPage from '../TaskManager/TaskManagerPage'
import MusicPage from '../Music/MusicPage'
import StudioPage from '../Studio/StudioPage'
import AppStudioPage from '../AppStudio/AppStudioPage'
import ClipsPage from '../Clips/ClipsPage'
import VideosPage from '../Videos/VideosPage'
import SoundboardPage from '../Soundboard/SoundboardPage'
import MacrosPage from '../Macros/MacrosPage'
import KeyRemapPage from '../KeyRemap/KeyRemapPage'
import DiscordVoicePage from '../Discord/DiscordVoicePage'
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
        {/* And Grok, so a chat isn't lost by looking at a note. */}
        {tabs?.includes(GROK_TAB) && <GrokPage hidden={active !== GROK_TAB} autoFocus={isActivePane} />}
        {tabs?.includes(CLAUDE_TAB) && <ChatSitePage site="claude" hidden={active !== CLAUDE_TAB} autoFocus={isActivePane} />}
        {active === SETTINGS_TAB && <SettingsPage />}
        {active === CALENDAR_TAB && <CalendarPage />}
        {active === GRAPH_TAB && <GraphPage />}
        {active === REPLACE_TAB && <ReplacePage />}
        {active === CONFLICTS_TAB && <ConflictsPage />}
        {active === AI_TAB && <AiPage autoFocus={isActivePane} />}
        {active === CHAT_TAB && <ChatPage autoFocus={isActivePane} />}
        {active === FLASHCARDS_TAB && <FlashcardsPage />}
        {active === SCREENSHOTS_TAB && <ScreenshotsPage />}
        {active === TIMELINE_TAB && <TimelinePage />}
        {active === TERMINAL_TAB && <TerminalPage />}
        {active === PASSWORDS_TAB && <PasswordsPage autoFocus={isActivePane} />}
        {active === EMAIL_TAB && <EmailPage />}
        {(active === HOME_TAB || !active) && <HomePage />}
        {active === MONEY_TAB && <MoneyPage />}
        {active === CONVERT_TAB && <ConvertPage />}
        {active === FILESENDER_TAB && <FileSenderPage />}
        {active === PDF_EDITOR_TAB && <PdfEditorPage />}
        {active === COMICS_TAB && <ComicsPage />}
        {active === WIKI_TAB && <WikiPage />}
        {active === MINIGAMES_TAB && <MiniGamesPage />}
        {active === CLOCKS_TAB && <WorldClocksPage />}
        {active === COUNTDOWNS_TAB && <CountdownsPage />}
        {active === SKYBLOCK_GOALS_TAB && <SkyblockGoalsPage />}
        {active === PUBLISHING_TAB && <PublishingPage />}
        {active === SCREENS_TAB && <ScreensPage />}
        {active === MIXER_TAB && <MixerPage />}
        {active === TASKS_TAB && <TaskManagerPage />}
        {active === MUSIC_TAB && <MusicPage />}
        {active === DOWNLOADS_TAB && <DownloadsPage />}
        {active === STUDIO_TAB && <StudioPage />}
        {active === APPSTUDIO_TAB && <AppStudioPage />}
        {active === CLIPS_TAB && <ClipsPage />}
        {active === VIDEOS_TAB && <VideosPage />}
        {active === SOUNDBOARD_TAB && <SoundboardPage />}
        {active === MACROS_TAB && <MacrosPage />}
        {active === KEYREMAP_TAB && <KeyRemapPage />}
        {active === DISCORD_TAB && <DiscordVoicePage />}
        {active === GAMES_TAB && <GamesPage />}
        {active === VIDEO_TAB && <VideoPage autoFocus={isActivePane} />}
        {isExplorerTab(active) && <ExplorerPage key={active} tab={active} autoFocus={isActivePane} />}
        {zone && <div className={`drop-zone ${zone}`} />}
      </div>
    </div>
  )
}
