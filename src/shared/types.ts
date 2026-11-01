import type { ExplorerEntry, ExplorerPlace, PasteMode } from './explorer'
import type { ComicOpened, ComicPreparing, ComicSettings, ComicShelf } from './comics'
import type { Prefs } from './prefs'
import type { DictionaryEntry } from './dictionary'
import type { Sheet } from './sheet'
import type { Place } from './places'
import type { WeatherPlace, WeatherState } from './weather'
import type { LocalLibrary } from './localMusic'
import type { WifiNetwork } from './wifi'
import type { MusicAction, MusicDevice, MusicItem, MusicQueue, MusicSearchResults, MusicState, MusicStatus } from './spotify'
import type { CoversStatus, GamesList, LaunchArt } from './games'
import type { VideoInfo } from './videoPlayer'
import type { Theme } from './themes'
import type { ShareButton, ShareOs, ShareSide } from './mouseShare'

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
  /** Mac: you chose not to be asked again about moving Notes into Applications. */
  keepOutsideApplications?: boolean
  /** The YouTube mini window: where it was left, what was playing, and how it was set. */
  youtubeWindow?: WindowBounds
  youtubeUrl?: string
  youtubePinned?: boolean
  youtubeVideoOnly?: boolean
  /** The floating mini music player: where it was left, and whether it was showing. */
  musicMiniWindow?: WindowBounds
  musicMiniOpen?: boolean
  /** The paired phone's link (its token, and the port it was on), so the phone reconnects by itself. */
  phoneToken?: string
  phonePort?: number
  /** One mouse, two computers: whether it's on, the paired computer, and how it's set up. */
  mouseShare?: ShareSaved
  /** The phone webcam: whether it's on, its https link (token and port), and how the picture is made. */
  camOn?: boolean
  camToken?: string
  camPort?: number
  camQuality?: 'sd' | 'hd'
  camFill?: boolean
}

/** How the phone webcam is doing, for its window in Orbit. */
export interface CamStatus {
  on: boolean
  /** The https address the phone opens (empty while off). */
  url: string
  /** Whether the phone is sending frames right now, and how many a second. */
  phone: boolean
  fps: number
  /**
   * The PC camera: running; starting; "no-driver" (OBS Studio's camera isn't installed); "in-use"
   * (OBS itself, or something else, is the virtual camera); "error"; "mac" (not needed there); "off".
   */
  camera: 'running' | 'starting' | 'no-driver' | 'in-use' | 'error' | 'mac' | 'off'
  message: string
  quality: 'sd' | 'hd'
  fill: boolean
}

/** Mouse sharing, as saved. `side` is where the other computer sits, seen from this one. */
export interface ShareSaved {
  enabled: boolean
  /** This computer's own id (made once). */
  id: string
  peer?: { id: string; name: string; os: ShareOs; secret: string; host?: string; port?: number }
  side: ShareSide
  swapCtrlCmd: boolean
  shareClipboard: boolean
  speed: number
  /** Keep the mouse on this computer for now. */
  paused?: boolean
  /** The other computer's address, typed in, for networks that don't let them find each other. */
  manualHost?: string
}

/** Mouse sharing, for the Settings page. */
export interface ShareStatus {
  enabled: boolean
  name: string
  os: ShareOs
  paired: { name: string; os: ShareOs } | null
  connected: boolean
  side: ShareSide
  swapCtrlCmd: boolean
  shareClipboard: boolean
  speed: number
  paused: boolean
  manualHost: string
  /** Other computers running Orbit with sharing on, not paired yet. */
  nearby: { id: string; name: string; os: ShareOs }[]
  pairing: { name: string; code: string; weConfirmed: boolean } | null
  /** Where the mouse is: on this computer, over on the other one, or this one is being driven. */
  using: 'here' | 'there' | 'controlled'
  /** Mac: Orbit is allowed to move the pointer (Accessibility). Always true on Windows. */
  accessibility: boolean
  error: string
}

/** Something done in the invisible window while the mouse is on the other computer. */
export type ShareInputEvent =
  | { t: 'move'; dx: number; dy: number }
  | { t: 'btn'; b: ShareButton; down: boolean }
  | { t: 'wheel'; dx: number; dy: number }
  | { t: 'key'; code: string; down: boolean }

/** What the notes window's music player tells the floating mini player. */
export interface MusicMiniState {
  state: MusicState | null
  /** When `state` arrived (for the progress bar). */
  at: number
}

/** A button pressed in the floating mini player, for the notes window to carry out. */
export type MusicMiniCommand = { action: MusicAction } | { seek: number }

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

/**
 * A folder, a markdown note ('file'), or any other file ('attachment': pictures, recordings, PDFs…).
 * `path` is relative to the vault root and always uses `/`.
 */
