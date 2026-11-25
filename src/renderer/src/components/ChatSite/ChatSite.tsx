import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { WebviewTag } from 'electron'
import { Bot, ExternalLink, Home, PanelTop, PictureInPicture2, Asterisk, RotateCw, X, type LucideIcon } from 'lucide-react'
import { clampFloat, defaultFloat, type FloatRect } from '@shared/grok'
import { CHAT_SITES, type ChatSiteId } from '@shared/chatSites'
import { WEB_PARTITION } from '@shared/web'
import { CLAUDE_TAB, closeTab, GROK_TAB, openSpecialTab } from '../../lib/editorController'
import { paneWithTab } from '../../store/editor'
import { setSiteFloating, setSiteRect, setSiteUrl, useChatSites } from '../../store/grok'
import { webviews } from '../../store/web'
import { addonOn } from '../../lib/addons'

/**
 * Chat bots inside Orbit (Grok, Claude): the real site in a walled-off web page (main/browser.ts
 * sets it up, with the web tabs' storage, so you stay signed in), either as a tab or as a panel
 * floating over your notes in the Orbit window. Moving between the two carries on the chat you're in.
 */

export const SITE_TABS: Record<ChatSiteId, string> = { grok: GROK_TAB, claude: CLAUDE_TAB }
export const SITE_ICONS: Record<ChatSiteId, LucideIcon> = { grok: Bot, claude: Asterisk }

/** Opens the site as a tab (bringing it in from the floating panel if it's there). */
export function openSiteTab(site: ChatSiteId): void {
  setSiteFloating(site, false)
  openSpecialTab(SITE_TABS[site])
}

/** Shows the site in the floating panel instead of its tab. */
export function popSiteOut(site: ChatSiteId): void {
  setSiteFloating(site, true)
  if (paneWithTab(SITE_TABS[site])) void closeTab(SITE_TABS[site])
}

/** Opens the floating panel, or puts it away. */
export function toggleSiteFloat(site: ChatSiteId): void {
  if (useChatSites.getState()[site].floating) setSiteFloating(site, false)
  else popSiteOut(site)
}

/** The page the view is on, so the bar's buttons can reach it. */
type View = { current: WebviewTag | null }

/** The floating panel's name among the web pages (lib/appNavigation, Clear browsing data). */
const floatKey = (site: ChatSiteId): string => `${site}:float`

/** The site's pages showing now (tab and panel), newest first: where "Send to Claude" types. */
const shown = new Map<ChatSiteId, WebviewTag[]>()

/** A file to attach along with the text (a picture, as base64 so it can be handed to the page). */
export interface SiteFile {
  name: string
  type: string
  base64: string
}

/** What sendToSite managed: the text typed in, and how many of the files were attached. */
export interface SiteSent {
  typed: boolean
  attached: number
}

/**
 * Opens the site (in its panel if that's how you use it, else its tab), goes to `url`, and puts
 * `text` in its message box, ready to send, with `files` attached to the message. `typed` is false
 * if the box couldn't be found in time (the text should then be pasted by hand); `attached` says
 * how many files went in (the rest should be copied across by hand).
 */
export async function sendToSite(site: ChatSiteId, url: string, text: string, files: SiteFile[] = []): Promise<SiteSent> {
  // Claude and Grok are add-ons: without this one, the page opens in your browser instead (the text is pasted by hand).
  if (!addonOn(site)) {
    window.open(url)
    return { typed: false, attached: 0 }
  }
  if (!useChatSites.getState()[site].floating) openSiteTab(site)
  const view = await waitFor(() => shown.get(site)?.[0] ?? null, 8000)
  if (!view) return { typed: false, attached: 0 }
  await new Promise<void>((done) => {
    const finished = (): void => {
      view.removeEventListener('did-stop-loading', finished)
      done()
    }
    view.addEventListener('did-stop-loading', finished)
    view.loadURL(url).catch(finished)
    setTimeout(finished, 15000)
  })
  // The message box is drawn by the page's own code after it loads.
  const script = `(() => {
    const box = document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea')
    if (!box) return false
    box.focus()
    const text = ${JSON.stringify(text)}
    if (box.tagName === 'TEXTAREA') {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      set.call(box, text)
      box.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }
    const data = new DataTransfer()
    data.setData('text/plain', text)
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    if (!box.textContent.trim()) document.execCommand('insertText', false, text)
    return !!box.textContent.trim()
  })()`
  const typed = await waitFor(async () => ((await view.executeJavaScript(script).catch(() => false)) ? true : null), 15000)
  const attached = typed && files.length ? await attachFiles(view, files) : 0
  if (typed) view.focus()
  return { typed: !!typed, attached }
}

