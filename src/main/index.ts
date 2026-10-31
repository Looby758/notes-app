import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  systemPreferences,
  nativeTheme,
  net,
  protocol,
  screen,
  session,
  shell,
  webContents,
  type MenuItemConstructorOptions
} from 'electron'
import { existsSync, statSync } from 'fs'
import { readFile } from 'fs/promises'
import * as fsp from 'fs/promises'
import { basename, extname, isAbsolute, join, relative } from 'path'
import { pathToFileURL } from 'url'
import type { AiAskTurn, AiExtraContext, AiChat, AiChatMessage, AiNote, ConfirmOptions, EmailFolder, OutgoingEmail } from '@shared/types'
import type { MusicAction } from '@shared/spotify'
import { normalizePrefs, type Prefs } from '@shared/prefs'
import { activeThemeId, getTheme } from '@shared/themes'
import { loadSettings, saveSettings, settingsFile, watchSettingsFile } from './settings'
import { Vault } from './vault'
import { startWatching, stopWatching } from './watcher'
import * as calendars from './calendarSources'
import { readGoogleSheet } from './googleSheets'
import * as ai from './ai'
import * as email from './email'
import * as spotify from './spotify'
import * as localMusic from './localMusic'
import { closeMusicMini, setupMusicMini } from './musicMini'
import { applyCaptureShortcut, noteHiddenToTray, setTrayIcon, setupCapture, teardownCapture } from './capture'
import { applySnipShortcut, setupSnip, startSnip } from './snip'
import { setupUpdater } from './updater'
import { setupExport } from './exporter'
import { setupConverter } from './converter'
import { isAppPage, setupStudio } from './studio'
import { setupLive } from './live'
import { explorerFile, setupExplorer } from './explorer'
import { hold, setupUndoBin } from './undoBin'
import { IS_MAC, TRASH_NAME } from '@shared/platform'
import { logCrashes, logError, safely } from './log'
import { formatMenuFor, setupMenus } from './menus'
import { dictionaryMenu, setupDictionary } from './dictionary'
import { setupPhoneLink } from './phoneLink'
import { phoneNotify, setupPhonePair } from './phonePair'
import { setupPhoneCam } from './phoneCam'
import { setupWebTitle } from './webTitle'
import { setupPlaces } from './places'
import { setupWeather } from './weather'
import { releaseMessages, saveMessages, setupBrowser } from './browser'
import { closeYouTube, setupYouTube } from './youtube'
import { setupImporter } from './importer'
import { setupTerminal } from './terminal'
import { setupGames } from './games'
import { setupGameCovers } from './gameCovers'
import { applyIconOutsideApp } from './appIcon'
import { broadcastThemes, loadImportedThemes, setupThemes, THEME_SCHEME, themeFilePath } from './themes'
import { CODE_SANDBOX_SCHEME, registerCodeSandbox } from './codeSandbox'
import { readHandwritingOffline } from './handwriting'

let vault: Vault | null = null
const shownReminders = new Set<Electron.Notification>()
let mainWindow: BrowserWindow | null = null
/** True once you've chosen Quit (from the tray), so closing really closes instead of hiding. */
let quitting = false
/** The messages hub closing its pages before the window closes. */
let hubReleased: Promise<void> = Promise.resolve()

logCrashes()

// The app used to be called Notes: keep its data folder so settings and sign-ins carry over.
app.setPath('userData', join(app.getPath('appData'), 'Notes'))

// Windows shows notifications under this app id (it matches the installer's).
if (process.platform === 'win32') app.setAppUserModelId('com.notesapp.desktop')

// Only one copy of Notes runs; starting it again just brings the window back.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMain())
}

// Clicking the Dock icon (Mac) brings the window back. Set up first thing, so that nothing that
// goes wrong later in start-up can leave Notes running with no way to see it.
app.on('activate', () => {
  if (app.isReady()) showMain()
})

function showMain(): void {
  if (!app.isReady()) return
  // Undo "Hide Notes" (⌘H) or the hide after quick capture.
  if (IS_MAC) app.show()
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (mainWindow.webContents.isCrashed()) mainWindow.webContents.reload()
  keepOnScreen(mainWindow)
  mainWindow.show()
  mainWindow.focus()
  if (IS_MAC) app.focus({ steal: true })
}

/** If the window ended up off every screen (a monitor was unplugged), bring it back to the middle. */
function keepOnScreen(win: BrowserWindow): void {
  const b = win.getBounds()
  const visible = screen.getAllDisplays().some(({ workArea: a }) => b.x + 80 < a.x + a.width && b.x + b.width - 80 > a.x && b.y + 40 < a.y + a.height && b.y + 20 > a.y - 20)
  if (!visible) win.center()
}

// Empty at start, so the icon is checked once each launch (an update puts the original back on shortcuts).
let appliedIcon = ''

/**
 * The app icon you picked (Settings → Appearance): the Dock icon on a Mac; on Windows the window's
 * taskbar icon and the tray icon, and (installed app) its shortcuts.
 */