export interface FileNode {
  name: string
  path: string
  type: 'file' | 'folder' | 'attachment'
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

/** The Google sign-in, as the Email page sees it. */
export interface GoogleAuthStatus {
  /** A client ID and secret are saved (Settings → Calendar). */
  configured: boolean
  connected: boolean
  email?: string
  /** The sign-in includes Gmail. */
  gmail: boolean
  error?: string
  canEncrypt: boolean
}

export interface EmailAddress {
  name: string
  email: string
}

/** One email in a list. */
export interface EmailSummary {
  id: string
  threadId: string
  from: EmailAddress
  subject: string
  /** Google's short preview of the text. */
  snippet: string
  /** ISO instant. */
  date: string
  unread: boolean
  starred: boolean
  hasAttachments: boolean
}

/** An opened email. */
export interface EmailMessage extends EmailSummary {
  to: EmailAddress[]
  cc: EmailAddress[]
  replyTo?: EmailAddress
  /** The Message-ID header, for replies. */
  messageId?: string
  references?: string
  text?: string
  html?: string
  attachments: { name: string; size: number }[]
  /** Opens it in Gmail in your browser. */
  webUrl: string
}

export type EmailFolder = 'inbox' | 'unread' | 'starred' | 'sent' | 'all'

export interface EmailList {
  emails: EmailSummary[]
  /** Pass back to get the next page. */
  next?: string
}

export interface OutgoingEmail {
  to: string
  cc?: string
  subject: string
  body: string
  /** Replying: keeps it in the same conversation. */
  replyTo?: { threadId: string; messageId?: string; references?: string }
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
/** Settings → AI helper: whether an Anthropic API key is saved. */
export interface AiStatus {
  hasKey: boolean
  /** False if the system can't encrypt the key (it is then not saved). */
  canEncrypt: boolean
}

/** A note handed to the AI helper as context for a question. */
export interface AiNote {
  title: string
  text: string
}

/** An earlier question and answer, so follow-up questions make sense. */
export interface AiAskTurn {
  question: string
  answer: string
}

/** A message in the AI chat. */
export interface AiChatMessage {
  role: 'user' | 'assistant'
  text: string
}

/** A saved AI chat conversation. */
export interface AiChat {
  id: string
  title: string
  /** When it was last added to (ISO time), so the newest chats come first. */
  updated: string
  messages: AiChatMessage[]
}

export interface YouTubeState {
  url: string
  /** Where to start a video popped out from another website, in seconds. */
  startAt?: number
  pinned: boolean
  videoOnly: boolean
}

/** Something shared with a phone over the local Wi-Fi: `url` goes in the QR code. */
export interface PhoneShare {
  token: string
  url: string
  expiresAt: number
}

/** The paired phone's QR address, and how many phones have its page open now. */
export interface PhonePairing {
  url: string
  connected: number
}

/** Something the paired phone did, for the notes window to carry out. */
export type PhoneEvent =
  | { type: 'connected'; count: number }
  | { type: 'file'; path: string; into: 'note' | 'folder' }
  | { type: 'receipt'; path: string; text: string }
  | { type: 'dictate'; id: string; text: string; done: boolean }
  /** A button on the phone's Deck was pressed. */
  | { type: 'deck'; id: string }

/** A button on the phone's Deck tab. */
export interface DeckButton {
  id: string
  label: string
  /** An emoji (the phone page has no icon font). */
  icon: string
  /** Bring Orbit's window to the front when pressed (it opens something). */
  show?: boolean
}

/** What the phone's Screen tab shows: today's plan, the open note, the focus timer. */
export interface PhoneScreen {
  today: { time: string; title: string; done?: boolean }[]
  note: { title: string; text: string } | null
  timer: { label: string; endsAt: number | null; left: number | null } | null
}

/** A screen or window the Studio can capture (desktopCapturer). */
export interface StudioCaptureSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  /** A small picture of it (data: URL), or '' if there isn't one. */
  thumb: string
}

export interface NotesApi {
  /** A native yes/no dialog; resolves true if the user picked `ok`. */
  confirm(options: ConfirmOptions): Promise<boolean>
  /** Copies a password; the clipboard empties itself after `seconds` (and when Notes quits) if it still holds it. */
  copySecret(text: string, seconds: number): Promise<void>

  getPrefs(): Promise<Prefs>
  /** Saves some preferences; resolves with the full, validated preferences. */
  setPrefs(patch: Partial<Prefs>): Promise<Prefs>
  /** Called when preferences change (including hand edits to settings.json). */
  onPrefsChanged(callback: (prefs: Prefs) => void): () => void
  // Undo for files (main/undoBin.ts). Paths are notes-folder paths when `inVault`, else full paths.
  /** Deletes without asking, into Orbit's short-term bin. Returns the ones that can be brought back. */
  undoHold(paths: string[], inVault: boolean): Promise<string[]>
  /** Which of these were just deleted in a way that can be undone. */
  undoHeld(paths: string[], inVault: boolean): Promise<string[]>
  /** Brings deleted things back. Returns where each went, in the same order. */
  undoRestore(paths: string[], inVault: boolean): Promise<string[]>
  /** They can't be undone any more: on to the Recycle Bin / Bin. */
  undoRelease(paths: string[], inVault: boolean): Promise<void>
  /** Moves things back (full paths): each `to` goes back to `from`. Returns the moves made. */
  undoMoveBack(items: { from: string; to: string }[]): Promise<{ from: string; to: string }[]>
  /** Undo / Redo from the Mac's Edit menu. */
  onEditCommand(callback: (which: 'undo' | 'redo') => void): () => void
  /** Spell-check languages Windows has available (none on a Mac, which picks them itself), e.g. ['en-GB', 'en-US']. */
  spellcheckLanguages(): Promise<string[]>
  /** Opens settings.json in your default editor. */
  openSettingsFile(): Promise<void>

