import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft,
  ArrowLeftRight,
  BookMarked,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Focus,
  GalleryVertical,
  ImageDown,
  Loader2,
  Moon,
  Music2,
  RectangleVertical,
  ScanText,
  StretchHorizontal,
  Timer,
  X
} from 'lucide-react'
import {
  chapterAt,
  DEFAULT_COMIC_SETTINGS,
  spreads,
  viewOf,
  type ComicOpened,
  type ComicPage,
  type ComicPlaylist,
  type ComicSettings
} from '@shared/comics'
import { findPanels, grayOf, zoomTo, type Panel } from '../../lib/comicPanels'
import { musicPlay, useMusic } from '../../store/music'
import { usePrefs } from '../../store/prefs'
import { setQuiet } from '../../store/quiet'
import { errorMessage } from '../../lib/paths'
import type { Dest } from '../CaptureApp'
import { ChapterMenu, MusicChooser, NoteButton, saveToNote, ScanCard, type Scan } from './ComicExtras'

const pageUrl = (id: string, n: number): string => `vault://comic/${id}/${n}`
const HUD_KEY = 'comics:hud'
/** In the long scroll, a page's place is read this far down the screen. */
const READ_LINE = 0.3
const GAP = 6

/** The width-to-height of a page whose size isn't known (a usual comic page). */
const aspect = (p: ComicPage): number => (p.w > 0 && p.h > 0 ? p.h / p.w : 1.54)