function applyAppIcon(prefs: Prefs): void {
  const { id, file } = appIconFile(prefs)
  if (id === appliedIcon || !file) return
  appliedIcon = id
  const image = nativeImage.createFromPath(file)
  safely('app icon outside the app', () => applyIconOutsideApp(id, file))
  if (IS_MAC) {
    app.dock?.setIcon(image)
  } else {
    for (const win of BrowserWindow.getAllWindows()) win.setIcon(image)
    setTrayIcon(image)
  }
}

/** The icon to show: the theme's own (when it has one and you let it), or the one you picked. */
function appIconFile(prefs: Prefs): { id: string; file?: string } {
  const theme = currentTheme(prefs)
  const themeIcon = prefs.themeAppIcon && theme.pack?.appIcon ? themeFilePath(theme.id, theme.pack.appIcon) : null
  if (themeIcon) {
    // The file's time is in the id, so updating the theme makes a fresh icon for Windows' shortcuts.
    return { id: `${theme.id}-${Math.round(statSync(themeIcon).mtimeMs)}`, file: themeIcon }
  }
  const candidates = [join(__dirname, '../renderer/icons', `${prefs.appIcon}.png`), join(app.getAppPath(), 'src/renderer/public/icons', `${prefs.appIcon}.png`)]
  return { id: prefs.appIcon, file: candidates.find((f) => existsSync(f)) }
}

/** Settings that live outside the app's windows: the capture shortcut, the app icon and starting at login. */
function applySystemPrefs(prefs: Prefs): void {
  applyCaptureShortcut(prefs.captureShortcut)
  applySnipShortcut(prefs.snipShortcut)
  safely('app icon', () => applyAppIcon(prefs))
  // Only the installed app registers itself (in development it would register electron.exe).
  if (!app.isPackaged) return
  if (IS_MAC) app.setLoginItemSettings({ openAtLogin: prefs.launchAtStartup })
  else app.setLoginItemSettings({ openAtLogin: prefs.launchAtStartup, args: ['--hidden'] })
}

/** True when this launch came from starting at login, so the window can stay hidden. */
function startedAtLogin(): boolean {
  if (process.argv.includes('--hidden')) return true
  return IS_MAC && app.isPackaged && app.getLoginItemSettings().wasOpenedAtLogin === true
}

/**
 * On a Mac the menu bar is always there, and it's what makes ⌘C, ⌘V, ⌘Q and friends work. On
 * Windows there's none (it also frees Ctrl+W for closing tabs). App shortcuts like ⌘W and ⌘P
 * aren't in the menu, so the notes window handles them like on Windows.
 */
function setAppMenu(): void {
  if (!IS_MAC) {
    Menu.setApplicationMenu(null)
    return
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: 'Edit',
        submenu: [
          // Orbit decides what's undone: the text you're typing in, or the last change you made anywhere else.
          { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => editCommand('undo') },
          { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => editCommand('redo') },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'pasteAndMatchStyle' },
          { role: 'selectAll' }
        ]
      },
      { label: 'View', submenu: [{ role: 'togglefullscreen' }] },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] }
    ])
  )
}

/** Undo / Redo from the Edit menu (or ⌘Z when the page didn't use it): Orbit's own windows decide, web pages undo their text. */
function editCommand(which: 'undo' | 'redo'): void {
  const wc = webContents.getFocusedWebContents()
  if (!wc) return
  if (mainWindow && wc === mainWindow.webContents) wc.send('edit:command', which)
  else if (which === 'undo') wc.undo()
  else wc.redo()
}

/** The theme showing now (yours, or your light/dark one when matching the system). */
export const currentTheme = (prefs: Prefs): ReturnType<typeof getTheme> => getTheme(activeThemeId(prefs, nativeTheme.shouldUseDarkColors))

function currentPrefs(): Prefs {
  return normalizePrefs(loadSettings().prefs)
}

/** The parts of preferences the main process handles: title-bar colours, zoom and spellcheck. */
function applyPrefs(win: BrowserWindow, prefs: Prefs): void {
  const { colors } = currentTheme(prefs)
  win.setBackgroundColor(colors.bg)
  // Only the main window has the native title-bar buttons (the capture window is frameless).
  // On a Mac they're the coloured circles, which need no colouring.
  if (win === mainWindow && !IS_MAC) win.setTitleBarOverlay({ color: colors.bg, symbolColor: colors.textMuted, height: 38 })
  win.webContents.setZoomFactor(prefs.zoom)
  const { session } = win.webContents
  session.setSpellCheckerEnabled(prefs.spellcheck)
  if (prefs.spellcheckLanguage) {
    try {
      session.setSpellCheckerLanguages([prefs.spellcheckLanguage])
    } catch {
      // Not available on this machine: keep the current language.
    }
  }
}

// The system switched light/dark: windows matching it recolour their title bars.
nativeTheme.on('updated', () => {
  const prefs = currentPrefs()
  if (!prefs.followSystem) return
  for (const win of BrowserWindow.getAllWindows()) applyPrefs(win, prefs)
  // A theme with its own icon may have just come on or gone off.
  safely('app icon', () => applyAppIcon(prefs))
})

