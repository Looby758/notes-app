import { THEMES } from './themes'
import { IS_MAC } from './platform'

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

  // Streamer mode
  /** Blur private things (your town, email, money, passwords, messages, events) until you click them, for sharing your screen. */
  streamerMode: boolean
  /** In streamer mode, a note you open stays hidden until you click Show. */
  streamerHideNotes: boolean
  /** In streamer mode, note names (file list, tabs, recent notes) are blurred too. */
  streamerHideNames: boolean

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
  vimMode: boolean
  cursorBlink: boolean
  showWordCount: boolean
  /** Opening a note adds a tab instead of changing the current one. */
  openInNewTab: boolean
  /** Web links in notes open in a web tab beside the note, instead of your usual browser. */
  openLinksInApp: boolean
  /** Notes starts on the Home page (today, reminders, recent notes). */
  homeOnStart: boolean
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
  /** Closing the window keeps Notes running in the tray (so quick capture still works). */
  closeToTray: boolean
  launchAtStartup: boolean

  /** Look for a newer version on GitHub now and then. */
  checkForUpdates: boolean

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

  streamerMode: false,
  streamerHideNotes: true,
  streamerHideNames: true,

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
  vimMode: false,
  cursorBlink: true,
  showWordCount: true,
  openInNewTab: false,
  openLinksInApp: true,
  homeOnStart: true,
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
  closeToTray: true,
  launchAtStartup: false,

  checkForUpdates: true,

  shortcuts: {}
}

/** Allowed ranges, shared by the settings page sliders and `normalizePrefs`. */
export const RANGES = {
  editorFontSize: { min: 12, max: 28, step: 1 },
  lineHeight: { min: 1.2, max: 2.2, step: 0.02 },
  zoom: { min: 0.8, max: 1.5, step: 0.05 },
  autosaveDelay: { min: 300, max: 5000, step: 100 },
  tabSize: { min: 2, max: 8, step: 1 },
  weekStart: { min: 0, max: 1, step: 1 },
  focusMinutes: { min: 1, max: 180, step: 1 },
  breakMinutes: { min: 1, max: 60, step: 1 },
  longBreakMinutes: { min: 1, max: 90, step: 1 },
  focusRounds: { min: 1, max: 12, step: 1 },
  autoLockMinutes: { min: 0, max: 120, step: 5 }
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
    : ['Super+Shift+N', 'Control+Alt+Space', 'Control+Shift+Space', 'Alt+Shift+N', '']
} as const

/** Shortcuts offered for quick capture (system-wide, so they're picked from a safe list). */
export const CAPTURE_SHORTCUTS = CHOICES.captureShortcut

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
  const out: Prefs = { ...DEFAULT_PREFS, shortcuts: {} }

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
  if (typeof input.theme === 'string' && THEMES.some((t) => t.id === input.theme)) out.theme = input.theme
  if (typeof input.lightTheme === 'string' && THEMES.some((t) => t.id === input.lightTheme && t.light)) out.lightTheme = input.lightTheme
  if (typeof input.darkTheme === 'string' && THEMES.some((t) => t.id === input.darkTheme && !t.light)) out.darkTheme = input.darkTheme
  if (input.accent === '' || isHex(input.accent)) out.accent = (input.accent as string).toLowerCase()
  out.uiFont = cleanFont(input.uiFont)
  out.editorFont = cleanFont(input.editorFont)
  out.codeFont = cleanFont(input.codeFont)
  if (typeof input.spellcheckLanguage === 'string' && /^([a-z]{2,3}(-[A-Za-z0-9]{2,8})*)?$/.test(input.spellcheckLanguage)) {
    out.spellcheckLanguage = input.spellcheckLanguage
  }
  out.tabSize = Math.round(out.tabSize)
  for (const k of ['focusMinutes', 'breakMinutes', 'longBreakMinutes', 'focusRounds', 'autoLockMinutes'] as const) out[k] = Math.round(out[k])
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

  if (input.shortcuts && typeof input.shortcuts === 'object') {
    for (const [id, value] of Object.entries(input.shortcuts as Record<string, unknown>)) {
      if (value === null || (typeof value === 'string' && value.length > 0 && value.length < 40)) out.shortcuts[id] = value
    }
  }
  return out
}