function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`
}

/** A file name for a picture saved from a comic: "Walking-Dead-Compendium-1-p123.png". */
const pictureName = (title: string, page: number, ext: string): string =>
  `${title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'comic'}-p${page + 1}.${ext}`

/** The comic reader: one page, two-page spreads or a long scroll, with panel zoom, zen mode and scanning text. */
export default function ComicReader({ id, onClose }: { id: string; onClose: () => void }) {
  const [opened, setOpened] = useState<ComicOpened | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState<{ done: number; total: number } | null>(null)
  const [settings, setSettings] = useState<ComicSettings>(DEFAULT_COMIC_SETTINGS)
  const [page, setPage] = useState(0)
  const [offset, setOffset] = useState(0)
  const [panelMode, setPanelMode] = useState(false)
  const [panel, setPanel] = useState<number | null>(null)
  const [panels, setPanels] = useState<Record<number, Panel[]>>({})
  const [scanMode, setScanMode] = useState(false)
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [scan, setScan] = useState<Scan | null>(null)
  const [pop, setPop] = useState<null | 'chapters' | 'music'>(null)
  const [zen, setZen] = useState(false)
  const [zenStart, setZenStart] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [hud, setHud] = useState(() => localStorage.getItem(HUD_KEY) !== 'off')
  const [chrome, setChrome] = useState(true)
  const [today, setToday] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const [scrollTop, setScrollTop] = useState(0)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const furthest = useRef(-1)
  const restore = useRef(true)
  const chromeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const say = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3000)
  }, [])

  // ---- opening ----
  useEffect(() => {
    let live = true
    const off = window.api.onComicsPreparing((p) => p.id === id && live && setPreparing(p.done < p.total ? { done: p.done, total: p.total } : null))
    window.api.comicsOpen(id).then(
      (o) => {
        if (!live) return
        setOpened(o)
        setSettings(o.book.settings)
        const start = Math.min(o.book.progress?.page ?? 0, o.pages.length - 1)
        setPage(start)
        setOffset(o.book.progress?.offset ?? 0)
        furthest.current = start
        setPreparing(null)
      },
      (err) => live && setError(errorMessage(err))
    )
    window.api.comicsShelf().then((s) => live && setToday(s.pagesToday), () => undefined)
    return () => {
      live = false
      off()
    }
  }, [id])

  const pages = opened?.pages ?? []
  const count = pages.length
  const title = opened?.book.title ?? ''
  const chapters = settings.chapters ?? opened?.foundChapters ?? []
  // Panel zoom works on one page at a time.
  const layout = panelMode && settings.layout !== 'scroll' ? 'single' : settings.layout
  const views = useMemo(() => (layout === 'spread' ? spreads(pages, settings.coverAlone) : pages.map((_, i) => [i])), [layout, pages, settings.coverAlone])
  const view = viewOf(views, page)

  const changeSettings = (patch: Partial<ComicSettings>): void => {
    setSettings((s) => ({ ...s, ...patch }))
    void window.api.comicsSettings(id, patch).catch(() => undefined)
  }

  // ---- remembering where you are ----
  useEffect(() => {
    if (!opened) return
    const t = setTimeout(() => void window.api.comicsProgress(id, page, offset).catch(() => undefined), 400)
    return () => clearTimeout(t)
  }, [id, opened, page, offset])

  // Pages read today: each new page you reach going forwards (not jumps across an issue).
  useEffect(() => {
    if (!opened) return
    const gained = page - furthest.current
    if (gained > 0) {
      furthest.current = page
      if (gained <= 3) void window.api.comicsTurned(gained).then(setToday, () => undefined)
    } else if (gained < -3) furthest.current = page
  }, [page, opened])

  // Load the next pages before you get to them.
  useEffect(() => {
    if (!opened || layout === 'scroll') return
    for (const v of views.slice(view + 1, view + 3)) for (const n of v) new Image().src = pageUrl(id, n)
  }, [id, opened, view, views, layout])

  // ---- the size of the reading area ----
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setStage({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
    // Zen mode moves the reader to cover the window, so the reading area is a new one.
  }, [opened, layout, zen])

  // ---- long scroll ----
  const column = Math.min(stage.w, settings.fit === 'width' ? stage.w : 900)
  const tops = useMemo(() => {
    const out: number[] = []
    let y = 0
    for (const p of pages) {
      out.push(y)
      y += column * aspect(p) + GAP
    }
    out.push(y)
    return out
  }, [pages, column])
  const heightOf = (n: number): number => tops[n + 1] - tops[n] - GAP

  /** The page at a point in the long scroll (binary search). */
  const pageAtY = (y: number): number => {
    let lo = 0
    let hi = count - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (tops[mid] <= y) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  const scrollToPage = useCallback(
    (n: number, within = 0) => {
      const el = stageRef.current
      if (!el) return
      el.scrollTop = Math.max(0, tops[n] + within * (tops[n + 1] - tops[n] - GAP) - el.clientHeight * READ_LINE)
    },
    [tops]
  )

  useLayoutEffect(() => {
    if (layout !== 'scroll' || !opened || !column) return
    if (restore.current) {
      restore.current = false
      scrollToPage(page, offset)
      setScrollTop(stageRef.current?.scrollTop ?? 0)
    }
  }, [layout, opened, column, page, offset, scrollToPage])

  const onScroll = (): void => {
    const el = stageRef.current
    if (!el || layout !== 'scroll') return
    setScrollTop(el.scrollTop)
    const y = el.scrollTop + el.clientHeight * READ_LINE
    const n = pageAtY(y)
    setPage(n)
    setOffset(Math.max(0, Math.min(1, (y - tops[n]) / Math.max(1, heightOf(n)))))
  }

  // ---- turning pages (and panels) ----
  const goPage = useCallback(
    (n: number) => {
      const p = Math.max(0, Math.min(count - 1, n))
      setPage(p)
      setOffset(0)
      setPanel(null)
      if (layout === 'scroll') scrollToPage(p)
      else stageRef.current?.scrollTo({ top: 0 })
    },
    [count, layout, scrollToPage]
  )

  const panelsHere = panels[page] ?? []
  const next = useCallback(() => {
    if (layout === 'scroll') {
      stageRef.current?.scrollBy({ top: stageRef.current.clientHeight * 0.85, behavior: 'smooth' })
      return
    }
    if (panelMode && panelsHere.length) {
      if (panel === null) return setPanel(0)
      if (panel < panelsHere.length - 1) return setPanel(panel + 1)
    }
    if (view >= views.length - 1) {
      void window.api.comicsProgress(id, page, 1, true)
      say('That’s the end. Finished!')
      return
    }
    goPage(views[view + 1][0])
    if (panelMode) setPanel(0)
  }, [layout, panelMode, panelsHere.length, panel, view, views, goPage, id, page, say])

  const prev = useCallback(() => {
    if (layout === 'scroll') {
      stageRef.current?.scrollBy({ top: -stageRef.current.clientHeight * 0.85, behavior: 'smooth' })
      return
    }
    if (panelMode && panel !== null && panel > 0) return setPanel(panel - 1)
    if (view <= 0) return
    goPage(views[view - 1][0])
    // Going back lands on the last panel of the page before.
    if (panelMode) setPanel(-1)
  }, [layout, panelMode, panel, view, views, goPage])

  // A panel of -1 means "the last one", once the page's panels are known.
  useEffect(() => {
    if (panel === -1 && panels[page]) setPanel(panels[page].length ? panels[page].length - 1 : null)
  }, [panel, panels, page])

  const findPagePanels = (n: number, img: HTMLImageElement): void => {
    setNatural({ w: img.naturalWidth, h: img.naturalHeight })
    if (!panelMode || panels[n]) return
    const g = grayOf(img)
    setPanels((all) => ({ ...all, [n]: g ? findPanels(g.gray, g.w, g.h, settings.rtl) : [] }))
  }
  // Turning panel zoom on for a page that's already showing.
  useEffect(() => {
    if (panelMode && imgRef.current?.complete && imgRef.current.naturalWidth && !panels[page]) findPagePanels(page, imgRef.current)
  })

  // ---- zen mode ----
  const enterZen = (): void => {
    restore.current = true
    setZen(true)
    setZenStart(Date.now())
    setQuiet('comics', true)
    void window.api.setFullScreen(true)
    if (settings.playlist) playPlaylist(settings.playlist)
    else setPop('music')
  }
  const leaveZen = useCallback(() => {
    restore.current = true
    setZen(false)
    setQuiet('comics', false)
    void window.api.setFullScreen(false)
  }, [])
  useEffect(
    () => () => {
      // Leaving the reader (or the tab) ends zen mode.
      setQuiet('comics', false)
    },
    []
  )
  useEffect(() => {
    if (zen) void window.api.setFullScreen(true)
    return () => {
      if (zen) void window.api.setFullScreen(false)
    }
  }, [zen])
  useEffect(() => {
    if (!zen) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [zen])

  const playPlaylist = (p: ComicPlaylist): void => {
    void musicPlay(p.uri).then((ok) => say(ok ? `Playing ${p.name}` : (useMusic.getState().error ?? 'Couldn’t start the music.')))
  }

  // In zen mode the bar hides until the mouse moves.
  const wake = (): void => {
    setChrome(true)
    clearTimeout(chromeTimer.current)
    if (zen) chromeTimer.current = setTimeout(() => setChrome(false), 2500)
  }
  useEffect(() => {
    if (zen) wake()
    else setChrome(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zen])

  // ---- keys ----
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true })
  }, [opened, zen])
  const onKey = (e: KeyboardEvent | ReactKeyboardEvent): void => {
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return
    const forward = settings.rtl ? 'ArrowLeft' : 'ArrowRight'
    const back = settings.rtl ? 'ArrowRight' : 'ArrowLeft'
    const k = e.key
    let done = true
    if (k === 'Escape') {
      if (box || scanMode) (setBox(null), setScanMode(false))
      else if (scan) setScan(null)
      else if (pop) setPop(null)
      else if (panel !== null) setPanel(null)
      else if (zen) leaveZen()
      else done = false
    } else if (k === forward || k === 'PageDown' || (k === ' ' && !e.shiftKey) || (layout !== 'scroll' && k === 'ArrowDown' && !panelMode)) next()
    else if (k === back || k === 'PageUp' || (k === ' ' && e.shiftKey) || (layout !== 'scroll' && k === 'ArrowUp' && !panelMode)) prev()
    else if (k === 'Home') goPage(0)
    else if (k === 'End') goPage(count - 1)
    else if (k === 'z' || k === 'Z') togglePanels()
    else if (k === 's' || k === 'S') toggleScan()
    else if (k === 'f' || k === 'F') (zen ? leaveZen() : enterZen())
    else if (k === 't' || k === 'T') toggleHud()
    else done = false
    if (done) e.preventDefault()
  }
  // In zen mode the keys work wherever the focus is.
  useEffect(() => {
    if (!zen) return
    const h = (e: KeyboardEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) onKey(e)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const togglePanels = (): void => {
    setPanelMode((m) => !m)
    setPanel(null)
    setScanMode(false)
  }
  const toggleScan = (): void => {
    setScanMode((m) => !m)
    setBox(null)
  }
  const toggleHud = (): void => {
    setHud((h) => {
      localStorage.setItem(HUD_KEY, h ? 'off' : 'on')
      return !h
    })
  }

  // ---- clicking the page ----
  const onStageClick = (e: ReactMouseEvent): void => {
    if (scanMode || (e.target as HTMLElement).closest('button, input, .comic-scan, .comic-pop, .comic-music')) return
    rootRef.current?.focus({ preventScroll: true })
    if (panelMode && layout === 'single') {
      const img = imgRef.current
      if (panel !== null) return void (e.clientX > window.innerWidth / 2 ? next() : prev())
      if (img && panelsHere.length) {
        const r = img.getBoundingClientRect()
        const fx = (e.clientX - r.left) / r.width
        const fy = (e.clientY - r.top) / r.height
        const hit = panelsHere.findIndex((p) => fx >= p.x && fx <= p.x + p.w && fy >= p.y && fy <= p.y + p.h)
        if (hit >= 0) return setPanel(hit)
      }
      if (!panelsHere.length && panels[page]) say('No panels found on this page; showing it whole.')
      return
    }
    if (layout === 'scroll') return
    // The outer thirds turn the page.
    const r = stageRef.current!.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    if (x < 0.3) (settings.rtl ? next : prev)()
    else if (x > 0.7) (settings.rtl ? prev : next)()
  }

  // ---- scanning a box ----
  const onBoxDown = (e: ReactPointerEvent): void => {
    if (e.button !== 0) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setBox({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY })
  }
  const onBoxMove = (e: ReactPointerEvent): void => setBox((b) => (b ? { ...b, x1: e.clientX, y1: e.clientY } : b))
  const onBoxUp = (): void => {
    const b = box
    setBox(null)
    if (!b) return
    const x = Math.min(b.x0, b.x1)
    const y = Math.min(b.y0, b.y1)
    const w = Math.abs(b.x1 - b.x0)
    const h = Math.abs(b.y1 - b.y0)
    if (w < 8 || h < 8) return
    // The page under the middle of the box.
    const img = document.elementsFromPoint(x + w / 2, y + h / 2).find((el) => el instanceof HTMLImageElement && el.dataset.comicPage) as HTMLImageElement | undefined
    if (!img) return say('Draw the box over a page.')
    const n = Number(img.dataset.comicPage)
    const png = cropOf(img, x, y, w, h, true)
    if (!png) return say('Couldn’t read that part of the page.')
    setScanMode(false)
    setScan({ png, page: n, text: null })
    window.api.comicsReadText(png).then(
      (text) => setScan((s) => (s && s.png === png ? { ...s, text } : s)),
      (err) => setScan((s) => (s && s.png === png ? { ...s, text: '', error: errorMessage(err) } : s))
    )
  }

  // ---- saving pictures into notes ----
  const attachmentFolder = usePrefs((s) => s.prefs.attachmentFolder)
  const savePicture = async (dest: Dest, bytes: Uint8Array, n: number, ext: string): Promise<void> => {
    try {
      const path = await window.api.saveAttachment(attachmentFolder, pictureName(title, n, ext), bytes)
      say(`Saved in ${await saveToNote(dest, `![${title}, page ${n + 1}](vault:${path})`)}`)
    } catch (err) {
      say(errorMessage(err))
    }
  }
  const saveShown = async (dest: Dest): Promise<void> => {
    // Zoomed into a panel: just that panel.
    const img = imgRef.current
    if (panel !== null && panel >= 0 && img && panelsHere[panel]) {
      const p = panelsHere[panel]
      const png = cropNatural(img, p.x * img.naturalWidth, p.y * img.naturalHeight, p.w * img.naturalWidth, p.h * img.naturalHeight, false)
      if (png) return savePicture(dest, png, page, 'png')
    }
    const data = new Uint8Array(await (await fetch(pageUrl(id, page))).arrayBuffer())
    const ext = (pages[page]?.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'jpg').toLowerCase()
    return savePicture(dest, data, page, ext)
  }

  // ---- drawing ----
  if (error) {
    return (
      <div className="comic-reader comic-message" data-comic-error>
        <p>{error}</p>
        <button className="btn" onClick={onClose}>
          <ArrowLeft size={14} /> Back to the shelf
        </button>
      </div>
    )
  }
  if (!opened) {
    return (
      <div className="comic-reader comic-message" data-comic-loading>
        <Loader2 size={22} className="spin" />
        {preparing ? (
          <>
            <p>Getting the pages ready (only the first time)… {preparing.done.toLocaleString()} of {preparing.total.toLocaleString()}</p>
            <span className="comic-bar wide">
              <span style={{ width: `${(preparing.done / Math.max(1, preparing.total)) * 100}%` }} />
            </span>
          </>
        ) : (
          <p>Opening…</p>
        )}
        <button className="btn" onClick={onClose}>
          Back to the shelf
        </button>
      </div>
    )
  }

  const chapterIndex = chapterAt(chapters, page)
  const shownPages = layout === 'scroll' ? [] : settings.rtl ? [...views[view]].reverse() : views[view]

  // Panel zoom: where the page sits and how it's moved and scaled to fill the screen with one panel.
  let zoom: { left: number; top: number; w: number; h: number; transform: string } | null = null
  let spotlight: { left: number; top: number; width: number; height: number } | null = null
  if (layout === 'single' && natural && stage.w && (panelMode || settings.fit === 'page')) {
    const s0 = Math.min(stage.w / natural.w, stage.h / natural.h)
    const dw = natural.w * s0
    const dh = natural.h * s0
    const bx = (stage.w - dw) / 2
    const by = (stage.h - dh) / 2
    const p = panel !== null && panel >= 0 ? panelsHere[panel] : undefined
    const z = p ? zoomTo(p, dw, dh, bx, by, stage.w, stage.h) : { tx: 0, ty: 0, k: 1 }
    zoom = { left: bx, top: by, w: dw, h: dh, transform: `translate(${z.tx}px, ${z.ty}px) scale(${z.k})` }
    // The rest of the page is dimmed round the panel (which is in the middle of the screen).
    if (p) {
      const pw = p.w * dw * z.k
      const ph = p.h * dh * z.k
      spotlight = { left: (stage.w - pw) / 2, top: (stage.h - ph) / 2, width: pw, height: ph }
    }
  }

  // The long scroll draws only the pages near the screen.
  let first = 0
  let last = -1
  if (layout === 'scroll' && count) {
    first = Math.max(0, pageAtY(scrollTop) - 2)
    last = Math.min(count - 1, pageAtY(scrollTop + stage.h) + 3)
  }

  const reader = (
    <div
      ref={rootRef}
      className={`comic-reader ${zen ? 'zen' : ''} ${chrome ? '' : 'hide-chrome'} ${scanMode ? 'scanning' : ''} ${panelMode ? 'panels' : ''}`}
      tabIndex={0}
      onKeyDown={(e) => onKey(e)}
      onMouseMove={wake}
      data-comic-reader
      data-layout={layout}
    >
      <div className="comic-bar-top" onMouseEnter={() => clearTimeout(chromeTimer.current)}>
        <button className="icon-btn" onClick={() => (zen ? leaveZen() : onClose())} title={zen ? 'Leave zen mode (Esc)' : 'Back to the shelf'} data-comic-back>
          {zen ? <X size={16} /> : <ArrowLeft size={16} />}
        </button>
        <span className="comic-title" title={opened.book.fileName}>
          {title}
        </span>
        <span className="comic-pop-anchor">
          <button className="btn btn-ghost comic-chapter-btn" onClick={() => setPop(pop === 'chapters' ? null : 'chapters')} title="Jump to an issue or chapter" data-comic-chapters-btn>
            <BookMarked size={14} /> {chapterIndex >= 0 ? chapters[chapterIndex].title : 'Issues'} <ChevronDown size={12} />
          </button>
          {pop === 'chapters' && (
            <ChapterMenu
              chapters={chapters}
              own={!!settings.chapters}
              page={page}
              onJump={(n) => {
                setPop(null)
                goPage(n)
              }}
              onChange={(c) => changeSettings({ chapters: c })}
              onClose={() => setPop(null)}
            />
          )}
        </span>
        <span className="comic-pageno" data-comic-pageno>
          <input
            type="number"
            min={1}
            max={count}
            value={page + 1}
            onChange={(e) => e.target.value && goPage(Number(e.target.value) - 1)}
            title="Go to page"
          />
          <span>/ {count.toLocaleString()}</span>
        </span>
        <span className="comic-spacer" />
        <div className="comic-seg" role="group" aria-label="How pages are shown">
          <button className={settings.layout === 'single' ? 'active' : ''} onClick={() => ((restore.current = true), changeSettings({ layout: 'single' }))} title="One page at a time" data-comic-layout="single">
            <RectangleVertical size={14} />
          </button>
          <button className={settings.layout === 'spread' ? 'active' : ''} onClick={() => ((restore.current = true), changeSettings({ layout: 'spread' }))} title="Two-page spreads" data-comic-layout="spread">
            <Columns2 size={14} />
          </button>
          <button
            className={settings.layout === 'scroll' ? 'active' : ''}
            onClick={() => {
              restore.current = true
              setPanelMode(false)
              changeSettings({ layout: 'scroll' })
            }}
            title="Long scroll"
            data-comic-layout="scroll"
          >
            <GalleryVertical size={14} />
          </button>
        </div>
        <button className={`icon-btn ${settings.fit === 'width' ? 'active' : ''}`} onClick={() => changeSettings({ fit: settings.fit === 'width' ? 'page' : 'width' })} title={settings.fit === 'width' ? 'Fit the whole page on screen' : 'Fill the width (scroll down the page)'} data-comic-fit>
          <StretchHorizontal size={15} />
        </button>
        <button className={`icon-btn ${settings.rtl ? 'active' : ''}`} onClick={() => changeSettings({ rtl: !settings.rtl })} title={settings.rtl ? 'Reading right to left (manga). Click for left to right' : 'Read right to left (manga)'} data-comic-rtl>
          <ArrowLeftRight size={15} />
        </button>
        {settings.layout === 'spread' && (
          <button className={`icon-btn ${settings.coverAlone ? 'active' : ''}`} onClick={() => changeSettings({ coverAlone: !settings.coverAlone })} title="Cover on its own (if the spreads look out of step, click this)">
            <span className="comic-cover-toggle">1</span>
          </button>
        )}
        <span className="comic-divider" />
        <button className={`icon-btn ${panelMode ? 'active' : ''}`} onClick={togglePanels} title="Panel zoom (Z): click a panel to fill the screen with it, then → for the next" data-comic-panel-mode disabled={settings.layout === 'scroll'}>
          <Focus size={15} />
        </button>
        <button className={`icon-btn ${scanMode ? 'active' : ''}`} onClick={toggleScan} title="Scan text (S): draw a box round a speech bubble or caption" data-comic-scan-mode>
          <ScanText size={15} />
        </button>
        <span data-comic-save-page>
          <NoteButton label="" icon={<ImageDown size={15} />} onSave={saveShown} title={panel !== null ? 'Save this panel as a picture in a note' : 'Save this page as a picture in a note'} />
        </span>
        <span className="comic-divider" />
        {zen && (
          <>
            <button className="icon-btn" onClick={() => setPop(pop === 'music' ? null : 'music')} title={settings.playlist ? `Music: ${settings.playlist.name}` : 'Pick music'} data-comic-music-btn>
              <Music2 size={15} />
            </button>
            <button className={`icon-btn ${hud ? 'active' : ''}`} onClick={toggleHud} title="Reading timer and pages read today (T)">
              <Timer size={15} />
            </button>
          </>
        )}
        <button className={`btn ${zen ? '' : 'btn-primary'}`} onClick={() => (zen ? leaveZen() : enterZen())} title="Zen mode (F): full screen, dark, no pop-ups, your music" data-comic-zen>
          <Moon size={14} /> {zen ? 'Leave zen' : 'Zen'}
        </button>
      </div>

      <div
        ref={stageRef}
        className={`comic-stage fit-${settings.fit}`}
        onScroll={onScroll}
        onClick={onStageClick}
        onDoubleClick={(e) => {
          if (!panelMode && !scanMode && layout !== 'scroll' && !(e.target as HTMLElement).closest('button')) changeSettings({ fit: settings.fit === 'width' ? 'page' : 'width' })
        }}
        data-comic-stage
      >
        {layout === 'scroll' ? (
          <div className="comic-column" style={{ height: tops[count], width: column }}>
            {pages.slice(first, last + 1).map((_p, i) => {
              const n = first + i
              return (
                <img
                  key={n}
                  className="comic-img"
                  src={pageUrl(id, n)}
                  crossOrigin="anonymous"
                  alt={`Page ${n + 1}`}
                  draggable={false}
                  data-comic-page={n}
                  style={{ top: tops[n], height: heightOf(n), width: column }}
                />
              )
            })}
          </div>
        ) : zoom ? (
          <img
            ref={imgRef}
            key={page}
            className={`comic-img zoomable ${panel !== null ? 'zoomed' : ''}`}
            src={pageUrl(id, page)}
            crossOrigin="anonymous"
            alt={`Page ${page + 1}`}
            draggable={false}
            data-comic-page={page}
            onLoad={(e) => findPagePanels(page, e.currentTarget)}
            style={{ left: zoom.left, top: zoom.top, width: zoom.w, height: zoom.h, transform: zoom.transform }}
          />
        ) : (
          <div className={`comic-view ${shownPages.length > 1 ? 'two' : 'one'}`}>
            {shownPages.map((n) => (
              <img
                key={n}
                ref={shownPages.length === 1 ? imgRef : undefined}
                className="comic-img"
                src={pageUrl(id, n)}
                crossOrigin="anonymous"
                alt={`Page ${n + 1}`}
                draggable={false}
                data-comic-page={n}
                onLoad={(e) => shownPages.length === 1 && findPagePanels(n, e.currentTarget)}
              />
            ))}
          </div>
        )}
        {spotlight && <div className="comic-spotlight" style={spotlight} />}
        {panelMode && panel === null && layout === 'single' && zoom && panelsHere.length > 0 && (
          <div className="comic-panel-hints" style={{ left: zoom.left, top: zoom.top, width: zoom.w, height: zoom.h }}>
            {panelsHere.map((p, i) => (
              <span key={i} style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.w * 100}%`, height: `${p.h * 100}%` }} />
            ))}
          </div>
        )}
      </div>

      {layout !== 'scroll' && (
        <>
          <button className="comic-turn left" onClick={settings.rtl ? next : prev} title={settings.rtl ? 'Next' : 'Back'} aria-label={settings.rtl ? 'Next page' : 'Previous page'}>
            <ChevronLeft size={22} />
          </button>
          <button className="comic-turn right" onClick={settings.rtl ? prev : next} title={settings.rtl ? 'Back' : 'Next'} aria-label={settings.rtl ? 'Previous page' : 'Next page'}>
            <ChevronRight size={22} />
          </button>
        </>
      )}

      <div className="comic-bar-bottom">
        <input
          type="range"
          className={`comic-slider ${settings.rtl ? 'rtl' : ''}`}
          min={0}
          max={Math.max(0, count - 1)}
          value={page}
          onChange={(e) => goPage(Number(e.target.value))}
          title={`Page ${page + 1} of ${count}`}
          data-comic-slider
        />
      </div>

      {scanMode && (
        <div className="comic-scan-layer" onPointerDown={onBoxDown} onPointerMove={onBoxMove} onPointerUp={onBoxUp} data-comic-scan-layer>
          {!box && <span className="comic-scan-tip">Draw a box round a speech bubble or caption · Esc to stop</span>}
          {box && <span className="comic-box" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />}
        </div>
      )}

      {scan && (
        <ScanCard
          scan={scan}
          title={title}
          say={say}
          onClose={() => setScan(null)}
          onSavePicture={(d) => savePicture(d, scan.png, scan.page, 'png')}
        />
      )}

      {pop === 'music' && (
        <MusicChooser
          current={settings.playlist}
          onClose={() => setPop(null)}
          onPick={(p, remember) => {
            setPop(null)
            if (remember) changeSettings({ playlist: p })
            if (p) playPlaylist(p)
          }}
        />
      )}

      {zen && hud && (
        <div className="comic-hud" data-comic-hud>
          <span>
            <Timer size={12} /> {formatClock(now - zenStart)}
          </span>
          <span>{today.toLocaleString()} {today === 1 ? 'page' : 'pages'} today</span>
          <span>
            {page + 1} / {count}
          </span>
        </div>
      )}

      {toast && <div className="comic-toast">{toast}</div>}
    </div>
  )
  // Zen mode covers the whole window, above everything else in Orbit.
  return zen ? (
    <>
      <div className="comic-reader comic-zen-placeholder" />
      {createPortal(reader, document.body)}
    </>
  ) : (
    reader
  )
}