function broadcastPrefs(prefs: Prefs): void {
  for (const win of BrowserWindow.getAllWindows()) {
    applyPrefs(win, prefs)
    win.webContents.send('prefs:changed', prefs)
  }
  safely('system settings', () => applySystemPrefs(prefs))
}

function openVault(path: string | null): void {
  stopWatching()
  vault = path ? new Vault(path) : null
  if (!path) return
  startWatching(path, (paths) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('vault:changed', paths)
  })
}

// Images (and voice notes) in notes load through vault://local/<path>, served only from inside the open vault.
/** Biggest file the file vault takes (it's read into memory to encrypt). */
const SAFE_MAX_BYTES = 100 * 1024 * 1024
const safePicked = new Set<string>()
const IMAGE_TYPES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif'])
const AUDIO_TYPES = new Set(['.webm', '.mp3', '.m4a', '.wav', '.ogg', '.oga', '.aac', '.flac', '.opus'])
/** Shown in their own tab from the file list. */
const VIEWER_TYPES = new Set(['.mp4', '.mov', '.m4v', '.ogv', '.pdf', '.ico', '.xlsx', '.xlsm', '.csv', '.tsv'])

protocol.registerSchemesAsPrivileged([
  // corsEnabled: your own music plays through the Web Audio visualiser, which needs it.
  { scheme: 'vault', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  CODE_SANDBOX_SCHEME,
  THEME_SCHEME
])

function registerVaultProtocol(): void {
  protocol.handle('vault', async (request) => {
    try {
      const url = new URL(request.url)
      // Your own music files (vault://music/…) and their album pictures (vault://musicart/…), from your music folder.
      if (url.host === 'music' || url.host === 'musicart') {
        const rel = decodeURIComponent(url.pathname.slice(1))
        const full = localMusic.musicFile(rel)
        if (!full || !AUDIO_TYPES.has(extname(full).toLowerCase())) return new Response('Not allowed', { status: 403 })
        if (url.host === 'music') {
          const res = await net.fetch(pathToFileURL(full).toString(), { headers: request.headers })
          const headers = new Headers(res.headers)
          headers.set('Access-Control-Allow-Origin', '*')
          return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
        }
        const pic = await localMusic.cover(rel)
        return pic ? new Response(Buffer.from(pic.data), { headers: { 'Content-Type': pic.type, 'Cache-Control': 'max-age=3600' } }) : new Response('No picture', { status: 404 })
      }
      // Previews in the file explorer tab (vault://explore/<full path>): pictures, video, sound and PDFs only.
      if (url.host === 'explore') {
        const full = explorerFile(url)
        return full ? net.fetch(pathToFileURL(full).toString(), { headers: request.headers }) : new Response('Not allowed', { status: 403 })
      }
      const rel = decodeURIComponent(url.pathname.slice(1))
      const full = currentVault().abs(rel)
      const ext = extname(full).toLowerCase()
      if (!IMAGE_TYPES.has(ext) && !AUDIO_TYPES.has(ext) && !VIEWER_TYPES.has(ext)) return new Response('Not allowed', { status: 403 })
      return net.fetch(pathToFileURL(full).toString(), { headers: request.headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

function currentVault(): Vault {
  if (!vault) throw new Error('No notes folder is open.')
  return vault
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function createWindow(): BrowserWindow {
  const { window: bounds } = loadSettings()
  const prefs = currentPrefs()
  const BG = currentTheme(prefs).colors.bg

  const win = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 820,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: BG,
    ...(IS_MAC
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 12 } }
      : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: { color: BG, symbolColor: currentTheme(prefs).colors.textMuted, height: 38 }
        }),
    // The installed app uses the icon baked into Notes.exe; while developing, use the source PNG.
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.png') }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Chromium's PDF viewer, for PDFs opened from the file list.
      plugins: true,
      // The web browser tab (browser.ts locks each page down as it's created).
      webviewTag: true
    }
  })

  // Started at login: stay in the tray / menu bar until you open it.
  const startHidden = startedAtLogin() && prefs.closeToTray
  let shown = false
  const reveal = (): void => {
    if (shown || win.isDestroyed()) return
    shown = true
    if (bounds?.maximized) win.maximize()
    if (!startHidden) win.show()
  }
  win.once('ready-to-show', reveal)
  // If the page is slow or fails to load, show the window anyway rather than leaving nothing on screen.
  setTimeout(reveal, 5000)
  win.webContents.on('did-finish-load', () => applyPrefs(win, currentPrefs()))

  // If the page breaks (it crashed, or its files went missing), note it and load it again.
  win.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (isMainFrame) logError('window', `couldn't load ${url}: ${description} (${code})`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    logError('window', `the page stopped: ${details.reason} (exit ${details.exitCode})`)
    if (details.reason !== 'clean-exit' && !quitting) setTimeout(() => !win.isDestroyed() && win.webContents.reload(), 500)
  })
  win.on('unresponsive', () => logError('window', 'the page stopped responding'))

  // Before closing, give the renderer a moment to save any unsaved edits.
  let readyToClose = false
  let toldAboutTray = false
  // Windows is shutting down or signing out: WhatsApp and Discord close properly first (see releaseMessages).
  win.on('session-end', () => {
    if (win === mainWindow) void releaseMessages()
  })
  win.on('close', (e) => {
    // Keeping Notes in the tray: just hide the window (autosave keeps working while it's hidden).
    if (!quitting && currentPrefs().closeToTray) {
      e.preventDefault()
      const maximized = win.isMaximized()
      saveSettings({ window: { ...(maximized ? win.getNormalBounds() : win.getBounds()), maximized } })
      // A full-screen Mac window has to leave full screen first, or hiding it leaves a black space.
      if (win.isFullScreen()) {
        win.once('leave-full-screen', () => win.hide())
        win.setFullScreen(false)
      } else {
        win.hide()
      }
      // Hidden in the tray, the app may next be stopped by Windows shutting down: save sign-ins now.
      saveMessages()
      if (!toldAboutTray && !loadSettings().toldAboutTray) {
        toldAboutTray = true
        saveSettings({ toldAboutTray: true })
        noteHiddenToTray()
      }
      return
    }
    if (!readyToClose) {
      e.preventDefault()
      if (win === mainWindow) hubReleased = releaseMessages()
      win.webContents.send('app:before-close')
      setTimeout(() => {
        readyToClose = true
        if (!win.isDestroyed()) win.close()
      }, 3000)
      return
    }
    const maximized = win.isMaximized()
    const b = maximized ? win.getNormalBounds() : win.getBounds()
    saveSettings({ window: { ...b, maximized } })
    // The notes window is really closing: the YouTube mini window goes with it.
    if (win === mainWindow) {
      closeYouTube()
      closeMusicMini()
    }
  })
  ipcMain.removeHandler('app:ready-to-close')
  ipcMain.handle('app:ready-to-close', async () => {
    // WhatsApp and Discord save their sign-ins as their pages close (see releaseMessages).
    await hubReleased
    readyToClose = true
    win.close()
    // Closing the window cancels a quit that was in progress; carry it on now everything's saved.
    if (quitting) app.quit()
  })

  // Right-click in text: spelling suggestions (or the word's meaning and synonyms) plus cut/copy/paste.
  // (The file tree shows its own menu.)
  win.webContents.on('context-menu', async (_e, params) => {
    const items: MenuItemConstructorOptions[] = []
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: suggestion, click: () => win.webContents.replaceMisspelling(suggestion) })
      }
      if (params.dictionarySuggestions.length === 0) items.push({ label: 'No suggestions', enabled: false })
      items.push(
        {
          label: `Add “${params.misspelledWord}” to dictionary`,
          click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
        },
        { type: 'separator' }
      )
    } else if (win === mainWindow) {
      items.push(...(await dictionaryMenu(win)))
    }
    if (params.isEditable) {
      // In a note (not a text box elsewhere): format the selected text, or record a voice note / draw a sketch here.
      if (win === mainWindow && params.formControlType === 'none') {
        if (params.selectionText.trim()) items.push(...formatMenuFor(win))
        else
          items.push(
            { label: 'Record a voice note…', click: () => win.webContents.send('voice:start') },
            { label: 'Draw a sketch…', click: () => win.webContents.send('sketch:start') },
            { type: 'separator' }
          )
      }
      items.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll' }
      )
    } else if (params.selectionText) {
      items.push({ role: 'copy' })
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
  })

  // F12 opens DevTools while developing.
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
    })
  }

  // Links to the web open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function registerIpc(): void {
  ipcMain.handle('app:confirm', async (event, opts: ConfirmOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const { response } = await dialog.showMessageBox(win, {
      type: opts.type ?? 'question',
      buttons: [opts.ok, opts.cancel ?? 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      message: opts.message,
      detail: opts.detail
    })
    return response === 0
  })

  ipcMain.handle('prefs:get', () => currentPrefs())
  ipcMain.handle('prefs:set', (_e, patch: Partial<Prefs>) => {
    const prefs = normalizePrefs({ ...currentPrefs(), ...patch })
    saveSettings({ prefs })
    broadcastPrefs(prefs)
    return prefs
  })
  // A reminder: a system notification; clicking it brings Notes up at that note.
  ipcMain.handle('reminder:show', (_e, r: { title: string; body: string; path: string; line: number }) => {
    // Your phone buzzes too, if its Orbit page is open.
    phoneNotify('⏰ ' + (currentPrefs().streamerMode ? 'Reminder' : r.title), currentPrefs().streamerMode ? '' : r.body)
    if (!Notification.isSupported()) {
      logError('reminder', new Error('Notifications aren’t supported on this system.'))
      return false
    }
    // Streamer mode: the reminder itself could be private, so the notification only says there is one.
    const quiet = currentPrefs().streamerMode
    const n = new Notification({ title: quiet ? 'Reminder' : r.title, body: quiet ? 'Click to see it in Orbit.' : r.body, silent: false })
    // Windows reports some failures (e.g. notifications switched off for Notes) here.
    n.on('failed', (_ev, error) => logError('reminder notification', new Error(error)))
    n.on('click', () => {
      showMain()
      mainWindow?.webContents.send('reminder:open', r.path, r.line)
    })
    n.show()
    // Keep a reference until it's dealt with (otherwise clicks can be lost).
    shownReminders.add(n)
    n.on('close', () => shownReminders.delete(n))
    return true
  })
  setupMenus()
  setupDictionary()
  setupPhoneLink(() => mainWindow, (path) => currentVault().abs(path))
  setupPhonePair(
    () => mainWindow,
    (name, data) => currentVault().saveAttachment(currentPrefs().attachmentFolder, name, data)
  )
  setupPhoneCam(() => mainWindow)
  setupWebTitle()
  setupPlaces()
  setupWeather()
  localMusic.setupLocalMusic()
  setupImporter()
  setupGames()
  setupGameCovers()
  setupTerminal(() => vault?.root ?? null)
  // The Mac asks once whether Notes may use the microphone.
  ipcMain.handle('voice:access', async () => (IS_MAC ? systemPreferences.askForMediaAccess('microphone') : true))
  ipcMain.handle('app:fullscreen', (event, on: boolean) => BrowserWindow.fromWebContents(event.sender)?.setFullScreen(on))
  ipcMain.handle('clipboard:copySecret', (_e, text: string, seconds: number) => copySecret(text, seconds))
  ipcMain.handle('app:showLog', () => {
    const log = join(app.getPath('userData'), 'notes.log')
    if (existsSync(log)) shell.showItemInFolder(log)
    else shell.openPath(app.getPath('userData'))
  })
  ipcMain.handle('prefs:languages', (event) => event.sender.session.availableSpellCheckerLanguages)
  ipcMain.handle('prefs:openFile', async () => {
    if (!loadSettings().prefs) saveSettings({ prefs: currentPrefs() }) // so the file lists every option
    await shell.openPath(settingsFile())
  })

  ipcMain.handle('vault:get', () => {
    const { vaultPath } = loadSettings()
    const valid = vaultPath && isDirectory(vaultPath) ? vaultPath : null
    if (valid !== vault?.root) openVault(valid)
    return valid
  })

  ipcMain.handle('vault:pick', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a folder for your notes',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory', 'promptToCreate']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const vaultPath = result.filePaths[0]
    saveSettings({ vaultPath })
    openVault(vaultPath)
    return vaultPath
  })

  ipcMain.handle('vault:close', () => {
    saveSettings({ vaultPath: null })
    openVault(null)
  })

  ipcMain.handle('vault:reveal', async () => {
    if (vault) await shell.openPath(vault.root)
  })

  ipcMain.handle('fs:tree', () => currentVault().tree())
  ipcMain.handle('fs:read', (_e, path: string) => currentVault().read(path))
  ipcMain.handle('fs:write', (_e, path: string, content: string) => currentVault().write(path, content))
  ipcMain.handle('fs:readAll', () => currentVault().readAll())
  ipcMain.handle('fs:createNote', (_e, folder: string) => currentVault().createNote(folder))
  ipcMain.handle('fs:createNoteAt', (_e, path: string) => currentVault().createNoteAt(path))
  ipcMain.handle('fs:createBoard', (_e, folder: string) => currentVault().createBoard(folder))
  ipcMain.handle('fs:createFolder', (_e, folder: string) => currentVault().createFolder(folder))
  ipcMain.handle('fs:rename', (_e, path: string, name: string) => currentVault().rename(path, name))
  ipcMain.handle('fs:move', (_e, path: string, folder: string) => currentVault().move(path, folder))
  // Image bytes for export (images only, from inside the notes folder).
  ipcMain.handle('fs:readImage', async (_e, path: string) => {
    const full = currentVault().abs(path)
    if (!IMAGE_TYPES.has(extname(full).toLowerCase())) throw new Error('Not an image.')
    return new Uint8Array(await readFile(full))
  })
  ipcMain.handle('fs:reveal', (_e, path: string) => shell.showItemInFolder(currentVault().abs(path)))
  ipcMain.handle('cal:status', () => calendars.status())
  ipcMain.handle('cal:setClient', (_e, id: string, secret: string) => calendars.setClient(id, secret))
  ipcMain.handle('cal:connect', () => calendars.connect())
  ipcMain.handle('cal:disconnect', () => calendars.disconnect())
  ipcMain.handle('cal:setEnabled', (_e, id: string, enabled: boolean) => calendars.setCalendarEnabled(id, enabled))
  ipcMain.handle('cal:addFeed', (_e, name: string, url: string) => calendars.addFeed(name, url))
  ipcMain.handle('cal:removeFeed', (_e, id: string) => calendars.removeFeed(id))
  ipcMain.handle('cal:events', (_e, from: string, to: string) => calendars.fetchEvents(from, to))
  ipcMain.handle('email:status', () => email.status())
  ipcMain.handle('email:connect', () => email.connect())
  ipcMain.handle('email:list', (_e, folder: EmailFolder, query: string, next?: string) => email.list(folder, query, next))
  ipcMain.handle('email:get', (_e, id: string) => email.get(id))
  ipcMain.handle('email:send', (_e, message: OutgoingEmail) => email.send(message))
  ipcMain.handle('email:markRead', (_e, id: string, read: boolean) => email.markRead(id, read))
  ipcMain.handle('email:star', (_e, id: string, starred: boolean) => email.star(id, starred))
  ipcMain.handle('email:archive', (_e, id: string) => email.archive(id))
  ipcMain.handle('email:trash', (_e, id: string) => email.trash(id))
  ipcMain.handle('gsheet:read', (_e, rel: string) => readGoogleSheet(currentVault().abs(rel)))
  ipcMain.handle('music:status', () => spotify.status())
  ipcMain.handle('music:setClient', (_e, id: string) => spotify.setClient(id))
  ipcMain.handle('music:connect', () => spotify.connect())
  ipcMain.handle('music:disconnect', () => spotify.disconnect())
  ipcMain.handle('music:nowPlaying', () => spotify.nowPlaying())
  ipcMain.handle('music:control', (_e, action: MusicAction) => spotify.control(action))
  ipcMain.handle('music:seek', (_e, ms: number) => spotify.seek(ms))
  ipcMain.handle('music:skip', (_e, count: number) => spotify.skip(Number(count)))
  ipcMain.handle('music:play', (_e, uri: string, context?: string) => spotify.play(uri, context))
  ipcMain.handle('music:search', (_e, query: string) => spotify.search(query))
  ipcMain.handle('music:playlists', () => spotify.playlists())
  ipcMain.handle('music:setVolume', (_e, percent: number) => spotify.setVolume(Number(percent)))
  ipcMain.handle('music:isLiked', (_e, uri: string) => spotify.isLiked(String(uri)))
  ipcMain.handle('music:setLiked', (_e, uri: string, liked: boolean) => spotify.setLiked(String(uri), liked === true))
  ipcMain.handle('music:queue', () => spotify.queue())
  ipcMain.handle('music:addToQueue', (_e, uri: string) => spotify.addToQueue(String(uri)))
  ipcMain.handle('music:recent', () => spotify.recent())
  ipcMain.handle('music:devices', () => spotify.devices())
  ipcMain.handle('music:playlistSongs', (_e, uri: string) => spotify.playlistSongs(String(uri)))
  ipcMain.handle('music:createPlaylist', (_e, name: string) => spotify.createPlaylist(String(name)))
  ipcMain.handle('music:renamePlaylist', (_e, uri: string, name: string) => spotify.renamePlaylist(String(uri), String(name)))
  ipcMain.handle('music:deletePlaylist', (_e, uri: string) => spotify.deletePlaylist(String(uri)))
  ipcMain.handle('music:addToPlaylist', (_e, uri: string, songs: string[], position?: number) =>
    spotify.addToPlaylist(String(uri), Array.isArray(songs) ? songs.map(String) : [], typeof position === 'number' ? position : undefined)
  )
  ipcMain.handle('music:restorePlaylist', (_e, uri: string) => spotify.restorePlaylist(String(uri)))
  ipcMain.handle('music:removeFromPlaylist', (_e, uri: string, song: string) => spotify.removeFromPlaylist(String(uri), String(song)))
  ipcMain.handle('music:moveInPlaylist', (_e, uri: string, from: number, to: number) => spotify.moveInPlaylist(String(uri), Number(from), Number(to)))
  ipcMain.handle('music:transfer', (_e, deviceId: string) => spotify.transfer(String(deviceId)))
  ipcMain.handle('music:open', (_e, what: 'app' | 'automation') => spotify.open(what === 'automation' ? 'automation' : 'app'))

  ipcMain.handle('ai:status', () => ai.status())
  ipcMain.handle('ai:setKey', (_e, key: string) => ai.setKey(key))
  ipcMain.handle('ai:clearKey', () => ai.clearKey())
  ipcMain.handle('ai:summarise', (_e, title: string, text: string) => ai.summarise(title, text))
  ipcMain.handle('ai:tidy', (_e, text: string, kind: 'note' | 'capture') => ai.tidy(text, kind === 'capture' ? 'capture' : 'note'))
  ipcMain.handle('ai:interpret', (_e, text: string, context: string) => ai.interpret(String(text).slice(0, 1000), String(context).slice(0, 8000)))
  ipcMain.handle('ai:ask', (_e, question: string, notes: AiNote[], history: AiAskTurn[], extra?: AiExtraContext) => ai.askNotes(question, notes, history, extra))
  ipcMain.handle('ai:chat', (_e, messages: AiChatMessage[]) => ai.chat(messages))
  ipcMain.handle('ai:loadChats', () => ai.loadChats())
  ipcMain.handle('ai:saveChats', (_e, chats: AiChat[]) => ai.saveChats(chats))
  ipcMain.handle('handwriting:read', (_e, png: Uint8Array, reader: 'ai' | 'offline') => (reader === 'ai' ? ai.readHandwriting(png) : readHandwritingOffline(png)))

  ipcMain.handle('vault:readAppData', (_e, name: string) => currentVault().readAppData(name))
  ipcMain.handle('vault:writeAppData', (_e, name: string, content: string) => currentVault().writeAppData(name, content))
  ipcMain.handle('safe:read', (_e, id: string) => currentVault().readSafeFile(id))
  ipcMain.handle('safe:write', (_e, id: string, data: Uint8Array) => currentVault().writeSafeFile(id, data))
  ipcMain.handle('safe:remove', (_e, id: string) => currentVault().removeSafeFile(id))
  // Files picked to lock away. Only these paths may later be sent to the Bin by safe:trashOriginals.
  ipcMain.handle('safe:pick', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showOpenDialog(win, { title: 'Add to file vault', properties: ['openFile', 'multiSelections'] })
    if (result.canceled) return []
    const picked = []
    for (const path of result.filePaths) {
      if ((await fsp.stat(path)).size > SAFE_MAX_BYTES) throw new Error(`"${basename(path)}" is too big for the file vault (over 100 MB).`)
      picked.push({ path, name: basename(path), data: new Uint8Array(await fsp.readFile(path)) })
      safePicked.add(path)
    }
    return picked
  })
  ipcMain.handle('safe:trashOriginals', async (_e, paths: string[]) => {
    for (const p of paths) {
      if (!safePicked.delete(p)) continue
      await shell.trashItem(p).catch((err) => logError('vault original', err))
    }
  })
  ipcMain.handle('safe:saveCopy', async (event, name: string, data: Uint8Array) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showSaveDialog(win, { title: 'Save a copy', defaultPath: join(app.getPath('downloads'), basename(name)) })
    if (result.canceled || !result.filePath) return false
    await fsp.writeFile(result.filePath, data)
    return true
  })
  ipcMain.handle('fs:writeSketch', (_e, path: string, svg: string) => currentVault().writeSketch(path, svg))
  ipcMain.handle('fs:writeSheet', (_e, path: string, data: Uint8Array) => currentVault().writeSheet(path, data))
  ipcMain.handle('fs:saveAttachment', (_e, folder: string, name: string, data: Uint8Array) =>
    currentVault().saveAttachment(folder, name, data)
  )
  // A file dragged from the file explorer tab into a note: one already in the notes folder is linked
  // where it is, anything else is copied into the attachments folder first.
  ipcMain.handle('fs:attachFromComputer', async (_e, folder: string, source: string) => {
    if (typeof source !== 'string' || !isAbsolute(source)) throw new Error('That isn’t a file on this computer.')
    const v = currentVault()
    const rel = relative(v.root, source)
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel.split(/[\\/]/).join('/')
    return v.copyAttachment(folder, source)
  })
  ipcMain.handle('fs:pickAttachment', async (event, folder: string, imagesOnly: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showOpenDialog(win, {
      title: imagesOnly ? 'Insert image' : 'Attach file',
      properties: ['openFile', 'multiSelections'],
      filters: imagesOnly ? [{ name: 'Images', extensions: [...IMAGE_TYPES].map((e) => e.slice(1)) }] : []
    })
    if (result.canceled) return []
    return Promise.all(result.filePaths.map((p) => currentVault().copyAttachment(folder, p)))
  })
  // Opens an attachment (PDF, document…) in its usual app. Notes and folders stay in the app.
  ipcMain.handle('fs:openFile', async (_e, path: string) => {
    const full = currentVault().abs(path)
    if (!statSync(full).isFile()) throw new Error('That is not a file.')
    if (/\.(exe|bat|cmd|com|msi|ps1|vbs|js|lnk|scr|app|command|sh|pkg|workflow|terminal|tool|scpt)$/i.test(full)) throw new Error('For safety, programs and scripts are not opened from notes.')
    const error = await shell.openPath(full)
    if (error) throw new Error(error)
  })

  // Several at once: one question, then each to the Bin. Returns the ones moved.
  ipcMain.handle('fs:trashMany', async (event, paths: string[]) => {
    const v = currentVault()
    const items = paths.filter(Boolean)
    if (items.length === 0) return []
    const win = BrowserWindow.fromWebContents(event.sender)!
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: [`Move to ${TRASH_NAME}`, 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      message: `Delete ${items.length} items?`,
      detail: `They'll be moved to the ${TRASH_NAME}:\n${items.slice(0, 8).map((p) => basename(p).replace(/\.md$/i, '')).join('\n')}${items.length > 8 ? `\n…and ${items.length - 8} more` : ''}`
    })
    if (response !== 0) return []
    const done: string[] = []
    for (const p of items) {
      try {
        await hold(v.abs(p))
        done.push(p)
      } catch (err) {
        logError('delete', err)
      }
    }
    return done
  })

  ipcMain.handle('fs:trash', async (event, path: string) => {
    const v = currentVault()
    if (!path) throw new Error('The notes folder itself cannot be deleted here.')
    const full = v.abs(path)
    const isFolder = statSync(full).isDirectory()
    const win = BrowserWindow.fromWebContents(event.sender)!
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: [`Move to ${TRASH_NAME}`, 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      message: `Delete "${basename(full).replace(/\.md$/i, '')}"?`,
      detail: isFolder
        ? `The folder and everything in it will be moved to the ${TRASH_NAME}.`
        : `The note will be moved to the ${TRASH_NAME}.`
    })
    if (response !== 0) return false
    await hold(full)
    return true
  })
}

