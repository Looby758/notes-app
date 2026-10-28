import { app, clipboard, ipcMain, Menu, session, shell, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { firefoxUserAgent, isGoogleSignIn, isWebUrl, plainUserAgent, searchUrl, WEB_PARTITION } from '@shared/web'
import { shortcutFromEvent } from '@shared/shortcuts'
import { logError } from './log'

/**
 * The web browser tab. Each one is a <webview>: a web page running in its own locked-down process,
 * in its own storage (WEB_PARTITION), so a site can't reach your notes, the app, or your computer.
 * Sign-ins are remembered in that storage until you clear it.
 */

/** Web pages may go full screen (videos) and copy text; nothing else (camera, location…). */
const WEB_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write'])

/** The app's own shortcuts (sent over by the UI), so they still work while a web page has focus. */
let appShortcuts = new Set<string>()

/** What Google's sign-in pages are told the browser is (see isGoogleSignIn). */
const SIGN_IN_AGENT = firefoxUserAgent(process.platform)

export function setupBrowser(): void {
  app.on('web-contents-created', (_e, contents) => {
    // However a web page tab is asked for, it gets the same walled-off setup.
    contents.on('will-attach-webview', (event, prefs, params) => {
      delete prefs.preload
      prefs.partition = WEB_PARTITION
      prefs.nodeIntegration = false
      prefs.nodeIntegrationInSubFrames = false
      prefs.contextIsolation = true
      prefs.sandbox = true
      prefs.webSecurity = true
      prefs.allowRunningInsecureContent = false
      if (!isWebUrl(params.src) && params.src !== 'about:blank') event.preventDefault()
    })
    if (contents.getType() === 'webview') {
      guardPage(contents, () => (contents.hostWebContents && !contents.hostWebContents.isDestroyed() ? contents.hostWebContents : null))
    }
  })

  const web = session.fromPartition(WEB_PARTITION)
  web.setUserAgent(plainUserAgent(web.getUserAgent()))
  web.setPermissionRequestHandler((_wc, permission, callback) => callback(WEB_PERMISSIONS.has(permission)))
  web.setPermissionCheckHandler((_wc, permission) => WEB_PERMISSIONS.has(permission))
  // Google's sign-in pages hear "Firefox", without the Chrome-only hints that would give it away.
  web.webRequest.onBeforeSendHeaders({ urls: ['https://accounts.google.com/*'] }, (details, callback) => {
    const headers = Object.fromEntries(Object.entries(details.requestHeaders).filter(([name]) => !/^sec-ch-ua/i.test(name)))
    callback({ requestHeaders: { ...headers, 'User-Agent': SIGN_IN_AGENT } })
  })

  ipcMain.handle('web:clear', async () => {
    await web.clearStorageData()
    await web.clearCache()
    await web.clearAuthCache()
  })
  ipcMain.on('web:shortcuts', (_e, list: unknown) => {
    appShortcuts = new Set(Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [])
  })
}

/**
 * What a web page may do: stay on the web, and open new windows as new web tabs. `host` is the
 * app window it belongs to.
 */
function guardPage(page: WebContents, host: () => WebContents | null): void {
  const openInTab = (url: string): void => {
    if (isWebUrl(url)) host()?.send('web:open', url)
  }

  page.setWindowOpenHandler(({ url, disposition }) => {
    // A small pop-up window (how "Sign in with Google / Microsoft / Apple" buttons work) opens as
    // one, so it can hand the sign-in back to the page that opened it. Other links get a web tab.
    if (disposition === 'new-window' && isWebUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          autoHideMenuBar: true,
          webPreferences: { partition: WEB_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false }
        }
      }
    }
    if (isWebUrl(url)) openInTab(url)
    else if (/^mailto:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  page.on('did-create-window', (popup) => guardPage(popup.webContents, host))

  // Google's sign-in pages see "Firefox" from the page's side too (the request side is in setupBrowser).
  const browserName = (url: string): void => {
    const agent = isGoogleSignIn(url) ? SIGN_IN_AGENT : page.session.getUserAgent()
    if (page.getUserAgent() !== agent) page.setUserAgent(agent)
  }
  page.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) browserName(details.url)
  })

  // Only web pages: an email link goes to your email app, and anything else (files, other apps) is refused.
  const stayOnWeb = (e: { preventDefault(): void }, url: string): void => {
    if (isWebUrl(url) || url === 'about:blank') return
    e.preventDefault()
    if (/^mailto:/i.test(url)) void shell.openExternal(url)
  }
  page.on('will-navigate', (e, url) => {
    stayOnWeb(e, url)
    browserName(url)
  })
  page.on('will-redirect', (e, url, _inPlace, isMainFrame) => {
    stayOnWeb(e, url)
    if (isMainFrame) browserName(url)
  })

  // The app's shortcuts (Ctrl+W, Ctrl+P…) work while a page has focus; everything else goes to the page.
  page.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !appShortcuts.size) return
    const pressed = shortcutFromEvent({
      key: input.key,
      code: input.code,
      ctrlKey: input.control,
      metaKey: input.meta,
      altKey: input.alt,
      shiftKey: input.shift
    })
    if (pressed && appShortcuts.has(pressed)) {
      e.preventDefault()
      host()?.send('web:shortcut', pressed)
    }
  })

  page.on('context-menu', (_e, params) => {
    const items: MenuItemConstructorOptions[] = []
    if (params.linkURL && isWebUrl(params.linkURL)) {
      items.push(
        { label: 'Open link in new web tab', click: () => openInTab(params.linkURL) },
        { label: 'Open link in your browser', click: () => void shell.openExternal(params.linkURL) },
        { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) },
        { type: 'separator' }
      )
    }
    if (params.isEditable) {
      items.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { role: 'selectAll' },
        { type: 'separator' }
      )
    } else if (params.selectionText.trim()) {
      const text = params.selectionText.trim()
      items.push(
        { role: 'copy' },
        { label: `Search Google for “${text.length > 30 ? `${text.slice(0, 30)}…` : text}”`, click: () => openInTab(searchUrl(text)) },
        { type: 'separator' }
      )
    }
    if (params.mediaType === 'image' && isWebUrl(params.srcURL)) {
      items.push({ label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) }, { type: 'separator' })
    }
    const history = page.navigationHistory
    items.push(
      { label: 'Back', enabled: history.canGoBack(), click: () => history.goBack() },
      { label: 'Forward', enabled: history.canGoForward(), click: () => history.goForward() },
      { label: 'Reload', click: () => page.reload() }
    )
    try {
      Menu.buildFromTemplate(items).popup()
    } catch (err) {
      logError('web page menu', err)
    }
  })
}
