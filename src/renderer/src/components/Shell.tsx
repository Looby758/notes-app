import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  Command as CommandIcon,
  FolderOpen,
  FolderSync,
  LogOut,
  PanelLeft,
  PanelRight,
  Settings as SettingsIcon
} from 'lucide-react'
import { useVault } from '../store/vault'
import { useEditor, type SaveStatus } from '../store/editor'
import { useNoteIndex } from '../store/noteIndex'
import { usePrefs } from '../store/prefs'
import { showSearch, useUI } from '../store/ui'
import { countNotes, parentOf } from '../lib/paths'
import { FILE_MANAGER, IS_MAC, showKeys } from '@shared/platform'
import { commandForKey } from '../lib/commands'
import {
  handleExternalChanges,
  init as initEditor,
  isNoteTab,
  openSpecialTab,
  refreshEmbeds,
  refreshLinkDecorations,
  remeasure,
  SETTINGS_TAB
} from '../lib/editorController'
import { openLink, openWikiLink } from '../lib/openLink'
import Sidebar from './Sidebar/Sidebar'
import EditorArea from './Editor/EditorArea'
import LayoutMenu from './Editor/LayoutMenu'
import RightPanel from './Panels/RightPanel'
import Modals from './Picker/Modals'
import { EventDetails } from './Calendar/shared'
import Resizer from './Resizer'
import UpdateToast from './UpdateToast'

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

  // Every keyboard shortcut comes from the command list, so Ctrl+K shows exactly what works.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
      const cmd = commandForKey(e)
      if (!cmd) return
      e.preventDefault()
      cmd.run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
      <EventDetails />
      <UpdateToast />
    </div>
  )
}
