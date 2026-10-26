import { app, nativeImage, shell, type NativeImage } from 'electron'
import { execFile } from 'child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { logError } from './log'

/**
 * The app icon you picked, beyond the running window: on Windows the Start menu, desktop and
 * pinned-taskbar shortcuts (which is what the taskbar shows).
 * Only the installed app does this (in development the "app" is electron.exe).
 */

/** An .ico holding PNG images (Windows Vista and later read these), from one big picture. */
export function icoFromImage(image: NativeImage): Buffer {
  const sizes = [256, 64, 48, 32, 24, 16]
  const pngs = sizes.map((s) => image.resize({ width: s, height: s, quality: 'best' }).toPNG())
  const header = Buffer.alloc(6 + 16 * sizes.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // an icon
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((s, i) => {
    const at = 6 + 16 * i
    header.writeUInt8(s >= 256 ? 0 : s, at) // 0 means 256
    header.writeUInt8(s >= 256 ? 0 : s, at + 1)
    header.writeUInt8(0, at + 2)
    header.writeUInt8(0, at + 3)
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(pngs[i].length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += pngs[i].length
  })
  return Buffer.concat([header, ...pngs])
}

/** Folders where Windows keeps shortcuts to Notes. */
function shortcutFolders(): string[] {
  const appData = app.getPath('appData')
  return [
    join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    app.getPath('desktop'),
    join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
    join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch')
  ]
}

const samePath = (a: string, b: string): boolean => a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase()

/** Points every shortcut to Notes at `icon` (an .ico, or Notes.exe for the original). Returns how many changed. */
function updateShortcuts(icon: string): number {
  let changed = 0
  for (const folder of shortcutFolders()) {
    let names: string[] = []
    try {
      names = readdirSync(folder).filter((n) => n.toLowerCase().endsWith('.lnk'))
    } catch {
      continue
    }
    for (const name of names) {
      const file = join(folder, name)
      try {
        const link = shell.readShortcutLink(file)
        if (!samePath(link.target, process.execPath)) continue
        if (link.icon && samePath(link.icon, icon)) continue
        if (!link.icon && samePath(icon, process.execPath)) continue
        if (shell.writeShortcutLink(file, 'update', { ...link, icon, iconIndex: 0 })) changed++
      } catch (err) {
        logError(`shortcut icon (${name})`, err)
      }
    }
  }
  return changed
}

function windowsIcon(id: string, image: NativeImage): void {
  let icon = process.execPath
  if (id !== 'default') {
    const dir = join(app.getPath('userData'), 'app-icons')
    mkdirSync(dir, { recursive: true })
    icon = join(dir, `${id}.ico`)
    if (!existsSync(icon)) writeFileSync(icon, icoFromImage(image))
  }
  // Explorer caches icons: ask it to look again.
  if (updateShortcuts(icon) > 0) execFile('ie4uinit.exe', ['-show'], () => undefined)
}

/**
 * Windows shortcuts follow the icon you picked. (Not done on a Mac: macOS protects apps from being
 * changed, even by themselves, so the Dock icon is all that changes there.)
 */
export function applyIconOutsideApp(id: string, file: string): void {
  if (process.platform !== 'win32') return
  if (!app.isPackaged && !process.env.NOTES_TEST_SHORTCUTS) return
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) return
  if (process.platform === 'win32') windowsIcon(id, image)
}
