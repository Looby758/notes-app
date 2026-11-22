import { BrowserWindow, clipboard, desktopCapturer, globalShortcut, ipcMain, nativeImage, net, Notification, screen } from 'electron'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { hideCaptureWindow, loadRenderer } from './capture'
import { detectScript, ocrLangDir, readPrintedText } from './handwriting'
import { GameRunningError, localAiState, localComplete } from './localAi'
import { logError } from './log'
import { isTarget, OCR_LANGS, ocrLangByCode, ocrLangSetting, ocrLangUrl, onlineTranslateUrl, parseTranslation, readerForScript, tidyReading, TRANSLATE_SYSTEM, translatePrompt } from '@shared/translate'
import type { SnipReading, SnipTranslation } from '@shared/types'
import type { SnipMode } from '@shared/snipLaunch'
import { matchSources } from '@shared/snipDisplays'
import { acceleratorLabel, IS_MAC, SYSTEM_NAME } from '@shared/platform'

/**
 * Screen snip: press the shortcut (Alt+Shift+S by default) over any app, drag a box round some
 * text, and Orbit reads it (offline, with the same reader as scanned receipts). Then copy it, save
 * it to today's note, search or translate it, or ask the AI about it.
 *
 * Translate uses the offline AI, so the text stays on this computer. If the offline AI isn't
 * there (or a game has it switched off), the snip says so and offers to set it up; Google
 * Translate is only used when you press its button.
 *
 * How: a picture of every monitor is taken first, then each is shown full screen in a frameless
 * window on its own monitor, so you're really drawing on a still picture of the screen, on
 * whichever monitor you like.
 *
 * A picture snip (from the taskbar, the tray or "Snip a picture") is the same windows, but letting
 * go of the box copies that part of the screen as a picture and closes, like the Windows Snipping
 * Tool: click, drag, paste anywhere.
 */

/** One snip window per monitor, each over a still picture of its own monitor. */
const wins = new Map<number, BrowserWindow>()
const shots = new Map<number, { png: Buffer; scale: number }>()
let registered = ''
/** What the open snip does with its box. */
let mode: SnipMode = 'text'
let shortcutError: string | undefined

interface Hooks {
  getMain: () => BrowserWindow | null
  showMain: () => void
}
let hooks: Hooks

const openWins = (): BrowserWindow[] => [...wins.values()].filter((w) => !w.isDestroyed())

/** Opening one now (between pressing and the windows existing), so a second press doesn't open two sets. */
let starting = false

export async function startSnip(as: SnipMode = 'text'): Promise<void> {
  const cursor = screen.getCursorScreenPoint()
  const under = screen.getDisplayNearestPoint(cursor)
  if (starting) return
  if (openWins().length) {
    // Already snipping: the windows are one per webContents, so find the one on this monitor.
    const here = openWins().find((w) => {
      const b = w.getBounds()
      return cursor.x >= b.x && cursor.x < b.x + b.width && cursor.y >= b.y && cursor.y < b.y + b.height
    })
    ;(here ?? openWins()[0])?.focus()
    return
  }
  starting = true
  try {
    await openSnip(as, under)
  } finally {
    starting = false
  }
}

async function openSnip(as: SnipMode, under: Electron.Display): Promise<void> {
  mode = as
  hideCaptureWindow()
  const displays = screen.getAllDisplays()
  const pictures = new Map<number, { png: Buffer; scale: number }>()
  try {
    // Give a just-hidden window a moment to leave the screen.
    await new Promise((r) => setTimeout(r, 120))
    // Big enough for the largest monitor at full resolution (each picture keeps its own shape).
    const thumbnailSize = {
      width: Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor))),
      height: Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)))
    }
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
    const matched = matchSources(
      displays.map((d) => d.id),
      sources
    )
    for (const d of displays) {
      const source = matched.get(d.id)
      if (!source || source.thumbnail.isEmpty()) continue
      const width = Math.round(d.size.width * d.scaleFactor)
      const height = Math.round(d.size.height * d.scaleFactor)
      const size = source.thumbnail.getSize()
      // A smaller monitor's picture may come back bigger than the monitor: bring it to size.
      const pic = size.width > width ? source.thumbnail.resize({ width, height, quality: 'best' }) : source.thumbnail
      pictures.set(d.id, { png: pic.toPNG(), scale: d.scaleFactor })
    }
    if (!pictures.size) throw new Error('no picture')
  } catch (err) {
    logError('screen snip', err)
    hooks.showMain()
    hooks
      .getMain()
      ?.webContents.send(
        'snip:failed',
        IS_MAC
          ? 'Orbit isn’t allowed to see the screen yet. Turn it on in System Settings → Privacy & Security → Screen Recording, then try again.'
          : 'Couldn’t take a picture of the screen. Try again.'
      )
    return
  }

  for (const display of displays) {
    const picture = pictures.get(display.id)
    if (!picture) continue
    const w = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      alwaysOnTop: true,
      backgroundColor: '#000000',
      title: 'Screen snip',
      ...(IS_MAC ? { type: 'panel' } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    const contentsId = w.webContents.id
    wins.set(contentsId, w)
    shots.set(contentsId, picture)
    w.setAlwaysOnTop(true, 'screen-saver')
    if (IS_MAC) w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    w.setBounds(display.bounds)
    w.on('closed', () => {
      wins.delete(contentsId)
      shots.delete(contentsId)
      // Closing one (Esc, or done with it) closes the snip on every monitor.
      closeSnip()
    })
    const isUnder = display.id === under.id
    w.webContents.once('did-finish-load', () => {
      if (w.isDestroyed()) return
      if (isUnder) {
        w.show()
        w.focus()
      } else w.showInactive()
    })
    loadRenderer(w, 'snip')
  }
}

