import { app, ipcMain, type WebContents } from 'electron'
import { accessSync, chmodSync, constants } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { IPty } from 'node-pty'
import type { TerminalStart } from '@shared/types'
import { IS_MAC } from '@shared/platform'
import { logError } from './log'

/**
 * The Terminal tab: one real command line (PowerShell on Windows, your usual shell on a Mac),
 * started in the notes folder. It only ever runs what you type into the tab; nothing else in the
 * app writes to it.
 */

let shell: { pty: IPty; owner: WebContents } | null = null

function shellToRun(): { file: string; args: string[]; name: string } {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: ['-NoLogo'], name: 'PowerShell' }
  const file = process.env.SHELL || (IS_MAC ? '/bin/zsh' : '/bin/bash')
  // A login shell, so it has the same programs and settings as the Terminal app.
  return { file, args: ['-l'], name: file.slice(file.lastIndexOf('/') + 1) }
}

function environment(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  // Electron's own settings would change how programs started from the terminal behave.
  for (const k of Object.keys(env)) if (k.startsWith('ELECTRON_')) delete env[k]
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = app.getName()
  // Opened from the Dock or Finder, a Mac app gets no language setting, which garbles accented letters.
  if (IS_MAC && !env.LANG) env.LANG = 'en_US.UTF-8'
  return env
}

/** On a Mac node-pty starts shells through a small helper program, which must be runnable. */
function makeHelperRunnable(): void {
  if (!IS_MAC) return
  const helper = join(dirname(require.resolve('node-pty/package.json')), 'prebuilds', `darwin-${process.arch}`, 'spawn-helper').replace(
    'app.asar',
    'app.asar.unpacked'
  )
  try {
    accessSync(helper, constants.X_OK)
  } catch {
    try {
      chmodSync(helper, 0o755)
    } catch (err) {
      logError('terminal helper', err)
    }
  }
}

function stop(): void {
  const s = shell
  shell = null
  if (!s) return
  try {
    s.pty.kill()
  } catch {
    // Already gone.
  }
}

async function start(owner: WebContents, folder: string | null, cols: number, rows: number): Promise<TerminalStart> {
  // Already running (the tab was moved or switched away from and back): carry on with it.
  if (shell && shell.owner === owner) return { ok: true, name: shellToRun().name, resumed: true }
  stop()
  const { file, args, name } = shellToRun()
  try {
    makeHelperRunnable()
    const { spawn } = await import('node-pty')
    const pty = spawn(file, args, {
      name: 'xterm-256color',
      cols: Math.max(2, cols),
      rows: Math.max(2, rows),
      cwd: folder ?? homedir(),
      env: environment()
    })
    const current = { pty, owner }
    shell = current
    pty.onData((data) => {
      if (!owner.isDestroyed()) owner.send('term:data', data)
    })
    pty.onExit(({ exitCode }) => {
      if (shell === current) shell = null
      if (!owner.isDestroyed()) owner.send('term:exit', exitCode)
    })
    owner.once('destroyed', () => {
      if (shell === current) stop()
    })
    return { ok: true, name, resumed: false }
  } catch (err) {
    logError('terminal', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function setupTerminal(getFolder: () => string | null): void {
  ipcMain.handle('term:start', (e, cols: number, rows: number) => start(e.sender, getFolder(), cols, rows))
  ipcMain.handle('term:stop', () => stop())
  ipcMain.on('term:input', (e, data: string) => {
    if (shell?.owner === e.sender) shell.pty.write(data)
  })
  ipcMain.on('term:resize', (e, cols: number, rows: number) => {
    if (shell?.owner === e.sender && cols > 1 && rows > 1) shell.pty.resize(cols, rows)
  })
  app.on('will-quit', stop)
}
