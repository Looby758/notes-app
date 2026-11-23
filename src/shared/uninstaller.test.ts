import { describe, expect, it } from 'vitest'
import {
  appKeys,
  baseName,
  formatSize,
  fromInfoPlist,
  fromWindows,
  hasBundleId,
  iconFile,
  installDate,
  isInside,
  isSafeLeftover,
  isSafeRegistryKey,
  matchName,
  ownFolder,
  parseRegQuery,
  publisherKeys,
  runningFrom,
  searchApps,
  sortApps,
  splitCommand,
  totalSize,
  type InstalledApp,
  type SafeRules
} from './uninstaller'

describe('names', () => {
  it('drops versions and bits from app names', () => {
    expect(baseName('7-Zip 23.01 (x64)')).toBe('7-Zip')
    expect(baseName('Zoom Workplace (64-bit)')).toBe('Zoom Workplace')
    expect(baseName('Python 3.12.1 (64-bit)')).toBe('Python')
    expect(baseName('Discord')).toBe('Discord')
    expect(baseName('VLC media player')).toBe('VLC media player')
  })

  it('keys an app by its name and its own install folder, never by a general name', () => {
    expect(appKeys({ name: 'Mozilla Firefox (x64 en-GB)', location: 'C:\\Program Files\\Mozilla Firefox' })).toEqual(['mozillafirefoxx64engb', 'mozillafirefox'])
    // A company folder isn't the app's own.
    expect(appKeys({ name: 'PyCharm', location: 'C:\\Program Files\\JetBrains' })).toEqual(['pycharm'])
    expect(appKeys({ name: 'Microsoft' })).toEqual([])
    expect(appKeys({ name: 'Go' })).toEqual([])
  })

  it('knows an install folder from a company folder', () => {
    expect(ownFolder('Discord', 'C:\\Users\\a\\AppData\\Local\\Discord')).toBe(true)
    expect(ownFolder('PyCharm Community Edition 2023.1', 'C:\\Program Files\\JetBrains\\PyCharm Community Edition 2023.1')).toBe(true)
    expect(ownFolder('Epic Games Launcher', 'C:\\Program Files (x86)\\Epic Games')).toBe(false)
    expect(ownFolder('Mozilla Firefox', 'C:\\Program Files\\Mozilla')).toBe(false)
    expect(ownFolder('Thing', 'C:\\Program Files')).toBe(false)
  })

  it('turns publishers into folder names', () => {
    expect(publisherKeys('Spotify AB')).toEqual(['spotifyab', 'spotify'])
    expect(publisherKeys('Microsoft Corporation')).toEqual(['microsoftcorporation'])
    expect(publisherKeys('Google LLC')).toEqual(['googlellc'])
    expect(publisherKeys(undefined)).toEqual([])
  })

  it('finds a bundle ID only as a whole', () => {
    expect(hasBundleId('com.spotify.client.plist', 'com.spotify.client')).toBe(true)
    expect(hasBundleId('com.spotify.client', 'com.spotify.client')).toBe(true)
    expect(hasBundleId('group.com.spotify.client', 'com.spotify.client')).toBe(true)
    expect(hasBundleId('ABC123.com.spotify.client.savedState', 'com.spotify.client')).toBe(true)
    expect(hasBundleId('com.spotify.clientele.plist', 'com.spotify.client')).toBe(false)
    expect(hasBundleId('xcom.spotify.client', 'com.spotify.client')).toBe(false)
    expect(hasBundleId('anything', 'single')).toBe(false)
  })

  it('matches folders and shortcuts by the whole name only', () => {
    const keys = ['discord']
    expect(matchName('Discord', keys)).toBe('app')
    expect(matchName('discord', keys)).toBe('app')
    expect(matchName('Discord.lnk', keys)).toBe('app')
    expect(matchName('DiscordPTB', keys)).toBe(null)
    expect(matchName('Discord Helper Tools', keys)).toBe(null)
    expect(matchName('Microsoft', ['microsoft'])).toBe(null)
    expect(matchName('Spotify', ['spotifyapp'], ['spotify'])).toBe('publisher')
    expect(matchName('com.x.app.plist', [], [], 'com.x.app')).toBe('app')
  })
})

