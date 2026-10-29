import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { WebviewTag } from 'electron'
import { ArrowLeft, ArrowRight, Eraser, ExternalLink, Globe, MonitorPlay, MoreHorizontal, RotateCw, Smartphone, X } from 'lucide-react'
import { displayUrl, toWebUrl, WEB_PARTITION } from '@shared/web'
import { youTubeVideoId, youTubeWatchUrl } from '@shared/youtube'
import { FIND_VIDEO } from '@shared/video'
import { loadInWebTab, setWebPage, useWeb, webviews } from '../../store/web'
import { notify } from '../../store/notify'
import { sendToPhone } from '../../store/phone'
import { CLICK_MOD } from '@shared/platform'

/** Signs you out of every website, after asking. */
export async function clearBrowsingData(): Promise<void> {
  const ok = await window.api.confirm({
    type: 'warning',
    message: 'Clear browsing data?',
    detail: 'You’ll be signed out of every website in the web tabs, and their saved data and history are forgotten. Your notes aren’t touched.',
    ok: 'Clear'
  })
  if (!ok) return
  try {
    await window.api.clearWebData()
    for (const view of webviews.values()) view.reload()
    notify('Browsing data cleared. You’re signed out of all websites.', 'info')
  } catch (err) {
    notify(err)
  }
}

interface Failure {
  url: string
  description: string
}

/**
 * A web page in a tab: an address bar, back/forward/reload, and the page itself in a walled-off
 * <webview> (main/browser.ts sets it up), so it can sit beside a note in split view.
 */
