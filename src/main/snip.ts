import { app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, nativeImage, net, screen, shell } from 'electron'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { hideCaptureWindow, loadRenderer } from './capture'
import { detectScript, ocrLangDir, readPrintedText } from './handwriting'
import { GameRunningError, localAiState, localComplete } from './localAi'
import { logError } from './log'
import { isTarget, OCR_LANGS, ocrLangByCode, ocrLangSetting, ocrLangUrl, onlineTranslateUrl, parseTranslation, readerForScript, tidyReading, TRANSLATE_SYSTEM, translatePrompt } from '@shared/translate'
import type { SnipReading, SnipTranslation } from '@shared/types'
import { cleanSnipDelay, snipFileName, type SnipMode } from '@shared/snipLaunch'
import type { Prefs } from '@shared/prefs'
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
 * Tool: click, drag, paste anywhere. No notification pops up: it's just on the clipboard.
 */

/** A still picture of one monitor, as raw pixels (no PNG to encode or decode, so it's quick). */
interface Shot {
  bitmap: Buffer
  width: number
  height: number
  scale: number
}

/**
 * Snip windows are made ahead of time, one per monitor, and kept hidden with their page loaded,
 * so a snip only has to take the picture and show them: no window to make or page to load, and
 * no black screen while it does. Each is shown only once its picture is drawn.
 */
const ready = new Map<number, BrowserWindow>()
/** The monitor's size and place each ready window was made for (a window's own bounds can read a little differently). */
const madeFor = new WeakMap<BrowserWindow, Electron.Rectangle>()
/** Every snip window, by webContents id (what their calls come from). */
const wins = new Map<number, BrowserWindow>()
/** This snip's picture for each window, by webContents id. */
const shots = new Map<number, Shot>()
/** The windows in the snip that's open now. */
const active = new Set<BrowserWindow>()
/** The monitor the pointer was on, whose window gets the keyboard. */
let focusDisplay = -1
let registered = ''
/** What the open snip does with its box. */
let mode: SnipMode = 'text'
let shortcutError: string | undefined

interface Hooks {
  getMain: () => BrowserWindow | null
  showMain: () => void
  prefs: () => Prefs
}
let hooks: Hooks

const openWins = (): BrowserWindow[] => [...active].filter((w) => !w.isDestroyed())

/** Opening one now (between pressing and the windows showing), so a second press doesn't open two. */
let starting = false

/**
 * Starts a snip. A picture snip waits for the delay in Settings first (none by default); `delay`
 * (seconds) overrides that, e.g. "Snip after a delay → 5 seconds" from the tray.
 */
export async function startSnip(as: SnipMode = 'text', delay?: number): Promise<void> {
  // Pressed again while counting down: snip now.
  if (countdown) {
    finishCountdown()
    return
  }
  const wait = cleanSnipDelay(delay ?? (as === 'picture' ? hooks.prefs().snipDelay : 0))
  if (wait > 0 && !starting && !openWins().length) {
    beginCountdown(as, wait)
    return
  }
  await snipNow(as)
}

/** The countdown before a delayed snip: a small pill at the bottom of the screen you're on. */
let countdown: { win: BrowserWindow; timer: NodeJS.Timeout; mode: SnipMode; left: number } | null = null

const countdownPage = (seconds: number): string => `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:600 14px/1 system-ui,-apple-system,'Segoe UI',sans-serif;user-select:none}
.pill{box-sizing:border-box;height:100%;display:flex;align-items:center;gap:10px;padding:0 8px 0 16px;border-radius:999px;background:rgba(22,23,29,.92);color:#eceef3;border:1px solid rgba(255,255,255,.12)}
.n{display:inline-block;min-width:1.2em;text-align:center;color:#4ade80;font-size:18px;font-variant-numeric:tabular-nums}
a{margin-left:auto;padding:6px 10px;border-radius:999px;color:#eceef3;background:rgba(255,255,255,.1);text-decoration:none;font-weight:500;font-size:12.5px}
a:hover{background:rgba(255,255,255,.18)}
</style></head><body><div class="pill">Snipping in <span class="n" id="n">${seconds}</span><a href="orbit-snip:cancel" title="Don’t snip">Cancel</a></div></body></html>`

