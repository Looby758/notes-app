import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { WebviewTag } from 'electron'
import { ArrowLeft, House, Minus, Pin, PinOff, Scan, Search, X } from 'lucide-react'
import { WEB_PARTITION } from '@shared/web'
import { isYouTubeUrl, toYouTubeUrl, YOUTUBE_HOME, youTubeVideoId, youTubeWatchUrl } from '@shared/youtube'
import type { YouTubeState } from '@shared/types'
import { playVideoFrom, POP_VIDEO, POP_VIDEO_CSS, UNPOP_VIDEO } from '@shared/video'

/**
 * On a video's page, only the video: the player fills the window and the rest of YouTube (the
 * header, comments, suggestions) is out of the way. Scroll lock keeps it from sliding off.
 */
const VIDEO_ONLY_CSS = `
html, body { overflow: hidden !important; }
ytd-app #masthead-container, ytd-app tp-yt-app-drawer, ytd-app ytd-mini-guide-renderer { display: none !important; }
ytd-app #movie_player.html5-video-player {
  position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
  z-index: 2147483000 !important; background: #000 !important;
}
ytd-app #movie_player .html5-video-container, ytd-app #movie_player video.html5-main-video {
  width: 100% !important; height: 100% !important; left: 0 !important; top: 0 !important; object-fit: contain !important;
}
ytd-app #movie_player .ytp-chrome-bottom { left: 12px !important; width: calc(100% - 24px) !important; }
`

/** Makes YouTube's player measure itself again (it sizes its controls to the space it has). */
const NUDGE_PLAYER = `window.dispatchEvent(new Event('resize'))`

/** The second the video is at, or 0 (not on a video, or YouTube not ready). */
const CURRENT_TIME = `(() => { const v = document.querySelector('video.html5-main-video') || document.querySelector('video'); return v ? v.currentTime : 0 })()`

/**
 * The YouTube mini window (opened with #youtube): a slim bar you drag the window by, with back,
 * home, search (or paste a link), video-only, float-on-top, minimise and close, and YouTube below.
 */
