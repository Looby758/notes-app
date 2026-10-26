import { IS_MAC } from '@shared/platform'

/** Fonts that come with macOS, used if the list of installed fonts can't be read. */
const MAC_FONTS = [
  'American Typewriter',
  'Avenir',
  'Avenir Next',
  'Baskerville',
  'Charter',
  'Courier New',
  'Futura',
  'Georgia',
  'Gill Sans',
  'Helvetica',
  'Helvetica Neue',
  'Iowan Old Style',
  'Menlo',
  'Monaco',
  'New York',
  'Optima',
  'Palatino',
  'SF Mono',
  'SF Pro Text',
  'Times New Roman',
  'Verdana'
]

/** Fonts commonly installed on Windows, used if the list of installed fonts can't be read. */
const WINDOWS_FONTS = [
  'Arial',
  'Bahnschrift',
  'Calibri',
  'Cambria',
  'Candara',
  'Cascadia Code',
  'Cascadia Mono',
  'Consolas',
  'Constantia',
  'Corbel',
  'Courier New',
  'Georgia',
  'Lucida Console',
  'Palatino Linotype',
  'Segoe UI',
  'Segoe UI Variable Text',
  'Sitka Text',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana'
]

let cached: Promise<string[]> | null = null

interface LocalFont {
  family: string
}

/** Installed font family names, alphabetically. */
export function listFonts(): Promise<string[]> {
  cached ??= (async () => {
    try {
      const query = (window as unknown as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts
      if (query) {
        const families = [...new Set((await query()).map((f) => f.family))]
        if (families.length) return families.sort((a, b) => a.localeCompare(b))
      }
    } catch {
      // permission refused or not supported
    }
    return IS_MAC ? MAC_FONTS : WINDOWS_FONTS
  })()
  return cached
}
