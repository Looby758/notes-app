/**
 * Which folders Whole PC search lists. Everything a person keeps is in; what's only ever the
 * system's or an app's own workings is left out, which keeps the list a fraction of the size.
 */

/** Left out wherever they are. */
const ANYWHERE = new Set([
  'node_modules',
  '$recycle.bin',
  'system volume information',
  '$windows.~bt',
  '$windows.~ws',
  '$winreagent',
  'appdata',
  'windowsapps',
  'winsxs',
  '__pycache__',
  'cache',
  'caches',
  'code cache',
  'gpucache',
  'shadercache',
  'dawncache'
])

/** Left out at the top of a drive (C:\Windows and the like). */
const TOP_WINDOWS = new Set(['windows', 'programdata', 'recovery', 'msocache', 'config.msi', 'perflogs', '$sysreset', 'onedrivetemp', 'intel', 'amd', 'nvidia'])

/** The Mac's system folders (only the home folder, Applications and other drives are listed there). */
const MAC_HOME_TOP = new Set(['library', 'applications (parallels)'])

export function skipDirFor(platform: NodeJS.Platform, home: string): (lowerName: string, parentPath: string, depth: number) => boolean {
  const homeKey = home.toLowerCase().replace(/[\\/]+$/, '')
  return (name, parent, depth) => {
    if (ANYWHERE.has(name)) return true
    if (platform === 'win32') return depth === 1 && TOP_WINDOWS.has(name)
    if (platform === 'darwin') {
      return MAC_HOME_TOP.has(name) && parent.toLowerCase().replace(/[\\/]+$/, '') === homeKey
    }
    return false
  }
}

/** Mac apps (.app folders) are listed but not walked into: they're full of the app's own files. */
export const isMacBundle = (platform: NodeJS.Platform, lowerName: string): boolean => platform === 'darwin' && /\.(app|bundle|framework|photoslibrary|musiclibrary|tvlibrary)$/.test(lowerName)

/**
 * The same as isHiddenName in shared/explorer.ts (dot files and Windows' own files), copied here
 * because the worker thread is built on its own and can't share code with the main process
 * (fileIndex.test.ts checks the two agree).
 */
const SYSTEM_NAMES = new Set(['desktop.ini', 'thumbs.db', 'ntuser.dat', '$recycle.bin', 'system volume information', '$windows.~ws', 'pagefile.sys', 'hiberfil.sys', 'swapfile.sys', 'dumpstack.log.tmp', 'icon\r'])
export function isHiddenFile(name: string): boolean {
  const lower = name.toLowerCase()
  return name.startsWith('.') || name.startsWith('~$') || SYSTEM_NAMES.has(lower) || lower.startsWith('ntuser.')
}
