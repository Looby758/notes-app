import type { Prefs } from '@shared/prefs'
import { CAPTURE_SHORTCUTS, RANGES } from '@shared/prefs'
import { acceleratorLabel, IS_MAC, showKeys, TRAY_NAME } from '@shared/platform'
import { formatDate } from './dates'

/**
 * Every setting on the Settings page, described once. The page draws itself from this list,
 * and search looks through labels, descriptions and keywords.
 */

export type SectionId = 'appearance' | 'editor' | 'files' | 'calendar' | 'capture' | 'ai' | 'music' | 'shortcuts' | 'about'

interface Base {
  key: keyof Prefs
  section: SectionId
  group: string
  label: string
  description?: string
  keywords?: string
}

export type SettingDef = Base &
  (
    | { type: 'toggle' }
    | { type: 'choice'; options: { value: string; label: string }[] }
    | { type: 'slider'; min: number; max: number; step: number; format: (v: number) => string }
    | { type: 'theme' }
    | { type: 'appIcon' }
    | { type: 'color' }
    | { type: 'font'; sample: string }
    | { type: 'language' }
    | { type: 'folder'; placeholder: string; prefix?: string }
    | { type: 'text'; placeholder: string; preview?: (value: string) => string }
  )

const px = (v: number): string => `${v}px`
const pct = (v: number): string => `${Math.round(v * 100)}%`