/** Only the browser features the app actually uses; everything else (camera, location…) is refused. */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'local-fonts'])

/**
 * On a Mac, apps should live in Applications. Run from the disk image (or Downloads), macOS gives
 * Notes a temporary read-only copy that breaks if the disk image is ejected, so offer to move it.
 * Returns true if Notes is moving (it then restarts from Applications).
 */
async function offerMoveToApplications(): Promise<boolean> {
  if (!IS_MAC || !app.isPackaged || app.isInApplicationsFolder() || loadSettings().keepOutsideApplications) return false
  const { response, checkboxChecked } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Move to Applications', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    message: 'Move Orbit to your Applications folder?',
    detail:
      'Orbit is running from the disk image or your Downloads folder. From there it can stop working (for example when the disk image is ejected) and can’t be kept in the Dock properly. Orbit will restart from Applications.',
    checkboxLabel: 'Don’t ask again'
  })
  if (response !== 0) {
    if (checkboxChecked) saveSettings({ keepOutsideApplications: true })
    return false
  }
  try {
    return app.moveToApplicationsFolder({
      // An older copy already in Applications gets replaced; one that's running can't be.
      conflictHandler: (kind) => kind === 'exists'
    })
  } catch (err) {
    logError('move to Applications', err)
    dialog.showErrorBox('Couldn’t move Notes', 'Drag Notes from the disk image into your Applications folder instead, then open it from there.')
    return false
  }
}

