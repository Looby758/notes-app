import { BrowserWindow, ipcMain, Menu, type MenuItemConstructorOptions } from 'electron'
import type { PopupMenuItem } from '@shared/types'

/**
 * Native menus the UI describes: the Format part of a note's right-click menu (sent over whenever
 * shortcuts change, so the menu can show them), and small menus that buttons pop up.
 */

let formatItems: PopupMenuItem[] = []

/** Settings-style shortcuts ("Ctrl+Shift+H") as Electron accelerators. */
const accelerator = (s?: string): string | undefined => s?.replace(/\bCtrl\b/g, 'CommandOrControl').replace(/\b(Win|Meta)\b/g, 'Super')

export function buildMenu(items: PopupMenuItem[], pick: (id: string) => void): MenuItemConstructorOptions[] {
  return items.map((it): MenuItemConstructorOptions => {
    if (it === 'separator') return { type: 'separator' }
    if (it.submenu) return { label: it.label, submenu: buildMenu(it.submenu, pick) }
    return { label: it.label, accelerator: accelerator(it.accelerator), registerAccelerator: false, click: () => it.id && pick(it.id) }
  })
}

/** The Format items for a note's right-click menu (when text is selected). */
export const formatMenuFor = (win: BrowserWindow): MenuItemConstructorOptions[] =>
  formatItems.length ? [...buildMenu(formatItems, (id) => win.webContents.send('format:run', id)), { type: 'separator' }] : []

export function setupMenus(): void {
  ipcMain.on('format:menu', (_e, items: PopupMenuItem[]) => {
    formatItems = Array.isArray(items) ? items : []
  })
  // A menu popped up by a button at (x, y) in the page; resolves to the chosen item's id, or null.
  ipcMain.handle('menu:popup', (event, items: PopupMenuItem[], x: number, y: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const zoom = event.sender.getZoomFactor()
    return new Promise<string | null>((resolve) => {
      const menu = Menu.buildFromTemplate(buildMenu(items, (id) => resolve(id)))
      // The menu closes before its click handler runs on some systems: wait a moment before giving up.
      menu.popup({ window: win, x: Math.round(x * zoom), y: Math.round(y * zoom), callback: () => setTimeout(() => resolve(null), 100) })
    })
  })
}