export default function WebPage({ tab, hidden, autoFocus }: { tab: string; hidden: boolean; autoFocus: boolean }) {
  const url = useWeb((s) => s.pages[tab]?.url ?? '')
  const pageTitle = useWeb((s) => s.pages[tab]?.title)
  // The page the webview starts on; after that it navigates itself (or through loadInWebTab).
  const [src, setSrc] = useState(url)
  // React knows <webview> as a plain element; Electron gives it the methods (WebviewTag).
  const viewEl = useRef<HTMLWebViewElement>(null)
  const view = viewEl as unknown as { current: WebviewTag | null }
  const address = useRef<HTMLInputElement>(null)
  const [typed, setTyped] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [nav, setNav] = useState({ back: false, forward: false })
  const [failure, setFailure] = useState<Failure | null>(null)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    if (!src && url) setSrc(url)
  }, [src, url])

  // An empty web tab is waiting for an address.
  useEffect(() => {
    if (!src && autoFocus && !hidden) address.current?.focus()
  }, [src, autoFocus, hidden])

  useEffect(() => {
    const el = view.current
    if (!src || !el) return
    webviews.set(tab, el)
    let ready = false
    const updateNav = (): void => {
      if (ready) setNav({ back: el.canGoBack(), forward: el.canGoForward() })
    }
    const onReady = (): void => {
      ready = true
      updateNav()
    }
    const onNavigate = (e: Event): void => {
      const { url: next, isMainFrame } = e as Event & { url: string; isMainFrame?: boolean }
      if (isMainFrame === false) return
      setWebPage(tab, { url: next })
      setFailure(null)
      updateNav()
    }
    const onTitle = (e: Event): void => setWebPage(tab, { title: (e as Event & { title: string }).title })
    const onStart = (): void => setLoading(true)
    const onStop = (): void => {
      setLoading(false)
      updateNav()
    }
    const onFail = (e: Event): void => {
      const { errorCode, errorDescription, validatedURL, isMainFrame } = e as Event & {
        errorCode: number
        errorDescription: string
        validatedURL: string
        isMainFrame: boolean
      }
      // -3 is a page load that was cancelled (you clicked elsewhere first): not a failure.
      if (!isMainFrame || errorCode === -3) return
      setFailure({ url: validatedURL, description: errorDescription })
    }
    el.addEventListener('dom-ready', onReady)
    el.addEventListener('did-navigate', onNavigate)
    el.addEventListener('did-navigate-in-page', onNavigate)
    el.addEventListener('page-title-updated', onTitle)
    el.addEventListener('did-start-loading', onStart)
    el.addEventListener('did-stop-loading', onStop)
    el.addEventListener('did-fail-load', onFail)
    return () => {
      if (webviews.get(tab) === el) webviews.delete(tab)
      el.removeEventListener('dom-ready', onReady)
      el.removeEventListener('did-navigate', onNavigate)
      el.removeEventListener('did-navigate-in-page', onNavigate)
      el.removeEventListener('page-title-updated', onTitle)
      el.removeEventListener('did-start-loading', onStart)
      el.removeEventListener('did-stop-loading', onStop)
      el.removeEventListener('did-fail-load', onFail)
    }
  }, [tab, src])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  const go = (e: FormEvent): void => {
    e.preventDefault()
    const next = toWebUrl(typed ?? '')
    if (!next) return
    setTyped(null)
    setFailure(null)
    if (src) loadInWebTab(tab, next)
    else setWebPage(tab, { url: next })
    address.current?.blur()
    view.current?.focus()
  }

  const ready = (): WebviewTag | null => (src ? view.current : null)

  // The video on the page (any website, not just YouTube) carries on in the mini window from where
  // it's got to, and stops here.
  const videoId = youTubeVideoId(url)
  const popOut = async (): Promise<void> => {
    let found: { seconds?: number; url?: string } | null = null
    try {
      found = (await ready()?.executeJavaScript(FIND_VIDEO)) ?? null
    } catch {
      // The page isn't ready: a YouTube video starts from the beginning.
    }
    const seconds = Number(found?.seconds) || 0
    if (videoId) void window.api.openYouTube(youTubeWatchUrl(videoId, seconds))
    else if (found?.url) void window.api.openYouTube(found.url)
    else if (found) void window.api.openYouTube(url, seconds)
    else notify('There’s no video on this page to pop out.', 'info')
  }

  return (
    <div className={`web-page ${hidden ? 'hidden' : ''}`} data-web-tab={tab}>
      <form className="web-bar" onSubmit={go}>
        <button type="button" className="icon-btn" title="Back" disabled={!nav.back} onClick={() => ready()?.goBack()}>
          <ArrowLeft size={15} />
        </button>
        <button type="button" className="icon-btn" title="Forward" disabled={!nav.forward} onClick={() => ready()?.goForward()}>
          <ArrowRight size={15} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={loading ? 'Stop' : 'Reload'}
          disabled={!src}
          onClick={() => (loading ? ready()?.stop() : ready()?.reload())}
        >
          {loading ? <X size={15} /> : <RotateCw size={14} />}
        </button>
        <input
          ref={address}
          className="web-address"
          value={typed ?? (url ? displayUrl(url) : '')}
          placeholder="Search Google or type a web address"
          spellCheck={false}
          onChange={(e) => setTyped(e.target.value)}
          onFocus={(e) => {
            setTyped(url)
            requestAnimationFrame(() => e.target.select())
          }}
          onBlur={() => setTyped(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setTyped(null)
              e.currentTarget.blur()
            }
          }}
          data-web-address
        />
        {/^https?:/i.test(url) && (
          <button type="button" className="icon-btn" title="Pop the video out into the mini window (floats over everything)" onClick={() => void popOut()}>
            <MonitorPlay size={14} />
          </button>
        )}
        <button type="button" className="icon-btn" title="Send to phone (scan a QR code)" disabled={!url} onClick={() => sendToPhone({ kind: 'link', url, title: pageTitle })}>
          <Smartphone size={14} />
        </button>
        <button type="button" className="icon-btn" title="Open in your browser" disabled={!url} onClick={() => window.open(url)}>
          <ExternalLink size={14} />
        </button>
        <div className="web-menu-wrap" onMouseDown={(e) => e.stopPropagation()}>
          <button type="button" className={`icon-btn ${menu ? 'active' : ''}`} title="More" onClick={() => setMenu(!menu)}>
            <MoreHorizontal size={15} />
          </button>
          {menu && (
            <div className="menu web-menu">
              <button
                type="button"
                onClick={() => {
                  setMenu(false)
                  void clearBrowsingData()
                }}
              >
                <Eraser size={15} /> Clear browsing data (sign out of all websites)
              </button>
            </div>
          )}
        </div>
        {loading && <div className="web-progress" />}
      </form>
      <div className="web-body">
        {src ? (
          // allowpopups lets links that open a new window reach main/browser.ts, which opens them in a new web tab.
          // (React only sets attributes it knows as strings, so "true" rather than true.)
          <webview ref={viewEl} src={src} partition={WEB_PARTITION} allowpopups={'true' as unknown as boolean} className="web-view" />
        ) : (
          <div className="web-start">
            <Globe size={36} strokeWidth={1.2} />
            <p>Search or type a web address above.</p>
            <span>
              Websites open here walled off from your notes. Sign-ins are remembered until you clear browsing data. Tip: {CLICK_MOD} a link in a
              note to open it beside the note.
            </span>
          </div>
        )}
        {failure && (
          <div className="web-failed">
            <p>Couldn’t open {displayUrl(failure.url)}</p>
            <span>{failure.description || 'The page didn’t load.'}</span>
            <div>
              <button className="btn" onClick={() => ready() && loadInWebTab(tab, failure.url)}>
                Try again
              </button>
              <button className="btn" onClick={() => window.open(failure.url)}>
                Open in your browser
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