const ocrFile = (code: string): string => join(ocrLangDir(), `${code}.traineddata.gz`)
const ocrDownloaded = (code: string | undefined): boolean => !!ocrLangByCode(code) && existsSync(ocrFile(code!))

/** Downloads one language reader (a couple of MB), checking its size and SHA-256 before it's used. */
async function getOcrLang(code: string): Promise<{ ok: true } | { error: string }> {
  const lang = ocrLangByCode(code)
  if (!lang) return { error: 'Orbit doesn’t have a reader for that language.' }
  if (ocrDownloaded(code)) return { ok: true }
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 120_000)
  try {
    const res = await net.fetch(ocrLangUrl(lang), { signal: abort.signal })
    if (!res.ok) return { error: `The download didn’t work (${res.status}). Try again.` }
    const data = Buffer.from(await res.arrayBuffer())
    if (data.length !== lang.bytes || createHash('sha256').update(data).digest('hex') !== lang.sha256) {
      return { error: 'The download was damaged or changed, so it wasn’t used. Try again.' }
    }
    mkdirSync(ocrLangDir(), { recursive: true })
    const tmp = `${ocrFile(code)}.part`
    writeFileSync(tmp, data)
    renameSync(tmp, ocrFile(code))
    return { ok: true }
  } catch (err) {
    logError('snip reader download', err)
    return { error: abort.signal.aborted ? 'The download took too long. Check your internet and try again.' : 'Couldn’t download it. Check your internet and try again.' }
  } finally {
    clearTimeout(timer)
  }
}

/** Translate, on the offline AI only. Never goes online: when it can't, it says why, and the snip offers the choices. */
async function translate(text: string, target: string): Promise<SnipTranslation> {
  const state = localAiState()
  if (state.state === 'unsupported') return { problem: 'unsupported', error: 'The offline AI doesn’t run on this computer, so it can’t translate here.' }
  if (state.state === 'downloading') return { problem: 'downloading', error: 'The offline AI is still downloading. Try again when it’s done (Settings → AI helper shows how far it is).' }
  if (state.state !== 'ready') return { problem: 'missing', error: 'Translating needs the offline AI.' }
  try {
    const reply = await localComplete(
      [
        { role: 'system', content: TRANSLATE_SYSTEM },
        { role: 'user', content: translatePrompt(text, target) }
      ],
      { maxTokens: 2000, temperature: 0.1 }
    )
    const out = parseTranslation(reply)
    if (!out.text) return { problem: 'failed', error: 'The offline AI didn’t send a translation back. Try again.' }
    return { from: out.from, text: out.text }
  } catch (err) {
    if (err instanceof GameRunningError) return { problem: 'game', error: err.message }
    logError('snip translate', err)
    return { problem: 'failed', error: err instanceof Error ? err.message : 'The offline AI couldn’t translate that. Try again.' }
  }
}

/** Spotting the alphabet works better on bigger letters, so a small snip is made twice the size for it. */
function forDetecting(png: Uint8Array): Uint8Array {
  try {
    const img = nativeImage.createFromBuffer(Buffer.from(png))
    const { width } = img.getSize()
    if (!width || width >= 1600) return png
    return new Uint8Array(img.resize({ width: width * 2, quality: 'best' }).toPNG())
  } catch {
    return png
  }
}

/** A small "Copied" note with the picture, so you know it worked (it goes away by itself). */
function copiedNote(image: Electron.NativeImage): void {
  if (!Notification.isSupported()) return
  try {
    const { width, height } = image.getSize()
    const n = new Notification({
      title: 'Snip copied',
      body: `${width} × ${height}. Paste it anywhere with ${IS_MAC ? '⌘V' : 'Ctrl+V'}.`,
      icon: image.resize(width >= height ? { width: Math.min(width, 256) } : { height: Math.min(height, 256) }),
      silent: true,
      timeoutType: 'default'
    })
    n.show()
    setTimeout(() => n.close(), 6000)
  } catch (err) {
    logError('snip copied note', err)
  }
}

