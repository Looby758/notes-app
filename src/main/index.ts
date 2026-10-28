import {
  app,
  BrowserWindow,
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
  type MenuItemConstructorOptions
} from 'electron'
import { existsSync, statSync } from 'fs'
import { readFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { pathToFileURL } from 'url'
import type { AiAskTurn, AiChat, AiChatMessage, AiNote, ConfirmOptions } from '@shared/types'
import { normalizePrefs, type Prefs } from '@shared/prefs'
import { activeThemeId, getTheme } from '@shared/themes'
import { loadSettings, saveSettings, settingsFile, watchSettingsFile } from './settings'
import { Vault } from './vault'
import { startWatching, stopWatching } from './watcher'
import * as calendars from './calendarSources'
import * as ai from './ai'
import { applyCaptureShortcut, noteHiddenToTray, setTrayIcon, setupCapture, teardownCapture } from './capture'
import { setupUpdater } from './updater'
import { setupExport } from './exporter'
import { IS_MAC, TRASH_NAME } from '@shared/platform'
import { logCrashes, logError, safely } from './log'
import { formatMenuFor, setupMenus } from './menus'
import { dictionaryMenu, setupDictionary } from './dictionary'
import { setupWebTitle } from './webTitle'
import { setupImporter } from './importer'
import { applyIconOutsideApp } from './appIcon'
import { CODE_SANDBOX_SCHEME, registerCodeSandbox } from './codeSandbox'

let vault: Vault | null = null
const shownReminders = new Set<Electron.Notification>()
let mainWindow: BrowserWindow | null = null
/** True once you've chosen Quit (from the tray), so closing really closes instead of hiding. */
let quitting = false

logCrashes()

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
function applyAppIcon(id: string): void {
  if (id === appliedIcon) return
  const candidates = [join(__dirname, '../renderer/icons', `${id}.png`), join(app.getAppPath(), 'src/renderer/public/icons', `${id}.png`)]
  const file = candidates.find((f) => existsSync(f))
  if (!file) return
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

/** Settings that live outside the app's windows: the capture shortcut, the app icon and starting at login. */
function applySystemPrefs(prefs: Prefs): void {
  applyCaptureShortcut(prefs.captureShortcut)
  safely('app icon', () => applyAppIcon(prefs.appIcon))
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
          { role: 'undo' },
          { role: 'redo' },
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
  if (prefs.followSystem) for (const win of BrowserWindow.getAllWindows()) applyPrefs(win, prefs)
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
const IMAGE_TYPES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif'])
const AUDIO_TYPES = new Set(['.webm', '.mp3', '.m4a', '.wav', '.ogg', '.oga', '.aac', '.flac', '.opus'])
/** Shown in their own tab from the file list. */
const VIEWER_TYPES = new Set(['.mp4', '.mov', '.m4v', '.ogv', '.pdf', '.ico', '.xlsx', '.xlsm', '.csv', '.tsv'])

protocol.registerSchemesAsPrivileged([
  { scheme: 'vault', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  CODE_SANDBOX_SCHEME
])

function registerVaultProtocol(): void {
  protocol.handle('vault', (request) => {
    try {
      const rel = decodeURIComponent(new URL(request.url).pathname.slice(1))
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
      plugins: true
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
      if (!toldAboutTray && !loadSettings().toldAboutTray) {
        toldAboutTray = true
        saveSettings({ toldAboutTray: true })
        noteHiddenToTray()
      }
      return
    }
    if (!readyToClose) {
      e.preventDefault()
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
  })
  ipcMain.removeHandler('app:ready-to-close')
  ipcMain.handle('app:ready-to-close', () => {
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
    if (!Notification.isSupported()) {
      logError('reminder', new Error('Notifications aren’t supported on this system.'))
      return false
    }
    const n = new Notification({ title: r.title, body: r.body, silent: false })
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
  setupWebTitle()
  setupImporter()
  // The Mac asks once whether Notes may use the microphone.
  ipcMain.handle('voice:access', async () => (IS_MAC ? systemPreferences.askForMediaAccess('microphone') : true))
  ipcMain.handle('app:fullscreen', (event, on: boolean) => BrowserWindow.fromWebContents(event.sender)?.setFullScreen(on))
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
  ipcMain.handle('ai:status', () => ai.status())
  ipcMain.handle('ai:setKey', (_e, key: string) => ai.setKey(key))
  ipcMain.handle('ai:clearKey', () => ai.clearKey())
  ipcMain.handle('ai:summarise', (_e, title: string, text: string) => ai.summarise(title, text))
  ipcMain.handle('ai:tidy', (_e, text: string, kind: 'note' | 'capture') => ai.tidy(text, kind === 'capture' ? 'capture' : 'note'))
  ipcMain.handle('ai:ask', (_e, question: string, notes: AiNote[], history: AiAskTurn[]) => ai.askNotes(question, notes, history))
  ipcMain.handle('ai:chat', (_e, messages: AiChatMessage[]) => ai.chat(messages))
  ipcMain.handle('ai:loadChats', () => ai.loadChats())
  ipcMain.handle('ai:saveChats', (_e, chats: AiChat[]) => ai.saveChats(chats))

  ipcMain.handle('vault:readAppData', (_e, name: string) => currentVault().readAppData(name))
  ipcMain.handle('vault:writeAppData', (_e, name: string, content: string) => currentVault().writeAppData(name, content))
  ipcMain.handle('fs:writeSketch', (_e, path: string, svg: string) => currentVault().writeSketch(path, svg))
  ipcMain.handle('fs:saveAttachment', (_e, folder: string, name: string, data: Uint8Array) =>
    currentVault().saveAttachment(folder, name, data)
  )
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
        await shell.trashItem(v.abs(p))
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
    await shell.trashItem(full)
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
    message: 'Move Notes to your Applications folder?',
    detail:
      'Notes is running from the disk image or your Downloads folder. From there it can stop working (for example when the disk image is ejected) and can’t be kept in the Dock properly. Notes will restart from Applications.',
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
  if (await offerMoveToApplications()) return
  safely('menu', setAppMenu)
  // The microphone (for voice notes) is allowed; the camera and everything else isn't.
  const audioOnly = (details: { mediaTypes?: string[] } | undefined): boolean =>
    !!details?.mediaTypes?.length && details.mediaTypes.every((t) => t === 'audio')
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) =>
    callback(ALLOWED_PERMISSIONS.has(permission) || (permission === 'media' && audioOnly(details as { mediaTypes?: string[] })))
  )
  session.defaultSession.setPermissionCheckHandler(
    (_wc, permission, _origin, details) => ALLOWED_PERMISSIONS.has(permission) || (permission === 'media' && (details as { mediaType?: string }).mediaType === 'audio')
  )
  registerVaultProtocol()
  registerCodeSandbox()
  registerIpc()
  safely('export', setupExport)
  // Hand edits to settings.json apply straight away.
  safely('settings watcher', () => watchSettingsFile((settings) => broadcastPrefs(normalizePrefs(settings.prefs))))
  mainWindow = createWindow()
  // The extras: if one of them fails on some computer, the app itself still works.
  safely('quick capture', () => setupCapture({ getMain: () => mainWindow, showMain, prefs: currentPrefs }))
  safely('system settings', () => applySystemPrefs(currentPrefs()))
  safely('updates', () => setupUpdater(() => currentPrefs().checkForUpdates))
})

app.on('before-quit', () => {
  quitting = true
})
app.on('will-quit', () => teardownCapture())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