app.whenReady().then(async () => {
  // Imported themes first: settings that use one are only valid once it's known.
  safely('imported themes', loadImportedThemes)
  if (await offerMoveToApplications()) return
  safely('menu', setAppMenu)
  // The microphone (for voice notes) is allowed; the camera and screen only for Orbit's own pages
  // (the Studio), never web pages; everything else isn't.
  const audioOnly = (details: { mediaTypes?: string[] } | undefined): boolean =>
    !!details?.mediaTypes?.length && details.mediaTypes.every((t) => t === 'audio')
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) =>
    callback(ALLOWED_PERMISSIONS.has(permission) || (permission === 'media' && (audioOnly(details as { mediaTypes?: string[] }) || isAppPage(wc))))
  )
  session.defaultSession.setPermissionCheckHandler(
    (wc, permission, _origin, details) =>
      ALLOWED_PERMISSIONS.has(permission) || (permission === 'media' && ((details as { mediaType?: string }).mediaType === 'audio' || isAppPage(wc)))
  )
  registerVaultProtocol()
  registerCodeSandbox()
  registerIpc()
  safely('themes', () =>
    setupThemes(() => {
      // A removed theme that was in use falls back to the default.
      const prefs = normalizePrefs(loadSettings().prefs)
      if (loadSettings().prefs) saveSettings({ prefs })
      broadcastThemes()
      broadcastPrefs(prefs)
    })
  )
  safely('web browser', () => setupBrowser(() => currentPrefs().streamerMode))
  safely('YouTube mini window', () => setupYouTube(currentPrefs))
  safely('Music mini player', () => setupMusicMini(currentPrefs, () => mainWindow))
  safely('export', setupExport)
  safely('converter', setupConverter)
  safely('studio', setupStudio)
  safely('live streaming', setupLive)
  safely('file explorer', () => setupExplorer(() => vault?.root ?? null))
  safely('undo', () => setupUndoBin(() => vault?.root ?? null))
  // Hand edits to settings.json apply straight away.
  safely('settings watcher', () => watchSettingsFile((settings) => broadcastPrefs(normalizePrefs(settings.prefs))))
  mainWindow = createWindow()
  // The extras: if one of them fails on some computer, the app itself still works.
  safely('quick capture', () => setupCapture({ getMain: () => mainWindow, showMain, prefs: currentPrefs, snip: () => void startSnip() }))
  safely('screen snip', () => setupSnip({ getMain: () => mainWindow, showMain }))
  safely('system settings', () => applySystemPrefs(currentPrefs()))
  safely('updates', () => setupUpdater(() => currentPrefs().checkForUpdates))
})

// A copied password: the clipboard is emptied after a while, unless you've copied something else since.
let copiedSecret: string | null = null
let clearTimer: NodeJS.Timeout | undefined
function clearSecret(): void {
  if (copiedSecret !== null && clipboard.readText() === copiedSecret) clipboard.clear()
  copiedSecret = null
}
function copySecret(text: string, seconds: number): void {
  clearTimeout(clearTimer)
  clipboard.writeText(text)
  copiedSecret = text
  clearTimer = setTimeout(clearSecret, Math.min(Math.max(seconds, 5), 300) * 1000)
}

// Stopping Notes from the terminal (Ctrl+C) quits it properly, so everything is saved first.
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.quit())

app.on('before-quit', () => {
  quitting = true
})
app.on('will-quit', () => {
  teardownCapture()
  clearSecret()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