describe('safety', () => {
  const win: SafeRules = {
    roots: ['C:\\Users\\a\\AppData\\Roaming', 'C:\\Users\\a\\AppData\\Local', 'C:\\Program Files'],
    keep: ['C:\\Users\\a', 'C:\\Windows', 'C:\\Users\\a\\AppData\\Roaming\\Microsoft', 'C:\\Users\\a\\AppData\\Roaming\\Orbit', 'C:\\Users\\a\\AppData\\Local\\Notes']
  }
  it('allows an app’s folder inside a place it keeps files', () => {
    expect(isSafeLeftover('C:\\Users\\a\\AppData\\Roaming\\discord', win)).toBe(true)
    expect(isSafeLeftover('c:/users/a/appdata/local/Spotify', win)).toBe(true)
    expect(isSafeLeftover('C:\\Program Files\\Vendor\\App', win)).toBe(true)
  })
  it('never allows the places themselves, system folders or what holds something kept', () => {
    expect(isSafeLeftover('C:\\Users\\a\\AppData\\Roaming', win)).toBe(false)
    expect(isSafeLeftover('C:\\Users\\a\\AppData\\Roaming\\', win)).toBe(false)
    expect(isSafeLeftover('C:\\Program Files', win)).toBe(false)
    expect(isSafeLeftover('C:\\Windows\\System32', win)).toBe(false)
    expect(isSafeLeftover('C:\\Users\\a', win)).toBe(false)
    expect(isSafeLeftover('C:\\Users\\a\\Documents\\x', win)).toBe(false)
    expect(isSafeLeftover('C:\\Users\\a\\AppData\\Roaming\\Microsoft', win)).toBe(false)
    expect(isSafeLeftover('C:\\Users\\a\\AppData\\Roaming\\Orbit', win)).toBe(false)
    // Your notes folder is inside it, so it stays.
    expect(isSafeLeftover('C:\\Users\\a\\AppData\\Local', win)).toBe(false)
    expect(isSafeLeftover('C:\\Users\\a\\AppData\\Roaming\\x\\..\\..\\..', win)).toBe(false)
    expect(isSafeLeftover('relative\\path', win)).toBe(false)
    expect(isSafeLeftover('', win)).toBe(false)
  })
  it('keeps a notes folder that sits inside an app’s folder', () => {
    const rules = { ...win, keep: [...win.keep, 'C:\\Users\\a\\AppData\\Roaming\\Obsidian\\vault'] }
    expect(isSafeLeftover('C:\\Users\\a\\AppData\\Roaming\\Obsidian', rules)).toBe(false)
  })
  it('works the same on a Mac', () => {
    const mac: SafeRules = { roots: ['/Users/a/Library/Caches', '/Applications'], keep: ['/Users/a', '/Users/a/Library'] }
    expect(isSafeLeftover('/Users/a/Library/Caches/com.x.app', mac)).toBe(true)
    expect(isSafeLeftover('/Applications/X.app', mac)).toBe(true)
    expect(isSafeLeftover('/Applications', mac)).toBe(false)
    expect(isSafeLeftover('/Users/a/Library', mac)).toBe(false)
    expect(isSafeLeftover('/System/Applications/Mail.app', mac)).toBe(false)
    // Case matters on a Mac's paths as written, so a different case isn't "inside".
    expect(isInside('/users/a/Library/Caches/x', '/Users/a/Library/Caches')).toBe(false)
  })
  it('only removes the current user’s own registry settings', () => {
    expect(isSafeRegistryKey('HKEY_CURRENT_USER\\Software\\Discord')).toBe(true)
    expect(isSafeRegistryKey('HKEY_CURRENT_USER\\Software\\Spotify AB\\Spotify')).toBe(true)
    expect(isSafeRegistryKey('HKEY_CURRENT_USER\\Software\\Microsoft')).toBe(false)
    expect(isSafeRegistryKey('HKEY_CURRENT_USER\\Software\\Microsoft\\Teams')).toBe(false)
    expect(isSafeRegistryKey('HKEY_CURRENT_USER\\Software\\Classes\\x')).toBe(false)
    expect(isSafeRegistryKey('HKEY_CURRENT_USER\\Software\\Policies')).toBe(false)
    expect(isSafeRegistryKey('HKEY_LOCAL_MACHINE\\Software\\Discord')).toBe(false)
    expect(isSafeRegistryKey('HKEY_CURRENT_USER\\Software')).toBe(false)
    expect(isSafeRegistryKey('HKEY_CURRENT_USER\\Software\\A\\B\\C')).toBe(false)
    expect(isSafeRegistryKey('HKEY_CURRENT_USER\\Software\\Vendor\\Update')).toBe(false)
  })
})