  /** Themes imported from theme files (see themePack.ts). */
  listThemes(): Promise<Theme[]>
  /** Asks for a theme file and imports it. */
  importTheme(): Promise<{ theme?: Theme; error?: string; canceled?: boolean }>
  removeTheme(id: string): Promise<void>
  onThemesChanged(callback: (themes: Theme[]) => void): () => void
  /** Shows notes.log (problems Notes ran into) in File Explorer / Finder. */
  showLog(): Promise<void>
  /** Puts the window into (or out of) full screen. */
  setFullScreen(on: boolean): Promise<void>
  /** A reminder notification; clicking it opens the note at that line (onReminderOpen). */
  /** Resolves false if this system can't show notifications at all. */
  showReminder(r: { title: string; body: string; path: string; line: number }): Promise<boolean>
  onReminderOpen(callback: (path: string, line: number) => void): () => void
  /** Mac: asks for microphone access (once); elsewhere always true. */
  micAccess(): Promise<boolean>
  /** Studio: the screens and windows that can be captured. */
  studioSources(): Promise<StudioCaptureSource[]>
  /** Studio, Mac: asks for camera access / checks screen recording isn't blocked; elsewhere true. */
  studioAccess(what: 'camera' | 'screen'): Promise<boolean>
  studioDefaultFolder(): Promise<string>
  studioPickFolder(): Promise<string | null>
  /** Starts a recording file in `folder` (null = Videos/Orbit Recordings). */
  studioStart(folder: string | null, ext: 'mp4' | 'webm'): Promise<{ id: number; path: string }>
  studioChunk(id: number, data: Uint8Array): Promise<{ ok: boolean; error?: string }>
  /** Finishes the file; resolves to its path. */
  studioStop(id: number): Promise<string | null>
  studioReveal(path: string): Promise<void>
  studioOpenFolder(folder: string | null): Promise<string>
  /** Going live (main/live.ts). */
  liveStatus(): Promise<import('./live').LiveStatus>
  onLiveStatus(callback: (s: import('./live').LiveStatus) => void): () => void
  /** Downloads ffmpeg (needed to go live). */
  liveGetFfmpeg(): Promise<import('./live').LiveStatus>
  liveRemoveFfmpeg(): Promise<import('./live').LiveStatus>
  /** Saves a stream key (encrypted) and, for Custom, the server address. An empty key keeps the saved one. */
  liveSetKey(service: import('./live').LiveService, key: string, customUrl?: string): Promise<import('./live').LiveStatus>
  liveClearKey(service: import('./live').LiveService): Promise<import('./live').LiveStatus>
  liveSetService(service: import('./live').LiveService): Promise<import('./live').LiveStatus>
  liveStart(service: import('./live').LiveService, quality: string): Promise<void>
  /** Resolves false once the stream has ended. */
  liveChunk(data: Uint8Array): Promise<boolean>
  liveStop(): Promise<void>
  onLiveStats(callback: (s: import('./live').LiveStats) => void): () => void
  /** The stream ended by itself: an error message, or null. */
  onLiveEnded(callback: (error: string | null) => void): () => void
  /** The note's right-click menu asked to record a voice note. */
  onVoiceStart(callback: () => void): () => void
  /** The note's right-click menu asked to draw a sketch. */
  onSketchStart(callback: () => void): () => void

  // Menus
  /** The Format items shown when you right-click selected text in a note. */
  setFormatMenu(items: PopupMenuItem[]): void
  /** A Format item was picked from the right-click menu. */
  onFormat(callback: (id: string) => void): () => void
  /** Pops up a native menu at (x, y) in the page; resolves to the picked item's id, or null. */
  popupMenu(items: PopupMenuItem[], x: number, y: number): Promise<string | null>
  /** The word you just right-clicked in a note (null: not on a word), for the dictionary on the menu. */
  setMenuWord(word: MenuWord | null): void
  /** "See all meanings" was picked on the right-click menu. */
  onShowDefinition(callback: (entry: DictionaryEntry) => void): () => void
  /** A synonym was picked on the right-click menu: put it in place of the right-clicked word. */
  onReplaceWord(callback: (text: string) => void): () => void
  // Importing from other apps
  /** Picks an export (a file, or a folder) to import; null if cancelled. */
  pickImport(kind: 'file' | 'folder', extensions?: string[]): Promise<string | null>
  /** Every file inside a picked folder (paths relative to it, with /). */
  listImport(root: string): Promise<string[]>
  readImport(path: string): Promise<Uint8Array>
  md5(data: Uint8Array): Promise<string>
  /** Mac: every note in Apple Notes (asks for permission the first time). */
  appleNotes(): Promise<AppleNote[]>

  /** A web page's title (for pasted links); null if it can't be read quickly. */
  webTitle(url: string): Promise<string | null>
  /** Places matching a search (from OpenStreetMap), or an error to show if it couldn't be reached. */
  searchPlaces(query: string): Promise<{ places: Place[]; error?: string }>
  /** One square of a map preview as a data: URL; null if it couldn't be fetched. */
  mapTile(z: number, x: number, y: number): Promise<string | null>
  /** Your town and its forecast (from Open-Meteo), fetched again if it's old or `force`. */
  weather(force?: boolean): Promise<WeatherState>
  /** Sets (or, with null, forgets) the town the weather is for, and fetches its forecast. */
  setWeatherPlace(place: WeatherPlace | null): Promise<WeatherState>

