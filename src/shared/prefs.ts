import { allThemes } from './themes'
import { IS_MAC } from './platform'
import { cleanClocks, type WorldClock } from './worldClock'
import { cleanCountdowns, type Countdown } from './countdown'

/**
 * Everything you can customise in Settings. Stored in settings.json under "prefs", which you can
 * also edit by hand: `normalizePrefs` repairs anything invalid instead of breaking the app.
 */
export interface Prefs {
  // Appearance
  theme: string
  /** Switch between a light and a dark theme with the system's light/dark mode. */
  followSystem: boolean
  lightTheme: string
  darkTheme: string
  /** Hex colour, or '' to use the theme's own accent. */
  accent: string
  /** Font family names; '' means the built-in default. */
  uiFont: string
  editorFont: string
  codeFont: string
  editorFontSize: number
  lineHeight: number
  noteWidth: 'narrow' | 'medium' | 'wide' | 'full'
  density: 'compact' | 'comfortable'
  zoom: number
  showStatusBar: boolean
  /** How much the app animates. The system's reduce-motion setting turns Full down to Subtle (see lib/motion.ts). */
  motion: 'full' | 'subtle' | 'off'
  /** Pressing Play on the Games page shows a short title card with the game's art while it starts. */
  gameLaunchAnimation: boolean
  /** Animated game covers (from SteamGridDB): moving all the time, only under the pointer, or never. */
  gameAnimatedCovers: 'always' | 'hover' | 'off'
  /** Which app icon design to use (taskbar / Dock / window). */
  appIcon: string
  /** A pop-up with the song's name and picture when the music player moves on to a new song. */
  musicSongPopup: boolean
  /** Moving bars in the music player while your own music files play. */
  musicVisualiser: boolean
  /** Soft clicks and whooshes as you use the app (lib/sounds.ts). */
  interfaceSounds: boolean
  /** How loud they are, 0 to 1. */
  interfaceSoundsVolume: number
  /** After a while without using Notes, show the time, weather and what's playing on a moving screen. */
  screensaver: boolean
  /** Minutes without using Notes before the screensaver starts. */
  screensaverMinutes: number
  /** A little animated pet in the bottom corner that cheers when you finish things and naps when you're away. */
  pet: boolean

  /**
   * Google's sign-in pages (in web tabs, Messages and Grok) are told the browser is Firefox. Off (the
   * default) they see plain Chromium, which Google accepts; telling them Firefox sends "Sign in with
   * Google" back to "Choose an account" each time. On is a fallback in case Google ever refuses the
   * app with "This browser or app may not be secure".
   */
  googleSignInAsFirefox: boolean

  // Streamer mode
  /** Blur private things (your town, email, money, passwords, messages, events) until you click them, for sharing your screen. */
  streamerMode: boolean
  /** In streamer mode, a note you open stays hidden until you click Show. */
  streamerHideNotes: boolean
  /** In streamer mode, note names (file list, tabs, recent notes) are blurred too. */
  streamerHideNames: boolean

  /** Use an imported theme's own app icon while that theme is on. */
  themeAppIcon: boolean