export const SETTINGS: SettingDef[] = [
  // ---------- Appearance ----------
  {
    key: 'followSystem',
    section: 'appearance',
    group: 'Theme',
    type: 'toggle',
    label: IS_MAC ? 'Match the Mac’s light or dark appearance' : 'Match Windows’ light or dark mode',
    description: 'Pick one dark and one light theme below; Notes switches between them when your system does.',
    keywords: 'light dark mode system auto automatic appearance night day'
  },
  { key: 'theme', section: 'appearance', group: 'Theme', type: 'theme', label: 'Theme', keywords: 'colour color dark light white paper sepia black nord blue' },
  {
    key: 'appIcon',
    section: 'appearance',
    group: 'App icon',
    type: 'appIcon',
    label: 'App icon',
    description: IS_MAC
      ? 'Shown in the Dock while Notes runs.'
      : 'Shown on the window, the taskbar (also when pinned), the Start menu and the desktop shortcut. Windows can take a moment to catch up; if a pinned icon doesn’t change, unpin and pin Notes again.',
    keywords: 'icon logo dock taskbar green'
  },
  {
    key: 'accent',
    section: 'appearance',
    group: 'Theme',
    type: 'color',
    label: 'Accent colour',
    description: 'Used for links, the cursor, selections and highlights.',
    keywords: 'color highlight purple'
  },

  {
    key: 'editorFontSize',
    section: 'appearance',
    group: 'Text',
    type: 'slider',
    ...RANGES.editorFontSize,
    format: px,
    label: 'Text size',
    description: `Also ${showKeys('Ctrl+=')} and ${showKeys('Ctrl+-')} while writing.`,
    keywords: 'font size zoom bigger smaller'
  },
  {
    key: 'lineHeight',
    section: 'appearance',
    group: 'Text',
    type: 'slider',
    ...RANGES.lineHeight,
    format: (v) => v.toFixed(2),
    label: 'Line spacing',
    keywords: 'line height leading'
  },
  {
    key: 'noteWidth',
    section: 'appearance',
    group: 'Text',
    type: 'choice',
    options: [
      { value: 'narrow', label: 'Narrow' },
      { value: 'medium', label: 'Medium' },
      { value: 'wide', label: 'Wide' },
      { value: 'full', label: 'Full' }
    ],
    label: 'Note width',
    description: 'How wide lines of text can get before wrapping.',
    keywords: 'readable line length column'
  },

  {
    key: 'editorFont',
    section: 'appearance',
    group: 'Fonts',
    type: 'font',
    sample: 'The quick brown fox jumps over the lazy dog',
    label: 'Note font',
    description: 'The font your notes are written in.',
    keywords: 'typeface editor'
  },
  {
    key: 'uiFont',
    section: 'appearance',
    group: 'Fonts',
    type: 'font',
    sample: 'Files  ·  Search  ·  Tags',
    label: 'Interface font',
    description: 'Sidebars, tabs and menus. Notes use it too unless you pick a note font.',
    keywords: 'typeface ui'
  },
  {
    key: 'codeFont',
    section: 'appearance',
    group: 'Fonts',
    type: 'font',
    sample: 'const answer = 42 // code',
    label: 'Code font',
    description: 'Code blocks, inline code and frontmatter.',
    keywords: 'monospace typeface'
  },

  {
    key: 'density',
    section: 'appearance',
    group: 'Interface',
    type: 'choice',
    options: [
      { value: 'comfortable', label: 'Comfortable' },
      { value: 'compact', label: 'Compact' }
    ],
    label: 'Density',
    description: 'Spacing in the file tree, lists and pickers.',
    keywords: 'spacing compact padding'
  },
  {
    key: 'zoom',
    section: 'appearance',
    group: 'Interface',
    type: 'slider',
    ...RANGES.zoom,
    format: pct,
    label: 'Interface zoom',
    description: 'Scales the whole window.',
    keywords: 'scale size dpi'
  },
  { key: 'showStatusBar', section: 'appearance', group: 'Interface', type: 'toggle', label: 'Show status bar', description: 'The strip at the bottom with save status and counts.' },
  {
    key: 'motion',
    section: 'appearance',
    group: 'Interface',
    type: 'choice',
    options: [
      { value: 'full', label: 'Full' },
      { value: 'subtle', label: 'Subtle' },
      { value: 'off', label: 'Off' }
    ],
    label: 'Motion',
    description:
      'Full: pages slide in, tabs grow, ticks and stars pop. Subtle: things fade instead of moving. Off: no animations at all. If your system is set to reduce motion, Full acts like Subtle.',
    keywords: 'animation animations reduce motion accessibility transitions effects fade slide'
  },
  {
    key: 'gameLaunchAnimation',
    section: 'appearance',
    group: 'Interface',
    type: 'toggle',
    label: 'Launch animation for games',
    description: 'Pressing Play on the Games page shows the game’s art and logo for a few seconds while it starts. Click or press Esc to skip it. Off while Motion is Off.',
    keywords: 'games play launch start animation intro splash steam epic cinematic'
  },
  {
    key: 'gameAnimatedCovers',
    section: 'appearance',
    group: 'Interface',
    type: 'choice',
    options: [
      { value: 'always', label: 'Always' },
      { value: 'hover', label: 'On hover' },
      { value: 'off', label: 'Off' }
    ],
    label: 'Animated game covers',
    description: 'Covers on the Games page that move, from SteamGridDB (add a free key on the Games page). Still pictures are shown when a game has none, and while Motion is on Subtle or Off.',
    keywords: 'games covers art animated moving living gif webp steamgriddb grid'
  },
  {
    key: 'streamerMode',
    section: 'appearance',
    group: 'Streamer mode',
    type: 'toggle',
    label: 'Streamer mode',
    description: `For sharing your screen: your town, email, money, passwords, messages, calendar events and the notes folder’s path are blurred until you click them. Also the eye at the top, or ${showKeys('Ctrl+Alt+B')}.`,
    keywords: 'streamer streaming screenshare screen share sharing discord obs privacy private hide blur postcode'
  },
  {
    key: 'streamerHideNotes',
    section: 'appearance',
    group: 'Streamer mode',
    type: 'toggle',
    label: 'Hide notes until I click Show',
    description: 'A note you open in streamer mode stays covered until you choose to show it. Closing its tab hides it again.',
    keywords: 'streamer streaming screenshare privacy private hide notes cover'
  },
  {
    key: 'streamerHideNames',
    section: 'appearance',
    group: 'Streamer mode',
    type: 'toggle',
    label: 'Blur note names',
    description: 'In streamer mode, note names in the file list, tabs and recent notes are blurred too. Click one to see it; click again to open it.',
    keywords: 'streamer streaming screenshare privacy private hide names titles file list tabs'
  },

  // ---------- Editor ----------
  {
    key: 'livePreview',
    section: 'editor',
    group: 'Writing',
    type: 'toggle',
    label: 'Live preview',
    description: 'Show formatting as you type. Off shows plain markdown everywhere.',
    keywords: 'source raw markdown render'
  },
  { key: 'spellcheck', section: 'editor', group: 'Writing', type: 'toggle', label: 'Check spelling', description: 'Right-click a misspelled word for suggestions.', keywords: 'spell' },
  // macOS picks the spelling language itself, from the languages you type in.
  ...(IS_MAC
    ? []
    : [{ key: 'spellcheckLanguage', section: 'editor', group: 'Writing', type: 'language', label: 'Spelling language', keywords: 'spell dictionary english' } as SettingDef]),
  {
    key: 'autoPair',
    section: 'editor',
    group: 'Writing',
    type: 'toggle',
    label: 'Auto-close brackets and quotes',
    description: 'Typing ( [ { " or ` also types the closing one.',
    keywords: 'pair close bracket'
  },
  {
    key: 'wrapSelection',
    section: 'editor',
    group: 'Writing',
    type: 'toggle',
    label: 'Wrap selected text when typing * = ~ or `',
    description: 'Select a word and type * for italic (again for bold), = for a highlight, ~ for strikethrough or ` for code, instead of replacing it.',
    keywords: 'auto pair format bold italic highlight wrap selection'
  },
  {
    key: 'selectionToolbar',
    section: 'editor',
    group: 'Writing',
    type: 'toggle',
    label: 'Formatting toolbar on selected text',
    description: 'Bold, italic, highlight, links and more, just above what you select. (Right-clicking selected text has them all too.)',
    keywords: 'toolbar format bubble popup selection bold'
  },
  {
    key: 'smartPaste',
    section: 'editor',
    group: 'Writing',
    type: 'toggle',
    label: 'Smart paste',
    description: 'A pasted web address becomes a link with the page’s title; a table copied from Excel or a web page becomes a markdown table. Paste over selected text to link it. Ctrl+Shift+V always pastes plain text.',
    keywords: 'paste link url title table excel spreadsheet'
  },
  {
    key: 'vimMode',
    section: 'editor',
    group: 'Writing',
    type: 'toggle',
    label: 'Vim keys',
    description: 'Edit with Vim-style modes and motions.',
    keywords: 'vi modal keybindings'
  },

  { key: 'lineNumbers', section: 'editor', group: 'Display', type: 'toggle', label: 'Line numbers', keywords: 'gutter' },
  { key: 'highlightActiveLine', section: 'editor', group: 'Display', type: 'toggle', label: 'Highlight the current line', keywords: 'active line' },
  { key: 'cursorBlink', section: 'editor', group: 'Display', type: 'toggle', label: 'Blinking cursor', keywords: 'caret' },
  { key: 'showWordCount', section: 'editor', group: 'Display', type: 'toggle', label: 'Word count in the status bar', keywords: 'words' },
  {
    key: 'typewriterCenter',
    section: 'editor',
    group: 'Typewriter mode',
    type: 'toggle',
    label: 'Keep the current line in the middle',
    description: 'The note scrolls as you type, so the line you’re writing on stays in the middle of the screen.',
    keywords: 'typewriter focus scroll centre center writing'
  },
  {
    key: 'typewriterDim',
    section: 'editor',
    group: 'Typewriter mode',
    type: 'toggle',
    label: 'Fade everything else',
    description: 'While you write, the rest of the note fades back so only what you’re working on stands out.',
    keywords: 'typewriter focus dim fade writing'
  },
  {
    key: 'typewriterDimUnit',
    section: 'editor',
    group: 'Typewriter mode',
    type: 'choice',
    options: [
      { value: 'paragraph', label: 'Current paragraph' },
      { value: 'line', label: 'Current line' }
    ],
    label: 'What stays bright',
    keywords: 'typewriter focus dim paragraph line'
  },
  {
    key: 'handwritingReader',
    section: 'editor',
    group: 'Sketches',
    type: 'choice',
    options: [
      { value: 'auto', label: 'AI helper if set up' },
      { value: 'ai', label: 'AI helper' },
      { value: 'offline', label: 'Offline' }
    ],
    label: 'Turn handwriting into text with',
    description:
      'The sketch pad’s “Turn into text” button. The AI helper reads messy and joined-up writing well, but sends that sketch to Anthropic (about a cent each time). Offline stays on this computer and needs no key, but works best with neat printed letters.',
    keywords: 'handwriting ocr recognise recognize text sketch pen convert'
  },
  {
    key: 'focusMinutes',
    section: 'editor',
    group: 'Focus timer',
    type: 'slider',
    ...RANGES.focusMinutes,
    format: (v) => `${v} min`,
    label: 'Focus length',
    description: 'The timer in zen mode (Ctrl+Alt+Z). It can also be changed there.',
    keywords: 'timer pomodoro zen focus minutes'
  },
  {
    key: 'focusRounds',
    section: 'editor',
    group: 'Focus timer',
    type: 'slider',
    ...RANGES.focusRounds,
    format: (v) => (v === 1 ? '1 (no breaks)' : `${v}`),
    label: 'Rounds',
    description: 'More than one: a break between rounds, and a longer one at the end.',
    keywords: 'timer pomodoro rounds cycles'
  },
  { key: 'breakMinutes', section: 'editor', group: 'Focus timer', type: 'slider', ...RANGES.breakMinutes, format: (v) => `${v} min`, label: 'Break', keywords: 'timer pomodoro break rest' },
  { key: 'longBreakMinutes', section: 'editor', group: 'Focus timer', type: 'slider', ...RANGES.longBreakMinutes, format: (v) => `${v} min`, label: 'Long break', keywords: 'timer pomodoro break rest' },
  { key: 'timerChime', section: 'editor', group: 'Focus timer', type: 'toggle', label: 'Chime when a part ends', keywords: 'timer sound alarm' },
  { key: 'timerAlwaysVisible', section: 'editor', group: 'Focus timer', type: 'toggle', label: 'Keep the countdown faintly visible while writing', keywords: 'timer zen' },
  { key: 'timerLeaveZen', section: 'editor', group: 'Focus timer', type: 'toggle', label: 'Leave zen mode when the session ends', keywords: 'timer zen exit' },
  {
    key: 'openInNewTab',
    section: 'editor',
    group: 'Tabs',
    type: 'toggle',
    label: 'Open notes in a new tab',
    description: `Off: opening a note changes the current tab (pinned tabs are left alone). Either way, middle-click a note (or right-click → Open in new tab) to open it in a new tab.`,
    keywords: 'tab replace reuse open'
  },
  {
    key: 'openLinksInApp',
    section: 'editor',
    group: 'Tabs',
    type: 'toggle',
    label: 'Open web links in a web tab beside the note',
    description: 'Off: web links open in your usual browser instead. Either way, a web tab’s ↗ button opens its page in your browser.',
    keywords: 'web browser link url website internet split external chrome safari edge'
  },
  {
    key: 'homeOnStart',
    section: 'editor',
    group: 'Tabs',
    type: 'toggle',
    label: 'Show Home when Notes starts',
    description: `Home shows today's plans, reminders, flashcards to review and your recent notes. You can always open it from the house button at the top.`,
    keywords: 'home start dashboard today startup'
  },

  {
    key: 'tabSize',
    section: 'editor',
    group: 'Indentation',
    type: 'choice',
    options: [
      { value: '2', label: '2' },
      { value: '4', label: '4' },
      { value: '8', label: '8' }
    ],
    label: 'Tab size',
    description: 'How far Tab indents list items and code.',
    keywords: 'indent spaces'
  },
  { key: 'indentWithTabs', section: 'editor', group: 'Indentation', type: 'toggle', label: 'Indent with tab characters', description: 'Off uses spaces.', keywords: 'spaces' },

  {
    key: 'autosaveDelay',
    section: 'editor',
    group: 'Saving',
    type: 'slider',
    ...RANGES.autosaveDelay,
    format: (v) => (v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`),
    label: 'Autosave after',
    description: `How long after you stop typing a note is saved. ${showKeys('Ctrl+S')} saves straight away.`,
    keywords: 'save delay'
  },

  // ---------- Files ----------
  {
    key: 'attachmentFolder',
    section: 'files',
    group: 'Folders',
    type: 'folder',
    placeholder: 'attachments',
    label: 'Attachments folder',
    description: 'Where pasted and dropped images and files are saved, inside your notes folder. Leave empty for the top level.',
    keywords: 'images pictures screenshots paste media'
  },
  {
    key: 'templatesFolder',
    section: 'files',
    group: 'Folders',
    type: 'folder',
    placeholder: 'Templates',
    label: 'Templates folder',
    description: 'Notes in this folder show up in "New note from template" and /template.',
    keywords: 'template'
  },
  {
    key: 'showAttachments',
    section: 'files',
    group: 'Folders',
    type: 'toggle',
    label: 'Show pictures, recordings and other files',
    description: 'In the file list, next to your notes. Pictures, recordings, videos and PDFs open in a tab; drag one into a note to show it there.',
    keywords: 'attachments images audio pdf files hide show tree'
  },
  {
    key: 'randomIncludeDaily',
    section: 'files',
    group: 'Random note',
    type: 'toggle',
    label: 'Random note can pick daily notes',
    description: 'The dice button (or Ctrl+K → “Open a random note”) opens any note except templates. Daily notes are skipped unless this is on.',
    keywords: 'random dice shuffle daily'
  },
  {
    key: 'hideTemplatesFromTags',
    section: 'files',
    group: 'Folders',
    type: 'toggle',
    label: 'Hide templates from tags',
    description: 'Templates can carry tags for the notes made from them without showing up under those tags themselves (in the Tags list and #tag searches).',
    keywords: 'template tags hide search'
  },
  {
    key: 'autoLockMinutes',
    section: 'files',
    group: 'Locked notes',
    type: 'slider',
    ...RANGES.autoLockMinutes,
    format: (v) => (v === 0 ? 'Never' : `${v} min`),
    label: 'Lock again after',
    description: 'Unlocked notes and passwords lock again after this long without using Notes. (Passwords still lock after 30 min if this is “Never”. Also Ctrl+K → “Lock all notes and passwords now”, and they always lock when Notes closes.)',
    keywords: 'lock password encrypt private secure auto timeout'
  },

  // ---------- Calendar ----------
  {
    key: 'dailyFolder',
    section: 'calendar',
    group: 'Daily notes',
    type: 'folder',
    placeholder: 'Daily',
    label: 'Daily notes folder',
    keywords: 'journal diary day'
  },
  {
    key: 'dailyFormat',
    section: 'calendar',
    group: 'Daily notes',
    type: 'text',
    placeholder: 'YYYY-MM-DD',
    preview: (v) => `Today's note: ${formatDate(new Date(), v || 'YYYY-MM-DD')}.md`,
    label: 'Daily note name',
    description: 'YYYY year · MM month · DD day · MMMM month name · dddd weekday. Use / for subfolders, e.g. YYYY/MM/YYYY-MM-DD.',
    keywords: 'date format file name journal'
  },
  {
    key: 'dailyTemplate',
    section: 'calendar',
    group: 'Daily notes',
    type: 'folder',
    prefix: 'Template note:',
    placeholder: 'e.g. Templates/Daily',
    label: 'Daily note template',
    description: 'New daily notes start from this note (leave empty for just a title). Placeholders like {{date:dddd D MMMM YYYY}} become that day’s date: see the list below, or type /placeholder in a template.',
    keywords: 'template journal placeholder date'
  },
  {
    key: 'dailyKeepHeading',
    section: 'calendar',
    group: 'Daily notes',
    type: 'toggle',
    label: 'Keep the date heading above my template',
    description: 'If your daily template doesn’t start with a heading of its own, the usual one (like “Monday 26 October 2026”) goes on top.',
    keywords: 'template heading title date day'
  },
  {
    key: 'createDailyOnClick',
    section: 'calendar',
    group: 'Daily notes',
    type: 'toggle',
    label: 'Clicking a day creates its daily note',
    description: 'Off: clicking a day without a note just shows that day’s agenda.'
  },
  {
    key: 'weekStart',
    section: 'calendar',
    group: 'Calendar',
    type: 'choice',
    options: [
      { value: '1', label: 'Monday' },
      { value: '0', label: 'Sunday' }
    ],
    label: 'Week starts on',
    keywords: 'monday sunday first day'
  },
  {
    key: 'timeFormat',
    section: 'calendar',
    group: 'Calendar',
    type: 'choice',
    options: [
      { value: '24h', label: '14:00' },
      { value: '12h', label: '2 pm' }
    ],
    label: 'Time format',
    keywords: '12 24 hour clock am pm'
  },
  {
    key: 'scheduleHeading',
    section: 'calendar',
    group: 'Calendar',
    type: 'text',
    placeholder: 'Schedule',
    label: 'Events heading',
    description: 'In daily notes, list items under this heading are events, like "- 09:30-10:30 Standup".',
    keywords: 'schedule agenda events'
  },
  {
    key: 'weatherHome',
    section: 'calendar',
    group: 'Weather',
    type: 'toggle',
    label: 'Show the weather on the Home page',
    description: 'Today’s weather and the week ahead. Pick your town on the Home page; the forecast is from Open-Meteo, so there’s nothing to sign up for.',
    keywords: 'weather forecast rain sun temperature town city location home'
  },
  {
    key: 'weatherCalendar',
    section: 'calendar',
    group: 'Weather',
    type: 'toggle',
    label: 'Show the forecast on the calendar',
    description: 'A small forecast beside outdoor events (walks, football, a BBQ… or anything with “outside” in it), and on each day of the next two weeks.',
    keywords: 'weather forecast rain outdoor outside event calendar'
  },

  // ---------- Quick capture & tray ----------
  {
    key: 'captureShortcut',
    section: 'capture',
    group: 'Quick capture',
    type: 'choice',
    options: CAPTURE_SHORTCUTS.map((value) => ({ value, label: value ? acceleratorLabel(value) : 'Off' })),
    label: 'Shortcut',
    description: `Works from any app, as long as Notes is running (it can wait in the ${TRAY_NAME}).`,
    keywords: 'capture hotkey global win key'
  },
  {
    key: 'captureTarget',
    section: 'capture',
    group: 'Quick capture',
    type: 'choice',
    options: [
      { value: 'daily', label: "Today's note" },
      { value: 'inbox', label: 'Inbox note' }
    ],
    label: 'Save captures to',
    keywords: 'capture inbox daily'
  },
  {
    key: 'captureHeading',
    section: 'capture',
    group: 'Quick capture',
    type: 'text',
    placeholder: 'Captured',
    label: 'Heading in the daily note',
    description: 'Captures are added under this heading in today’s note (it’s created if needed).',
    keywords: 'capture heading'
  },
  {
    key: 'captureInbox',
    section: 'capture',
    group: 'Quick capture',
    type: 'folder',
    prefix: 'Inbox note:',
    placeholder: 'Inbox',
    label: 'Inbox note',
    description: 'Used when captures go to the inbox. Created if it doesn’t exist.',
    keywords: 'capture inbox'
  },
  { key: 'captureTimestamp', section: 'capture', group: 'Quick capture', type: 'toggle', label: 'Add the time to each capture', description: 'Like "- 14:05 Call the plumber".' },
  {
    key: 'captureRememberTarget',
    section: 'capture',
    group: 'Quick capture',
    type: 'toggle',
    label: 'Remember where I last sent a capture',
    description: 'The → menu at the top of quick capture picks another note or folder. Normally each capture starts back at the usual place; with this on, it stays where you last chose.',
    keywords: 'destination folder note target where'
  },
  {
    key: 'closeToTray',
    section: 'capture',
    group: IS_MAC ? 'Menu bar' : 'Tray',
    type: 'toggle',
    label: `Keep running in the ${TRAY_NAME} when the window is closed`,
    description: IS_MAC
      ? 'So quick capture works any time. Quit with ⌘Q or from the menu bar icon.'
      : 'So quick capture works any time. Quit from the tray icon’s menu.',
    keywords: 'tray menu bar background minimize system'
  },
  {
    key: 'launchAtStartup',
    section: 'capture',
    group: IS_MAC ? 'Menu bar' : 'Tray',
    type: 'toggle',
    label: IS_MAC ? 'Open Notes when you log in' : 'Start Notes when Windows starts',
    description: IS_MAC ? 'Only in the installed app.' : 'It starts quietly in the tray.',
    keywords: 'startup login boot'
  },

  // ---------- About ----------
  {
    key: 'checkForUpdates',
    section: 'about',
    group: 'Updates',
    type: 'toggle',
    label: 'Check for updates automatically',
    description: IS_MAC
      ? 'Notes tells you when a new version is out and opens its download page.'
      : 'New versions download in the background and install when you restart Notes.',
    keywords: 'update upgrade version new release'
  }
]

export const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'editor', label: 'Editor' },
  { id: 'files', label: 'Files' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'capture', label: 'Quick capture' },
  { id: 'ai', label: 'AI helper' },
  { id: 'music', label: 'Music' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'about', label: 'About' }
]

/** Accent colours offered as one-click swatches. */
export const ACCENT_SWATCHES = ['#8b7cf6', '#5ea8ff', '#3ccfcf', '#4ade80', '#e0a458', '#f97066', '#f472b6', '#c4b5fd']

export function matchesSearch(def: SettingDef, query: string): boolean {
  const haystack = `${def.label} ${def.description ?? ''} ${def.keywords ?? ''} ${def.group}`.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}
