import { BrowserWindow, clipboard, desktopCapturer, globalShortcut, ipcMain, net, screen } from 'electron'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { hideCaptureWindow, loadRenderer } from './capture'
import { ocrLangDir, readPrintedText } from './handwriting'
import { GameRunningError, localAiState, localComplete } from './localAi'
import { logError } from './log'
import { isTarget, OCR_LANGS, ocrLangByCode, ocrLangSetting, ocrLangUrl, onlineTranslateUrl, parseTranslation, tidyReading, TRANSLATE_SYSTEM, translatePrompt } from '@shared/translate'
import type { SnipTranslation } from '@shared/types'
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
 * How: a picture of the screen under the pointer is taken first, then shown full screen in a
 * frameless window, so you're really drawing on a still picture of the screen.
 */

let win: BrowserWindow | null = null
let shot: { png: Buffer; scale: number } | null = null
let registered = ''
let shortcutError: string | undefined

interface Hooks {
  getMain: () => BrowserWindow | null
  showMain: () => void
}
let hooks: Hooks

export async function startSnip(): Promise<void> {
  if (win && !win.isDestroyed()) {
    win.focus()
    return
  }
  hideCaptureWindow()
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { width, height } = display.size
  const scale = display.scaleFactor
  try {
    // Give a just-hidden window a moment to leave the screen.
    await new Promise((r) => setTimeout(r, 120))
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) } })
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    if (!source || source.thumbnail.isEmpty()) throw new Error('no picture')
    shot = { png: source.thumbnail.toPNG(), scale }
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

  win = new BrowserWindow({
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
  win.setAlwaysOnTop(true, 'screen-saver')
  if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setBounds(display.bounds)
  win.on('closed', () => {
    win = null
    shot = null
  })
  const w = win
  w.webContents.once('did-finish-load', () => {
    w.show()
    w.focus()
  })
  loadRenderer(w, 'snip')
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

function closeSnip(): void {
  win?.close()
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
  ipcMain.handle('snip:start', () => startSnip())
  ipcMain.handle('snip:status', () => ({ shortcut: registered ? acceleratorLabel(registered) : '', error: shortcutError }))
  ipcMain.handle('snip:image', () => (shot ? { png: new Uint8Array(shot.png), scale: shot.scale } : null))
  // `lang`: an extra language reader to use with English (only once it's downloaded).
  ipcMain.handle('snip:read', async (_e, png: Uint8Array, lang?: string) => {
    const code = ocrDownloaded(lang) ? lang : undefined
    return tidyReading(await readPrintedText(png, ocrLangSetting(code)), code)
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