/** A picture of part of a page (in screen pixels over `img`), at the page's full size. */
function cropOf(img: HTMLImageElement, x: number, y: number, w: number, h: number, forReading: boolean): Uint8Array | null {
  const r = img.getBoundingClientRect()
  const sx = img.naturalWidth / r.width
  const sy = img.naturalHeight / r.height
  const x0 = Math.max(0, (x - r.left) * sx)
  const y0 = Math.max(0, (y - r.top) * sy)
  const x1 = Math.min(img.naturalWidth, (x + w - r.left) * sx)
  const y1 = Math.min(img.naturalHeight, (y + h - r.top) * sy)
  if (x1 - x0 < 4 || y1 - y0 < 4) return null
  return cropNatural(img, x0, y0, x1 - x0, y1 - y0, forReading)
}

/** Cuts out part of a page (in its own pixels) as a PNG. For reading, small text is enlarged and made grey, which the text reader prefers. */
function cropNatural(img: HTMLImageElement, x: number, y: number, w: number, h: number, forReading: boolean): Uint8Array | null {
  const scale = forReading ? Math.min(4, Math.max(1, 1200 / Math.max(w, 1))) : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  if (forReading) ctx.filter = 'grayscale(1) contrast(1.4)'
  ctx.imageSmoothingQuality = 'high'
  try {
    ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height)
    const url = canvas.toDataURL('image/png')
    const bin = atob(url.slice(url.indexOf(',') + 1))
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}