  // Editor
  livePreview: boolean
  spellcheck: boolean
  /** e.g. 'en-GB'; '' means the Windows default. */
  spellcheckLanguage: string
  autosaveDelay: number
  tabSize: number
  indentWithTabs: boolean
  lineNumbers: boolean
  highlightActiveLine: boolean
  autoPair: boolean
  /** Typing * = ~ or ` with text selected wraps it (bold, highlight…) instead of replacing it. */
  wrapSelection: boolean
  /** A small formatting toolbar above selected text. */
  selectionToolbar: boolean
  /** Pasting a web address fetches its title; pasting a table (Excel, a web page) makes a markdown table. */
  smartPaste: boolean
  /** Writing autocomplete: the offline AI shows the next few words in grey as you type; Tab takes them. */
  aiAutocomplete: boolean
  vimMode: boolean
  cursorBlink: boolean
  showWordCount: boolean
  /** Opening a note adds a tab instead of changing the current one. */
  openInNewTab: boolean
  /** Web links in notes open in a web tab beside the note, instead of your usual browser. */
  openLinksInApp: boolean
  /** Notes starts on the Home page (today, reminders, recent notes). */
  homeOnStart: boolean
  /** The Home page's boxes in the order you dragged them into (ids; boxes not listed keep their usual place). */
  homeOrder: string[]
  /** Home page boxes you've hidden. */
  homeHidden: string[]
  /** The places on the World clocks page (and its Home box), in your order. */
  worldClocks: WorldClock[]
  /** The countdowns on the Countdowns page (and its Home box). */
  countdowns: Countdown[]
  /** Every note opens read-only (links open with a plain click) until you switch back to writing. */
  readingMode: boolean
  /** The file list shows pictures, recordings and other files, not just notes. */
  showAttachments: boolean
  /** "Random note" may pick daily notes too. */
  randomIncludeDaily: boolean
  /** Typewriter mode: keep the line you're writing on in the middle of the screen. */
  typewriterCenter: boolean
  /** Typewriter mode: fade everything but the current paragraph or line. */
  typewriterDim: boolean
  typewriterDimUnit: 'paragraph' | 'line'
  /** How the graph tab draws your notes. */
  graphStyle: 'neighbourhood' | 'constellation'
  /** What reads handwriting in a sketch: the AI helper when a key is saved (else offline), or always one of them. */
  handwritingReader: 'auto' | 'ai' | 'offline'

  // Focus timer (zen mode)
  focusMinutes: number
  /** Breaks between focus rounds; 0 rounds of breaks = one focus session. */
  breakMinutes: number
  longBreakMinutes: number
  /** How many focus rounds in a session (a long break after the last one, if more than one). */
  focusRounds: number
  timerChime: boolean
  /** The countdown stays faintly visible while you write. */
  timerAlwaysVisible: boolean
  /** Leave zen mode when the whole session is done. */
  timerLeaveZen: boolean
  /** Locked notes lock again after this many minutes without using the app (0: only when you say). */
  autoLockMinutes: number

  // Files (vault-relative folder paths)
  /** Where pasted and dropped images and files are saved. */
  attachmentFolder: string
  /** Notes in this folder can be used as templates. */
  templatesFolder: string
  /** Notes in the templates folder don't show up under tags (or in #tag searches). */
  hideTemplatesFromTags: boolean

  // Calendar
  dailyFolder: string
  /** File name pattern for daily notes (lib/dates.ts tokens); may include "/" for subfolders. */
  dailyFormat: string
  /** Template note for new daily notes ('' for none), e.g. "Templates/Daily.md". */
  dailyTemplate: string
  /** Clicking a day in the calendar creates its daily note if it doesn't exist. */
  /** A daily template without a heading of its own still gets the date heading on top. */
  dailyKeepHeading: boolean
  createDailyOnClick: boolean
  /** 0 = Sunday, 1 = Monday. */
  weekStart: number
  timeFormat: '24h' | '12h'
  /** Heading in daily notes whose list items are events. */
  scheduleHeading: string
  /** Today's weather and the week ahead on the Home page. */
  weatherHome: boolean
  /** The forecast beside outdoor events (walks, football, BBQs…) and on each day of the calendar. */
  weatherCalendar: boolean

