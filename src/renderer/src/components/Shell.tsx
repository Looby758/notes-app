import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  Command as CommandIcon,
  FolderOpen,
  FolderSync,
  LogOut,
  BookOpen,
  Moon,
  PanelLeft,
  PanelRight,
  Settings as SettingsIcon
} from 'lucide-react'
import { useVault } from '../store/vault'
import { notify } from '../store/notify'
import { useEditor, type SaveStatus } from '../store/editor'
import { useNoteIndex } from '../store/noteIndex'
import { setPrefs, usePrefs } from '../store/prefs'
import { useTerminals } from '../store/terminals'
import { setSection, useAppStudio } from '../store/appStudio'
import { reportBugFromSnip } from '../store/appBoard'
import { boardKey } from '@shared/appStudio'
import { showSearch, toggleZen, useUI } from '../store/ui'
import { countNotes, parentOf } from '../lib/paths'
import { FILE_MANAGER, IS_MAC, showKeys } from '@shared/platform'
import { appShortcuts, commandForKey, commandForShortcut } from '../lib/commands'
import {
  handleExternalChanges,
  init as initEditor,
  isNoteTab,
  openNote,
  openSpecialTab,
  APPSTUDIO_TAB,
  MONEY_TAB,
  openWebTab,
  activateTab,
  refreshEmbeds,
  refreshLinkDecorations,
  remeasure,
  SETTINGS_TAB,
  setZenEditor
} from '../lib/editorController'
import { startNavHistory, watchMouseNavigation } from '../lib/appNavigation'
import { openLink, openWikiLink } from '../lib/openLink'
import { openFromComputer } from '../lib/openFromComputer'
import { watchUndoKeys } from '../lib/undo'
import Sidebar from './Sidebar/Sidebar'
import Dock, { TopbarFeatures } from './Nav/Dock'
import Launcher, { LauncherButton } from './Nav/Launcher'
import RadialMenu from './Nav/RadialMenu'
import EditorArea from './Editor/EditorArea'
import LayoutMenu from './Editor/LayoutMenu'
import RightPanel from './Panels/RightPanel'
import Modals from './Picker/Modals'
import SettingsDialog from './Settings/SettingsDialog'
import LockDialog from './Lock/LockDialog'
import SendToPhone from './Phone/SendToPhone'
import { startPhone } from '../store/phone'
import { watchSnips } from '../lib/snip'
import { watchReplay } from '../lib/replay'
import { localDuck } from '../store/localMusic'
import { startFormatMenu } from '../lib/formatMenu'
import { startDictionary } from '../lib/dictionary'
import { EventDetails } from './Calendar/shared'
import { CalendarOverlays } from './Calendar/edit'
import Resizer from './Resizer'
import UpdateToast from './UpdateToast'
import SkyblockCard from './Games/SkyblockCard'
import { DownloadPrompt } from './Web/Downloads'
import { startBrowser, tabsByPage } from '../store/browser'
import StartupNotices from './Notices/StartupNotices'
import Screensaver from './Screensaver/Screensaver'
import Pet from './Motion/Pet'
import MusicHost from './Music/MusicHost'
import { GrokFloat } from './Grok/GrokPage'
import { ChatSiteFloat } from './ChatSite/ChatSite'
import RecordingBar from './Studio/RecordingBar'
import ZenBar, { StatusTimer } from './ZenBar'
import VoiceRecorder from './VoiceRecorder'
import DefinitionCard from './DefinitionCard'
import SketchPad from './Sketch/SketchPad'
import PictureEditor from './PicEdit/PictureEditor'
import { toggleStreamerMode } from '../store/streamer'
import Private from './Streamer/Private'
import DeviceDrop from './Share/DeviceDrop'
import { startReminders, stopReminders } from '../lib/reminderScheduler'
import { MONEY_IOU_LINK, startIouReminders, stopIouReminders } from '../lib/iouReminders'
import { addonOn, useAddonOn, useInstalledAddons } from '../lib/addons'
import { useMoneyView } from '../store/money'

interface Props {
  vault: string
  onSwitchVault: () => void
  onCloseVault: () => void
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: 'Saved',
  unsaved: 'Unsaved',
  saving: 'Saving…',
  error: 'Save failed',
  conflict: 'Changed on disk'
}

