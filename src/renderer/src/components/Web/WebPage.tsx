import './web.css'
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import type { WebviewTag } from 'electron'
import {
  AppWindow,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bookmark as BookmarkIcon,
  ChevronDown,
  Clock,
  Copy,
  Download,
  Eraser,
  ExternalLink,
  FilePlus2,
  Folder,
  Globe,
  Languages,
  Loader2,
  MonitorPlay,
  MoreHorizontal,
  RotateCw,
  Search,
  Settings2,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Star,
  VenetianMask,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { displayUrl, toWebUrl, WEB_PARTITION } from '@shared/web'
import {
  bookmarkFor,
  childrenOf,
  clipName,
  clipToNote,
  drmService,
  hasProfile,
  hostOf,
  isForeign,
  isTranslated,
  PRIVATE_PARTITION,
  siteOf,
  translateUrl,
  type Bookmark
} from '@shared/browser'
import { youTubeVideoId, youTubeWatchUrl } from '@shared/youtube'
import { FIND_VIDEO } from '@shared/video'
import { loadInWebTab, setWebPage, useWeb, webviews } from '../../store/web'
import { addBookmark, setSite, tabsByPage, useBrowser } from '../../store/browser'
import { notify } from '../../store/notify'
import { sendToPhone } from '../../store/phone'
import { setPrefs, usePrefs } from '../../store/prefs'
import { useVault } from '../../store/vault'
import { useNoteIndex } from '../../store/noteIndex'
import { refreshAiStatus } from '../../store/ai'
import { usePasswords } from '../../lib/passwords/session'
import { loginMatchesPage } from '@shared/browser'
import { isPrivateWebTab, openSpecialTab, openWebTab, SETTINGS_TAB } from '../../lib/editorController'
import { freePath } from '../../lib/email'
import { CLICK_MOD, showKeys } from '@shared/platform'
import { openAiSettings } from '../Ai/AiSettings'
import ContextMenu, { type MenuItem } from '../ContextMenu'
import { BookmarksPanel, EditBookmark, HistoryPanel, SitesPanel } from './WebPanels'
import { DownloadsList } from './Downloads'
import { FillPopup, loginOffer, PermissionBar, SaveLoginBar, type FieldFocus, type LoginOffer } from './WebPrompts'

/** Signs you out of every website, after asking. */
export async function clearBrowsingData(): Promise<void> {
  const ok = await window.api.confirm({
    type: 'warning',
    message: 'Clear browsing data?',
    detail: 'You’ll be signed out of every website in the web tabs, and their saved data and history are forgotten. Your notes, bookmarks and saved passwords aren’t touched.',
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

type Panel = 'bookmarks' | 'history' | 'downloads' | 'sites' | 'summary'

const PANEL_TITLES: Record<Panel, string> = {
  bookmarks: 'Bookmarks',
  history: 'History',
  downloads: 'Downloads',
  sites: 'Site settings',
  summary: 'Page summary'
}

/** What a page's script hands back for clipping and summarising: what's selected, the article's words, its language. */
const PAGE_TEXT = `(() => {
  const pick = document.querySelector('article') || document.querySelector('main, [role=main]') || document.body
  return {
    selection: String(window.getSelection() || ''),
    text: (pick ? pick.innerText : '').slice(0, 50000),
    lang: (document.documentElement.lang || '').trim()
  }
})()`

interface PageText {
  selection: string
  text: string
  lang: string
}

/** Saves a page (or what's selected on it, or its summary) as a note in the Inbox folder. */
async function clipPage(page: { title: string; url: string; text: string; selection: string; summary?: string }): Promise<void> {
  const folder = usePrefs.getState().prefs.webClipFolder || 'Inbox'
  const taken = new Set([...useNoteIndex.getState().notes.keys()].map((p) => p.toLowerCase()))
  const path = freePath(folder, clipName(page.title, page.url), (p) => taken.has(p.toLowerCase()))
  // Saved without opening it, so you stay on the page.
  const created = await window.api.createNoteAt(path)
  await window.api.writeNote(created, clipToNote({ ...page, saved: new Date() }))
  await useVault.getState().refresh([created])
  notify(`Saved to ${folder}: ${created.slice(folder.length + 1).replace(/\.md$/, '')}`, 'info')
}

/**
 * A web page in a tab: an address bar, back/forward/reload, the bookmarks bar, and the page itself
 * in a walled-off <webview> (main/browser.ts sets it up), so it can sit beside a note in split view.
 * Around it: find on page, bookmarks, history, downloads, site settings, page summaries, saving to
 * the Inbox, translating, and offers to save and fill in logins and addresses.
 */
export default function WebPage({ tab, hidden, autoFocus }: { tab: string; hidden: boolean; autoFocus: boolean }) {
  const isPrivate = isPrivateWebTab(tab)
  const url = useWeb((s) => s.pages[tab]?.url ?? '')
  const pageTitle = useWeb((s) => s.pages[tab]?.title ?? '')
  const prefs = usePrefs((s) => s.prefs)
  const bookmarks = useBrowser((s) => s.bookmarks)
  const downloads = useBrowser((s) => s.downloads)
  const profile = useBrowser((s) => s.profile)
  const [wcId, setWcId] = useState<number | null>(null)
  const wcRef = useRef<number | null>(null)
  const zoom = useBrowser((s) => (wcId !== null ? (s.zoom[wcId] ?? 1) : 1))
  const allAsks = useBrowser((s) => s.asks)
  const asks = allAsks.filter((a) => a.wcId === wcId)
  const audio = useBrowser((s) => s.audio[tab])
  const siteMuted = useBrowser((s) => !!s.sites[siteOf(url)]?.muted)
  // The page the webview starts on; after that it navigates itself (or through loadInWebTab).
  const [src, setSrc] = useState(url)
  // React knows <webview> as a plain element; Electron gives it the methods (WebviewTag).
  const viewEl = useRef<HTMLWebViewElement>(null)
  const view = viewEl as unknown as { current: WebviewTag | null }
  const address = useRef<HTMLInputElement>(null)
  const [typed, setTyped] = useState<string | null>(null)
  const [suggested, setSuggested] = useState<{ url: string; title: string; kind: 'bookmark' | 'history' }[]>([])
  const [pick, setPick] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [nav, setNav] = useState({ back: false, forward: false })
  const [failure, setFailure] = useState<Failure | null>(null)
  const [menu, setMenu] = useState(false)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [starOpen, setStarOpen] = useState(false)
  const [find, setFind] = useState<{ text: string; active: number; matches: number } | null>(null)
  const findInput = useRef<HTMLInputElement>(null)
  const [summary, setSummary] = useState<{ state: 'working' | 'done' | 'error' | 'nokey'; text?: string; url: string; title: string } | null>(null)
  const [pageLang, setPageLang] = useState('')
  const [drmHidden, setDrmHidden] = useState('')
  const [offer, setOffer] = useState<LoginOffer | null>(null)
  const [field, setField] = useState<FieldFocus | null>(null)
  const overFill = useRef(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [barMenu, setBarMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [folderMenu, setFolderMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!src && url) setSrc(url)
  }, [src, url])

  // An empty web tab is waiting for an address.
  useEffect(() => {
    if (!src && autoFocus && !hidden) address.current?.focus()
  }, [src, autoFocus, hidden])

  // Things on screen for one page go when you leave it (and the offer to save a login, when you
  // leave its site).
  useEffect(() => {
    setField(null)
    setPageLang('')
    setOffer((o) => (o && siteOf(o.pageUrl) !== siteOf(url) ? null : o))
  }, [url])

  const ready = (): WebviewTag | null => (src ? view.current : null)
  /** The page's title now (the saved one can still be the last page's for a moment after moving on). */
  const titleNow = (): string => {
    try {
      return ready()?.getTitle() || pageTitle
    } catch {
      return pageTitle
    }
  }

  const readPage = async (): Promise<PageText | null> => {
    try {
      return ((await ready()?.executeJavaScript(PAGE_TEXT)) as PageText) ?? null
    } catch {
      return null
    }
  }

  // ---------- the page's events ----------

  useEffect(() => {
    const el = view.current
    if (!src || !el) return
    webviews.set(tab, el)
    let isReady = false
    const updateNav = (): void => {
      if (isReady) setNav({ back: el.canGoBack(), forward: el.canGoForward() })
    }
    const onReady = (): void => {
      isReady = true
      const id = el.getWebContentsId()
      tabsByPage.set(id, tab)
      wcRef.current = id
      setWcId(id)
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
      // Pages in another language get the Translate button.
      el.executeJavaScript('(document.documentElement.lang || "").trim()')
        .then((lang: unknown) => setPageLang(typeof lang === 'string' ? lang : ''))
        .catch(() => undefined)
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
    const onFound = (e: Event): void => {
      const { result } = e as Event & { result: { activeMatchOrdinal: number; matches: number; finalUpdate: boolean } }
      setFind((f) => (f ? { ...f, active: result.activeMatchOrdinal, matches: result.matches } : f))
    }
    const onMessage = (e: Event): void => {
      const { channel, args } = e as Event & { channel: string; args: unknown[] }
      const pageUrl = el.getURL()
      if (channel === 'orbit:login') {
        const { username, password } = (args[0] ?? {}) as { username?: string; password?: string }
        const p = usePrefs.getState().prefs
        if (isPrivate || !p.webOfferPasswords || useBrowser.getState().sites[siteOf(pageUrl)]?.neverSavePasswords) return
        const next = loginOffer(pageUrl, String(username ?? ''), String(password ?? ''))
        if (next) setOffer(next)
      } else if (channel === 'orbit:field') {
        const f = args[0] as FieldFocus
        const p = usePrefs.getState().prefs
        clearTimeout(blurTimer.current)
        if (f.kind === 'login' ? p.webOfferPasswords && usePasswords.getState().setUp : p.webAutofill && hasProfile(useBrowser.getState().profile)) setField(f)
        else setField(null)
      } else if (channel === 'orbit:field-blur') {
        clearTimeout(blurTimer.current)
        blurTimer.current = setTimeout(() => !overFill.current && setField(null), 200)
      }
    }
    el.addEventListener('dom-ready', onReady)
    el.addEventListener('did-navigate', onNavigate)
    el.addEventListener('did-navigate-in-page', onNavigate)
    el.addEventListener('page-title-updated', onTitle)
    el.addEventListener('did-start-loading', onStart)
    el.addEventListener('did-stop-loading', onStop)
    el.addEventListener('did-fail-load', onFail)
    el.addEventListener('found-in-page', onFound)
    el.addEventListener('ipc-message', onMessage)
    return () => {
      if (webviews.get(tab) === el) webviews.delete(tab)
      if (wcRef.current !== null) tabsByPage.delete(wcRef.current)
      el.removeEventListener('dom-ready', onReady)
      el.removeEventListener('did-navigate', onNavigate)
      el.removeEventListener('did-navigate-in-page', onNavigate)
      el.removeEventListener('page-title-updated', onTitle)
      el.removeEventListener('did-start-loading', onStart)
      el.removeEventListener('did-stop-loading', onStop)
      el.removeEventListener('did-fail-load', onFail)
      el.removeEventListener('found-in-page', onFound)
      el.removeEventListener('ipc-message', onMessage)
    }
  }, [tab, src])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  // ---------- address bar ----------

  useEffect(() => {
    if (typed === null || typed === url || typed.trim().length < 2) {
      setSuggested([])
      return
    }
    let live = true
    const t = setTimeout(() => void window.api.webSuggest(typed).then((s) => live && (setSuggested(s), setPick(-1))), 100)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [typed, url])

  const goTo = (next: string): void => {
    if (!next) return
    setTyped(null)
    setSuggested([])
    setFailure(null)
    if (src) loadInWebTab(tab, next)
    else setWebPage(tab, { url: next })
    address.current?.blur()
    view.current?.focus()
  }

  const go = (e: FormEvent): void => {
    e.preventDefault()
    goTo(pick >= 0 && suggested[pick] ? suggested[pick].url : toWebUrl(typed ?? ''))
  }

  const openLink = (target: string, newTab: boolean): void => {
    if (newTab) openWebTab(target, { privately: isPrivate })
    else goTo(target)
  }

  // ---------- page tools ----------

  // The video on the page (any website, not just YouTube) carries on in the mini window from where
  // it's got to, and stops here.
  const videoId = youTubeVideoId(url)
  const findVideo = async (): Promise<{ seconds?: number; url?: string } | null> => {
    try {
      return (await ready()?.executeJavaScript(FIND_VIDEO)) ?? null
    } catch {
      // The page isn't ready: a YouTube video starts from the beginning.
      return null
    }
  }
  const popOut = async (): Promise<void> => {
    const found = await findVideo()
    const seconds = Number(found?.seconds) || 0
    if (videoId) void window.api.openYouTube(youTubeWatchUrl(videoId, seconds))
    else if (found?.url) void window.api.openYouTube(found.url)
    else if (found) void window.api.openYouTube(url, seconds)
    else notify('There’s no video on this page to pop out.', 'info')
  }

  /** Save to Inbox: what's selected on the page, or (with nothing selected, or `whole`) the page. */
  const clip = async (whole = false): Promise<void> => {
    if (!url) return
    const page = await readPage()
    await clipPage({ title: titleNow(), url, text: page?.text ?? '', selection: whole ? '' : (page?.selection ?? '') }).catch(notify)
  }

  const summarise = async (): Promise<void> => {
    if (!url) return
    setPanel('summary')
    const at = { url, title: titleNow() || hostOf(url) }
    setSummary({ state: 'working', ...at })
    const status = await refreshAiStatus().catch(() => null)
    if (!status?.ready) return setSummary({ state: 'nokey', ...at })
    const page = await readPage()
    const text = (page?.selection.trim() || page?.text || '').slice(0, 12000)
    if (!text.trim()) return setSummary({ state: 'error', text: 'There are no words on this page to summarise.', ...at })
    try {
      const result = await window.api.aiSummarise(at.title, `Web page: ${url}\n\n${text}`)
      setSummary((s) => (s?.url === at.url ? { state: 'done', text: result, ...at } : s))
    } catch (err) {
      setSummary((s) => (s?.url === at.url ? { state: 'error', text: err instanceof Error ? err.message : String(err), ...at } : s))
    }
  }

  const translate = (): void => {
    if (url && !isTranslated(url)) goTo(translateUrl(url, navigator.language))
  }

  const openFind = (): void => {
    setFind((f) => f ?? { text: '', active: 0, matches: 0 })
    requestAnimationFrame(() => findInput.current?.select())
  }
  const findNext = (forward: boolean): void => {
    if (find?.text) ready()?.findInPage(find.text, { forward, findNext: true })
  }
  const closeFind = (): void => {
    setFind(null)
    ready()?.stopFindInPage('clearSelection')
  }

  const toggleStar = (): void => {
    if (!url) return
    if (!bookmarkFor(bookmarks, url)) addBookmark(url, titleNow() || hostOf(url))
    setStarOpen(true)
  }

  const zoomBy = (by: number): void => {
    if (wcId !== null) void window.api.webZoom(wcId, by)
  }

  const handleKey = (key: string): void => {
    if (key === 'find') openFind()
    else if (key === 'find-next') find ? findNext(true) : openFind()
    else if (key === 'find-previous') find ? findNext(false) : openFind()
    else if (key === 'escape') {
      if (find) closeFind()
      setField(null)
    } else if (key === 'bookmark') toggleStar()
    else if (key === 'history') setPanel('history')
    else if (key === 'downloads') setPanel('downloads')
    else if (key === 'address') address.current?.focus()
    else if (key === 'private') openWebTab('', { privately: true })
    else if (key === 'clip') void clip()
    else if (key === 'clip-page') void clip(true)
    else if (key === 'translate') translate()
    else if (key === 'zoom-in') zoomBy(1)
    else if (key === 'zoom-out') zoomBy(-1)
    else if (key === 'zoom-reset') zoomBy(0)
  }
  const keyRef = useRef(handleKey)
  keyRef.current = handleKey
  useEffect(() => window.api.onWebKey((e) => e.wcId === wcRef.current && keyRef.current(e.key)), [])

  // The same keys while the address bar or a panel has focus.
  const onKeyDown = (e: ReactKeyboardEvent): void => {
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    const key =
      e.key === 'F3' ? (e.shiftKey ? 'find-previous' : 'find-next') : !mod || e.altKey ? null : k === 'f' ? 'find' : k === 'd' ? 'bookmark' : k === 'h' ? 'history' : k === 'j' ? 'downloads' : k === 'l' ? 'address' : k === 'n' && e.shiftKey ? 'private' : null
    if (!key || (key === 'find' && (e.target as HTMLElement).closest('.web-find'))) return
    e.preventDefault()
    e.stopPropagation()
    handleKey(key)
  }

  const fillLogin = (login: { username: string; password: string; url: string }): void => {
    const el = ready()
    setField(null)
    // Only ever into the site the login was saved for.
    if (!el || !loginMatchesPage(login.url, el.getURL())) return notify('That login is for a different site.')
    el.send('orbit:fill-login', { username: login.username, password: login.password })
  }
  const fillAddress = (): void => {
    setField(null)
    ready()?.send('orbit:fill-address', useBrowser.getState().profile)
  }

  // ---------- what's shown ----------

  const bookmark = url ? bookmarkFor(bookmarks, url) : undefined
  const drm = drmService(url)
  const offerTranslate = prefs.webOfferTranslate && !!url && isForeign(pageLang, navigator.language) && !isTranslated(url)
  const busyDownloads = downloads.filter((d) => d.state === 'downloading' || d.state === 'paused').length
  const barItems = useMemo(() => childrenOf(bookmarks, 'bar'), [bookmarks])
  const muted = !!audio?.muted

  const bookmarkMenu = (e: ReactMouseEvent, b: Bookmark): void => {
    e.preventDefault()
    const items: MenuItem[] = b.url
      ? [
          { label: 'Open in new tab', onClick: () => openWebTab(b.url!, { privately: isPrivate }) },
          ...(isPrivate ? [] : [{ label: 'Open in private tab', onClick: () => openWebTab(b.url!, { privately: true }) }]),
          { label: 'Copy link', icon: <Copy size={14} />, onClick: () => void navigator.clipboard.writeText(b.url!) },
          'separator'
        ]
      : []
    items.push({ label: 'Edit in Bookmarks…', onClick: () => setPanel('bookmarks') })
    setBarMenu({ x: e.clientX, y: e.clientY, items })
  }

  // The whole page in an ordinary window of its own, which can go full screen on another screen
  // while you use Orbit. Its video stops here and carries on there from where it had got to.
  const popOutWindow = async (): Promise<void> => {
    const found = await findVideo()
    const seconds = Number(found?.seconds) || 0
    const next = videoId ? youTubeWatchUrl(videoId, seconds) : url
    await window.api.popOutWebPage(next, videoId ? 0 : seconds).catch(notify)
  }

  return (
    <div className={`web-page ${hidden ? 'hidden' : ''} ${isPrivate ? 'private' : ''}`} data-web-tab={tab} onKeyDown={onKeyDown}>
      <form className="web-bar" onSubmit={go}>
        {isPrivate && (
          <span className="web-private-badge" title="Private tab: no history is kept, nothing is offered for saving, and its sign-ins are forgotten when Orbit closes">
            <VenetianMask size={14} /> Private
          </span>
        )}
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
        <div className="web-address-wrap">
          <input
            ref={address}
            className="web-address"
            value={typed ?? (url ? displayUrl(url) : '')}
            placeholder={isPrivate ? 'Search privately or type a web address' : 'Search Google or type a web address'}
            spellCheck={false}
            onChange={(e) => setTyped(e.target.value)}
            onFocus={(e) => {
              setTyped(url)
              requestAnimationFrame(() => e.target.select())
            }}
            onBlur={() => setTimeout(() => (setTyped(null), setSuggested([])), 120)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setTyped(null)
                e.currentTarget.blur()
              } else if (e.key === 'ArrowDown' && suggested.length) {
                e.preventDefault()
                setPick((p) => Math.min(suggested.length - 1, p + 1))
              } else if (e.key === 'ArrowUp' && suggested.length) {
                e.preventDefault()
                setPick((p) => Math.max(-1, p - 1))
              }
            }}
            data-web-address
          />
          {offerTranslate && (
            <button type="button" className="web-chip" title={`This page is in another language (${pageLang}). Translate it with Google Translate`} onClick={translate} data-web-translate>
              <Languages size={13} /> Translate
            </button>
          )}
          {Math.abs(zoom - 1) > 0.001 && (
            <button type="button" className="web-chip" title="Zoom for this site (click for 100%)" onClick={() => zoomBy(0)}>
              {Math.round(zoom * 100)}%
            </button>
          )}
          {url && (
            <button type="button" className={`icon-btn web-star ${bookmark ? 'on' : ''}`} title={bookmark ? 'Edit bookmark' : `Bookmark this page (${showKeys('Ctrl+D')})`} onClick={toggleStar} data-web-star>
              <Star size={14} />
            </button>
          )}
          {suggested.length > 0 && typed !== null && (
            <div className="web-suggest" onMouseDown={(e) => e.preventDefault()}>
              {suggested.map((s, i) => (
                <button type="button" key={s.url} className={i === pick ? 'on' : ''} onClick={() => goTo(s.url)}>
                  {s.kind === 'bookmark' ? <Star size={13} /> : <Clock size={13} />}
                  <span className="web-suggest-title">{s.title || displayUrl(s.url)}</span>
                  <span className="web-suggest-url">{displayUrl(s.url)}</span>
                </button>
              ))}
            </div>
          )}
          {starOpen && bookmark && (
            <div className="web-star-pop" onMouseDown={(e) => e.stopPropagation()}>
              <div className="web-star-head">
                <Star size={14} /> Bookmarked
              </div>
              <EditBookmark bookmark={bookmark} done={() => setStarOpen(false)} />
            </div>
          )}
        </div>
        {audio?.audible || muted ? (
          <button
            type="button"
            className={`icon-btn ${muted ? 'active' : ''}`}
            title={muted ? 'Unmute this tab' : 'Mute this tab'}
            onClick={() => wcId !== null && void window.api.webMuteTab(wcId, !muted)}
          >
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
        ) : null}
        <button type="button" className="icon-btn" title={`Save to ${prefs.webClipFolder || 'Inbox'}: the part you’ve highlighted, or the whole page, as a note with its link (${showKeys('Ctrl+Shift+S')})`} disabled={!url} onClick={() => void clip()} data-web-clip>
          <FilePlus2 size={14} />
        </button>
        <button type="button" className="icon-btn" title="Summarise this page with the AI helper" disabled={!url} onClick={() => void summarise()} data-web-summarise>
          <Sparkles size={14} />
        </button>
        {busyDownloads > 0 && (
          <button type="button" className="icon-btn active web-downloading" title={`${busyDownloads} downloading`} onClick={() => setPanel('downloads')}>
            <Download size={14} />
          </button>
        )}
        {/^https?:/i.test(url) && (
          <button type="button" className="icon-btn" title="Pop the video out into the mini window (floats over everything)" onClick={() => void popOut()}>
            <MonitorPlay size={14} />
          </button>
        )}
        {/^https?:/i.test(url) && !isPrivate && (
          <button
            type="button"
            className="icon-btn"
            title="Pop out into its own window (put it on another screen and make it full screen while you use Orbit)"
            onClick={() => void popOutWindow()}
            data-web-pop-out-window
          >
            <AppWindow size={14} />
          </button>
        )}
        <button type="button" className="icon-btn" title="Send to phone (scan a QR code)" disabled={!url} onClick={() => sendToPhone({ kind: 'link', url, title: pageTitle })}>
          <Smartphone size={14} />
        </button>
        <div className="web-menu-wrap" onMouseDown={(e) => e.stopPropagation()}>
          <button type="button" className={`icon-btn ${menu ? 'active' : ''}`} title="More" onClick={() => setMenu(!menu)} data-web-more>
            <MoreHorizontal size={15} />
          </button>
          {menu && (
            <div className="menu web-menu" onClick={() => setMenu(false)}>
              {!isPrivate && (
                <button type="button" onClick={() => openWebTab('', { privately: true })}>
                  <VenetianMask size={15} /> New private tab <kbd>{showKeys('Ctrl+Shift+N')}</kbd>
                </button>
              )}
              <button type="button" onClick={() => setPanel('bookmarks')}>
                <BookmarkIcon size={15} /> Bookmarks
              </button>
              <button type="button" onClick={() => setPanel('history')}>
                <Clock size={15} /> History <kbd>{showKeys('Ctrl+H')}</kbd>
              </button>
              <button type="button" onClick={() => setPanel('downloads')}>
                <Download size={15} /> Downloads <kbd>{showKeys('Ctrl+J')}</kbd>
              </button>
              <div className="menu-sep" />
              <button type="button" disabled={!url} onClick={openFind}>
                <Search size={15} /> Find on page <kbd>{showKeys('Ctrl+F')}</kbd>
              </button>
              <button type="button" disabled={!url || isTranslated(url)} onClick={translate}>
                <Languages size={15} /> Translate page
              </button>
              <div className="web-menu-zoom" onClick={(e) => e.stopPropagation()}>
                <span>Zoom</span>
                <button type="button" className="icon-btn" title="Zoom out" disabled={!url} onClick={() => zoomBy(-1)}>
                  <ZoomOut size={14} />
                </button>
                <button type="button" className="web-menu-zoom-pct" title="Back to 100%" disabled={!url} onClick={() => zoomBy(0)}>
                  {Math.round(zoom * 100)}%
                </button>
                <button type="button" className="icon-btn" title="Zoom in" disabled={!url} onClick={() => zoomBy(1)}>
                  <ZoomIn size={14} />
                </button>
              </div>
              <button type="button" disabled={!url} onClick={() => setSite(siteOf(url), { muted: !siteMuted || undefined })}>
                {siteMuted ? <Volume2 size={15} /> : <VolumeX size={15} />} {siteMuted ? 'Unmute' : 'Mute'} {siteOf(url) || 'this site'}
              </button>
              <button type="button" onClick={() => setPanel('sites')}>
                <Settings2 size={15} /> Site settings (permissions, zoom, sound)
              </button>
              <div className="menu-sep" />
              <button type="button" disabled={!url} onClick={() => void window.api.webOpenOutside(url)}>
                <ExternalLink size={15} /> Open in your other browser
              </button>
              <button type="button" onClick={() => setPrefs({ webBookmarksBar: !prefs.webBookmarksBar })}>
                <Star size={15} /> {prefs.webBookmarksBar ? 'Hide' : 'Show'} the bookmarks bar
              </button>
              <button type="button" onClick={() => openSpecialTab(SETTINGS_TAB)}>
                <Settings2 size={15} /> Browser settings
              </button>
              <button type="button" onClick={() => void clearBrowsingData()}>
                <Eraser size={15} /> Clear browsing data (sign out of all websites)
              </button>
            </div>
          )}
        </div>
        {loading && <div className="web-progress" />}
      </form>

      {prefs.webBookmarksBar && (
        <div className="web-bookmarks-bar" data-bookmarks-bar>
          {barItems.length === 0 && <span className="web-bookmarks-hint">Bookmarks you add (☆ or {showKeys('Ctrl+D')}) show here.</span>}
          {barItems.map((b) =>
            b.kind === 'folder' ? (
              <button key={b.id} className="web-bookmark" onClick={(e) => setFolderMenu({ id: b.id, x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom + 2 })} onContextMenu={(e) => bookmarkMenu(e, b)}>
                <Folder size={13} /> <span>{b.title || 'Folder'}</span> <ChevronDown size={11} />
              </button>
            ) : (
              <button
                key={b.id}
                className="web-bookmark"
                title={b.url}
                onClick={(e) => openLink(b.url!, e.ctrlKey || e.metaKey)}
                onAuxClick={(e) => e.button === 1 && openLink(b.url!, true)}
                onContextMenu={(e) => bookmarkMenu(e, b)}
              >
                <Globe size={12} /> <span>{b.title || hostOf(b.url!)}</span>
              </button>
            )
          )}
          <button className="web-bookmark web-bookmark-all" title="All bookmarks" onClick={() => setPanel('bookmarks')}>
            <BookmarkIcon size={12} /> All bookmarks
          </button>
        </div>
      )}
      {folderMenu && (
        <BookmarkFolderMenu
          folder={folderMenu.id}
          x={folderMenu.x}
          y={folderMenu.y}
          onOpen={(target, newTab) => {
            setFolderMenu(null)
            openLink(target, newTab)
          }}
          onClose={() => setFolderMenu(null)}
        />
      )}
      {barMenu && <ContextMenu x={barMenu.x} y={barMenu.y} items={barMenu.items} onClose={() => setBarMenu(null)} />}

      {asks.map((a) => (
        <PermissionBar key={a.id} ask={a} />
      ))}
      {offer && <SaveLoginBar offer={offer} onDone={() => setOffer(null)} />}
      {drm && drmHidden !== drm && (
        <div className="web-bar-prompt web-drm" data-web-drm>
          <ShieldAlert size={15} />
          <span className="web-bar-prompt-text">
            {drm}’s videos are protected (DRM), and Orbit’s browser can’t play protected video yet, so they won’t start here. Browsing, signing in and the rest of the site still work.
          </span>
          <button className="btn btn-primary" onClick={() => void window.api.webOpenOutside(url)}>
            Watch in your other browser
          </button>
          <button className="icon-btn" title="Hide" onClick={() => setDrmHidden(drm)}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="web-body">
        {src ? (
          // allowpopups lets links that open a new window reach main/browser.ts, which opens them in a new web tab.
          // (React only sets attributes it knows as strings, so "true" rather than true.)
          <webview ref={viewEl} src={src} partition={isPrivate ? PRIVATE_PARTITION : WEB_PARTITION} allowpopups={'true' as unknown as boolean} className="web-view" />
        ) : (
          <div className="web-start">
            {isPrivate ? <VenetianMask size={36} strokeWidth={1.2} /> : <Globe size={36} strokeWidth={1.2} />}
            <p>{isPrivate ? 'A private tab' : 'Search or type a web address above.'}</p>
            <span>
              {isPrivate
                ? 'Pages you visit here aren’t kept in your history, Orbit doesn’t offer to save logins, and anything sites store (sign-ins, cookies) is forgotten when Orbit closes. Downloads and bookmarks you make are still kept.'
                : `Websites open here walled off from your notes. Sign-ins are remembered until you clear browsing data. Tip: ${CLICK_MOD} a link in a note to open it beside the note.`}
            </span>
          </div>
        )}
        {find && (
          <form
            className="web-find"
            data-web-find
            onSubmit={(e) => {
              e.preventDefault()
              findNext(true)
            }}
          >
            <input
              ref={findInput}
              className="text-input"
              autoFocus
              placeholder="Find on page"
              value={find.text}
              onChange={(e) => {
                const text = e.target.value
                setFind({ text, active: 0, matches: 0 })
                if (text) ready()?.findInPage(text)
                else ready()?.stopFindInPage('clearSelection')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  closeFind()
                } else if (e.key === 'Enter' && e.shiftKey) {
                  e.preventDefault()
                  findNext(false)
                }
              }}
            />
            <span className="web-find-count">{find.text ? `${find.active}/${find.matches}` : ''}</span>
            <button type="button" className="icon-btn" title="Previous (Shift+Enter)" disabled={!find.matches} onClick={() => findNext(false)}>
              <ArrowUp size={14} />
            </button>
            <button type="button" className="icon-btn" title="Next (Enter)" disabled={!find.matches} onClick={() => findNext(true)}>
              <ArrowDown size={14} />
            </button>
            <button type="button" className="icon-btn" title="Close (Esc)" onClick={closeFind}>
              <X size={14} />
            </button>
          </form>
        )}
        {field && url && (
          <FillPopup
            focus={field}
            zoom={zoom}
            pageUrl={url}
            profile={profile}
            onFillLogin={fillLogin}
            onFillAddress={fillAddress}
            onHover={(over) => (overFill.current = over)}
            onClose={() => setField(null)}
          />
        )}
        {panel && (
          <div className="web-panel" data-web-panel={panel}>
            <div className="web-panel-head">
              <strong>{PANEL_TITLES[panel]}</strong>
              <button className="icon-btn" title="Close" onClick={() => setPanel(null)}>
                <X size={14} />
              </button>
            </div>
            {panel === 'bookmarks' && <BookmarksPanel onOpen={openLink} />}
            {panel === 'history' && (isPrivate ? <p className="web-panel-empty">Private tabs don’t keep history. Your history from normal tabs is in any other web tab.</p> : <HistoryPanel onOpen={openLink} />)}
            {panel === 'downloads' && (
              <div className="web-panel-body">
                <DownloadsList />
              </div>
            )}
            {panel === 'sites' && <SitesPanel current={siteOf(url) || undefined} />}
            {panel === 'summary' && summary && (
              <div className="web-panel-body web-summary" data-web-summary={summary.state}>
                <p className="web-summary-of">{summary.title}</p>
                {summary.state === 'working' && (
                  <p className="ai-working">
                    <Loader2 size={14} className="spin" /> Reading the page…
                  </p>
                )}
                {summary.state === 'nokey' && (
                  <>
                    <p className="export-note">Summaries use the offline AI (a free download that runs on this computer) or your own Anthropic API key. Both are in Settings → AI helper.</p>
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        openSpecialTab(SETTINGS_TAB)
                        openAiSettings()
                      }}
                    >
                      Set up the AI helper
                    </button>
                  </>
                )}
                {summary.state === 'error' && <p className="setting-warning">{summary.text}</p>}
                {summary.state === 'done' && (
                  <>
                    <div className="ai-result">{summary.text}</div>
                    <div className="web-summary-foot">
                      <button className="btn" onClick={() => (navigator.clipboard.writeText(summary.text ?? ''), notify('Copied', 'info'))}>
                        <Copy size={13} /> Copy
                      </button>
                      <button className="btn btn-primary" onClick={() => void clipPage({ title: summary.title, url: summary.url, text: '', selection: '', summary: summary.text }).catch(notify)}>
                        <FilePlus2 size={13} /> Save to {prefs.webClipFolder || 'Inbox'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
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
              <button className="btn" onClick={() => void window.api.webOpenOutside(failure.url)}>
                Open in your other browser
              </button>
            </div>
          </div>
        )}
      </div>
      {starOpen && <div className="web-star-away" onMouseDown={() => setStarOpen(false)} />}
    </div>
  )
}

/** A folder on the bookmarks bar, opened as a list (its folders open in place, with a way back). */
function BookmarkFolderMenu({ folder, x, y, onOpen, onClose }: { folder: string; x: number; y: number; onOpen: (url: string, newTab: boolean) => void; onClose: () => void }) {
  const all = useBrowser((s) => s.bookmarks)
  const [path, setPath] = useState<string[]>([folder])
  const here = path[path.length - 1]
  const items = childrenOf(all, here)
  useEffect(() => {
    const away = (e: MouseEvent): void => {
      if (!(e.target as Element).closest?.('.web-folder-menu')) onClose()
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [onClose])
  return (
    <div className="menu web-folder-menu" style={{ left: x, top: y }}>
      {path.length > 1 && (
        <button type="button" onClick={() => setPath(path.slice(0, -1))}>
          <ArrowLeft size={14} /> Back
        </button>
      )}
      {items.length === 0 && <span className="web-folder-empty">Empty folder</span>}
      {items.map((b) =>
        b.kind === 'folder' ? (
          <button type="button" key={b.id} onClick={() => setPath([...path, b.id])}>
            <Folder size={14} /> {b.title || 'Folder'}
          </button>
        ) : (
          <button type="button" key={b.id} title={b.url} onClick={(e) => onOpen(b.url!, e.ctrlKey || e.metaKey)} onAuxClick={(e) => e.button === 1 && onOpen(b.url!, true)}>
            <Globe size={14} /> {b.title || hostOf(b.url!)}
          </button>
        )
      )}
    </div>
  )
}
