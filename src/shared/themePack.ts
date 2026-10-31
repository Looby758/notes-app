import type { Theme, ThemeColors } from './themes'

/**
 * Theme files: themes that don't come with the app. A theme file (.notestheme) is a zip holding a
 * theme.json and the pictures and fonts it names; a bare theme.json (colours only) works too.
 * Import one in Settings → Appearance. A theme file is only looks: colours, pictures, fonts and a
 * few words. It can't hold code or CSS, so a theme someone sends you can't do anything harmful.
 *
 * theme.json, every field but name and colors optional:
 *
 *   {
 *     "format": 1,
 *     "id": "walking-dead",            // a-z, 0-9 and -; importing the same id again updates it
 *     "name": "The Walking Dead",
 *     "author": "Looby",
 *     "light": false,
 *     "accent": "#c46a3b",
 *     "colors": { "bg": "#14161a", ... every key of ThemeColors ... },
 *     "pictures": {                     // a picture behind each part of the app (see THEME_PAGES)
 *       "home": { "file": "pictures/daryl.jpg", "position": "center top", "accent": "#7d9a6a" },
 *       "all": { "file": "pictures/group.jpg" }   // anywhere without its own picture
 *     },
 *     "pictureStrength": 0.15,         // how strongly pictures show, 0.03 to 0.6 (the sidebar and music player show half)
 *     "loading": { "text": "JSS", "picture": "pictures/enid.jpg", "font": "fonts/marker.ttf", "color": "#e8e2d4" },
 *     "starIcon": "icons/wings.png",   // in place of the star on starred notes
 *     "appIcon": "icons/hat.png",      // the app's icon while the theme is on (square, 512px or more)
 *     "fonts": { "ui": "fonts/a.woff2", "headings": "fonts/b.ttf", "editor": "fonts/c.woff2" }
 *   }
 */

export const THEME_FORMAT = 1
/** Imported themes' ids start with this, so they never clash with built-in ones. */
export const IMPORTED_PREFIX = 'imported-'
export const THEME_FILE_EXTENSION = 'notestheme'

/** Parts of the app a theme can put a picture behind. */
export const THEME_PAGES: Record<string, string> = {
  all: 'Everywhere without its own picture',
  home: 'Home',
  notes: 'Notes (the editor)',
  sidebar: 'The sidebar',
  calendar: 'Calendar',
  money: 'Money',
  games: 'Games',
  music: 'Music player',
  flashcards: 'Flashcards',
  passwords: 'Passwords',
  email: 'Email',
  messages: 'Messages',
  ai: 'Ask AI',
  chat: 'AI chat',
  sudoku: 'Sudoku',
  minesweeper: 'Minesweeper',
  clocks: 'World clocks',
  convert: 'File converter',
  explorer: 'File explorer',
  graph: 'Graph',
  settings: 'Settings',
  terminal: 'Terminal',
  files: 'Pictures and files',
  web: 'Web pages'
}

export const PICTURE_TYPES = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']
export const FONT_TYPES = ['.woff2', '.woff', '.ttf', '.otf']
/** The largest single file and the largest whole theme (after unzipping). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_THEME_BYTES = 120 * 1024 * 1024

export interface PagePicture {
  /** Path inside the theme folder. */
  file: string
  /** CSS background-position, e.g. "center top" or "30% 20%". */
  position: string
  /** An accent for this part of the app, e.g. picked from the picture. */
  accent?: string
}

export interface ThemePack {
  author?: string
  pictures: Record<string, PagePicture>
  pictureStrength: number
  loading?: { text?: string; picture?: string; color?: string }
  starIcon?: string
  appIcon?: string
  /** `loading` is the font for the loading screen's words. */
  fonts: { ui?: string; headings?: string; editor?: string; loading?: string }
  /** Every file the theme uses, so importing copies only these. */
  files: string[]
}

const COLOR_KEYS: (keyof ThemeColors)[] = ['bg', 'bgPanel', 'bgRaised', 'bgHover', 'bgCode', 'border', 'borderStrong', 'textStrong', 'text', 'textMuted', 'textFaint']

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const extOf = (path: string): string => (path.match(/\.[^./]+$/)?.[0] ?? '').toLowerCase()

/** A path inside the theme: forward slashes, no "..", no drive or leading slash, plain characters. */
export function cleanThemePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!path || path.length > 200 || path.startsWith('/') || !/^[\w\- ./()]+$/.test(path)) return null
  if (path.split('/').some((part) => part === '' || part === '.' || part === '..')) return null
  return path
}

/** A background-position: words and percentages only (it goes into CSS). */
function cleanPosition(value: unknown): string {
  if (typeof value !== 'string') return 'center'
  const words = value.trim().toLowerCase().split(/\s+/)
  const ok = words.length <= 2 && words.every((w) => /^(left|right|top|bottom|center|\d{1,3}%)$/.test(w))
  return ok ? words.join(' ') : 'center'
}