export default function Shell({ vault, onSwitchVault, onCloseVault }: Props) {
  const musicOn = useAddonOn('music')
  const skyblockOn = useAddonOn('skyblock')
  const grokOn = useAddonOn('grok')
  const claudeOn = useAddonOn('claude')
  const sketchOn = useAddonOn('sketch')
  useBugReports()
  const leftOpen = useUI((s) => s.leftOpen)
  const rightOpen = useUI((s) => s.rightOpen)
  const leftWidth = useUI((s) => s.leftWidth)
  const rightWidth = useUI((s) => s.rightWidth)
  const fontSize = usePrefs((s) => s.prefs.editorFontSize)
  const lineHeight = usePrefs((s) => s.prefs.lineHeight)
  const fonts = usePrefs((s) => s.prefs.editorFont + s.prefs.uiFont + s.prefs.zoom)
  const showWordCount = usePrefs((s) => s.prefs.showWordCount)
  const reading = usePrefs((s) => s.prefs.readingMode)
  const streamer = usePrefs((s) => s.prefs.streamerMode)
  const zen = useUI((s) => s.zen)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const tree = useVault((s) => s.tree)
  const active = useEditor((s) => s.active)
  const saveStatus = useEditor((s) => (s.active ? s.status[s.active] : undefined))
  const words = useEditor((s) => s.words)
  const noteCount = countNotes(tree)
  const showingNote = isNoteTab(active)

  useEffect(() => {
    useUI.setState({ vaultActions: { switchVault: onSwitchVault, closeVault: onCloseVault } })
  }, [onSwitchVault, onCloseVault])

  // Text metrics changed (CSS variables are set by the prefs store): let the editor re-measure.
  useEffect(() => {
    remeasure()
  }, [fontSize, lineHeight, fonts])

  // Load the vault, restore its tabs, and react to files changing on disk.
  useEffect(() => {
    useVault.getState().open(vault)
    initEditor(vault)
    const stopHistory = startNavHistory()
    void startReminders()
    // (The test notification from Settings has no note to open.) An IOU reminder opens Money → IOUs.
    const offReminder = window.api.onReminderOpen((path, line) => {
      if (path === MONEY_IOU_LINK) {
        useMoneyView.setState({ view: 'ious' })
        openSpecialTab(MONEY_TAB)
      } else if (path) openNote(path, { line })
    })
    // "Open in Orbit" from File Explorer / Finder: any that came in while Orbit was starting, then each new one.
    const offOpenFile = window.api.onOpenFile(openFromComputer)
    void window.api.takeOpenedFiles().then((paths) => paths.forEach(openFromComputer))
    const offVoice = window.api.onVoiceStart(() => useUI.setState({ voiceOpen: true }))
    const offSketch = window.api.onSketchStart(() => addonOn('sketch') && useUI.setState({ sketch: { path: null } }))
    const offFormat = startFormatMenu()
    const offDictionary = startDictionary()
    // Mouse sharing: the other computer started pairing (show the code), or sent a file over.
    const offSharePair = window.api.onShareOpenSettings(() => {
      openSpecialTab(SETTINGS_TAB)
      useUI.setState({ settingsSection: 'computers' })
    })
    const offShareFile = window.api.onShareReceived(({ title }) => notify(`${title}. It’s in Downloads.`, 'info'))
    const offSnips = watchSnips()
    const offReplay = watchReplay()
    // Friends talking in Discord: your own music dips (main/musicDuck.ts).
    const offDuck = window.api.onMusicDuck(localDuck)
    const offChanged = window.api.onVaultChanged((paths) => {
      useVault.getState().refresh(paths)
      handleExternalChanges(paths)
    })
    // When notes appear, disappear or get renamed, links in the open note may change colour.
    let lastLookup = useNoteIndex.getState().lookup
    let lastVersion = useNoteIndex.getState().version
    const offIndex = useNoteIndex.subscribe((s) => {
      if (s.lookup !== lastLookup) {
        lastLookup = s.lookup
        refreshLinkDecorations()
      }
      // Any note's text changed: embedded notes may need to show the new version.
      if (s.version !== lastVersion) {
        lastVersion = s.version
        refreshEmbeds()
      }
    })
    return () => {
      stopHistory()
      offChanged()
      offIndex()
      offReminder()
      offOpenFile()
      offVoice()
      offSketch()
      offFormat()
      offDictionary()
      offSharePair()
      offShareFile()
      offSnips()
      offReplay()
      offDuck()
      stopReminders()
    }
  }, [vault])

  // Your phone, and money reminders (IOUs), only with their add-ons.
  const phoneOn = useAddonOn('phone')
  useEffect(() => (phoneOn ? startPhone() : undefined), [phoneOn])
  const moneyOn = useAddonOn('money')
  useEffect(() => {
    if (!moneyOn) return
    startIouReminders()
    return stopIouReminders
  }, [moneyOn])

  // Soundboard hotkeys work from any app, so the sound side starts with the window (and reopens the mic if it was left on).
  // Only with the Soundboard add-on.
  const soundboardOn = useAddonOn('soundboard')
  useEffect(() => {
    if (!soundboardOn) return
    let off: (() => void) | undefined
    let gone = false
    void import('../lib/soundboard').then((m) => {
      if (!gone) off = m.startSoundboard()
    })
    return () => {
      gone = true
      off?.()
    }
  }, [soundboardOn])

  // Keep the tree's highlight on the note being edited.
  useEffect(() => {
    if (isNoteTab(active)) {
      useVault.getState().select(active)
      useVault.getState().expandTo(parentOf(active))
    }
  }, [active])

  // Ctrl+click on links and tags inside a note.
  useEffect(() => {
    const onLink = (e: Event): void => {
      const { href, from } = (e as CustomEvent<{ href: string; from: string }>).detail
      openLink(href, from)
    }
    const onWikiLink = (e: Event): void => {
      const { inner, from } = (e as CustomEvent<{ inner: string; from: string }>).detail
      openWikiLink(inner, from)
    }
    const onTag = (e: Event): void => showSearch(`#${(e as CustomEvent<{ tag: string }>).detail.tag}`)
    window.addEventListener('note:open-link', onLink)
    window.addEventListener('note:open-wikilink', onWikiLink)
    window.addEventListener('note:open-tag', onTag)
    return () => {
      window.removeEventListener('note:open-link', onLink)
      window.removeEventListener('note:open-wikilink', onWikiLink)
      window.removeEventListener('note:open-tag', onTag)
    }
  }, [])

  // Zen mode: full screen, just the note, typewriter mode on.
  const zenStarted = useRef(false)
  useEffect(() => {
    // Nothing to undo at start-up (and a window you made full screen yourself stays that way).
    if (!zen && !zenStarted.current) return
    zenStarted.current = true
    document.body.classList.toggle('zen', zen)
    window.api.setFullScreen(zen)
    setZenEditor(zen)
    remeasure()
  }, [zen])

  // Ctrl+Z / Ctrl+Shift+Z for everything that isn't typing (moved files, playlists, settings…).
  useEffect(() => watchUndoKeys(IS_MAC), [])

  // The mouse's back and forward buttons: back a web page, or back to the last note or page.
  useEffect(() => watchMouseNavigation(), [])

  // Every keyboard shortcut comes from the command list, so Ctrl+K shows exactly what works.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
      // Esc leaves zen mode (unless it's closing something else first).
      if (e.key === 'Escape' && useUI.getState().zen && !useUI.getState().modal && !useUI.getState().settingsOpen && !e.defaultPrevented) {
        toggleZen()
        return
      }
      const cmd = commandForKey(e)
      if (!cmd) return
      e.preventDefault()
      cmd.run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The same shortcuts while a web page has focus (the page gets every other key), and links the
  // page opens in a new window go to a new web tab.
  const shortcutPrefs = usePrefs((s) => s.prefs.shortcuts)
  const installed = useInstalledAddons()
  useEffect(() => window.api.setWebShortcuts(appShortcuts()), [shortcutPrefs, installed])
  useEffect(() => {
    const offShortcut = window.api.onWebShortcut((shortcut) => commandForShortcut(shortcut)?.run())
    const offOpen = window.api.onWebOpen((url, privately) => openWebTab(url, { privately }))
    // A site's notification was clicked: its tab comes forward.
    const offFocus = window.api.onWebFocus((wcId) => {
      const tab = tabsByPage.get(wcId)
      if (tab) activateTab(tab)
    })
    startBrowser()
    // Links other apps sent while Orbit was starting (Orbit as the default browser).
    void window.api.webTakePending().then((urls) => urls.forEach((url) => openWebTab(url)))
    return () => {
      offShortcut()
      offOpen()
      offFocus()
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const menuAction = (fn: () => void) => () => {
    setMenuOpen(false)
    fn()
  }

  return (
    <div className="shell">
      <header className="titlebar">
        <button
          className={`icon-btn ${leftOpen ? 'active' : ''}`}
          onClick={() => useUI.setState({ leftOpen: !leftOpen })}
          title="Toggle sidebar"
        >
          <PanelLeft size={16} />
        </button>

        <div className="vault-menu" ref={menuRef}>
          <button className="vault-btn" onClick={() => setMenuOpen(!menuOpen)} title={vault}>
            {folderName(vault)}
            <ChevronDown size={14} />
          </button>
          {menuOpen && (
            <div className="menu">
              <button onClick={menuAction(() => window.api.revealVault())}>
                <FolderOpen size={15} /> Open in {FILE_MANAGER}
              </button>
              <button onClick={menuAction(onSwitchVault)}>
                <FolderSync size={15} /> Switch notes folder…
              </button>
              <div className="menu-sep" />
              <button onClick={menuAction(onCloseVault)}>
                <LogOut size={15} /> Close folder
              </button>
            </div>
          )}
        </div>

        <button className="titlebar-search" onClick={() => useUI.setState({ modal: 'switcher' })} title={`Open a note (${showKeys('Ctrl+P')})`}>
          Open a note…
          <kbd>{IS_MAC ? '⌘P' : 'Ctrl P'}</kbd>
        </button>

        <div className="titlebar-spacer" />

        <TopbarFeatures />
        <LauncherButton />
        <LayoutMenu />
        <button className="icon-btn" onClick={() => useUI.setState({ modal: 'commands' })} title={`All commands (${showKeys('Ctrl+K')})`}>
          <CommandIcon size={15} />
        </button>
        <button className="icon-btn" onClick={() => openSpecialTab(SETTINGS_TAB)} title={`Settings (${showKeys('Ctrl+,')})`}>
          <SettingsIcon size={15} />
        </button>
        <button
          className={`icon-btn ${rightOpen ? 'active' : ''}`}
          onClick={() => useUI.setState({ rightOpen: !rightOpen })}
          title="Toggle right panel"
        >
          <PanelRight size={16} />
        </button>
      </header>

      <div className="workspace">
        <Dock />
        <aside
          className={`sidebar left ${leftOpen ? '' : 'collapsed'}`}
          style={{ ['--panel-w' as string]: `${leftWidth}px` }}
        >
          <Sidebar />
          {leftOpen && <Resizer side="left" />}
        </aside>

        <EditorArea />

        <aside
          className={`sidebar right ${rightOpen ? '' : 'collapsed'}`}
          style={{ ['--panel-w' as string]: `${rightWidth}px` }}
        >
          {rightOpen && <Resizer side="right" />}
          <RightPanel />
        </aside>
      </div>

      <footer className="statusbar">
        <TestCopyBadge />
        {/* The folder's path usually has your name in it. */}
        <Private>
          <span title={streamer ? undefined : vault}>{vault}</span>
        </Private>
        <span className="statusbar-spacer" />
        <StatusTimer />
        <button className="statusbar-btn" onClick={toggleZen} title={`Zen mode (${showKeys('Ctrl+Alt+Z')})`} data-zen-toggle>
          <Moon size={11} /> Zen
        </button>
        {streamer && (
          <button className="streamer-pill" onClick={toggleStreamerMode} title="Streamer mode is on: private things are blurred. Click to turn it off." data-streamer-pill>
            <span className="dot" /> LIVE
          </button>
        )}
        {reading && (
          <button className="reading-pill" onClick={() => setPrefs({ readingMode: false })} title="Notes are read-only. Click to write again.">
            <BookOpen size={11} /> Reading
          </button>
        )}
        {showingNote && saveStatus && <span className={`save-status ${saveStatus}`}>{STATUS_LABEL[saveStatus]}</span>}
        {showingNote && showWordCount && (
          <span>
            {words} {words === 1 ? 'word' : 'words'}
          </span>
        )}
        <span>
          {noteCount} {noteCount === 1 ? 'note' : 'notes'}
        </span>
      </footer>

      <Modals />
      <SettingsDialog />
      <Launcher />
      <RadialMenu />
      <LockDialog />
      <SendToPhone />
      <EventDetails />
      <CalendarOverlays />
      <Pet />
      <UpdateToast />
      {skyblockOn && <SkyblockCard />}
      <DownloadPrompt />
      <StartupNotices />
      <DeviceDrop />
      {musicOn && <MusicHost />}
      {grokOn && <GrokFloat />}
      {claudeOn && <ChatSiteFloat site="claude" />}
      <RecordingBar />
      <ZenBar />
      <VoiceRecorder />
      <DefinitionCard />
      {sketchOn && <SketchPad />}
      <PictureEditor />
      <Screensaver />
    </div>
  )
}

/** "Test copy" in the status bar, so a copy started from Orbit's code is never mistaken for the real one. */
function TestCopyBadge() {
  const [test, setTest] = useState(false)
  useEffect(() => {
    window.api
      .appsIsTestCopy()
      .then((t) => {
        setTest(t)
        if (t) document.title = 'Orbit (test copy)'
      })
      .catch(() => undefined)
  }, [])
  return test ? (
    <span className="statusbar-testcopy" title="Started from Orbit’s code: it has its own settings and notes, separate from your normal Orbit">
      Test copy
    </span>
  ) : null
}

/** Bugs reported from the screen snip ("Report bug") open on App Studio's board. */
function useBugReports(): void {
  useEffect(
    () =>
      window.api.onAppStudioBug((png) => {
        const project = useTerminals.getState().projects[0]
        const info = project ? useAppStudio.getState().info[project.folder] : undefined
        void reportBugFromSnip(png, usePrefs.getState().prefs.attachmentFolder, project ? boardKey({ name: project.name, repo: info?.repo }) : null, () => {
          openSpecialTab(APPSTUDIO_TAB)
          setSection('board')
        })
      }),
    []
  )
}