describe('Windows', () => {
  it('lists real apps, not updates, parts or Orbit', () => {
    const apps = fromWindows([
      { k: 'HKEY_LOCAL_MACHINE\\x\\Discord', s: 'user', n: 'Discord', pub: 'Discord Inc.', ver: '1.0.9', u: '"C:\\Users\\a\\AppData\\Local\\Discord\\Update.exe" --uninstall', sz: 2048, d: '20240131', loc: 'C:\\Users\\a\\AppData\\Local\\Discord\\' },
      { k: 'k2', n: 'Security Update for Windows (KB5034441)', u: 'x.exe' },
      { k: 'k3', n: 'Some Runtime', u: 'x.exe', sc: 1 },
      { k: 'k4', n: 'Part of something', u: 'x.exe', par: 'Office' },
      { k: 'k5', n: 'No uninstaller' },
      { k: 'k6', n: 'Orbit', u: 'x.exe' },
      { k: 'k7', n: '7-Zip 23.01 (x64)', u: 'C:\\Program Files\\7-Zip\\Uninstall.exe' },
      { k: 'k8', n: '7-Zip 23.01 (x64)', u: 'C:\\Program Files\\7-Zip\\Uninstall.exe' }
    ])
    expect(apps.map((a) => a.name)).toEqual(['7-Zip 23.01 (x64)', 'Discord'])
    const discord = apps[1]
    expect(discord).toMatchObject({ size: 2048 * 1024, installedAt: '2024-01-31', location: 'C:\\Users\\a\\AppData\\Local\\Discord', forEveryone: false, publisher: 'Discord Inc.' })
    expect(apps[0].forEveryone).toBe(true)
  })

  it('splits uninstall commands', () => {
    expect(splitCommand('"C:\\Program Files\\App\\uninst.exe" /S')).toEqual({ file: 'C:\\Program Files\\App\\uninst.exe', args: '/S' })
    expect(splitCommand('C:\\Program Files\\App\\uninst.exe /S')).toEqual({ file: 'C:\\Program Files\\App\\uninst.exe', args: '/S' })
    expect(splitCommand('C:\\Program Files\\App\\uninst.exe')).toEqual({ file: 'C:\\Program Files\\App\\uninst.exe', args: '' })
    expect(splitCommand('MsiExec.exe /I{1234-ABCD}')).toEqual({ file: 'MsiExec.exe', args: '/X{1234-ABCD}' })
    expect(splitCommand('MsiExec.exe /X{1234-ABCD}')).toEqual({ file: 'MsiExec.exe', args: '/X{1234-ABCD}' })
    expect(splitCommand('"C:\\a\\Update.exe" --uninstall -s')).toEqual({ file: 'C:\\a\\Update.exe', args: '--uninstall -s' })
    expect(splitCommand('"unclosed')).toBe(null)
    expect(splitCommand('  ')).toBe(null)
  })

  it('reads dates, icons and registry listings', () => {
    expect(installDate('20231105')).toBe('2023-11-05')
    expect(installDate('5/11/2023')).toBe(undefined)
    expect(iconFile('"C:\\x\\app.exe",0')).toBe('C:\\x\\app.exe')
    expect(iconFile('C:\\x\\app.ico')).toBe('C:\\x\\app.ico')
    expect(iconFile('%SystemRoot%\\x.dll,-3')).toBe(undefined)
    const text = '\r\nHKEY_CURRENT_USER\\Software\\Discord\r\nHKEY_CURRENT_USER\\Software\\Microsoft\r\n    (Default)    REG_SZ    x\r\n'
    expect(parseRegQuery(text, 'HKEY_CURRENT_USER\\Software')).toEqual(['HKEY_CURRENT_USER\\Software\\Discord', 'HKEY_CURRENT_USER\\Software\\Microsoft'])
  })
})

describe('Mac', () => {
  it('reads an app’s Info.plist and leaves macOS’s own apps out', () => {
    expect(fromInfoPlist('/Applications/Spotify.app', { CFBundleIdentifier: 'com.spotify.client', CFBundleName: 'Spotify', CFBundleShortVersionString: '1.2' })).toEqual({
      id: '/Applications/Spotify.app',
      name: 'Spotify',
      bundleId: 'com.spotify.client',
      version: '1.2',
      location: '/Applications/Spotify.app'
    })
    expect(fromInfoPlist('/Applications/Safari.app', { CFBundleIdentifier: 'com.apple.Safari' })).toBe(null)
    expect(fromInfoPlist('/Applications/Thing.app', {})?.name).toBe('Thing')
  })

  it('knows when an app is open', () => {
    const ps = '/sbin/launchd\n/Applications/Spotify.app/Contents/MacOS/Spotify\n/Applications/Spotify Helper.app/x\n'
    expect(runningFrom(ps, '/Applications/Spotify.app')).toBe(true)
    expect(runningFrom(ps, '/Applications/Zoom.app')).toBe(false)
  })
})

describe('the page', () => {
  const apps: InstalledApp[] = [
    { id: '1', name: 'Zoom', size: 300, installedAt: '2024-01-01', publisher: 'Zoom Video' },
    { id: '2', name: 'audacity', size: 900, installedAt: '2023-01-01' },
    { id: '3', name: 'Blender', installedAt: '2025-01-01' }
  ]
  it('searches and sorts', () => {
    expect(searchApps(apps, 'zoom vid').map((a) => a.id)).toEqual(['1'])
    expect(searchApps(apps, '').length).toBe(3)
    expect(sortApps(apps, 'name').map((a) => a.id)).toEqual(['2', '3', '1'])
    expect(sortApps(apps, 'size').map((a) => a.id)).toEqual(['2', '1', '3'])
    expect(sortApps(apps, 'date').map((a) => a.id)).toEqual(['3', '1', '2'])
  })
  it('shows sizes', () => {
    expect(formatSize(undefined)).toBe('')
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(2048)).toBe('2 KB')
    expect(formatSize(5.5 * 1024 * 1024)).toBe('5.5 MB')
    expect(formatSize(300 * 1024 * 1024 * 1024)).toBe('300 GB')
    const items = [
      { id: 'a', path: 'x', kind: 'folder' as const, where: 'w', size: 10 },
      { id: 'b', path: 'y', kind: 'file' as const, where: 'w', size: 5 },
      { id: 'c', path: 'z', kind: 'registry' as const, where: 'w' }
    ]
    expect(totalSize(items, new Set(['a', 'c']))).toBe(10)
  })
})
