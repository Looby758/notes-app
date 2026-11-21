import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { accessSync, chmodSync, constants, statSync } from 'fs'
import { homedir } from 'os'
import { dirname, isAbsolute, join } from 'path'
import type { IPty } from 'node-pty'
import type { TerminalStart } from '@shared/types'
import { IS_MAC } from '@shared/platform'
import { logError } from './log'

/**
 * The Terminal tab's command lines (PowerShell on Windows, your usual shell on a Mac). There can be
 * several at once, each with its own id and folder (the notes folder unless another is picked). They
 * only ever run what's typed into them, or what a run button on the Terminal tab types for you.
 */

interface Shell {
  pty: IPty
  owner: WebContents
}

const shells = new Map<string, Shell>()

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

function stop(id: string): void {
  const s = shells.get(id)
  shells.delete(id)
  if (!s) return
  try {
    s.pty.kill()
  } catch {
    // Already gone.
  }
}

function stopAll(): void {
  for (const id of [...shells.keys()]) stop(id)
}

/** The folder to start in: the one asked for if it's there, else the notes folder (or home). */
function startFolder(folder: string | null, notes: string | null): string {
  if (folder && isAbsolute(folder)) {
    try {
      if (statSync(folder).isDirectory()) return folder
    } catch {
      // Gone: use the notes folder instead.
    }
  }
  return notes ?? homedir()
}

async function start(owner: WebContents, id: string, cwd: string, cols: number, rows: number): Promise<TerminalStart> {
  const { name } = shellToRun()
  // Already running (the window was reloaded, or the tab moved): carry on with it.
  const existing = shells.get(id)
  if (existing && existing.owner === owner) return { ok: true, name, resumed: true, folder: cwd }
  stop(id)
  const { file, args } = shellToRun()
  try {
    makeHelperRunnable()
    const { spawn } = await import('node-pty')
    const pty = spawn(file, args, {
      name: 'xterm-256color',
      cols: Math.max(2, cols),
      rows: Math.max(2, rows),
      cwd,
      env: environment()
    })
    const current: Shell = { pty, owner }
    shells.set(id, current)
    pty.onData((data) => {
      // A command line that was stopped or restarted can still flush a little; that's dropped.
      if (shells.get(id) === current && !owner.isDestroyed()) owner.send('term:data', id, data)
    })
    pty.onExit(({ exitCode }) => {
      const now = shells.get(id)
      if (now === current) shells.delete(id)
      // Restarted: a new command line already has this id, and it's still running.
      if (now && now !== current) return
      if (!owner.isDestroyed()) owner.send('term:exit', id, exitCode)
    })
    owner.once('destroyed', () => {
      if (shells.get(id) === current) stop(id)
    })
    return { ok: true, name, resumed: false, folder: cwd }
  } catch (err) {
    logError('terminal', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

const validId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{1,64}$/.test(id)

export function setupTerminal(getFolder: () => string | null): void {
  ipcMain.handle('term:start', (e, id: unknown, folder: unknown, cols: number, rows: number) => {
    if (!validId(id)) throw new Error('Not allowed')
    return start(e.sender, id, startFolder(typeof folder === 'string' ? folder : null, getFolder()), cols, rows)
  })
  ipcMain.handle('term:stop', (e, id: unknown) => {
    if (validId(id) && shells.get(id)?.owner === e.sender) stop(id)
  })
  ipcMain.on('term:input', (e, id: unknown, data: string) => {
    const s = validId(id) ? shells.get(id) : undefined
    if (s?.owner === e.sender && typeof data === 'string') s.pty.write(data)
  })
  ipcMain.on('term:resize', (e, id: unknown, cols: number, rows: number) => {
    const s = validId(id) ? shells.get(id) : undefined
    if (s?.owner === e.sender && cols > 1 && rows > 1) s.pty.resize(cols, rows)
  })
  ipcMain.handle('term:pickFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { title: 'Pick the app’s folder', properties: ['openDirectory'] as 'openDirectory'[] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  ipcMain.handle('term:home', () => homedir())
  app.on('will-quit', stopAll)
}