/**
 * Attaches files to the message being written: through the page's own file picker if it has one
 * (as if you'd chosen them there), else pasted into the message box like a copied picture. Gives
 * how many went in.
 */
async function attachFiles(view: WebviewTag, files: SiteFile[]): Promise<number> {
  const script = `(() => {
    const files = ${JSON.stringify(files)}.map((f) => {
      const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))
      return new File([bytes], f.name, { type: f.type })
    })
    const data = new DataTransfer()
    for (const f of files) data.items.add(f)
    const inputs = [...document.querySelectorAll('input[type="file"]')].filter((i) => !i.disabled)
    const input = inputs.find((i) => !i.accept || /image|\\*/.test(i.accept)) || inputs[0]
    if (input) {
      if (!input.multiple && files.length > 1) {
        // One at a time, for a picker that takes a single file.
        for (const f of files) {
          const one = new DataTransfer()
          one.items.add(f)
          input.files = one.files
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
        }
      } else {
        input.files = data.files
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
      return files.length
    }
    const box = document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea')
    if (!box) return 0
    box.focus()
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    return files.length
  })()`
  const n = await view.executeJavaScript(script).catch(() => 0)
  return typeof n === 'number' ? n : 0
}

async function waitFor<T>(get: () => T | null | Promise<T | null>, ms: number): Promise<T | null> {
  const end = Date.now() + ms
  for (;;) {
    const v = await get()
    if (v) return v
    if (Date.now() > end) return null
    await new Promise((r) => setTimeout(r, 400))
  }
}

/**
 * The site itself, starting on the chat you were last in. It's listed with the web tabs' pages
 * (under `navKey`), so the mouse's back and forward buttons step through its chats first, and
 * clearing browsing data reloads it too (it keeps its sign-in in the same storage).
 */