function closeSnip(): void {
  for (const w of openWins()) w.close()
}

/** (Re)registers the system-wide snip shortcut. */
export function applySnipShortcut(accel: string): void {
  if (registered === accel) return
  if (registered) globalShortcut.unregister(registered)
  registered = ''
  shortcutError = undefined
  if (!accel) return
  try {
    if (globalShortcut.register(accel, () => void startSnip())) registered = accel
    else shortcutError = `${acceleratorLabel(accel)} is already used by ${SYSTEM_NAME} or another app. Pick a different shortcut.`
  } catch {
    shortcutError = `${acceleratorLabel(accel)} can't be used as a shortcut.`
  }
}

export function setupSnip(h: Hooks): void {
  hooks = h
  ipcMain.handle('snip:start', (_e, as?: SnipMode) => startSnip(as === 'picture' ? 'picture' : 'text'))
  // A picture snip's box (or the text snip's "Copy picture"): onto the clipboard, ready to paste anywhere.
  ipcMain.handle('snip:copyPicture', (_e, png: Uint8Array) => {
    closeSnip()
    if (!(png instanceof Uint8Array) || png.length > 80 * 1024 * 1024) return
    const image = nativeImage.createFromBuffer(Buffer.from(png))
    if (image.isEmpty()) return
    clipboard.writeImage(image)
    copiedNote(image)
  })
  ipcMain.handle('snip:status', () => ({ shortcut: registered ? acceleratorLabel(registered) : '', error: shortcutError }))
  // Each monitor's snip window gets the picture of its own monitor.
  ipcMain.handle('snip:image', (e) => {
    const shot = shots.get(e.sender.id)
    return shot ? { png: new Uint8Array(shot.png), scale: shot.scale, mode } : null
  })
  // A box was started on one monitor: the others drop theirs, so there's only ever one.
  ipcMain.handle('snip:boxing', (e) => {
    for (const [id, w] of wins) if (id !== e.sender.id && !w.isDestroyed()) w.webContents.send('snip:clear')
    wins.get(e.sender.id)?.focus()
  })
  // `lang`: an extra language reader to use with English (only once it's downloaded), or 'auto'
  // to spot the alphabet first and pick the reader for it.
  ipcMain.handle('snip:read', async (_e, png: Uint8Array, lang?: string): Promise<SnipReading> => {
    let code = ocrDownloaded(lang) ? lang : undefined
    let detected: string | undefined
    if (lang === 'auto') {
      const pick = readerForScript(await detectScript(forDetecting(png)), OCR_LANGS.filter((l) => ocrDownloaded(l.code)).map((l) => l.code))
      detected = pick.name || undefined
      // Its reader isn't downloaded: the English reader would only read nonsense, so ask first.
      if (pick.need.length) return { text: '', detected, need: pick.need }
      code = pick.use || undefined
    }
    return { text: tidyReading(await readPrintedText(png, ocrLangSetting(code)), code), lang: code ?? '', detected }
  })
  ipcMain.handle('snip:ocrLangs', () => OCR_LANGS.filter((l) => ocrDownloaded(l.code)).map((l) => l.code))
  ipcMain.handle('snip:getOcrLang', (_e, code: string) => getOcrLang(String(code)))
  ipcMain.handle('snip:translate', (_e, text: string, target: string) => translate(String(text ?? '').trim(), isTarget(target) ? target : 'English'))
  ipcMain.handle('snip:close', () => closeSnip())
  // "Report bug": the boxed part of the screen goes to App Studio as a new bug, with this picture.
  ipcMain.handle('snip:bug', (_e, png: Uint8Array) => {
    closeSnip()
    hooks.showMain()
    const main = hooks.getMain()
    if (main && !main.isDestroyed() && png instanceof Uint8Array && png.length < 40 * 1024 * 1024) main.webContents.send('appstudio:bug', png)
  })
  // What to do with the text: done here so it works whether or not Orbit's window is open.
  ipcMain.handle('snip:send', (_e, action: 'copy' | 'note' | 'web' | 'translate-online' | 'ask' | 'setup-ai', text: string, target?: string) => {
    const t = String(text).slice(0, 20000)
    closeSnip()
    if (action === 'copy') {
      clipboard.writeText(t)
      return
    }
    hooks.showMain()
    const main = hooks.getMain()
    if (!main || main.isDestroyed()) return
    if (action === 'web') main.webContents.send('web:open', `https://www.google.com/search?q=${encodeURIComponent(t.slice(0, 500))}`)
    // Only when you press "Translate online": sends the text to Google Translate.
    else if (action === 'translate-online') main.webContents.send('web:open', onlineTranslateUrl(t, isTarget(target) ? target : 'English'))
    else if (action === 'note' || action === 'ask' || action === 'setup-ai') main.webContents.send('snip:text', action, t)
  })
}