  // The web browser tab
  /** Signs you out of every website and forgets what the web tabs stored. */
  clearWebData(): Promise<void>
  /** Signs you out of WhatsApp and Discord in the messages hub. */
  clearMessagesData(): Promise<void>
  /** Closes WhatsApp and Discord properly before the Messages tab goes, so they stay signed in. */
  releaseMessages(): Promise<void>
  /** The app's shortcuts, so they still work while a web page has focus. */
  setWebShortcuts(shortcuts: string[]): void
  /** A web page opened a link in a new window: open it in a new web tab. */
  onWebOpen(callback: (url: string) => void): () => void
  /** One of the app's shortcuts was pressed while a web page had focus. */
  onWebShortcut(callback: (shortcut: string) => void): () => void

  // The YouTube mini window
  /**
   * Opens the floating YouTube window (or brings it back), playing `url` if given: a YouTube link,
   * or any web page with a video on it, played from `seconds` in.
   */
  openYouTube(url?: string, seconds?: number): Promise<void>
  /** In the mini window: what to show first, and how you left it set. */
  youTubeState(): Promise<YouTubeState>
  /** In the mini window: the page showing now, so it carries on there next time. */
  rememberYouTube(url: string): Promise<void>
  /** In the mini window: float over other windows, or not. */
  pinYouTube(on: boolean): Promise<void>
  /** In the mini window: show only the video on a video's page, or the whole YouTube page. */
  setYouTubeVideoOnly(on: boolean): Promise<void>
  minimizeYouTube(): Promise<void>
  closeYouTube(): Promise<void>
  /** In the mini window: play this page (opened from the notes window). */
  onYouTubeLoad(callback: (url: string, seconds: number) => void): () => void

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
  exportFile(defaultName: string, format: SaveFormat, data: ExportData): Promise<string | null>
  /** Asks for a folder and writes several exported files into a new folder inside it; resolves with that folder, or null. */
  exportFiles(folderName: string, files: { name: string; data: ExportData }[]): Promise<string | null>
  /** Shows a file in File Explorer / Finder. */
  showExported(path: string): Promise<void>

  // File converter
  /** An iPhone photo (HEIC/HEIF) as plain pixels: RGBA, 4 bytes a pixel. */
  decodeHeic(data: Uint8Array): Promise<{ width: number; height: number; data: Uint8Array }>
  /** Where a dropped or chosen file is on this computer ("" if it isn't a file on disk). */
  pathForFile(file: File): string
  /** Whether the video converter (ffmpeg) is downloaded. */
  videoConverterStatus(): Promise<FfmpegState>
  /** Downloads the video converter (ffmpeg); resolves when it's done or has failed. */
  getVideoConverter(): Promise<FfmpegState>
  /** Download progress for the video converter. Returns a function that stops listening. */
  onVideoConverterStatus(callback: (state: FfmpegState) => void): () => void
  /** Converts a video (or takes its sound) with ffmpeg; resolves when it's done. */
  convertVideo(request: VideoConvertRequest): Promise<ConvertedFile>
  /** Stops a video conversion, or throws away a finished one that wasn't saved. */
  cancelVideo(id: number): Promise<void>
  /** How far along a video conversion is (0…1). Returns a function that stops listening. */
  onVideoProgress(callback: (id: number, done: number) => void): () => void

  // Video player
  /** What's in a video (its tracks need the video helper, ffmpeg) and the subtitle files beside it. */
  videoInfo(path: string): Promise<VideoInfo>
  /** Subtitles as text: a subtitle file, or one of the video's own tracks (as WebVTT). */
  videoSubtitles(path: string, source: { stream?: number; file?: string }): Promise<string>
  /** Where a stream that copies the picture from `at` really starts (the keyframe before). */
  videoKeyframe(path: string, at: number, fileStart: number): Promise<number>
  /** Stops a page's live video stream. */
  stopVideoStream(session: string): Promise<void>
  /** The full path of a file in the notes folder. */
  videoInVault(path: string): Promise<string>
  /** Asks for a video, or subtitles (starting beside `near`); null if cancelled. */
  pickVideoFile(kind: 'video' | 'subtitles', near?: string): Promise<string | null>

