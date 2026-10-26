import type { Prefs } from './prefs'

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized?: boolean
}

export interface Settings {
  vaultPath: string | null
  window?: WindowBounds
  /** Raw preferences as stored; always read through normalizePrefs (shared/prefs.ts). */
  prefs?: unknown
  /** We've shown the "still running in the tray" message once. */
  toldAboutTray?: boolean
}

export interface CaptureStatus {
  /** e.g. "Win+Shift+N", or '' if none is set or it couldn't be registered. */
  shortcut: string
  error?: string
  target: 'daily' | 'inbox'
}

/** Where checking for a newer version of Notes (from GitHub Releases) has got to. */
export interface UpdateStatus {
  state: 'off' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  /** The current version of Notes. */
  current: string
  /** The newer version, once one is found. */
  version?: string
  /** Download progress, 0–100. */
  percent?: number
  error?: string
  /**
   * On a Mac, updates can only install themselves in apps signed with a paid Apple certificate, so
   * Notes offers to open the download page instead.
   */
  manual?: boolean
  /** Why checking is off, e.g. "Updates are checked in the installed app only." */
  reason?: string
}

/** A folder or markdown note. `path` is relative to the vault root and always uses `/`. */
export interface FileNode {
  name: string
  path: string
  type: 'file' | 'folder'
  children?: FileNode[]
}

/** An event from Google Calendar or a calendar link, as the calendar views show it. */
export interface CalEvent {
  id: string
  sourceId: string
  calendarName: string
  color: string
  title: string
  allDay: boolean
  /** All-day: day keys ("2026-10-26", end exclusive). Timed: ISO instants. */
  start: string
  end: string
  location?: string
  /** "Open in Google Calendar" link, if there is one. */
  url?: string
}

export interface CalendarSourcesStatus {
  google: {
    clientId: string
    hasSecret: boolean
    /** Signed in (a saved sign-in exists). */
    connected: boolean
    email?: string
    /** e.g. "Sign-in expired, connect again". */
    error?: string
    calendars: { id: string; name: string; color: string; enabled: boolean }[]
  }
  feeds: { id: string; name: string; color: string; error?: string }[]
  /** False if the system can't encrypt the saved sign-in (then connecting is refused). */
  canEncrypt: boolean
}

export interface ConfirmOptions {
  message: string
  detail?: string
  /** Label of the button that confirms. */
  ok: string
  cancel?: string
  type?: 'question' | 'warning'
}

/** The API the preload script exposes to the renderer as `window.api`. */
export interface NotesApi {
  /** A native yes/no dialog; resolves true if the user picked `ok`. */
  confirm(options: ConfirmOptions): Promise<boolean>

  getPrefs(): Promise<Prefs>
  /** Saves some preferences; resolves with the full, validated preferences. */
  setPrefs(patch: Partial<Prefs>): Promise<Prefs>
  /** Called when preferences change (including hand edits to settings.json). */
  onPrefsChanged(callback: (prefs: Prefs) => void): () => void
  /** Spell-check languages Windows has available (none on a Mac, which picks them itself), e.g. ['en-GB', 'en-US']. */
  spellcheckLanguages(): Promise<string[]>
  /** Opens settings.json in your default editor. */
  openSettingsFile(): Promise<void>

  // Updates
  updateStatus(): Promise<UpdateStatus>
  /** Looks for a newer version now. */
  checkForUpdates(): Promise<UpdateStatus>
  /** Restarts into a downloaded update (Windows), or opens the download page (Mac). */
  installUpdate(): Promise<void>
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void

  // Export
  /** An image file's bytes (images inside the notes folder only). */
  readImage(path: string): Promise<Uint8Array>
  /** Turns a complete HTML page into a PDF (A4). */
  printToPdf(html: string): Promise<Uint8Array>
  /** Asks where to save one exported file and writes it; resolves with its path, or null if cancelled. */
  exportFile(defaultName: string, format: 'pdf' | 'docx' | 'html', data: Uint8Array | string): Promise<string | null>
  /** Asks for a folder and writes several exported files into a new folder inside it; resolves with that folder, or null. */
  exportFiles(folderName: string, files: { name: string; data: Uint8Array | string }[]): Promise<string | null>
  /** Shows a file in File Explorer / Finder. */
  showExported(path: string): Promise<void>