const cleanText = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
  return text || undefined
}

export const themeSlug = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

/**
 * Checks a theme.json and turns it into a theme, or says what's wrong. `hasFile` says whether a
 * file is in the theme; pictures and fonts that are missing or of the wrong kind are left out.
 */
export function readThemeManifest(raw: unknown, hasFile: (path: string) => boolean): { theme: Theme } | { error: string } {
  if (!isObject(raw)) return { error: 'theme.json isn’t a theme.' }
  if (typeof raw.format === 'number' && raw.format > THEME_FORMAT) return { error: 'This theme needs a newer version of Orbit.' }
  const name = cleanText(raw.name, 60)
  if (!name) return { error: 'The theme has no name.' }
  const slug = themeSlug(raw.id) || themeSlug(name)
  if (!slug) return { error: 'The theme’s id should use letters and numbers.' }
  if (!isObject(raw.colors)) return { error: 'The theme has no colours.' }
  const rawColors = raw.colors
  const missing = COLOR_KEYS.filter((k) => !isHex(rawColors[k]))
  if (missing.length) return { error: `The theme’s colours are missing or not #hex: ${missing.join(', ')}.` }
  const colors = Object.fromEntries(COLOR_KEYS.map((k) => [k, (rawColors[k] as string).toLowerCase()])) as unknown as ThemeColors

  const files = new Set<string>()
  const file = (value: unknown, types: string[]): string | undefined => {
    const path = cleanThemePath(value)
    if (!path || !types.includes(extOf(path)) || !hasFile(path)) return undefined
    files.add(path)
    return path
  }

  const pictures: Record<string, PagePicture> = {}
  if (isObject(raw.pictures)) {
    for (const [page, value] of Object.entries(raw.pictures)) {
      if (!(page in THEME_PAGES)) continue
      const entry = typeof value === 'string' ? { file: value } : value
      if (!isObject(entry)) continue
      const picture = file(entry.file, PICTURE_TYPES)
      if (!picture) continue
      pictures[page] = { file: picture, position: cleanPosition(entry.position), ...(isHex(entry.accent) ? { accent: entry.accent.toLowerCase() } : {}) }
    }
  }

  const strength = typeof raw.pictureStrength === 'number' && Number.isFinite(raw.pictureStrength) ? raw.pictureStrength : 0.15
  const loadingRaw = isObject(raw.loading) ? raw.loading : {}
  const loading = {
    text: cleanText(loadingRaw.text, 40),
    picture: file(loadingRaw.picture, PICTURE_TYPES),
    ...(isHex(loadingRaw.color) ? { color: loadingRaw.color.toLowerCase() } : {})
  }
  const fontsRaw = isObject(raw.fonts) ? raw.fonts : {}
  const fonts: ThemePack['fonts'] = {}
  for (const key of ['ui', 'headings', 'editor'] as const) {
    const font = file(fontsRaw[key], FONT_TYPES)
    if (font) fonts[key] = font
  }
  const loadingFont = file(loadingRaw.font, FONT_TYPES)
  if (loadingFont) fonts.loading = loadingFont

  const pack: ThemePack = {
    author: cleanText(raw.author, 60),
    pictures,
    pictureStrength: Math.min(0.6, Math.max(0.03, strength)),
    loading: loading.text || loading.picture ? loading : undefined,
    starIcon: file(raw.starIcon, PICTURE_TYPES),
    appIcon: file(raw.appIcon, ['.png', '.jpg', '.jpeg', '.webp']),
    fonts,
    files: []
  }
  pack.files = [...files]
  return {
    theme: {
      id: IMPORTED_PREFIX + slug,
      name,
      light: raw.light === true,
      accent: isHex(raw.accent) ? raw.accent.toLowerCase() : colors.textStrong,
      colors,
      pack
    }
  }
}

/** The part of the app a tab shows, for its picture: "money:" → "money", a note → "notes". */
export function pageOfTab(tab: string | null | undefined): string {
  if (!tab) return 'home'
  const colon = tab.indexOf(':')
  if (colon < 0) return 'notes'
  const prefix = tab.slice(0, colon)
  if (prefix === 'file') return 'files'
  if (prefix === 'blank') return 'home'
  return prefix
}

/** The picture for a part of the app, falling back to the theme's picture for everywhere. */
export function pictureFor(pack: ThemePack | undefined, page: string): PagePicture | undefined {
  return pack?.pictures[page] ?? pack?.pictures.all
}

/** The address a theme's file is served at inside the app. */
export const themeFileUrl = (themeId: string, path: string): string =>
  `notestheme://${themeId.slice(IMPORTED_PREFIX.length)}/${path.split('/').map(encodeURIComponent).join('/')}`