  // Quick capture and the tray
  /** System-wide shortcut (an Electron accelerator) that opens quick capture; '' for none. */
  captureShortcut: string
  /** Where captures go: under a heading in today's daily note, or at the end of an inbox note. */
  captureTarget: 'daily' | 'inbox'
  captureHeading: string
  /** Inbox note path, e.g. "Inbox". */
  captureInbox: string
  /** Start each capture with the time ("- 14:05 …"). */
  /** Quick capture keeps the last place you chose instead of going back to the usual one. */
  captureRememberTarget: boolean
  captureTimestamp: boolean
  /** System-wide shortcut for a screen snip (grab text from anywhere on screen); '' for none. */
  snipShortcut: string
  /** System-wide shortcut for "What's this song?" (listen to what's playing and find it); '' for none. */
  songIdShortcut: string
  /** Instant replay: keep the last few seconds of the screen ready to save (lib/replay.ts). */
  replayOn: boolean
  /** System-wide shortcut that saves the replay; '' for none. */
  replayShortcut: string
  /** How many seconds a saved replay holds. */
  replaySeconds: number
  /** Studio quality id (shared/studio QUALITIES). */
  replayQuality: string
  /** Record what you hear (Windows) and your microphone in replays. */
  replaySound: boolean
  replayMic: boolean
  /** Joining a Discord voice call shows a small note in the corner offering the voice pop-out (it goes away by itself). */
  discordPopoutPrompt: boolean
  /** Closing the window keeps Notes running in the tray (so quick capture still works). */
  closeToTray: boolean
  launchAtStartup: boolean

  /** Look for a newer version on GitHub now and then. */
  checkForUpdates: boolean
  /** Keep settings, themes, Home, the soundboard and calendar links in the notes folder, so your other computers get them too. */
  syncOrbit: boolean

  // Finding features
  /** Feature ids (lib/features.tsx) shown as buttons in the top bar, in order. */
  topbarFeatures: string[]
  /** The dock down the left edge, with its own list of features. */
  showDock: boolean
  dockFeatures: string[]
  /** Holding the middle mouse button opens a ring of these features under the pointer. */
  radialMiddleClick: boolean
  radialFeatures: string[]
  /** Buttons on the phone's Deck tab: feature ids, and a few phone-only actions (lib/phoneDeck.ts). */
  phoneDeck: string[]
  /** Ctrl+K: if no built-in pattern understands a sentence, offer to ask the AI (never sent without asking). */
  smartCommandsAi: boolean

  /** Shortcut overrides by command id: a shortcut like "Ctrl+Shift+K", or null for none. */
  shortcuts: Record<string, string | null>
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'midnight',
  followSystem: false,
  lightTheme: 'daylight',
  darkTheme: 'midnight',
  accent: '',
  uiFont: '',
  editorFont: '',
  codeFont: '',
  editorFontSize: 16,
  lineHeight: 1.72,
  noteWidth: 'medium',
  density: 'comfortable',
  zoom: 1,
  showStatusBar: true,
  motion: 'full',
  gameLaunchAnimation: true,
  gameAnimatedCovers: 'always',
  appIcon: 'default',
  musicSongPopup: true,
  musicVisualiser: true,
  interfaceSounds: true,
  interfaceSoundsVolume: 0.5,
  screensaver: true,
  screensaverMinutes: 5,
  pet: true,
  googleSignInAsFirefox: false,

  streamerMode: false,
  streamerHideNotes: true,
  streamerHideNames: true,
  themeAppIcon: true,

  livePreview: true,
  spellcheck: true,
  spellcheckLanguage: '',
  autosaveDelay: 500,
  tabSize: 2,
  indentWithTabs: false,
  lineNumbers: false,
  highlightActiveLine: false,
  autoPair: false,
  wrapSelection: true,
  selectionToolbar: true,
  smartPaste: true,
  aiAutocomplete: true,
  vimMode: false,
  cursorBlink: true,
  showWordCount: true,
  openInNewTab: false,
  openLinksInApp: true,
  homeOnStart: true,
  homeOrder: [],
  homeHidden: [],
  worldClocks: [],
  countdowns: [],
  readingMode: false,
  randomIncludeDaily: false,
  showAttachments: true,
  typewriterCenter: false,
  typewriterDim: false,
  typewriterDimUnit: 'paragraph',
  graphStyle: 'neighbourhood',
  handwritingReader: 'auto',

  focusMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  focusRounds: 1,
  timerChime: true,
  timerAlwaysVisible: true,
  timerLeaveZen: false,
  autoLockMinutes: 10,

  attachmentFolder: 'attachments',
  templatesFolder: 'Templates',
  hideTemplatesFromTags: true,

  dailyFolder: 'Daily',
  dailyFormat: 'YYYY-MM-DD',
  dailyTemplate: '',
  createDailyOnClick: true,
  dailyKeepHeading: true,
  weekStart: 1,
  timeFormat: '24h',
  scheduleHeading: 'Schedule',
  weatherHome: true,
  weatherCalendar: true,

  // ⌘⇧N is taken by Finder and browsers on a Mac, so it gets ⌃⌥Space instead.
  captureShortcut: IS_MAC ? 'Control+Alt+Space' : 'Super+Shift+N',
  captureTarget: 'daily',
  captureHeading: 'Captured',
  captureInbox: 'Inbox',
  captureTimestamp: true,
  captureRememberTarget: false,
  snipShortcut: IS_MAC ? 'Control+Alt+S' : 'Alt+Shift+S',
  songIdShortcut: IS_MAC ? 'Control+Alt+W' : 'Alt+Shift+W',
  replayOn: false,
  replayShortcut: IS_MAC ? 'Control+Alt+R' : 'Alt+Shift+R',
  replaySeconds: 30,
  replayQuality: '1080p60',
  replaySound: true,
  replayMic: false,
  discordPopoutPrompt: true,
  closeToTray: true,
  launchAtStartup: false,

  checkForUpdates: true,
  syncOrbit: true,

  topbarFeatures: ['home', 'today', 'calendar', 'email', 'messages', 'money', 'music', 'phone'],
  showDock: true,
  dockFeatures: ['home', 'today', 'calendar', 'email', 'messages', 'money', 'chat', 'ask', 'explorer', 'convert', 'music', 'games'],
  radialMiddleClick: true,
  radialFeatures: ['today', 'new-note', 'calendar', 'money', 'music', 'email', 'snip', 'ask'],
  smartCommandsAi: true,
  phoneDeck: ['play-pause', 'next-song', 'previous-song', 'today', 'new-note', 'snip', 'streamer', 'lock-all', 'zen', 'money', 'calendar', 'messages'],

  shortcuts: {}
}

/** Allowed ranges, shared by the settings page sliders and `normalizePrefs`. */
export const RANGES = {
  editorFontSize: { min: 12, max: 28, step: 1 },
  lineHeight: { min: 1.2, max: 2.2, step: 0.02 },
  zoom: { min: 0.8, max: 1.5, step: 0.05 },
  interfaceSoundsVolume: { min: 0, max: 1, step: 0.05 },
  autosaveDelay: { min: 300, max: 5000, step: 100 },
  tabSize: { min: 2, max: 8, step: 1 },
  weekStart: { min: 0, max: 1, step: 1 },
  focusMinutes: { min: 1, max: 180, step: 1 },
  breakMinutes: { min: 1, max: 60, step: 1 },
  longBreakMinutes: { min: 1, max: 90, step: 1 },
  focusRounds: { min: 1, max: 12, step: 1 },
  autoLockMinutes: { min: 0, max: 120, step: 5 },
  screensaverMinutes: { min: 1, max: 60, step: 1 },
  replaySeconds: { min: 10, max: 120, step: 5 }
} as const

