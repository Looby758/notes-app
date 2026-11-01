import { useEditor } from '../store/editor'
import { useVault } from '../store/vault'
import { openExport, showRightView, showSearch, showSidebarView, toggleFocusMode, toggleMindMap, toggleZen, useUI } from '../store/ui'
import { effectiveShortcut, setPrefs, usePrefs } from '../store/prefs'
import { RANGES, DEFAULT_PREFS } from '@shared/prefs'
import { EDITOR_COMMANDS } from '../components/Editor/formatting'
import {
  applyPreset,
  CALENDAR_TAB,
  GRAPH_TAB,
  REPLACE_TAB,
  CONFLICTS_TAB,
  FLASHCARDS_TAB,
  TERMINAL_TAB,
  PASSWORDS_TAB,
  EMAIL_TAB,
  CHAT_TAB,
  HOME_TAB,
  MONEY_TAB,
  CONVERT_TAB,
  SUDOKU_TAB,
  COMICS_TAB,
  MINESWEEPER_TAB,
  CLOCKS_TAB,
  SCREENS_TAB,
  STUDIO_TAB,
  SOUNDBOARD_TAB,
  EXPLORER_TAB,
  MESSAGES_TAB,
  GAMES_TAB,
  VIDEO_TAB,
  closePane,
  closeTabUnlessPinned,
  cycleTab,
  equalizePanes,
  focusNextPane,
  isNoteTab,
  newTab,
  openSpecialTab,
  openWebTab,
  runEditorCommand,
  saveNow,
  SETTINGS_TAB,
  splitPane,
  togglePin
} from './editorController'
import { toggleStar } from '../store/starred'
import { toggleStreamerMode } from '../store/streamer'
import { openToday, stepDaily } from './daily'
import { matchesShortcut, normalizeShortcut } from './shortcuts'
import { clearBrowsingData } from '../components/Web/WebPage'
import { showMessages } from '../store/messages'
import { FILE_MANAGER } from '@shared/platform'
import { openRandomNote } from './random'
import { redo, undo } from './undo'
import { notify } from '../store/notify'
import { parentOf } from './paths'
import { newBoard } from './boards'
import { newSpreadsheet } from './newSheet'
import { openAsk, runNoteJob } from '../store/ai'
import { musicControl, musicToggleLike, setMusicMini, shareSongToNote, toggleMusic, useMusic } from '../store/music'
import { sendToPhone } from '../store/phone'
import { openRadial } from '../components/Nav/RadialMenu'
import { startSnip } from './snip'
import { changeNotesPassword, lockAllNow, lockFolder, lockNote, lockNoteOwn, removeLock } from './lock/actions'

export interface Command {
  id: string
  title: string
  /** Default shortcut, e.g. "Ctrl+Shift+F". Can be changed in Settings → Shortcuts. */
  shortcut?: string
  /** Editor commands only work while typing in a note; their keys are handled by the editor itself. */
  scope?: 'global' | 'editor'
  /** Shown as a group heading in Settings → Shortcuts. */
  group: string
  run: () => void
}

const activeNote = (): string | null => {
  const { active } = useEditor.getState()
  return isNoteTab(active) ? active : null
}

const changeFontSize = (step: number | null): void => {
  const { min, max } = RANGES.editorFontSize
  const current = usePrefs.getState().prefs.editorFontSize
  setPrefs({ editorFontSize: step === null ? DEFAULT_PREFS.editorFontSize : Math.min(max, Math.max(min, current + step)) })
}

