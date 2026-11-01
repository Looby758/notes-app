import { app, BrowserWindow, dialog, globalShortcut, ipcMain, shell } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { basename, extname, join } from 'path'
import {
  boardHotkeys,
  cleanBoard,
  EMPTY_HOTKEYS,
  hotkeyLabel,
  nameFromFile,
  normalizeAccelerator,
  SOUND_COLOURS,
  SOUND_LIMIT,
  SOUND_MAX_BYTES,
  SOUND_TYPES,
  type BoardHotkeys,
  type SoundboardAction,
  type SoundboardData,
  type SoundboardStatus,
  type SoundClip
} from '@shared/soundboard'
import { SYSTEM_NAME } from '@shared/platform'
import { logError } from './log'

/**
 * The soundboard's main-process side: the clips (copied into Orbit's folder, listed in board.json)
 * and their system-wide hotkeys. A hotkey tells the window, which plays the sound: all the audio
 * (mic, voice changer, clips, music) is in the renderer, in lib/soundboard.ts.
 */

const folder = (): string => join(app.getPath('userData'), 'soundboard')
const clipsFolder = (): string => join(folder(), 'clips')
const boardFile = (): string => join(folder(), 'board.json')

let board: SoundboardData = { clips: [], hotkeys: { ...EMPTY_HOTKEYS } }
/** Hotkeys this file registered (accelerator → what it does). */
const registered = new Map<string, SoundboardAction>()
const hotkeyErrors: Record<string, string> = {}

function load(): void {
  try {
    board = cleanBoard(JSON.parse(readFileSync(boardFile(), 'utf8')))
  } catch {
    board = { clips: [], hotkeys: { ...EMPTY_HOTKEYS } }
  }
}

function save(): void {
  mkdirSync(folder(), { recursive: true })
  const tmp = `${boardFile()}.tmp`
  writeFileSync(tmp, JSON.stringify(board, null, 2))
  renameSync(tmp, boardFile())
}

/** The full path of a clip's file, only for files the board lists. */
export function soundFile(file: string): string | null {
  if (!board.clips.some((c) => c.file === file)) return null
  const full = join(clipsFolder(), file)
  return existsSync(full) ? full : null
}

function send(action: SoundboardAction): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('soundboard:hotkey', action)
}

const errorKey = (a: SoundboardAction): string => (a.kind === 'clip' ? a.id : a.kind)

/** Makes the registered hotkeys match the board: frees ones no longer used, takes new ones. */
function applyHotkeys(): void {
  const wanted = boardHotkeys(board)
  for (const [accel] of registered) {
    if (!wanted.has(accel)) {
      globalShortcut.unregister(accel)
      registered.delete(accel)
    }
  }
  for (const k of Object.keys(hotkeyErrors)) delete hotkeyErrors[k]
  for (const [accel, action] of wanted) {
    const before = registered.get(accel)
    if (before) {
      // Same keys, maybe now for something else: the callback reads the map, so just update it.
      registered.set(accel, action)
      continue
    }
    try {
      if (globalShortcut.register(accel, () => send(registered.get(accel) ?? action))) registered.set(accel, action)
      else hotkeyErrors[errorKey(action)] = `${hotkeyLabel(accel)} is already used by ${SYSTEM_NAME} or another app. Pick different keys.`
    } catch {
      hotkeyErrors[errorKey(action)] = `${hotkeyLabel(accel)} can’t be used as a hotkey.`
    }
  }
}

const status = (): SoundboardStatus => ({ board, hotkeyErrors: { ...hotkeyErrors } })

function changed(): SoundboardStatus {
  save()
  applyHotkeys()
  const s = status()
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('soundboard:changed', s)
  return s
}

/** The soundboard's folder (board.json and the clips), for syncing with your other computers. */
export const soundboardFolder = folder

/** The folder was replaced (synced from another computer): read it again and tell the windows. */
export function reloadSoundboard(): void {
  load()
  applyHotkeys()
  const s = status()
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('soundboard:changed', s)
}

/** Copies sound files into the soundboard folder and adds a button for each. */
function addFiles(paths: string[]): { status: SoundboardStatus; skipped: string[] } {
  mkdirSync(clipsFolder(), { recursive: true })
  const skipped: string[] = []
  for (const path of paths) {
    const name = basename(path)
    const ext = extname(path).toLowerCase()
    if (board.clips.length >= SOUND_LIMIT) {
      skipped.push(`${name} (the board is full: ${SOUND_LIMIT} sounds)`)
      continue
    }
    if (!SOUND_TYPES.includes(ext)) {
      skipped.push(`${name} (not a sound file Orbit can play)`)
      continue
    }
    try {
      const st = statSync(path)
      if (!st.isFile()) throw new Error('not a file')
      if (st.size > SOUND_MAX_BYTES) {
        skipped.push(`${name} (bigger than ${Math.round(SOUND_MAX_BYTES / 1024 / 1024)} MB)`)
        continue
      }
      const id = randomUUID().slice(0, 12)
      const file = `${id}${ext}`
      copyFileSync(path, join(clipsFolder(), file))
      const clip: SoundClip = {
        id,
        file,
        name: nameFromFile(name),
        hotkey: '',
        volume: 1,
        colour: SOUND_COLOURS[board.clips.length % SOUND_COLOURS.length],
        emoji: ''
      }
      board = { ...board, clips: [...board.clips, clip] }
    } catch (err) {
      logError('soundboard', err)
      skipped.push(`${name} (couldn’t be copied)`)
    }
  }
  return { status: changed(), skipped }
}

