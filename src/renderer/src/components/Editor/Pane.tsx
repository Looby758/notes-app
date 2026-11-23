import { useEffect, useRef, useState, type DragEvent } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useEditor } from '../../store/editor'
import { usePrefs } from '../../store/prefs'
import { addonOfFeature, hasFeature } from '@shared/addons'
import { tabFeature, tabOn } from '../../lib/addons'
import { AddonMissing } from '../Settings/AddonsSettings'
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
  const installed = usePrefs((s) => s.prefs.installedAddons)
  const mindMap = useUI((s) => showingNote && isMindMap(s, pane, active)) && installed.includes('mind-map')
  // A page (or canvas board) from an add-on that isn't added shows how to add it instead.
  const missingFeature = tabFeature(active)
  const missing =
    missingFeature && !hasFeature(missingFeature, installed)
      ? addonOfFeature(missingFeature)
      : isFileTab(active) && isBoard(active) && !installed.includes('canvas-board')
        ? 'canvas-board'
        : null
  const shown = missing ? null : active

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
          !missing &&
          (isBoard(active) ? (
            <CanvasBoard key={active} path={fileOfTab(active)} />
          ) : (
            <FileViewer key={active} path={fileOfTab(active)} />
          ))}
        {isBlankTab(active) && <NewTabPage key={active} autoFocus={isActivePane} />}
        {missing && <AddonMissing addon={missing} />}
        {/* Web pages stay loaded while you look at another tab, like in a browser. */}
        {tabs?.filter((t) => isWebTab(t) && tabOn(t, installed)).map((t) => <WebPage key={t} tab={t} hidden={t !== active} autoFocus={isActivePane} />)}
        {/* So do WhatsApp and Discord, so their unread counts keep coming in. */}
        {tabs?.includes(MESSAGES_TAB) && tabOn(MESSAGES_TAB, installed) && <MessagesPage hidden={active !== MESSAGES_TAB} autoFocus={isActivePane} />}
        {/* And Grok, so a chat isn't lost by looking at a note. */}
        {tabs?.includes(GROK_TAB) && tabOn(GROK_TAB, installed) && <GrokPage hidden={active !== GROK_TAB} autoFocus={isActivePane} />}
        {tabs?.includes(CLAUDE_TAB) && tabOn(CLAUDE_TAB, installed) && <ChatSitePage site="claude" hidden={active !== CLAUDE_TAB} autoFocus={isActivePane} />}
        {shown === SETTINGS_TAB && <SettingsPage />}
        {shown === CALENDAR_TAB && <CalendarPage />}
        {shown === GRAPH_TAB && <GraphPage />}
        {shown === REPLACE_TAB && <ReplacePage />}
        {shown === CONFLICTS_TAB && <ConflictsPage />}
        {shown === AI_TAB && <AiPage autoFocus={isActivePane} />}
        {shown === CHAT_TAB && <ChatPage autoFocus={isActivePane} />}
        {shown === FLASHCARDS_TAB && <FlashcardsPage />}
        {shown === SCREENSHOTS_TAB && <ScreenshotsPage />}
        {shown === TIMELINE_TAB && <TimelinePage />}
        {shown === TERMINAL_TAB && <TerminalPage />}
        {shown === PASSWORDS_TAB && <PasswordsPage autoFocus={isActivePane} />}
        {shown === EMAIL_TAB && <EmailPage />}
        {(active === HOME_TAB || !active) && <HomePage />}
        {shown === MONEY_TAB && <MoneyPage />}
        {shown === CONVERT_TAB && <ConvertPage />}
        {shown === FILESENDER_TAB && <FileSenderPage />}
        {shown === PDF_EDITOR_TAB && <PdfEditorPage />}
        {shown === COMICS_TAB && <ComicsPage />}
        {shown === WIKI_TAB && <WikiPage />}
        {shown === MINIGAMES_TAB && <MiniGamesPage />}
        {shown === CLOCKS_TAB && <WorldClocksPage />}
        {shown === COUNTDOWNS_TAB && <CountdownsPage />}
        {shown === SKYBLOCK_GOALS_TAB && <SkyblockGoalsPage />}
        {shown === PUBLISHING_TAB && <PublishingPage />}
        {shown === SCREENS_TAB && <ScreensPage />}
        {shown === MIXER_TAB && <MixerPage />}
        {shown === TASKS_TAB && <TaskManagerPage />}
        {shown === MUSIC_TAB && <MusicPage />}
        {shown === DOWNLOADS_TAB && <DownloadsPage />}
        {shown === STUDIO_TAB && <StudioPage />}
        {shown === APPSTUDIO_TAB && <AppStudioPage />}
        {shown === CLIPS_TAB && <ClipsPage />}
        {shown === VIDEOS_TAB && <VideosPage />}
        {shown === SOUNDBOARD_TAB && <SoundboardPage />}
        {shown === MACROS_TAB && <MacrosPage />}
        {shown === KEYREMAP_TAB && <KeyRemapPage />}
        {shown === DISCORD_TAB && <DiscordVoicePage />}
        {shown === GAMES_TAB && <GamesPage />}
        {shown === VIDEO_TAB && <VideoPage autoFocus={isActivePane} />}
        {isExplorerTab(shown) && <ExplorerPage key={shown} tab={shown} autoFocus={isActivePane} />}
        {zone && <div className={`drop-zone ${zone}`} />}
      </div>
    </div>
  )
}