export const commands: Command[] = [
  { id: 'note.new', group: 'Notes', title: 'New note', shortcut: 'Ctrl+N', run: () => useVault.getState().newNote() },
  { id: 'folder.new', group: 'Notes', title: 'New folder', shortcut: 'Ctrl+Shift+N', run: () => useVault.getState().newFolder() },
  { id: 'board.new', group: 'Notes', title: 'New canvas board', run: () => newBoard() },
  { id: 'sheet.new', group: 'Notes', title: 'New spreadsheet', run: () => newSpreadsheet() },
  { id: 'note.fromTemplate', group: 'Notes', title: 'New note from template…', shortcut: 'Ctrl+Alt+N', run: () => useUI.setState({ modal: 'template' }) },
  {
    id: 'note.rename',
    group: 'Notes',
    title: 'Rename current note',
    run: () => {
      const path = activeNote()
      if (!path) return
      showSidebarView('files')
      useVault.getState().expandTo(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
      useVault.getState().startRename(path)
    }
  },
  {
    id: 'note.delete',
    group: 'Notes',
    title: 'Delete current note',
    run: () => {
      const path = activeNote()
      if (path) useVault.getState().trash(path)
    }
  },
  {
    id: 'note.reveal',
    group: 'Notes',
    title: `Show current note in ${FILE_MANAGER}`,
    run: () => {
      const path = activeNote()
      if (path) window.api.reveal(path)
    }
  },
  {
    id: 'note.star',
    group: 'Notes',
    title: 'Star / unstar current note',
    shortcut: 'Ctrl+Alt+S',
    run: () => {
      const path = activeNote()
      if (path) toggleStar(path)
    }
  },
  { id: 'save', group: 'Notes', title: 'Save now', shortcut: 'Ctrl+S', run: saveNow },
  {
    id: 'note.voice',
    group: 'Notes',
    title: 'Record a voice note',
    run: () => (activeNote() ? useUI.setState({ voiceOpen: true }) : notify('Open a note first; the voice note goes into it.', 'info'))
  },
  {
    id: 'note.place',
    group: 'Notes',
    title: 'Add a place (Google Maps link)',
    run: () => (activeNote() ? useUI.setState({ modal: 'place' }) : notify('Open a note first; the place goes into it.', 'info'))
  },
  {
    id: 'note.export',
    group: 'Notes',
    title: 'Export note… (PDF, Word, web page)',
    shortcut: 'Ctrl+Shift+P',
    run: () => {
      const path = activeNote()
      if (path) openExport(path, false)
    }
  },
  { id: 'vault.export', group: 'Notes folder', title: 'Export all notes…', run: () => openExport('', true) },
  { id: 'vault.import', group: 'Notes folder', title: 'Import notes… (Apple Notes, Google Keep, Notion, Evernote)', run: () => useUI.setState({ modal: 'import' }) },

  {
    id: 'lock.note',
    group: 'Locked notes',
    title: 'Lock this note',
    run: () => {
      const path = activeNote()
      if (path) lockNote(path)
    }
  },
  {
    id: 'lock.noteOwn',
    group: 'Locked notes',
    title: 'Lock this note with its own password…',
    run: () => {
      const path = activeNote()
      if (path) lockNoteOwn(path)
    }
  },
  {
    id: 'lock.remove',
    group: 'Locked notes',
    title: 'Remove the lock from this note…',
    run: () => {
      const path = activeNote()
      if (path) removeLock(path)
    }
  },
  {
    id: 'lock.folder',
    group: 'Locked notes',
    title: 'Lock the folder this note is in',
    run: () => {
      const path = activeNote()
      const folder = path ? parentOf(path) : ''
      if (folder) lockFolder(folder)
      else notify('Open a note that’s inside a folder first (or right-click a folder in the sidebar and choose “Lock folder”).', 'info')
    }
  },
  { id: 'lock.now', group: 'Locked notes', title: 'Lock all notes and passwords now', shortcut: 'Ctrl+Alt+L', run: lockAllNow },
  { id: 'lock.password', group: 'Locked notes', title: 'Change notes password…', run: changeNotesPassword },
  { id: 'passwords.open', group: 'Passwords', title: 'Open passwords', shortcut: 'Ctrl+Alt+K', run: () => openSpecialTab(PASSWORDS_TAB) },

  { id: 'capture.open', group: 'Notes', title: 'Quick capture…', run: () => window.api.openCapture() },
  { id: 'daily.today', group: 'Calendar', title: "Open today's note", shortcut: 'Ctrl+Shift+D', run: () => openToday() },
  { id: 'daily.prev', group: 'Calendar', title: 'Previous daily note', run: () => stepDaily(-1) },
  { id: 'daily.next', group: 'Calendar', title: 'Next daily note', run: () => stepDaily(1) },
  { id: 'calendar.open', group: 'Calendar', title: 'Open calendar', shortcut: 'Ctrl+Shift+C', run: () => openSpecialTab(CALENDAR_TAB) },
  { id: 'messages.open', group: 'Navigation', title: 'Open messages (WhatsApp, Discord)', run: () => openSpecialTab(MESSAGES_TAB) },
  {
    id: 'messages.whatsapp',
    group: 'Navigation',
    title: 'Open WhatsApp',
    run: () => {
      showMessages('whatsapp')
      openSpecialTab(MESSAGES_TAB)
    }
  },
  {
    id: 'messages.discord',
    group: 'Navigation',
    title: 'Open Discord',
    run: () => {
      showMessages('discord')
      openSpecialTab(MESSAGES_TAB)
    }
  },
  { id: 'email.open', group: 'Navigation', title: 'Open email', shortcut: 'Ctrl+Shift+A', run: () => openSpecialTab(EMAIL_TAB) },
  { id: 'calendar.panel', group: 'Calendar', title: 'Show calendar in the side panel', run: () => showRightView('calendar') },
  { id: 'phone.pair', group: 'Phone', title: 'Phone: connect your phone (send, clipboard, remote, touchpad, talk, scan)', run: () => sendToPhone({ kind: 'pair' }) },
  { id: 'phone.wifi', group: 'Phone', title: 'Phone: Wi-Fi QR code for guests', run: () => sendToPhone({ kind: 'wifi' }) },
  { id: 'music.player', group: 'Music', title: 'Show or hide the music player', shortcut: 'Ctrl+Alt+M', run: toggleMusic },
  { id: 'music.toggle', group: 'Music', title: 'Music: play / pause', run: () => void musicControl('toggle') },
  { id: 'music.next', group: 'Music', title: 'Music: next song', run: () => void musicControl('next') },
  { id: 'music.previous', group: 'Music', title: 'Music: previous song', run: () => void musicControl('previous') },
  { id: 'music.mini', group: 'Music', title: 'Music: floating mini player (on top of other apps)', run: () => void setMusicMini(!useMusic.getState().miniOpen) },
  { id: 'music.share', group: 'Music', title: 'Music: add the song playing to this note', run: shareSongToNote },
  { id: 'music.like', group: 'Music', title: 'Music: like the song playing (Liked Songs)', run: () => void musicToggleLike() },

  ...EDITOR_COMMANDS.map(
    (c): Command => ({ id: c.id, group: 'Formatting', title: c.title, shortcut: c.shortcut, scope: 'editor', run: () => runEditorCommand(c.id) })
  ),

  { id: 'tab.new', group: 'Tabs', title: 'New tab', shortcut: 'Ctrl+T', run: newTab },
  {
    id: 'tab.close',
    group: 'Tabs',
    title: 'Close tab',
    shortcut: 'Ctrl+W',
    run: () => {
      const { active } = useEditor.getState()
      if (active) closeTabUnlessPinned(active)
    }
  },
  {
    id: 'tab.pin',
    group: 'Tabs',
    title: 'Pin / unpin tab',
    shortcut: 'Ctrl+Alt+P',
    run: () => {
      const { active } = useEditor.getState()
      if (active) togglePin(active)
    }
  },
  { id: 'tab.next', group: 'Tabs', title: 'Next tab', shortcut: 'Ctrl+Tab', run: () => cycleTab(1) },
  { id: 'tab.prev', group: 'Tabs', title: 'Previous tab', shortcut: 'Ctrl+Shift+Tab', run: () => cycleTab(-1) },

  { id: 'pane.splitRight', group: 'Panes', title: 'Split right', shortcut: 'Ctrl+Alt+\\', run: () => splitPane('right') },
  { id: 'pane.splitDown', group: 'Panes', title: 'Split down', shortcut: 'Ctrl+Alt+-', run: () => splitPane('down') },
  {
    id: 'pane.moveRight',
    group: 'Panes',
    title: 'Move tab to a new pane on the right',
    run: () => {
      const { activePane } = useEditor.getState()
      splitPane('right', { moveFrom: activePane })
    }
  },
  {
    id: 'pane.moveDown',
    group: 'Panes',
    title: 'Move tab to a new pane below',
    run: () => {
      const { activePane } = useEditor.getState()
      splitPane('down', { moveFrom: activePane })
    }
  },
  { id: 'pane.next', group: 'Panes', title: 'Focus next pane', shortcut: 'Ctrl+Alt+Right', run: () => focusNextPane(1) },
  { id: 'pane.prev', group: 'Panes', title: 'Focus previous pane', shortcut: 'Ctrl+Alt+Left', run: () => focusNextPane(-1) },
  { id: 'pane.close', group: 'Panes', title: 'Close pane', run: () => closePane(useEditor.getState().activePane) },
  { id: 'pane.equalize', group: 'Panes', title: 'Even out pane sizes', run: equalizePanes },
  { id: 'layout.single', group: 'Panes', title: 'Layout: single pane', run: () => applyPreset('single') },
  { id: 'layout.columns2', group: 'Panes', title: 'Layout: two columns', run: () => applyPreset('columns2') },
  { id: 'layout.columns3', group: 'Panes', title: 'Layout: three columns', run: () => applyPreset('columns3') },
  { id: 'layout.rows2', group: 'Panes', title: 'Layout: two rows', run: () => applyPreset('rows2') },
  { id: 'layout.grid4', group: 'Panes', title: 'Layout: grid of four', run: () => applyPreset('grid4') },

  { id: 'launcher', group: 'Navigation', title: 'All features (the launcher)', shortcut: 'Ctrl+Shift+Space', run: () => useUI.setState({ launcherOpen: true }) },
  { id: 'radial', group: 'Navigation', title: 'Radial menu (your favourite features in a ring)', run: () => openRadial() },
  { id: 'snip.start', group: 'Tools', title: 'Screen snip: grab text from anywhere on screen', shortcut: 'Ctrl+Shift+S', run: () => void startSnip() },
  { id: 'switcher', group: 'Navigation', title: 'Open note…', shortcut: 'Ctrl+P', run: () => useUI.setState({ modal: 'switcher' }) },
  { id: 'palette', group: 'Navigation', title: 'Show all commands', shortcut: 'Ctrl+K', run: () => useUI.setState({ modal: 'commands' }) },
  { id: 'search', group: 'Navigation', title: 'Search all notes', shortcut: 'Ctrl+Shift+F', run: () => showSearch() },
  { id: 'note.random', group: 'Navigation', title: 'Open a random note', run: () => openRandomNote() },
  { id: 'conflicts', group: 'Navigation', title: 'Review sync copies (Plan (1) and so on)', run: () => openSpecialTab(CONFLICTS_TAB) },
  { id: 'replace', group: 'Navigation', title: 'Find and replace in all notes', shortcut: 'Ctrl+Alt+F', run: () => openSpecialTab(REPLACE_TAB) },
  { id: 'files', group: 'Navigation', title: 'Show files', shortcut: 'Ctrl+Shift+E', run: () => showSidebarView('files') },
  { id: 'tags', group: 'Navigation', title: 'Show tags', run: () => showSidebarView('tags') },
  { id: 'backlinks', group: 'Navigation', title: 'Show backlinks', run: () => showRightView('backlinks') },
  { id: 'graph.open', group: 'Navigation', title: 'Open graph', shortcut: 'Ctrl+Shift+G', run: () => openSpecialTab(GRAPH_TAB) },
  { id: 'home.open', group: 'Navigation', title: 'Go to Home', shortcut: 'Ctrl+Shift+J', run: () => openSpecialTab(HOME_TAB) },
  { id: 'flashcards.open', group: 'Navigation', title: 'Review flashcards', shortcut: 'Ctrl+Shift+Y', run: () => openSpecialTab(FLASHCARDS_TAB) },
  { id: 'terminal.open', group: 'Navigation', title: 'Open terminal (command line in the notes folder)', shortcut: 'Ctrl+Alt+T', run: () => openSpecialTab(TERMINAL_TAB) },
  { id: 'money.open', group: 'Navigation', title: 'Open money tracker', shortcut: 'Ctrl+Shift+B', run: () => openSpecialTab(MONEY_TAB) },
  { id: 'convert.open', group: 'Navigation', title: 'Convert files (photos, Word, audio…)', run: () => openSpecialTab(CONVERT_TAB) },
  { id: 'explorer.open', group: 'Navigation', title: 'Browse files on this computer (and Google Drive)', run: () => openSpecialTab(EXPLORER_TAB) },
  { id: 'comics.open', group: 'Navigation', title: 'Read comics (your comic book shelf)', run: () => openSpecialTab(COMICS_TAB) },
  { id: 'sudoku.open', group: 'Navigation', title: 'Play sudoku (take a quick break)', run: () => openSpecialTab(SUDOKU_TAB) },
  { id: 'soundboard.open', group: 'Navigation', title: 'Open the soundboard and voice changer', run: () => openSpecialTab(SOUNDBOARD_TAB) },
  { id: 'soundboard.stop', group: 'Navigation', title: 'Stop all soundboard sounds', run: () => void import('./soundboard').then((m) => m.stopAll()) },
  { id: 'studio.open', group: 'Navigation', title: 'Open the Studio (record your screen and webcam)', run: () => openSpecialTab(STUDIO_TAB) },
  { id: 'studio.record', group: 'Navigation', title: 'Start or stop recording (Studio)', run: () => void import('./studio').then((m) => m.toggleRecording()) },
  { id: 'minesweeper.open', group: 'Navigation', title: 'Play minesweeper (take a quick break)', run: () => openSpecialTab(MINESWEEPER_TAB) },
  { id: 'video.open', group: 'Navigation', title: 'Video player (play any video, MKV, AVI…)', run: () => openSpecialTab(VIDEO_TAB) },
  { id: 'screens.open', group: 'Navigation', title: 'Screens (monitor brightness, contrast and input)', run: () => openSpecialTab(SCREENS_TAB) },
  { id: 'screens.brighter', group: 'Navigation', title: 'Make every screen brighter', run: () => void window.api.monitorAction('all', { kind: 'brightness', mode: 'up', amount: 10 }) },
  { id: 'screens.dimmer', group: 'Navigation', title: 'Make every screen dimmer', run: () => void window.api.monitorAction('all', { kind: 'brightness', mode: 'down', amount: 10 }) },
  { id: 'clocks.open', group: 'Navigation', title: 'World clocks (the time in other places)', run: () => openSpecialTab(CLOCKS_TAB) },
  { id: 'games.open', group: 'Navigation', title: 'Games (play your Steam and other games)', run: () => openSpecialTab(GAMES_TAB) },
  { id: 'web.open', group: 'Web', title: 'Open a web page', shortcut: 'Ctrl+Shift+I', run: () => openWebTab() },
  { id: 'web.beside', group: 'Web', title: 'Open a web page beside this note', run: () => openWebTab('', { beside: true }) },
  {
    id: 'youtube.open',
    group: 'Web',
    title: 'YouTube in a mini window (floats over everything while you work)',
    shortcut: 'Ctrl+Alt+Y',
    run: () => void window.api.openYouTube()
  },
  { id: 'web.clear', group: 'Web', title: 'Clear browsing data (sign out of all websites)', run: () => void clearBrowsingData() },
  {
    id: 'view.mindmap',
    group: 'View',
    title: 'Mind map of this note / back to writing',
    shortcut: 'Ctrl+Shift+M',
    run: () => {
      const { activePane, active } = useEditor.getState()
      if (isNoteTab(active)) toggleMindMap(activePane, active)
    }
  },
  { id: 'outline', group: 'Navigation', title: 'Show outline', shortcut: 'Ctrl+Shift+O', run: () => showRightView('outline') },

  { id: 'ai.chat', group: 'AI helper', title: 'AI helper: chat with Claude', run: () => openSpecialTab(CHAT_TAB) },
  { id: 'ai.ask', group: 'AI helper', title: 'AI helper: ask everything (notes, email, calendar, money)', run: () => openAsk() },
  { id: 'ai.summarise', group: 'AI helper', title: 'AI helper: summarise this note', run: () => activeNote() && runNoteJob('summary') },
  { id: 'ai.tidy', group: 'AI helper', title: 'AI helper: tidy up this note', run: () => activeNote() && runNoteJob('tidy') },

  { id: 'settings', group: 'View', title: 'Open settings', shortcut: 'Ctrl+,', run: () => openSpecialTab(SETTINGS_TAB) },
  { id: 'focus', group: 'View', title: 'Toggle focus mode', shortcut: 'Ctrl+\\', run: toggleFocusMode },
  { id: 'view.zen', group: 'View', title: 'Zen mode', shortcut: 'Ctrl+Alt+Z', run: () => toggleZen() },
  {
    id: 'view.reading',
    group: 'View',
    title: 'Reading mode / writing mode',
    shortcut: 'Ctrl+Shift+R',
    run: () => setPrefs({ readingMode: !usePrefs.getState().prefs.readingMode })
  },
  { id: 'view.streamer', group: 'View', title: 'Streamer mode on / off (blur private things)', shortcut: 'Ctrl+Alt+B', run: toggleStreamerMode },
  {
    id: 'typewriter.center',
    group: 'View',
    title: 'Typewriter mode: keep the current line in the middle',
    run: () => setPrefs({ typewriterCenter: !usePrefs.getState().prefs.typewriterCenter })
  },
  {
    id: 'typewriter.dim',
    group: 'View',
    title: 'Typewriter mode: fade everything else',
    run: () => setPrefs({ typewriterDim: !usePrefs.getState().prefs.typewriterDim })
  },
  { id: 'left', group: 'View', title: 'Toggle left sidebar', run: () => useUI.setState((s) => ({ leftOpen: !s.leftOpen })) },
  { id: 'right', group: 'View', title: 'Toggle right panel', run: () => useUI.setState((s) => ({ rightOpen: !s.rightOpen })) },
  { id: 'font.bigger', group: 'View', title: 'Bigger text', shortcut: 'Ctrl+=', run: () => changeFontSize(1) },
  { id: 'font.smaller', group: 'View', title: 'Smaller text', shortcut: 'Ctrl+-', run: () => changeFontSize(-1) },
  { id: 'font.reset', group: 'View', title: 'Reset text size', shortcut: 'Ctrl+0', run: () => changeFontSize(null) },

  { id: 'undo', group: 'Notes', title: 'Undo the last change (files, playlists, settings…)', run: () => void undo() },
  { id: 'redo', group: 'Notes', title: 'Redo', run: () => void redo() },

  { id: 'vault.reveal', group: 'Notes folder', title: `Open notes folder in ${FILE_MANAGER}`, run: () => window.api.revealVault() },
  { id: 'vault.switch', group: 'Notes folder', title: 'Switch notes folder…', run: () => useUI.getState().vaultActions.switchVault() },
  { id: 'vault.close', group: 'Notes folder', title: 'Close notes folder', run: () => useUI.getState().vaultActions.closeVault() }
]

/** A command's current shortcut, taking your Settings into account. */
export const shortcutFor = (cmd: Command): string | null => effectiveShortcut(cmd.id, cmd.shortcut)

/** The app-wide commands' shortcuts (so they also work while a web page has focus). */
export function appShortcuts(): string[] {
  return commands.flatMap((c) => {
    const shortcut = c.scope === 'editor' ? null : shortcutFor(c)
    return shortcut ? [normalizeShortcut(shortcut)] : []
  })
}

/** The app-wide command bound to a shortcut like "Ctrl+W", if any. */
export function commandForShortcut(shortcut: string): Command | undefined {
  return commands.find((c) => c.scope !== 'editor' && normalizeShortcut(shortcutFor(c) ?? '') === shortcut)
}

/** The app-wide command (not an editor one) bound to this key press, if any. */
export function commandForKey(e: KeyboardEvent): Command | undefined {
  return commands.find((c) => {
    if (c.scope === 'editor') return false
    const shortcut = shortcutFor(c)
    return !!shortcut && matchesShortcut(e, shortcut)
  })
}
