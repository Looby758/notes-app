import { useEffect, useRef, useState } from 'react'
import {
  ArrowRightLeft,
  ChevronDown,
  Command as CommandIcon,
  FolderOpen,
  FolderSync,
  House,
  LogOut,
  MessageSquare,
  Orbit,
  Mail,
  BookOpen,
  Dices,
  KeyRound,
  Globe,
  MonitorPlay,
  Moon,
  PenLine,
  PanelLeft,
  PanelRight,
  Settings as SettingsIcon,
  SquareTerminal,
  PoundSterling
} from 'lucide-react'
import { useVault } from '../store/vault'
import { useEditor, type SaveStatus } from '../store/editor'
import { useNoteIndex } from '../store/noteIndex'
import { setPrefs, usePrefs } from '../store/prefs'
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
  openWebTab,
  refreshEmbeds,
  refreshLinkDecorations,
  remeasure,
  SETTINGS_TAB,
  GRAPH_TAB,
  TERMINAL_TAB,
  PASSWORDS_TAB,
  EMAIL_TAB,
  CHAT_TAB,
  HOME_TAB,
  MONEY_TAB,
  CONVERT_TAB,
  setZenEditor
} from '../lib/editorController'
import { openLink, openWikiLink } from '../lib/openLink'
import Sidebar from './Sidebar/Sidebar'
import EditorArea from './Editor/EditorArea'
import LayoutMenu from './Editor/LayoutMenu'
import RightPanel from './Panels/RightPanel'
import Modals from './Picker/Modals'
import LockDialog from './Lock/LockDialog'
import { startFormatMenu } from '../lib/formatMenu'
import { startDictionary } from '../lib/dictionary'
import { EventDetails } from './Calendar/shared'
import Resizer from './Resizer'
import UpdateToast from './UpdateToast'
import ZenBar, { StatusTimer } from './ZenBar'
import VoiceRecorder from './VoiceRecorder'
import DefinitionCard from './DefinitionCard'
import SketchPad from './Sketch/SketchPad'
import { FlashcardsButton } from './Flashcards/FlashcardsPage'
import { openRandomNote } from '../lib/random'
import { startReminders, stopReminders } from '../lib/reminderScheduler'

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
  const leftOpen = useUI((s) => s.leftOpen)
  const rightOpen = useUI((s) => s.rightOpen)
  const leftWidth = useUI((s) => s.leftWidth)
  const rightWidth = useUI((s) => s.rightWidth)
  const fontSize = usePrefs((s) => s.prefs.editorFontSize)
  const lineHeight = usePrefs((s) => s.prefs.lineHeight)
  const fonts = usePrefs((s) => s.prefs.editorFont + s.prefs.uiFont + s.prefs.zoom)
  const showWordCount = usePrefs((s) => s.prefs.showWordCount)
  const reading = usePrefs((s) => s.prefs.readingMode)
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
    void startReminders()
    // (The test notification from Settings has no note to open.)
    const offReminder = window.api.onReminderOpen((path, line) => path && openNote(path, { line }))
    const offVoice = window.api.onVoiceStart(() => useUI.setState({ voiceOpen: true }))
    const offSketch = window.api.onSketchStart(() => useUI.setState({ sketch: { path: null } }))
    const offFormat = startFormatMenu()
    const offDictionary = startDictionary()
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
      offChanged()
      offIndex()
      offReminder()
      offVoice()
      offSketch()
      offFormat()
      offDictionary()
      stopReminders()
    }
  }, [vault])

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

  // Every keyboard shortcut comes from the command list, so Ctrl+K shows exactly what works.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
      // Esc leaves zen mode (unless it's closing something else first).
      if (e.key === 'Escape' && useUI.getState().zen && !useUI.getState().modal && !e.defaultPrevented) {
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
  useEffect(() => window.api.setWebShortcuts(appShortcuts()), [shortcutPrefs])
  useEffect(() => {
    const offShortcut = window.api.onWebShortcut((shortcut) => commandForShortcut(shortcut)?.run())
    const offOpen = window.api.onWebOpen((url) => openWebTab(url))
    return () => {
      offShortcut()
      offOpen()
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

        <button className="icon-btn" onClick={() => openSpecialTab(HOME_TAB)} title={`Home (${showKeys('Ctrl+Shift+J')})`} data-home-button>
          <House size={15} />
        </button>

        <button
          className={`icon-btn ${reading ? 'active' : ''}`}
          onClick={() => setPrefs({ readingMode: !reading })}
          title={` (${showKeys('Ctrl+Shift+R')})`}
          data-reading-toggle
        >
          {reading ? <PenLine size={15} /> : <BookOpen size={15} />}
        </button>
        <button className="icon-btn" onClick={() => openRandomNote()} title="Open a random note" data-random-note>
          <Dices size={15} />
        </button>
        <button className="icon-btn" onClick={() => openSpecialTab(GRAPH_TAB)} title={`Graph (${showKeys('Ctrl+Shift+G')})`}>
          <Orbit size={15} />
        </button>
        <button className="icon-btn" onClick={() => openSpecialTab(EMAIL_TAB)} title={`Email (${showKeys('Ctrl+Shift+A')})`}>
          <Mail size={15} />
        </button>
        <FlashcardsButton />
        <button className="icon-btn" onClick={() => openSpecialTab(TERMINAL_TAB)} title={`Terminal (${showKeys('Ctrl+Alt+T')})`} data-terminal-button>
          <SquareTerminal size={15} />
        </button>
        <button className="icon-btn" onClick={() => openSpecialTab(PASSWORDS_TAB)} title={`Passwords (${showKeys('Ctrl+Alt+K')})`} data-passwords-button>
          <KeyRound size={15} />
        </button>
        <button className="icon-btn" onClick={() => openSpecialTab(MONEY_TAB)} title={`Money (${showKeys('Ctrl+Shift+B')})`} data-money-button>
          <PoundSterling size={15} />
        </button>
        <button className="icon-btn" onClick={() => openWebTab('', { beside: true })} title={`Web browser (${showKeys('Ctrl+Shift+I')})`} data-web-button>
          <Globe size={15} />
        </button>
        <button className="icon-btn" onClick={() => void window.api.openYouTube()} title={`YouTube mini window (${showKeys('Ctrl+Alt+Y')})`} data-youtube-button>
          <MonitorPlay size={15} />
        </button>
        <button className="icon-btn" onClick={() => openSpecialTab(CHAT_TAB)} title="Chat with Claude" data-chat-button>
          <MessageSquare size={15} />
        </button>
        <button className="icon-btn" onClick={() => openSpecialTab(CONVERT_TAB)} title="Convert files" data-convert-button>
          <ArrowRightLeft size={15} />
        </button>
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
        <span title={vault}>{vault}</span>
        <span className="statusbar-spacer" />
        <StatusTimer />
        <button className="statusbar-btn" onClick={toggleZen} title={`Zen mode (${showKeys('Ctrl+Alt+Z')})`} data-zen-toggle>
          <Moon size={11} /> Zen
        </button>
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
      <LockDialog />
      <EventDetails />
      <UpdateToast />
      <ZenBar />
      <VoiceRecorder />
      <DefinitionCard />
      <SketchPad />
    </div>
  )
}