  // Quick capture
  /** Opens the quick capture window. */
  // Screen snip (main/snip.ts)
  /** Takes a picture of the screen under the pointer and opens the snip window over it. */
  startSnip(): Promise<void>
  snipStatus(): Promise<{ shortcut: string; error?: string }>
  /** Snip window: the picture of the screen (PNG) and the screen's scale factor. */
  snipImage(): Promise<{ png: Uint8Array; scale: number } | null>
  /** Snip window: the text in part of the picture (read offline). */
  snipRead(png: Uint8Array): Promise<string>
  snipClose(): Promise<void>
  /** Snip window: what to do with the text (closes the snip). */
  snipSend(action: 'copy' | 'note' | 'web' | 'translate' | 'ask', text: string): Promise<void>
  /** Main window: snipped text to save in today's note or ask the AI about. */
  onSnipText(callback: (action: 'note' | 'ask', text: string) => void): () => void
  onSnipFailed(callback: (message: string) => void): () => void
  openCapture(): Promise<void>
  closeCapture(): Promise<void>
  /** Capture window: stay open even when it loses focus (while recording). */
  captureKeepOpen(on: boolean): Promise<void>
  captureStatus(): Promise<CaptureStatus>
  /** From the capture window: save this text (the main window does the saving). */
  submitCapture(request: CaptureRequest): Promise<{ ok: boolean; where?: string; error?: string; show?: boolean }>
  /** Capture window: called each time it's shown, to start fresh. */
  onCaptureReset(callback: () => void): () => void
  /** Main window: asked to save a capture; reply with captureResult. */
  onCaptureRequest(callback: (id: number, request: CaptureRequest) => void): () => void
  captureResult(id: number, result: { ok: boolean; where?: string; error?: string; show?: boolean }): Promise<void>

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
  // Email (Gmail, using the Google sign-in above)
  emailStatus(): Promise<GoogleAuthStatus>
  /** Signs in to Google in your browser, asking for email access too. */
  emailConnect(): Promise<GoogleAuthStatus>
  /** A page of emails; `query` is a Gmail search like "from:sam invoice". */
  emailList(folder: EmailFolder, query: string, next?: string): Promise<EmailList>
  emailGet(id: string): Promise<EmailMessage>
  emailSend(email: OutgoingEmail): Promise<void>
  emailMarkRead(id: string, read: boolean): Promise<void>
  emailStar(id: string, starred: boolean): Promise<void>
  emailArchive(id: string): Promise<void>
  /** Moves it to Gmail's Bin (Gmail deletes it for good after 30 days). */
  emailTrash(id: string): Promise<void>
  /** A .gsheet file's sheet, fetched from Google with the sign-in above. */
  readGoogleSheet(path: string): Promise<GoogleSheetResult>
  // Music player (Spotify: the Mac app directly, or your account)
  musicStatus(): Promise<MusicStatus>
  /** Saves your Spotify developer app's client ID ('' to remove it). */
  musicSetClient(clientId: string): Promise<MusicStatus>
  /** Signs in to Spotify in your browser. */
  musicConnect(): Promise<MusicStatus>
  musicDisconnect(): Promise<MusicStatus>
  musicNowPlaying(): Promise<MusicState>
  musicControl(action: MusicAction): Promise<void>
  musicSeek(ms: number): Promise<void>
  /** Plays a spotify: URI; a song can be played within a playlist or album (`context`). */
  /** Skips `count` songs on (playing a song further down Up next, keeping the playlist going). */
  musicSkip(count: number): Promise<void>
  musicPlay(uri: string, context?: string): Promise<void>
  /** Needs your account. */
  musicSearch(query: string): Promise<MusicSearchResults>
  musicPlaylists(): Promise<MusicItem[]>
  /** 0–100. */
  musicSetVolume(percent: number): Promise<void>
  /** Whether a song is in your Liked Songs (needs your account). */
  musicIsLiked(uri: string): Promise<boolean>
  musicSetLiked(uri: string, liked: boolean): Promise<void>
  /** Needs your account, like everything below. */
  musicQueue(): Promise<MusicQueue>
  musicAddToQueue(uri: string): Promise<void>
  musicRecent(): Promise<MusicItem[]>
  /** Where your account can play. */
  musicDevices(): Promise<MusicDevice[]>
  musicTransfer(deviceId: string): Promise<void>
  // The floating mini music player
  setMusicMini(open: boolean): Promise<boolean>
  isMusicMiniOpen(): Promise<boolean>
  /** It was showing when Notes last closed. */
  musicMiniWasOpen(): Promise<boolean>
  onMusicMiniOpen(callback: (open: boolean) => void): () => void
  /** Notes window → mini player. */
  pushMusicMini(state: MusicMiniState): void
  musicMiniLast(): Promise<MusicMiniState | null>
  onMusicMiniState(callback: (state: MusicMiniState) => void): () => void
  /** Mini player → notes window. */
  sendMusicMiniCommand(command: MusicMiniCommand): void
  onMusicMiniCommand(callback: (command: MusicMiniCommand) => void): () => void
  /** Your own music files; `fresh` looks through the folder again. */
  localMusicLibrary(fresh?: boolean): Promise<LocalLibrary>
  /** Asks which folder your music is in, then lists it. */
  localMusicChooseFolder(): Promise<LocalLibrary>
  // Your playlists (`uri` is spotify:playlist:…; songs only for playlists you can edit)
  musicPlaylistSongs(uri: string): Promise<MusicItem[]>
  /** Makes a private playlist. */
  musicCreatePlaylist(name: string): Promise<MusicItem>
  musicRenamePlaylist(uri: string, name: string): Promise<void>
  musicDeletePlaylist(uri: string): Promise<void>
  /** Puts a deleted playlist back in your library. */
  musicRestorePlaylist(uri: string): Promise<void>
  /** Adds to the end, or at `position` (counting from 0). */
  musicAddToPlaylist(uri: string, songs: string[], position?: number): Promise<void>
  musicRemoveFromPlaylist(uri: string, song: string): Promise<void>
  /** Positions count from 0. */
  musicMoveInPlaylist(uri: string, from: number, to: number): Promise<void>
  /** Opens the Spotify app, or (Mac) where you let Notes control it in System Settings. */
  musicOpen(what: 'app' | 'automation'): Promise<void>
  aiStatus(): Promise<AiStatus>
  /** Checks the key with Anthropic, then stores it encrypted. */
  aiSetKey(key: string): Promise<AiStatus>
  aiClearKey(): Promise<AiStatus>
  aiSummarise(title: string, text: string): Promise<string>
  /** A quick capture is tidied as one list item; a note can get headings and lists. */
  aiTidy(text: string, kind: 'note' | 'capture'): Promise<string>
  /** `extra`: digests of money, calendar and email for Ask everything (lib/askContext.ts). */
  aiAsk(question: string, notes: AiNote[], history: AiAskTurn[], extra?: AiExtraContext): Promise<string>
  /** Ctrl+K: the action a sentence asks for, as Claude reads it (checked by validSmart before anything runs). */
  aiInterpret(text: string, context: string): Promise<unknown>
  // Games
  /** The games installed on this computer, with time played; `rescan` looks for new ones first. */
  gamesList(rescan: boolean): Promise<GamesList>
  /** Starts a game; resolves to a message if it couldn't. */
  gamesPlay(id: string): Promise<string | null>
  /** The backdrop and title logo for a game's launch animation. */
  gamesLaunchArt(id: string): Promise<LaunchArt>
  gamesSetHidden(id: string, hidden: boolean): Promise<void>
  /** Asks for an app to add as a game; resolves to its id, or null if cancelled. */
  gamesAdd(): Promise<string | null>
  /** Takes a game you added off the list. */
  gamesRemove(id: string): Promise<void>
  gamesReveal(id: string): Promise<void>
  /** Whether a SteamGridDB key is saved, for animated covers. */
  gamesCoversStatus(): Promise<CoversStatus>
  /** Checks the key with SteamGridDB, then stores it encrypted. */
  gamesSetCoversKey(key: string): Promise<CoversStatus>
  gamesClearCoversKey(): Promise<CoversStatus>
  /** Animated covers for these games, by id; games without one are left out. */
  gamesCovers(ids: string[]): Promise<Record<string, string>>
  /** A game started or stopped, or more time was counted. */
  onGamesChanged(callback: () => void): () => void
  // Terminal tab
  /** Starts the command line in the notes folder (or carries on with the one already running). */
  terminalStart(cols: number, rows: number): Promise<TerminalStart>
  /** Ends the command line (and whatever is running in it). */
  terminalStop(): Promise<void>
  /** What you typed or pasted into the Terminal tab. */
  terminalInput(data: string): void
  terminalResize(cols: number, rows: number): void
  onTerminalData(callback: (data: string) => void): () => void
  /** The command line ended (you typed exit, or it closed). */
  onTerminalExit(callback: (code: number) => void): () => void
  /** The AI chat: Claude's reply to the conversation so far (the last message is yours). */
  aiChat(messages: AiChatMessage[]): Promise<string>
  /** Saved chats, kept in the settings folder on this computer. */
  aiLoadChats(): Promise<AiChat[]>
  aiSaveChats(chats: AiChat[]): Promise<void>
  /** The writing in a picture of a sketch (a PNG), read by the AI helper or offline on this computer. */
  readHandwriting(png: Uint8Array, reader: 'ai' | 'offline'): Promise<string>
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
  /** Creates an empty "Untitled board" (a .canvas file) in the folder; returns its path. */
  createBoard(folder: string): Promise<string>
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
  /** Asks once, then moves several items to the Bin; resolves with the ones moved. */
  trashMany(paths: string[]): Promise<string[]>
  /** Shows the item selected in File Explorer / Finder. */
  reveal(path: string): Promise<void>
  /** Sends a vault file, or a web link, to a phone on the same Wi-Fi: returns the address for its QR code. */
  phoneShareFile(path: string): Promise<PhoneShare>
  phoneShareLink(url: string): Promise<PhoneShare>
  /** Ends a share early (the QR code stops working). */
  phoneStop(token: string): Promise<void>
  /** The phone has the file (or opened the link). */
  onPhoneDelivered(callback: (token: string) => void): () => void
  /** Pairs a phone (or shows the code again); `fresh` makes a new code, so the old one stops working. */
  phonePair(fresh?: boolean): Promise<PhonePairing>
  phoneForget(): Promise<void>
  onPhoneEvent(callback: (event: PhoneEvent) => void): () => void
  /** The Deck buttons and Screen contents for the paired phone, and a heads-up to show on it. */
  phoneSetDeck(buttons: DeckButton[]): Promise<void>
  phoneSetScreen(screen: PhoneScreen): Promise<void>
  phoneNotify(title: string, body: string): Promise<void>
  /** The Wi-Fi this computer is on, for a guest QR code (blank where it can't be read). */
  phoneWifi(): Promise<WifiNetwork>
  /** One mouse, two computers (see main/mouseShare.ts). */
  shareStatus(): Promise<ShareStatus>
  shareSet(patch: Partial<Omit<ShareSaved, 'id' | 'peer'>>): Promise<ShareStatus>
  onShareStatus(callback: (status: ShareStatus) => void): () => void
  /** Starts pairing with a computer found on the network (by id) or typed in (host). */
  sharePair(target: { id?: string; host?: string }): Promise<void>
  shareConfirmPairing(): Promise<void>
  shareCancelPairing(): Promise<void>
  shareUnpair(): Promise<void>
  shareAskAccessibility(): Promise<boolean>
  shareSendFiles(paths: string[]): Promise<void>
  /** A file came over from the other computer (it's in Downloads). */
  onShareReceived(callback: (info: { title: string; path: string }) => void): () => void
  /** The other computer started pairing: open Settings to show the code. */
  onShareOpenSettings(callback: () => void): () => void
  /** The invisible window: what you do, and "come back". */
  shareInput(event: ShareInputEvent): void
  shareComeBack(): void
  onShareCapture(callback: (info: { name: string; os: ShareOs }) => void): () => void
  /** The drop strip: files dropped on it, or nothing to send. */
  shareDropped(paths: string[]): void
  shareDropCancel(): void
  onShareDrop(callback: (info: { name: string; side: ShareSide }) => void): () => void
  /** The phone webcam (Windows): turn it on/off, its status and settings, and a live preview of the phone's frames. */
  camStatus(): Promise<CamStatus>
  camOn(): Promise<CamStatus>
  camOff(): Promise<CamStatus>
  /** Checks again for OBS's camera (after installing it) and starts the camera. */
  camRetry(): Promise<CamStatus>
  camSet(patch: { quality?: 'sd' | 'hd'; fill?: boolean }): Promise<CamStatus>
  /** A new link (the old code and Home Screen page stop working). */
  camNewLink(): Promise<CamStatus>
  camPreview(on: boolean): Promise<void>
  onCamStatus(callback: (status: CamStatus) => void): () => void
  /** The phone's frames as JPEGs, a dozen or so a second, while the preview is on. */
  onCamFrame(callback: (jpeg: Uint8Array) => void): () => void
  /** Reads/writes a small app file kept in the vault's hidden ".notesapp" folder (synced with your notes). */
  readAppData(name: string): Promise<string | null>
  writeAppData(name: string, content: string): Promise<void>
  /** The file vault's encrypted files (in ".notesapp/safe"); null if there's no such file. */
  readSafeFile(id: string): Promise<Uint8Array | null>
  writeSafeFile(id: string, data: Uint8Array): Promise<void>
  removeSafeFile(id: string): Promise<void>
  /** Lets you pick files to lock away; returns their contents. */
  pickSafeFiles(): Promise<{ path: string; name: string; data: Uint8Array }[]>
  /** Sends picked originals to the Bin once they're safely locked away. */
  trashSafeOriginals(paths: string[]): Promise<void>
  /** Saves an unlocked copy where you choose. Resolves false if cancelled. */
  saveSafeCopy(name: string, data: Uint8Array): Promise<boolean>
  /** Saves pasted/dropped file data into a vault folder; returns the new file's path. */
  /** Saves an edited spreadsheet (.xlsx, .xlsm, .csv or .tsv) over the file. */
  writeSheet(path: string, data: Uint8Array): Promise<void>
  saveAttachment(folder: string, name: string, data: Uint8Array): Promise<string>
  /** Saves an edited sketch over its existing .svg. */
  writeSketch(path: string, svg: string): Promise<void>
  /** Lets you pick files on disk and copies them into a vault folder; returns their paths. */
  pickAttachment(folder: string, imagesOnly: boolean): Promise<string[]>
  /** Links a file from anywhere on the computer: copied into `folder` unless it's already in the notes folder. Returns its vault path. */
  attachFromComputer(folder: string, source: string): Promise<string>