function beginCountdown(as: SnipMode, seconds: number): void {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const width = 230
  const height = 44
  const win = new BrowserWindow({
    x: Math.round(area.x + (area.width - width) / 2),
    y: area.y + area.height - height - 24,
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    // Never takes the focus, so whatever you're hovering over (a menu, a tooltip) stays open.
    focusable: false,
    title: 'Snip countdown',
    ...(IS_MAC ? { type: 'panel' } : {}),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // "Cancel" is a link: it's caught here instead of going anywhere.
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault()
    if (url === 'orbit-snip:cancel') cancelCountdown()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.once('ready-to-show', () => !win.isDestroyed() && win.showInactive())
  win.on('closed', () => {
    if (countdown?.win === win) {
      clearInterval(countdown.timer)
      countdown = null
    }
  })
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(countdownPage(seconds))}`)
  const timer = setInterval(() => {
    if (!countdown) return
    countdown.left--
    if (countdown.left <= 0) finishCountdown()
    else if (!win.isDestroyed()) void win.webContents.executeJavaScript(`document.getElementById('n').textContent = ${countdown.left}`).catch(() => undefined)
  }, 1000)
  countdown = { win, timer, mode: as, left: seconds }
}

function cancelCountdown(): void {
  if (!countdown) return
  const { win, timer } = countdown
  countdown = null
  clearInterval(timer)
  if (!win.isDestroyed()) win.destroy()
}

/** Time's up (or pressed again): the pill goes, then the screen is frozen without it. */
function finishCountdown(): void {
  if (!countdown) return
  const { mode: as } = countdown
  cancelCountdown()
  // Give the pill a moment to leave the screen, so it isn't in the picture.
  setTimeout(() => void snipNow(as), 150)
}

async function snipNow(as: SnipMode): Promise<void> {
  const cursor = screen.getCursorScreenPoint()
  const under = screen.getDisplayNearestPoint(cursor)
  if (starting) return
  if (openWins().length) {
    // Already snipping: focus the one on this monitor.
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

const sameBounds = (a: Electron.Rectangle, b: Electron.Rectangle): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

/** A hidden snip window for this monitor, with its page loading or loaded. */
function windowFor(display: Electron.Display): BrowserWindow {
  const have = ready.get(display.id)
  if (have && !have.isDestroyed()) {
    const was = madeFor.get(have)
    if (was && sameBounds(was, display.bounds)) return have
    have.destroy()
  }
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
      sandbox: true,
      // Hidden between snips: it must still draw the next picture before it's shown.
      backgroundThrottling: false
    }
  })
  const contentsId = w.webContents.id
  madeFor.set(w, { ...display.bounds })
  ready.set(display.id, w)
  wins.set(contentsId, w)
  w.setAlwaysOnTop(true, 'screen-saver')
  if (IS_MAC) w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  w.setBounds(display.bounds)
  w.on('closed', () => {
    wins.delete(contentsId)
    shots.delete(contentsId)
    if (ready.get(display.id) === w) ready.delete(display.id)
    const wasOpen = active.delete(w)
    // Closed while snipping (Alt+F4): end the snip on every monitor.
    if (wasOpen) endSnip()
  })
  // Its page stopped: make a fresh one next time.
  w.webContents.on('render-process-gone', () => {
    if (!w.isDestroyed()) w.destroy()
  })
  loadRenderer(w, 'snip')
  return w
}

/** Makes (or puts right) the hidden snip windows: one per monitor, none for unplugged ones. */
function warm(): void {
  if (openWins().length || starting || closingDown) return
  const displays = screen.getAllDisplays()
  for (const [id, w] of ready) if (!displays.some((d) => d.id === id) && !w.isDestroyed()) w.destroy()
  for (const d of displays) windowFor(d)
}
/** Orbit's last other window has closed: the hidden snip windows go too, so Orbit can quit. */
let closingDown = false
function closeWithLastWindow(): void {
  const others = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && !wins.has(w.webContents.id))
  if (others.length) return
  closingDown = true
  clearTimeout(warmTimer)
  for (const w of [...wins.values()]) if (!w.isDestroyed()) w.destroy()
}
let warmTimer: NodeJS.Timeout | undefined
const warmSoon = (ms = 1500): void => {
  clearTimeout(warmTimer)
  warmTimer = setTimeout(() => {
    try {
      warm()
    } catch (err) {
      logError('snip windows', err)
    }
  }, ms)
}

async function openSnip(as: SnipMode, under: Electron.Display): Promise<void> {
  mode = as
  // Give the summon bar, if it was up, a moment to leave the screen (otherwise no waiting).
  if (hideCaptureWindow()) await new Promise((r) => setTimeout(r, 120))
  const displays = screen.getAllDisplays()
  const pictures = new Map<number, Shot>()
  try {
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
      pictures.set(d.id, { bitmap: pic.toBitmap(), ...pic.getSize(), scale: d.scaleFactor })
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

  focusDisplay = under.id
  for (const display of displays) {
    const picture = pictures.get(display.id)
    if (!picture) continue
    const w = windowFor(display)
    w.setBounds(display.bounds)
    shots.set(w.webContents.id, picture)
    active.add(w)
    // A loaded page is told there's a new picture; one still loading asks for it as it starts.
    if (!w.webContents.isLoading()) w.webContents.send('snip:new')
  }
}

/** A window's picture is drawn: show it (see-through for a moment, until it has painted on screen). */
function showDrawn(w: BrowserWindow): void {
  if (w.isDestroyed() || !active.has(w) || w.isVisible()) return
  const display = [...ready.entries()].find(([, x]) => x === w)?.[0]
  w.setOpacity(0)
  if (display === focusDisplay) {
    w.show()
    w.focus()
  } else w.showInactive()
  w.webContents.send('snip:visible')
  // In case the page doesn't say it has painted.
  setTimeout(() => !w.isDestroyed() && w.setOpacity(1), 250)
}

/** Where picture snips are saved: the folder you picked, or Pictures/Screenshots (where Windows keeps its own). */
export function snipFolder(): string {
  return hooks.prefs().snipFolder || join(app.getPath('pictures'), 'Screenshots')
}

/** Opens the snips folder in File Explorer / Finder (made first if it isn't there yet). */
export async function openSnipFolder(): Promise<void> {
  const folder = snipFolder()
  await mkdir(folder, { recursive: true }).catch(() => undefined)
  const err = await shell.openPath(folder)
  if (err) logError('open snips folder', err)
}

/** The last picture snip saved this session (Settings → Show the last one). */
let lastSaved: string | null = null

/** Saves a picture snip as "Snip 2026-11-22 09-05-07.png" in the snips folder. */
async function saveSnip(png: Buffer): Promise<void> {
  const folder = snipFolder()
  try {
    await mkdir(folder, { recursive: true })
    const at = new Date()
    for (let n = 1; n < 100; n++) {
      const file = join(folder, snipFileName(at, n))
      try {
        // 'wx': never writes over a file that's already there.
        await writeFile(file, png, { flag: 'wx' })
        lastSaved = file
        return
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      }
    }
  } catch (err) {
    logError('save snip', err)
    hooks.getMain()?.webContents.send('snip:failed', `The snip was copied, but couldn’t be saved in ${folder}. Pick another folder in Settings → Summon bar & snip.`)
  }
}

/** Ends the snip: its windows are hidden and emptied, ready for the next one. */
function endSnip(): void {
  for (const w of openWins()) {
    w.hide()
    w.webContents.send('snip:reset')
  }
  active.clear()
  shots.clear()
  // A monitor added or moved while snipping.
  warmSoon()
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
  // Ready a few seconds after Orbit starts, and again when monitors are plugged in, moved or changed.
  warmSoon(4000)
  // (A Mac app keeps running with no windows, so there they can stay.)
  if (!IS_MAC) {
    const watch = (win: BrowserWindow): void => void win.once('closed', () => setImmediate(closeWithLastWindow))
    BrowserWindow.getAllWindows().forEach(watch)
    app.on('browser-window-created', (_e, win) => watch(win))
  }
  screen.on('display-added', () => warmSoon())
  screen.on('display-removed', () => warmSoon())
  screen.on('display-metrics-changed', () => warmSoon())
  ipcMain.handle('snip:start', (_e, as?: SnipMode, delay?: number) => startSnip(as === 'picture' ? 'picture' : 'text', delay === undefined ? undefined : cleanSnipDelay(delay)))
  // A picture snip's box (or the text snip's "Copy picture"): onto the clipboard, ready to paste anywhere.
  ipcMain.handle('snip:copyPicture', (_e, png: Uint8Array) => {
    endSnip()
    if (!(png instanceof Uint8Array) || png.length > 80 * 1024 * 1024) return
    const image = nativeImage.createFromBuffer(Buffer.from(png))
    if (image.isEmpty()) return
    // Straight onto the clipboard, quietly (no notification)…
    clipboard.writeImage(image)
    // …and saved in the snips folder (Settings → Summon bar & snip).
    if (hooks.prefs().snipSave) void saveSnip(Buffer.from(png))
  })
  ipcMain.handle('snip:saveInfo', () => ({ save: hooks.prefs().snipSave, folder: snipFolder(), custom: !!hooks.prefs().snipFolder, last: lastSaved && existsSync(lastSaved) ? lastSaved : null }))
  // Pick another folder: returns it (Settings saves it), or null if you cancelled.
  ipcMain.handle('snip:pickFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = { title: 'Save snips in', defaultPath: snipFolder(), buttonLabel: 'Save snips here', properties: ['openDirectory', 'createDirectory'] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  })
  ipcMain.handle('snip:openFolder', () => openSnipFolder())
  ipcMain.handle('snip:showLast', () => {
    if (lastSaved && existsSync(lastSaved)) shell.showItemInFolder(lastSaved)
  })
  ipcMain.handle('snip:status', () => ({ shortcut: registered ? acceleratorLabel(registered) : '', error: shortcutError }))
  // Each monitor's snip window gets the picture of its own monitor.
  ipcMain.handle('snip:image', (e) => {
    const shot = shots.get(e.sender.id)
    if (!shot) return null
    const saveTo = mode === 'picture' && hooks.prefs().snipSave ? snipFolder() : undefined
    return { bitmap: new Uint8Array(shot.bitmap.buffer, shot.bitmap.byteOffset, shot.bitmap.byteLength), width: shot.width, height: shot.height, scale: shot.scale, mode, saveTo }
  })
  // Its picture is drawn (still hidden): show it.
  ipcMain.handle('snip:drawn', (e) => {
    const w = wins.get(e.sender.id)
    if (w) showDrawn(w)
  })
  // …and it has painted on screen: now it can be seen.
  ipcMain.handle('snip:painted', (e) => {
    const w = wins.get(e.sender.id)
    if (w && !w.isDestroyed() && active.has(w)) w.setOpacity(1)
  })
  // A box was started on one monitor: the others drop theirs, so there's only ever one.
  ipcMain.handle('snip:boxing', (e) => {
    for (const w of openWins()) if (w.webContents.id !== e.sender.id) w.webContents.send('snip:clear')
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
  ipcMain.handle('snip:close', () => endSnip())
  // "Report bug": the boxed part of the screen goes to App Studio as a new bug, with this picture.
  ipcMain.handle('snip:bug', (_e, png: Uint8Array) => {
    endSnip()
    hooks.showMain()
    const main = hooks.getMain()
    if (main && !main.isDestroyed() && png instanceof Uint8Array && png.length < 40 * 1024 * 1024) main.webContents.send('appstudio:bug', png)
  })
  // What to do with the text: done here so it works whether or not Orbit's window is open.
  ipcMain.handle('snip:send', (_e, action: 'copy' | 'note' | 'web' | 'translate-online' | 'ask' | 'setup-ai', text: string, target?: string) => {
    const t = String(text).slice(0, 20000)
    endSnip()
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
