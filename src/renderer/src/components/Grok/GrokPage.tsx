import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { WebviewTag } from 'electron'
import { Bot, ExternalLink, Home, PanelTop, PictureInPicture2, RotateCw, X } from 'lucide-react'
import { clampFloat, defaultFloat, GROK_URL, type FloatRect } from '@shared/grok'
import { WEB_PARTITION } from '@shared/web'
import { closeTab, GROK_TAB, openSpecialTab } from '../../lib/editorController'
import { paneWithTab } from '../../store/editor'
import { setGrokFloating, setGrokRect, setGrokUrl, useGrok } from '../../store/grok'
import { webviews } from '../../store/web'

/**
 * Grok inside Orbit: grok.com in a walled-off web page (main/browser.ts sets it up, with the web
 * tabs' storage, so you stay signed in), either as a tab or as a panel floating over your notes in
 * the Orbit window. Moving between the two carries on the chat you're in.
 */

/** Opens Grok as a tab (bringing it in from the floating panel if it's there). */
export function openGrokTab(): void {
  setGrokFloating(false)
  openSpecialTab(GROK_TAB)
}

/** Shows Grok in the floating panel instead of its tab. */
export function popGrokOut(): void {
  setGrokFloating(true)
  if (paneWithTab(GROK_TAB)) void closeTab(GROK_TAB)
}

/** Opens the floating panel, or puts it away. */
export function toggleGrokFloat(): void {
  if (useGrok.getState().floating) setGrokFloating(false)
  else popGrokOut()
}

/** The page the view is on, so the bar's buttons can reach it. */
type View = { current: WebviewTag | null }

/** The floating panel's name among the web pages (lib/appNavigation, Clear browsing data). */
const FLOAT_KEY = 'grok:float'

/**
 * grok.com itself, starting on the chat you were last in. It's listed with the web tabs' pages
 * (under `navKey`), so the mouse's back and forward buttons step through Grok's chats first, and
 * clearing browsing data reloads it too (it keeps its sign-in in the same storage).
 */
function GrokView({ view, focus, navKey }: { view: View; focus: boolean; navKey: string }) {
  // Where it starts; after that the page navigates itself (the store follows along).
  const [src] = useState(() => useGrok.getState().url || GROK_URL)
  const viewEl = useRef<HTMLWebViewElement>(null)
  const [failure, setFailure] = useState('')

  useEffect(() => {
    const el = viewEl.current as unknown as WebviewTag | null
    view.current = el
    if (!el) return
    webviews.set(navKey, el)
    const onNavigate = (e: Event): void => {
      const { url, isMainFrame } = e as Event & { url: string; isMainFrame?: boolean }
      if (isMainFrame === false) return
      setGrokUrl(url)
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
      el.removeEventListener('did-navigate', onNavigate)
      el.removeEventListener('did-navigate-in-page', onNavigate)
      el.removeEventListener('did-fail-load', onFail)
    }
  }, [navKey])

  useEffect(() => {
    if (focus) (viewEl.current as unknown as WebviewTag | null)?.focus()
  }, [focus])

  return (
    <div className="web-body">
      {/* allowpopups lets "Sign in with Google / X" pop-ups and links reach main/browser.ts (links open in a web tab). */}
      <webview ref={viewEl} src={src} partition={WEB_PARTITION} allowpopups={'true' as unknown as boolean} className="web-view" data-grok-view />
      {failure && (
        <div className="web-failed">
          <p>Couldn’t open Grok</p>
          <span>{failure}</span>
          <div>
            <button className="btn" onClick={() => view.current?.reload()}>
              Try again
            </button>
            <button className="btn" onClick={() => window.open(useGrok.getState().url || GROK_URL)}>
              Open in your browser
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Reload, start a new chat, open in the browser: the same few buttons in the tab and the panel. */
function PageButtons({ view }: { view: View }) {
  return (
    <>
      <button className="icon-btn" title="New chat" onClick={() => void view.current?.loadURL(GROK_URL)}>
        <Home size={14} />
      </button>
      <button className="icon-btn" title="Reload Grok" onClick={() => view.current?.reload()}>
        <RotateCw size={14} />
      </button>
      <button className="icon-btn" title="Open Grok in your browser" onClick={() => window.open(useGrok.getState().url || GROK_URL)}>
        <ExternalLink size={14} />
      </button>
    </>
  )
}

/** Grok in a tab. Like Messages, it stays loaded while you look at another tab. */
export default function GrokPage({ hidden, autoFocus }: { hidden: boolean; autoFocus: boolean }) {
  const view = useRef<WebviewTag | null>(null)
  return (
    <div className={`web-page grok-page ${hidden ? 'hidden' : ''}`} data-web-tab={GROK_TAB}>
      <div className="grok-bar">
        <span className="grok-title">
          <Bot size={15} /> Grok
        </span>
        <div className="messages-spacer" />
        <PageButtons view={view} />
        <button className="icon-btn" title="Pop out: float Grok over your notes, inside Orbit" onClick={popGrokOut} data-grok-popout>
          <PictureInPicture2 size={14} />
        </button>
      </div>
      <GrokView view={view} focus={!hidden && autoFocus} navKey={GROK_TAB} />
    </div>
  )
}

const viewport = (): { width: number; height: number } => ({ width: window.innerWidth, height: window.innerHeight })

/**
 * Grok floating over your notes inside the Orbit window: drag it by its top bar, resize it from
 * the corner. It stays where you leave it, and keeps out of the way of a smaller window.
 */
export function GrokFloat() {
  const floating = useGrok((s) => s.floating)
  const saved = useGrok((s) => s.rect)
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
      setGrokRect(last)
      setLive(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="grok-float" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} data-grok-float data-web-tab={FLOAT_KEY}>
      <div
        className="grok-bar grok-float-bar"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          track(e, (s, dx, dy) => ({ ...s, x: s.x + dx, y: s.y + dy }))
        }}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest('button')) setGrokRect(defaultFloat(viewport()))
        }}
        title="Drag to move. Double-click to put it back in the corner."
      >
        <span className="grok-title">
          <Bot size={15} /> Grok
        </span>
        <div className="messages-spacer" />
        <PageButtons view={view} />
        <button className="icon-btn" title="Open Grok as a tab" onClick={openGrokTab} data-grok-to-tab>
          <PanelTop size={14} />
        </button>
        <button className="icon-btn" title="Close" onClick={() => setGrokFloating(false)}>
          <X size={15} />
        </button>
      </div>
      <GrokView view={view} focus={false} navKey={FLOAT_KEY} />
      <div
        className="grok-float-grip"
        title="Drag to resize"
        onPointerDown={(e) => track(e, (s, dx, dy) => ({ ...s, width: s.width + dx, height: s.height + dy }))}
      />
    </div>
  )
}