  // File explorer tab (full paths on this computer)
  explorerPlaces(): Promise<ExplorerPlace[]>
  explorerList(dir: string): Promise<ExplorerEntry[]>
  /** The start of a text file, for its preview. */
  explorerReadText(path: string): Promise<string>
  /** Opens a file in its usual app (programs are shown in File Explorer / Finder instead). */
  explorerOpen(path: string): Promise<void>
  explorerReveal(path: string): Promise<void>
  /** A new empty folder or file, renamed " (2)" if the name's taken. Returns its path. */
  explorerCreate(dir: string, name: string, kind: 'folder' | 'file'): Promise<string>
  /** Returns the new path. */
  explorerRename(path: string, name: string): Promise<string>
  /** Copies or moves items into a folder, never over anything. Returns where each one went. */
  explorerPaste(paths: string[], dir: string, mode: PasteMode): Promise<{ from: string; to: string }[]>
  /** Moves items to the Recycle Bin / Bin (no question asked here). Returns the ones moved. */
  explorerTrash(paths: string[]): Promise<string[]>
  /** Finds names under a folder and all its subfolders. */
  explorerSearch(dir: string, query: string, showHidden: boolean): Promise<ExplorerEntry[]>
  // Comic book reader
  comicsShelf(): Promise<ComicShelf>
  /** Adds comic files (asks which, when no paths are given). */
  comicsAdd(paths?: string[]): Promise<{ shelf: ComicShelf; added: string[]; skipped: number }>
  /** Asks for a folder and adds every comic in it. */
  comicsAddFolder(): Promise<{ shelf: ComicShelf; added: string[]; skipped: number }>
  /** Takes a comic off the shelf (the file stays where it is). */
  comicsRemove(id: string): Promise<ComicShelf>
  /** Gets a comic ready to read (the first time, a RAR is unpacked: see onComicsPreparing). */
  comicsOpen(id: string): Promise<ComicOpened>
  comicsProgress(id: string, page: number, offset: number, finished?: boolean): Promise<void>
  comicsResetProgress(id: string): Promise<ComicShelf>
  /** Counts pages turned today; returns today's total. */
  comicsTurned(pages: number): Promise<number>
  comicsSettings(id: string, patch: Partial<ComicSettings>): Promise<ComicSettings>
  comicsRename(id: string, title: string): Promise<ComicShelf>
  comicsReveal(id: string): Promise<void>
  /** Reads the text in a picture of part of a page (offline). */
  comicsReadText(png: Uint8Array): Promise<string>
  onComicsChanged(callback: () => void): () => void
  onComicsPreparing(callback: (p: ComicPreparing) => void): () => void
  /** Copies files/folders from the computer into a notes folder ('' is the top); ones already in the notes folder are moved. Returns their notes-folder paths. */
  explorerToVault(paths: string[], folder: string): Promise<string[]>
  /** Starts dragging files out as real files (into Discord, a browser, File Explorer / Finder, or back into Orbit). Call it from dragstart, after preventDefault. */
  explorerStartDrag(paths: string[]): void
  /** Opens a vault file (like a PDF) in its usual app. */
  openFile(path: string): Promise<void>
  /** Reads a note's markdown. */
  readNote(path: string): Promise<string>
  /** Saves a note (or a .canvas board) atomically. */
  writeNote(path: string, content: string): Promise<void>