  // Quick capture
  /** Opens the quick capture window. */
  openCapture(): Promise<void>
  closeCapture(): Promise<void>
  captureStatus(): Promise<CaptureStatus>
  /** From the capture window: save this text (the main window does the saving). */
  submitCapture(text: string): Promise<{ ok: boolean; where?: string; error?: string }>
  /** Capture window: called each time it's shown, to start fresh. */
  onCaptureReset(callback: () => void): () => void
  /** Main window: asked to save a capture; reply with captureResult. */
  onCaptureRequest(callback: (id: number, text: string) => void): () => void
  captureResult(id: number, result: { ok: boolean; where?: string; error?: string }): Promise<void>

  // Google Calendar and calendar links (read-only)
  calendarSources(): Promise<CalendarSourcesStatus>
  googleSetClient(clientId: string, clientSecret: string): Promise<CalendarSourcesStatus>
  /** Opens your browser to sign in to Google; resolves once you've approved (or it timed out). */
  googleConnect(): Promise<CalendarSourcesStatus>
  googleDisconnect(): Promise<CalendarSourcesStatus>
  googleSetCalendarEnabled(id: string, enabled: boolean): Promise<CalendarSourcesStatus>
  addCalendarFeed(name: string, url: string): Promise<CalendarSourcesStatus>
  removeCalendarFeed(id: string): Promise<CalendarSourcesStatus>
  /** Events between two instants from every enabled calendar (cached ones if offline). */
  fetchCalendarEvents(from: string, to: string): Promise<{ events: CalEvent[]; errors: string[]; offline: boolean }>
  /** The last-opened vault, or null if none is set or the folder no longer exists. */
  getVault(): Promise<string | null>
  /** Opens a folder picker; returns the chosen vault path, or null if cancelled. */
  pickVault(): Promise<string | null>
  /** Forgets the current vault and returns to the welcome screen. */
  closeVault(): Promise<void>
  /** Opens the vault folder in File Explorer / Finder. */
  revealVault(): Promise<void>

  /** Folders and .md files in the vault, folders first. */
  listTree(): Promise<FileNode[]>
  /** Creates an empty "Untitled" note in the folder; returns its path. */
  createNote(folder: string): Promise<string>
  /** Creates a note at an exact path, making folders as needed; returns its path. */
  createNoteAt(path: string): Promise<string>
  /** Every note's path and text (for the link index). */
  readAllNotes(): Promise<{ path: string; content: string }[]>
  /** Creates a "New folder" in the folder; returns its path. */
  createFolder(folder: string): Promise<string>
  /** Renames a note or folder in place; returns the new path. Notes keep their .md extension. */
  rename(path: string, newName: string): Promise<string>
  /** Moves a note or folder into another folder ('' is the vault root); returns the new path. */
  move(path: string, folder: string): Promise<string>
  /** Asks for confirmation, then moves the item to the Recycle Bin / Bin. Returns false if cancelled. */
  trash(path: string): Promise<boolean>
  /** Shows the item selected in File Explorer / Finder. */
  reveal(path: string): Promise<void>
  /** Reads/writes a small app file kept in the vault's hidden ".notesapp" folder (synced with your notes). */
  readAppData(name: string): Promise<string | null>
  writeAppData(name: string, content: string): Promise<void>
  /** Saves pasted/dropped file data into a vault folder; returns the new file's path. */
  saveAttachment(folder: string, name: string, data: Uint8Array): Promise<string>
  /** Lets you pick files on disk and copies them into a vault folder; returns their paths. */
  pickAttachment(folder: string, imagesOnly: boolean): Promise<string[]>
  /** Opens a vault file (like a PDF) in its usual app. */
  openFile(path: string): Promise<void>
  /** Reads a note's markdown. */
  readNote(path: string): Promise<string>
  /** Saves a note atomically. */
  writeNote(path: string, content: string): Promise<void>

  /** Called with the changed paths whenever files in the vault change on disk. Returns an unsubscribe function. */
  onVaultChanged(callback: (paths: string[]) => void): () => void
  /** Called when the window is about to close; call `readyToClose()` once unsaved work is saved. */
  onBeforeClose(callback: () => void): () => void
  readyToClose(): Promise<void>
}