function SiteView({ site, view, focus, navKey }: { site: ChatSiteId; view: View; focus: boolean; navKey: string }) {
  // Where it starts; after that the page navigates itself (the store follows along).
  const [src] = useState(() => useChatSites.getState()[site].url || CHAT_SITES[site].home)
  const viewEl = useRef<HTMLWebViewElement>(null)
  const [failure, setFailure] = useState('')

  useEffect(() => {
    const el = viewEl.current as unknown as WebviewTag | null
    view.current = el
    if (!el) return
    webviews.set(navKey, el)
    shown.set(site, [el, ...(shown.get(site) ?? []).filter((v) => v !== el)])
    const onNavigate = (e: Event): void => {
      const { url, isMainFrame } = e as Event & { url: string; isMainFrame?: boolean }
      if (isMainFrame === false) return
      setSiteUrl(site, url)
      setFailure('')
    }
    const onFail = (e: Event): void => {
      const { errorCode, errorDescription, isMainFrame } = e as Event & { errorCode: number; errorDescription: string; isMainFrame: boolean }
      // -3 is a page load that was cancelled: not a failure.
      if (isMainFrame && errorCode !== -3) setFailure(errorDescription || 'The page didn’t load.')
    }
    el.addEventListener('did-navigate', onNavigate)
    el.addEventListener('did-navigate-in-page', onNavigate)
    el.addEventListener('did-fail-load', onFail)
    return () => {
      if (view.current === el) view.current = null
      if (webviews.get(navKey) === el) webviews.delete(navKey)
      shown.set(site, (shown.get(site) ?? []).filter((v) => v !== el))
      el.removeEventListener('did-navigate', onNavigate)
      el.removeEventListener('did-navigate-in-page', onNavigate)
      el.removeEventListener('did-fail-load', onFail)
    }
  }, [navKey, site])

  useEffect(() => {
    if (focus) (viewEl.current as unknown as WebviewTag | null)?.focus()
  }, [focus])

  return (
    <div className="web-body">
      {/* allowpopups lets "Sign in with Google / X" pop-ups and links reach main/browser.ts (links open in a web tab). */}
      <webview ref={viewEl} src={src} partition={WEB_PARTITION} allowpopups={'true' as unknown as boolean} className="web-view" data-chat-view={site} />
      {failure && (
        <div className="web-failed">
          <p>Couldn’t open {CHAT_SITES[site].name}</p>
          <span>{failure}</span>
          <div>
            <button className="btn" onClick={() => view.current?.reload()}>
              Try again
            </button>
            <button className="btn" onClick={() => window.open(useChatSites.getState()[site].url || CHAT_SITES[site].home)}>
              Open in your browser
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Reload, start a new chat, open in the browser: the same few buttons in the tab and the panel. */
function PageButtons({ site, view }: { site: ChatSiteId; view: View }) {
  const { name, home } = CHAT_SITES[site]
  return (
    <>
      <button className="icon-btn" title="New chat" onClick={() => void view.current?.loadURL(home)}>
        <Home size={14} />
      </button>
      <button className="icon-btn" title={`Reload ${name}`} onClick={() => view.current?.reload()}>
        <RotateCw size={14} />
      </button>
      <button className="icon-btn" title={`Open ${name} in your browser`} onClick={() => window.open(useChatSites.getState()[site].url || home)}>
        <ExternalLink size={14} />
      </button>
    </>
  )
}

/** The site in a tab. Like Messages, it stays loaded while you look at another tab. */
export default function ChatSitePage({ site, hidden, autoFocus }: { site: ChatSiteId; hidden: boolean; autoFocus: boolean }) {
  const view = useRef<WebviewTag | null>(null)
  const Icon = SITE_ICONS[site]
  const { name } = CHAT_SITES[site]
  return (
    <div className={`web-page grok-page ${hidden ? 'hidden' : ''}`} data-web-tab={SITE_TABS[site]}>
      <div className="grok-bar">
        <span className="grok-title">
          <Icon size={15} /> {name}
        </span>
        <div className="messages-spacer" />
        <PageButtons site={site} view={view} />
        <button className="icon-btn" title={`Pop out: float ${name} over your notes, inside Orbit`} onClick={() => popSiteOut(site)} data-chat-popout={site}>
          <PictureInPicture2 size={14} />
        </button>
      </div>
      <SiteView site={site} view={view} focus={!hidden && autoFocus} navKey={SITE_TABS[site]} />
    </div>
  )
}

const viewport = (): { width: number; height: number } => ({ width: window.innerWidth, height: window.innerHeight })

/**
 * The site floating over your notes inside the Orbit window: drag it by its top bar, resize it
 * from the corner. It stays where you leave it, and keeps out of the way of a smaller window.
 */
export function ChatSiteFloat({ site }: { site: ChatSiteId }) {
  const floating = useChatSites((s) => s[site].floating)
  const saved = useChatSites((s) => s[site].rect)
  const Icon = SITE_ICONS[site]
  const { name } = CHAT_SITES[site]
  const view = useRef<WebviewTag | null>(null)
  // While you drag, the panel follows the pointer; it's saved when you let go.
  const [live, setLive] = useState<FloatRect | null>(null)
  const [, setSize] = useState(viewport)

  useEffect(() => {
    if (!floating) return
    const onResize = (): void => setSize(viewport())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [floating])

  if (!floating) return null
  const rect = clampFloat(live ?? saved ?? defaultFloat(viewport()), viewport())

  /** Moving (by the bar) or resizing (by the corner), with the web page kept from eating the pointer. */
  const track = (e: ReactPointerEvent, change: (start: FloatRect, dx: number, dy: number) => FloatRect): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const start = rect
    const from = { x: e.clientX, y: e.clientY }
    let last = start
    document.body.classList.add('resizing')
    const move = (ev: PointerEvent): void => {
      last = clampFloat(change(start, ev.clientX - from.x, ev.clientY - from.y), viewport())
      setLive(last)
    }
    const up = (): void => {
      document.body.classList.remove('resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setSiteRect(site, last)
      setLive(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="grok-float" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} data-chat-float={site} data-web-tab={floatKey(site)}>
      <div
        className="grok-bar grok-float-bar"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          track(e, (s, dx, dy) => ({ ...s, x: s.x + dx, y: s.y + dy }))
        }}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest('button')) setSiteRect(site, defaultFloat(viewport()))
        }}
        title="Drag to move. Double-click to put it back in the corner."
      >
        <span className="grok-title">
          <Icon size={15} /> {name}
        </span>
        <div className="messages-spacer" />
        <PageButtons site={site} view={view} />
        <button className="icon-btn" title={`Open ${name} as a tab`} onClick={() => openSiteTab(site)} data-chat-to-tab={site}>
          <PanelTop size={14} />
        </button>
        <button className="icon-btn" title="Close" onClick={() => setSiteFloating(site, false)}>
          <X size={15} />
        </button>
      </div>
      <SiteView site={site} view={view} focus={false} navKey={floatKey(site)} />
      <div
        className="grok-float-grip"
        title="Drag to resize"
        onPointerDown={(e) => track(e, (s, dx, dy) => ({ ...s, width: s.width + dx, height: s.height + dy }))}
      />
    </div>
  )
}
