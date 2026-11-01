import { BrowserWindow, dialog, shell, type WebContents } from 'electron'
import { basename, extname } from 'path'
import { FILE_MANAGER } from '@shared/platform'

/**
 * Opening a file in another app (Word, Panels, Preview…). A click inside Orbit never does that by
 * surprise: when `ask` is set, Orbit asks first and offers to just show the file instead.
 * Returns false if you said no.
 */
export async function openOutside(sender: WebContents, full: string, ask: boolean): Promise<boolean> {
  if (ask) {
    const win = BrowserWindow.fromWebContents(sender)
    const ext = extname(full).slice(1).toLowerCase()
    const options = {
      type: 'question' as const,
      buttons: ['Open in other app', `Show in ${FILE_MANAGER}`, 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      message: `Open “${basename(full)}” in another app?`,
      detail: ext
        ? `Orbit can’t show .${ext} files itself, so this opens it in your computer’s usual app for them.`
        : 'Orbit can’t show this file itself, so this opens it in your computer’s usual app for it.'
    }
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    if (response === 1) shell.showItemInFolder(full)
    if (response !== 0) return false
  }
  const error = await shell.openPath(full)
  if (error) throw new Error(error)
  return true
}