const CHOICES = {
  noteWidth: ['narrow', 'medium', 'wide', 'full'],
  density: ['compact', 'comfortable'],
  motion: ['full', 'subtle', 'off'],
  gameAnimatedCovers: ['always', 'hover', 'off'],
  timeFormat: ['24h', '12h'],
  captureTarget: ['daily', 'inbox'],
  typewriterDimUnit: ['paragraph', 'line'],
  graphStyle: ['neighbourhood', 'constellation'],
  handwritingReader: ['auto', 'ai', 'offline'],
  appIcon: ['default', 'green', 'forest', 'ocean', 'sunset', 'light', 'midnight'],
  captureShortcut: IS_MAC
    ? ['Control+Alt+Space', 'Alt+Space', 'Control+Shift+Space', 'Super+Alt+N', '']
    : ['Super+Shift+N', 'Control+Alt+Space', 'Control+Shift+Space', 'Alt+Shift+N', ''],
  snipShortcut: IS_MAC ? ['Control+Alt+S', 'Control+Shift+S', 'Alt+Shift+S', ''] : ['Alt+Shift+S', 'Control+Alt+S', 'Super+Shift+T', ''],
  songIdShortcut: IS_MAC ? ['Control+Alt+W', 'Control+Shift+W', 'Alt+Shift+W', ''] : ['Alt+Shift+W', 'Control+Alt+W', 'Super+Shift+W', ''],
  // F-keys too: they work in games, where Alt or Ctrl combinations may do something else.
  replayShortcut: IS_MAC ? ['Control+Alt+R', 'Control+Shift+R', 'F9', 'F10', ''] : ['Alt+Shift+R', 'Control+Shift+R', 'Alt+F9', 'F9', 'F10', ''],
  replayQuality: ['720p30', '1080p30', '1080p60']
} as const

/** Shortcuts offered for saving an instant replay (system-wide). */
export const REPLAY_SHORTCUTS = CHOICES.replayShortcut

/** Shortcuts offered for screen snip (system-wide). */
export const SNIP_SHORTCUTS = CHOICES.snipShortcut

/** Shortcuts offered for "What's this song?" (system-wide). */
export const SONG_ID_SHORTCUTS = CHOICES.songIdShortcut

/** Shortcuts offered for quick capture (system-wide, so they're picked from a safe list). */
export const CAPTURE_SHORTCUTS = CHOICES.captureShortcut

/** A list of Home box ids: short, simple and each only once. */
const cleanIds = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((id): id is string => typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id)))].slice(0, 50) : []

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
/** Font names are used inside CSS, so keep them to characters a font name can contain. */
const cleanFont = (v: unknown): string =>
  typeof v === 'string' ? v.replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 80) : ''

/**
 * A folder inside the vault, written with "/" ("" is the vault itself). Anything that could
 * point outside the vault or isn't a valid Windows name falls back to `fallback`.
 */