export default function YouTubeMini() {
  const [state, setState] = useState<YouTubeState | null>(null)
  const [url, setUrl] = useState('')
  const [typed, setTyped] = useState('')
  const [searching, setSearching] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  // Counts full page loads (each starts without the video-only CSS).
  const [loads, setLoads] = useState(0)
  const viewEl = useRef<HTMLWebViewElement>(null)
  const view = viewEl as unknown as { current: WebviewTag | null }
  const input = useRef<HTMLInputElement>(null)
  const ready = useRef(false)
  const cssKey = useRef<string | null>(null)
  // A video popped out from another website: play it from here once its page has loaded.
  const playFrom = useRef<number | null>(null)

  useEffect(() => {
    window.api.youTubeState().then(
      (s) => {
        setState(s)
        setUrl(s.url)
        if (!isYouTubeUrl(s.url)) playFrom.current = s.startAt ?? 0
      },
      () => setState({ url: YOUTUBE_HOME, pinned: true, videoOnly: true })
    )
  }, [])

  const load = (next: string, seconds = 0): void => {
    const el = view.current
    if (!next || !el) return
    playFrom.current = isYouTubeUrl(next) ? null : seconds
    setSearching(false)
    if (ready.current) void el.loadURL(next)
    else el.src = next
  }

  // A YouTube link sent over from the notes window (or opened from a page here) plays in this window.
  useEffect(() => {
    const offLoad = window.api.onYouTubeLoad(load)
    const offOpen = window.api.onWebOpen((link) => (isYouTubeUrl(link) ? load(link) : window.open(link)))
    return () => {
      offLoad()
      offOpen()
    }
  }, [])

  const videoOnly = state?.videoOnly ?? true
  const onVideo = !!youTubeVideoId(url) && /\/watch\b/.test(url)
  // Another website's page (a video popped out of a web tab): video-only shows just its video.
  const otherSite = /^https?:/i.test(url) && !isYouTubeUrl(url)

  // Video-only: the CSS goes on while a video's page shows, and comes off again elsewhere.
  useEffect(() => {
    const el = view.current
    if (!el || !ready.current) return
    const want = videoOnly && (onVideo || otherSite)
    if (want && !cssKey.current) {
      el.insertCSS(otherSite ? POP_VIDEO_CSS : VIDEO_ONLY_CSS).then(
        (key) => {
          cssKey.current = key
          void el.executeJavaScript(otherSite ? POP_VIDEO : NUDGE_PLAYER).catch(() => undefined)
        },
        () => undefined
      )
    } else if (!want && cssKey.current) {
      const key = cssKey.current
      cssKey.current = null
      el.removeInsertedCSS(key).then(() => el.executeJavaScript(`${UNPOP_VIDEO}; ${NUDGE_PLAYER}`), () => undefined).catch(() => undefined)
    }
  }, [videoOnly, onVideo, otherSite, loads])

  useEffect(() => {
    const el = view.current
    if (!el || !state) return
    const onReady = (): void => {
      ready.current = true
      setCanGoBack(el.canGoBack())
      // A full page load starts without the CSS; the video-only effect puts it back.
      cssKey.current = null
      setUrl(el.getURL())
      setLoads((n) => n + 1)
      if (playFrom.current !== null) {
        // As if you'd clicked play, so the site lets it start with sound.
        void el.executeJavaScript(playVideoFrom(playFrom.current), true).catch(() => undefined)
        playFrom.current = null
      }
    }
    const onNavigate = (e: Event): void => {
      const { url: next, isMainFrame } = e as Event & { url: string; isMainFrame?: boolean }
      if (isMainFrame === false) return
      setUrl(next)
      setCanGoBack(el.canGoBack())
      void window.api.rememberYouTube(next)
    }
    el.addEventListener('dom-ready', onReady)
    el.addEventListener('did-navigate', onNavigate)
    el.addEventListener('did-navigate-in-page', onNavigate)
    return () => {
      el.removeEventListener('dom-ready', onReady)
      el.removeEventListener('did-navigate', onNavigate)
      el.removeEventListener('did-navigate-in-page', onNavigate)
    }
  }, [state !== null])

  /** Notes where the video has got to, so reopening the window carries on from there. */
  const rememberTime = async (): Promise<void> => {
    const el = view.current
    const id = youTubeVideoId(url)
    if (!el || !ready.current || !id) return
    try {
      const seconds = Number(await el.executeJavaScript(CURRENT_TIME)) || 0
      await window.api.rememberYouTube(youTubeWatchUrl(id, seconds))
    } catch {
      // Not ready yet: the page's own address is remembered already.
    }
  }
  useEffect(() => {
    if (!youTubeVideoId(url)) return
    const t = setInterval(() => void rememberTime(), 15_000)
    return () => clearInterval(t)
  }, [url])

  useEffect(() => {
    if (searching) input.current?.focus()
  }, [searching])

  const go = (e: FormEvent): void => {
    e.preventDefault()
    const next = toYouTubeUrl(typed)
    if (!next) return
    setTyped('')
    load(next)
    view.current?.focus()
  }

  const togglePin = (): void => {
    if (!state) return
    const pinned = !state.pinned
    setState({ ...state, pinned })
    void window.api.pinYouTube(pinned)
  }
  const toggleVideoOnly = (): void => {
    if (!state) return
    setState({ ...state, videoOnly: !state.videoOnly })
    void window.api.setYouTubeVideoOnly(!state.videoOnly)
  }
  const close = async (): Promise<void> => {
    await rememberTime()
    void window.api.closeYouTube()
  }

  return (
    <div className="yt-mini">
      <form className="yt-bar" onSubmit={go}>
        <button type="button" className="icon-btn" title="Back" disabled={!canGoBack} onClick={() => view.current?.goBack()}>
          <ArrowLeft size={14} />
        </button>
        <button type="button" className="icon-btn" title="YouTube home" onClick={() => load(YOUTUBE_HOME)}>
          <House size={14} />
        </button>
        {searching ? (
          <input
            ref={input}
            className="yt-search"
            value={typed}
            placeholder="Search YouTube or paste a link"
            spellCheck={false}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={() => !typed && setSearching(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setTyped('')
                setSearching(false)
              }
            }}
          />
        ) : (
          <button type="button" className="yt-search yt-search-button" title="Search YouTube or paste a link" onClick={() => setSearching(true)}>
            <Search size={12} />
            <span>Search or paste a link</span>
          </button>
        )}
        <button
          type="button"
          className={`icon-btn ${videoOnly ? 'active yt-on' : ''}`}
          title={videoOnly ? 'Showing just the video (click to show the whole page)' : 'Show just the video'}
          onClick={toggleVideoOnly}
        >
          <Scan size={14} />
        </button>
        <button
          type="button"
          className={`icon-btn ${state?.pinned ? 'active yt-on' : ''}`}
          title={state?.pinned ? 'Staying on top of other windows (click to stop)' : 'Keep on top of other windows'}
          onClick={togglePin}
        >
          {state?.pinned ? <Pin size={14} /> : <PinOff size={14} />}
        </button>
        <button type="button" className="icon-btn" title="Minimise" onClick={() => void window.api.minimizeYouTube()}>
          <Minus size={14} />
        </button>
        <button type="button" className="icon-btn" title="Close" onClick={() => void close()}>
          <X size={14} />
        </button>
      </form>
      <div className="yt-body">
        {state && (
          // allowpopups lets links that open a new window reach main/browser.ts (they come back here through onWebOpen).
          <webview ref={viewEl} src={state.url} partition={WEB_PARTITION} allowpopups={'true' as unknown as boolean} className="yt-view" />
        )}
      </div>
    </div>
  )
}
