import { ipcMain, type BrowserWindow } from 'electron'
import type { DropTarget } from '@shared/types'
import { linkedPeer, onLinkChange, sendFilesToPeer } from './mouseShare'
import { offerToPhone, onPhoneCount, phoneConnected } from './phonePair'

/**
 * Drop between devices, AirDrop-style: drag files onto the MacBook (or PC) or the phone in Orbit and
 * they turn up there. The other computer gets them in its Downloads (over the mouse-sharing link);
 * the phone gets a Save button for each on its Orbit page.
 */

function targets(): DropTarget[] {
  const out: DropTarget[] = []
  const peer = linkedPeer()
  if (peer) out.push({ id: 'computer', name: peer.name, os: peer.os })
  if (phoneConnected()) out.push({ id: 'phone', name: 'Phone' })
  return out
}

async function send(target: DropTarget['id'], paths: string[]): Promise<string> {
  const files = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && p).slice(0, 500)
  if (!files.length) throw new Error('Only files can be sent.')
  if (target === 'phone') {
    const count = await offerToPhone(files)
    return count === 1 ? 'Sent to your phone. Tap Save there.' : `Sent ${count} files to your phone. Tap Save there.`
  }
  const peer = linkedPeer()
  if (!peer) throw new Error('Your other computer isn’t connected. Turn on “Share mouse and keyboard” on both (Settings → Two computers).')
  await sendFilesToPeer(files)
  return `Sent to ${peer.name}. It’s in Downloads there.`
}

export function setupDeviceDrop(mainWindow: () => BrowserWindow | null): void {
  const announce = (): void => {
    const win = mainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('drop:targets', targets())
  }
  onLinkChange(announce)
  onPhoneCount(announce)
  ipcMain.handle('drop:targets', () => targets())
  ipcMain.handle('drop:send', (_e, target: DropTarget['id'], paths: string[]) => send(target === 'phone' ? 'phone' : 'computer', paths))
}