export function cleanFolder(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback
  const parts = v.replace(/\\/g, '/').split('/').map((p) => p.trim()).filter(Boolean)
  const valid = parts.every((p) => p !== '.' && p !== '..' && !/[:*?"<>|]/.test(p) && !/[. ]$/.test(p))
  return valid ? parts.join('/').slice(0, 200) : fallback
}

/** Turns anything (a hand-edited file, an old version) into valid preferences. */
export function normalizePrefs(raw: unknown): Prefs {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: Prefs = { ...DEFAULT_PREFS, homeOrder: [], homeHidden: [], worldClocks: [], countdowns: [], shortcuts: {} }

  for (const key of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) {
    const value = input[key]
    const fallback = DEFAULT_PREFS[key]
    if (value === undefined) continue
    if (key in RANGES) {
      const { min, max } = RANGES[key as keyof typeof RANGES]
      if (typeof value === 'number' && Number.isFinite(value)) {
        ;(out as unknown as Record<string, unknown>)[key] = Math.min(max, Math.max(min, value))
      }
    } else if (key in CHOICES) {
      if ((CHOICES[key as keyof typeof CHOICES] as readonly string[]).includes(value as string)) {
        ;(out as unknown as Record<string, unknown>)[key] = value
      }
    } else if (typeof fallback === 'boolean') {
      if (typeof value === 'boolean') (out as unknown as Record<string, unknown>)[key] = value
    }
  }

  // Before Motion had three levels it was a "Reduce motion" switch.
  if (input.motion === undefined && input.reduceMotion === true) out.motion = 'off'
  const themes = allThemes()
  if (typeof input.theme === 'string' && themes.some((t) => t.id === input.theme)) out.theme = input.theme
  if (typeof input.lightTheme === 'string' && themes.some((t) => t.id === input.lightTheme && t.light)) out.lightTheme = input.lightTheme
  if (typeof input.darkTheme === 'string' && themes.some((t) => t.id === input.darkTheme && !t.light)) out.darkTheme = input.darkTheme
  if (input.accent === '' || isHex(input.accent)) out.accent = (input.accent as string).toLowerCase()
  out.uiFont = cleanFont(input.uiFont)
  out.editorFont = cleanFont(input.editorFont)
  out.codeFont = cleanFont(input.codeFont)
  if (typeof input.spellcheckLanguage === 'string' && /^([a-z]{2,3}(-[A-Za-z0-9]{2,8})*)?$/.test(input.spellcheckLanguage)) {
    out.spellcheckLanguage = input.spellcheckLanguage
  }
  out.tabSize = Math.round(out.tabSize)
  for (const k of ['focusMinutes', 'breakMinutes', 'longBreakMinutes', 'focusRounds', 'autoLockMinutes', 'replaySeconds'] as const) out[k] = Math.round(out[k])
  out.attachmentFolder = cleanFolder(input.attachmentFolder ?? DEFAULT_PREFS.attachmentFolder, DEFAULT_PREFS.attachmentFolder)
  out.templatesFolder = cleanFolder(input.templatesFolder ?? DEFAULT_PREFS.templatesFolder, DEFAULT_PREFS.templatesFolder)
  out.dailyFolder = cleanFolder(input.dailyFolder ?? DEFAULT_PREFS.dailyFolder, DEFAULT_PREFS.dailyFolder)
  out.dailyTemplate = cleanFolder(input.dailyTemplate ?? '', '')
  out.weekStart = Math.round(out.weekStart)
  // The format becomes a file path: it must contain a day and nothing Windows can't use in a name.
  if (
    typeof input.dailyFormat === 'string' &&
    /D/.test(input.dailyFormat) &&
    !/[\\:*?"<>|]/.test(input.dailyFormat.replace(/\[[^\]]*\]/g, '')) &&
    input.dailyFormat.length <= 60
  ) {
    out.dailyFormat = input.dailyFormat.trim()
  }
  if (typeof input.scheduleHeading === 'string' && input.scheduleHeading.trim() && input.scheduleHeading.length <= 60) {
    out.scheduleHeading = input.scheduleHeading.trim()
  }
  if (typeof input.captureHeading === 'string' && input.captureHeading.length <= 60) out.captureHeading = input.captureHeading.trim()
  out.captureInbox = cleanFolder(input.captureInbox ?? DEFAULT_PREFS.captureInbox, DEFAULT_PREFS.captureInbox) || DEFAULT_PREFS.captureInbox
  out.homeOrder = cleanIds(input.homeOrder)
  out.homeHidden = cleanIds(input.homeHidden)
  out.worldClocks = cleanClocks(input.worldClocks)
  out.countdowns = cleanCountdowns(input.countdowns)
  for (const k of ['topbarFeatures', 'dockFeatures', 'radialFeatures', 'phoneDeck'] as const) {
    out[k] = input[k] === undefined ? [...DEFAULT_PREFS[k]] : cleanIds(input[k])
  }

  if (input.shortcuts && typeof input.shortcuts === 'object') {
    for (const [id, value] of Object.entries(input.shortcuts as Record<string, unknown>)) {
      if (value === null || (typeof value === 'string' && value.length > 0 && value.length < 40)) out.shortcuts[id] = value
    }
  }
  return out
}