  /** Called with the changed paths whenever files in the vault change on disk. Returns an unsubscribe function. */
  onVaultChanged(callback: (paths: string[]) => void): () => void
  /** Called when the window is about to close; call `readyToClose()` once unsaved work is saved. */
  onBeforeClose(callback: () => void): () => void
  readyToClose(): Promise<void>
}

/** An item in a native menu described by the UI. */
/** The word under a right-click in a note; `editable` if a synonym may replace it. */
export interface MenuWord {
  word: string
  editable: boolean
}

export type PopupMenuItem = 'separator' | { id?: string; label: string; accelerator?: string; submenu?: PopupMenuItem[] }
/** What quick capture sends to be saved. */
/** Ask everything: other things the AI can look at, as plain text. */
export interface AiExtraContext {
  money?: string
  calendar?: string
  email?: string
}

export interface CaptureRequest {
  text: string
  /** Where it goes; by default your capture setting (today's note or the inbox). */
  target?: { kind: 'daily' | 'inbox' } | { kind: 'note' | 'folder'; path: string }
  /** Instead: a calendar event on that day (in its daily note's schedule). */
  event?: { date: string; time?: string; title: string; remind: boolean }
  /** Instead: a command for the main window to run ("spent 12 on food", "? what's on today"). */
  command?: string
}
/** A note as read from Apple Notes. */
export interface AppleNote {
  account: string
  folder: string
  title: string
  html: string
  created: string
  modified: string
  locked: boolean
}
/** How starting the Terminal tab's command line went. */
export type TerminalStart = { ok: true; name: string; resumed: boolean } | { ok: false; error: string }

/** A Google Sheet (.gsheet file) fetched for the spreadsheet viewer, or why it couldn't be. */
export type GoogleSheetResult =
  | { sheets: Sheet[]; webUrl: string }
  | {
      error: string
      webUrl?: string
      /** What would fix it: set Google up in Settings, sign in (again), switch the Sheets API on, or just try later. */
      fix?: 'setup' | 'connect' | 'enable-api' | 'retry'
    }
/** The kinds of file Notes can save (exports and converted files). */
export type SaveFormat = 'pdf' | 'docx' | 'html' | 'md' | 'txt' | 'jpg' | 'png' | 'webp' | 'mp3' | 'wav' | 'mp4' | 'mov' | 'webm' | 'gif'

/** A converted video waiting in a temporary file (videos are too big to pass around in memory). */
export interface ConvertedFile {
  converted: string
  size: number
}

/** What an exported file holds: its bytes, its text, or a converted video waiting to be saved. */
export type ExportData = Uint8Array | string | ConvertedFile

/** Whether ffmpeg (downloaded only when asked, for converting videos and streaming) is on this computer. */
export interface FfmpegState {
  state: 'ready' | 'missing' | 'downloading' | 'unsupported'
  progress?: number
  error?: string
}

/** A caption bar above or below a GIF, drawn in the window (any font on this computer) and sent as a picture. */
export interface GifCaption {
  text: string
  font: string
  /** Text size as a share of the GIF's width (0.08 = 8%), so it looks the same at any size. */
  size: number
  bold: boolean
  textColor: string
  barColor: string
  position: 'top' | 'bottom'
}

/** The GIF maker's choices. Times are in seconds of the original video; the crop is in its pixels. */
export interface GifSettings {
  start: number
  end: number
  crop: { x: number; y: number; w: number; h: number } | null
  /** 0.5 is half speed, 2 is double. */
  speed: number
  fps: number
  /** The GIF's width in pixels (captions included). */
  width: number
  caption: GifCaption | null
}

export interface VideoConvertRequest {
  /** Picks out this job in progress updates and when cancelling. */
  id: number
  /** The original video on this computer. */
  path: string
  format: SaveFormat
  /** Shrinks the picture to at most this many pixels tall; null keeps its size. */
  maxHeight: number | null
  /** GIFs made in the GIF maker: the clip, crop, speed and caption. */
  gif?: GifSettings
  /** The caption bar as a PNG, exactly `gif.width` pixels wide. */
  captionPng?: Uint8Array
  captionHeight?: number
}