export function setupSoundboard(): void {
  load()
  applyHotkeys()

  ipcMain.handle('soundboard:get', () => status())
  // The Discord voice pop-out's buttons: the main window (which makes the sound) plays them.
  ipcMain.handle('soundboard:trigger', (_e, action: SoundboardAction) => {
    if (action && (action.kind === 'stopAll' || (action.kind === 'clip' && typeof action.id === 'string'))) send(action)
  })
  ipcMain.handle('soundboard:pick', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const opts = {
      title: 'Add sounds to the soundboard',
      properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
      filters: [{ name: 'Sounds', extensions: SOUND_TYPES.map((t) => t.slice(1)) }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return { status: status(), skipped: [] }
    return addFiles(res.filePaths)
  })
  ipcMain.handle('soundboard:add-files', (_e, paths: unknown) => addFiles(Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string').slice(0, 100) : []))
  ipcMain.handle('soundboard:update', (_e, id: string, patch: Partial<Pick<SoundClip, 'name' | 'hotkey' | 'volume' | 'colour' | 'emoji'>>) => {
    // A hotkey moves from whatever had it before.
    const hotkey = typeof patch.hotkey === 'string' ? normalizeAccelerator(patch.hotkey) : undefined
    const hotkeys: BoardHotkeys = { ...board.hotkeys }
    if (hotkey) for (const k of Object.keys(hotkeys) as (keyof BoardHotkeys)[]) if (hotkeys[k] === hotkey) hotkeys[k] = ''
    const clips = board.clips.map((c) => {
      if (c.id === id) {
        const p = patch ?? {}
        return {
          ...c,
          ...(typeof p.name === 'string' ? { name: p.name } : {}),
          ...(typeof p.volume === 'number' ? { volume: p.volume } : {}),
          ...(typeof p.colour === 'string' ? { colour: p.colour } : {}),
          ...(typeof p.emoji === 'string' ? { emoji: p.emoji } : {}),
          ...(hotkey !== undefined ? { hotkey } : {})
        }
      }
      return hotkey && c.hotkey === hotkey ? { ...c, hotkey: '' } : c
    })
    board = cleanBoard({ clips, hotkeys })
    return changed()
  })
  ipcMain.handle('soundboard:board-hotkey', (_e, which: keyof BoardHotkeys, accel: string) => {
    if (!(which in EMPTY_HOTKEYS)) return status()
    const hotkey = normalizeAccelerator(String(accel))
    const hotkeys: BoardHotkeys = { ...board.hotkeys }
    if (hotkey) for (const k of Object.keys(hotkeys) as (keyof BoardHotkeys)[]) if (hotkeys[k] === hotkey) hotkeys[k] = ''
    hotkeys[which] = hotkey
    board = cleanBoard({ clips: board.clips.map((c) => (hotkey && c.hotkey === hotkey ? { ...c, hotkey: '' } : c)), hotkeys })
    return changed()
  })
  ipcMain.handle('soundboard:remove', (_e, id: string) => {
    const clip = board.clips.find((c) => c.id === id)
    if (!clip) return status()
    board = { ...board, clips: board.clips.filter((c) => c.id !== id) }
    try {
      unlinkSync(join(clipsFolder(), clip.file))
    } catch {
      // Already gone.
    }
    return changed()
  })
  ipcMain.handle('soundboard:move', (_e, id: string, to: number) => {
    const from = board.clips.findIndex((c) => c.id === id)
    if (from < 0) return status()
    const clips = [...board.clips]
    const [clip] = clips.splice(from, 1)
    clips.splice(Math.max(0, Math.min(clips.length, Math.round(to))), 0, clip)
    board = { ...board, clips }
    return changed()
  })
  ipcMain.handle('soundboard:open-link', (_e, which: 'cable' | 'blackhole') => {
    const links = { cable: 'https://vb-audio.com/Cable/', blackhole: 'https://existential.audio/blackhole/' }
    if (links[which]) void shell.openExternal(links[which])
  })
  ipcMain.handle('soundboard:show-folder', () => {
    mkdirSync(clipsFolder(), { recursive: true })
    void shell.openPath(clipsFolder())
  })
}
