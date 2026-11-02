import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Brain, Download, House, Library, Pause, Play, Search, Shield, ShieldCheck, Trash2, X } from 'lucide-react'
import { bytesText, DEFAULT_PICTURES, pageUrl, type WikiAnswer, type WikiCheck, type WikiHit, type WikiInfo, type WikiPageView, type WikiPictureChoice, type WikiSpoilerView } from '@shared/wiki'
import type { WikiPartsChoice, WikiSpoilerSettings } from '@shared/wikiSpoilers'
import { goWiki, useWiki, wikiBack, wikiForward, type WikiPlace } from '../../store/wiki'
import { notify } from '../../store/notify'
import { openSpecialTab, SETTINGS_TAB } from '../../lib/editorController'
import { useUI } from '../../store/ui'
import { cleanWikiHtml, findAnchor } from './wikiHtml'
import './wiki.css'

/** The wikis you've downloaded, kept up to date while the tab shows. */
function useWikis(): WikiInfo[] | null {
  const [wikis, setWikis] = useState<WikiInfo[] | null>(null)
  useEffect(() => {
    void window.api.wikiList().then(setWikis, notify)
    return window.api.onWikiChanged(setWikis)
  }, [])
  return wikis
}

/** The Wiki tab: your downloaded wikis, or one of them open to read. */
export default function WikiPage() {
  const wikis = useWikis()
  const place = useWiki((s) => s.place)
  const open = place && wikis?.find((w) => w.id === place.wikiId && w.done > 0)
  if (!wikis) return <div className="wiki-page" />
  return open ? <Reader key={open.id} wiki={open} wikis={wikis} place={place} /> : <Shelf wikis={wikis} />
}

// ---------- the list of wikis, and downloading one ----------

function statusText(w: WikiInfo): string {
  const n = (x: number): string => x.toLocaleString()
  if (w.status === 'error') return w.error ?? 'The download stopped.'
  if (w.status === 'done') return `Ready · ${n(w.done)} pages${w.failed ? ` (${n(w.failed)} wouldn’t download)` : ''} · ${bytesText(w.bytes)}`
  if (w.status === 'listing') return w.running ? 'Getting the list of pages…' : 'Paused while getting the list of pages'
  if (w.status === 'indexing') return w.running ? 'Making it searchable…' : 'Paused'
  return `${w.running ? 'Downloading' : 'Paused'}: ${n(w.done)} of ${n(w.total)} pages · ${bytesText(w.bytes)}`
}

function Shelf({ wikis }: { wikis: WikiInfo[] }) {
  return (
    <div className="wiki-page wiki-scroll">
      <div className="wiki-shelf">
        <header className="screens-head">
          <h2>
            <Library size={18} /> Wikis
          </h2>
        </header>
        <p className="screens-intro">
          Download any Fandom wiki (shows, comics, games…) and read it here with no ads and no internet. The wiki brain answers questions from it using the offline AI on this computer. Downloaded wikis stay on this computer only.
        </p>
        {wikis.length > 0 && (
          <div className="wiki-list">
            {wikis.map((w) => (
              <WikiCard key={w.id} wiki={w} />
            ))}
          </div>
        )}
        <AddWiki />
      </div>
    </div>
  )
}

function WikiCard({ wiki: w }: { wiki: WikiInfo }) {
  const pct = w.total ? Math.min(100, (w.done / w.total) * 100) : 0
  const remove = (): void => {
    if (!window.confirm(`Delete the downloaded “${w.name}” from this computer? You can download it again later.`)) return
    void window.api.wikiRemove(w.id).then(() => {
      if (useWiki.getState().place?.wikiId === w.id) goWiki(null)
    }, notify)
  }
  return (
    <section className="wiki-card">
      <div className="wiki-card-text">
        <strong>{w.name}</strong>
        <span className="wiki-card-host">{w.base.replace(/^https:\/\//, '')}</span>
        <span className={`wiki-card-status${w.status === 'error' ? ' bad' : ''}`}>{statusText(w)}</span>
        {w.status !== 'done' && w.total > 0 && (
          <div className="wiki-bar">
            <div style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="wiki-card-buttons">
        {w.done > 0 && (
          <button className="btn btn-primary" onClick={() => goWiki({ wikiId: w.id, title: null })}>
            <BookOpen size={13} /> Read
          </button>
        )}
        {w.status !== 'done' &&
          (w.running ? (
            <button className="btn" onClick={() => void window.api.wikiPause(w.id).catch(notify)}>
              <Pause size={13} /> Pause
            </button>
          ) : (
            <button className="btn" onClick={() => void window.api.wikiResume(w.id).catch(notify)}>
              <Play size={13} /> Carry on
            </button>
          ))}
        <button className="btn" onClick={remove} title="Delete from this computer">
          <Trash2 size={13} />
        </button>
      </div>
    </section>
  )
}

const PICTURE_CHOICES: { value: WikiPictureChoice; name: string; blurb: string }[] = [
  { value: 'none', name: 'No pictures', blurb: 'The smallest download.' },
  { value: 'main', name: 'The main picture of each page', blurb: 'Like a character’s photo at the top of their page.' },
  { value: 'all', name: 'All pictures', blurb: 'Much bigger, and most aren’t needed.' }
]

function AddWiki() {
  const [address, setAddress] = useState('')
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<WikiCheck | null>(null)
  const [pictures, setPictures] = useState<WikiPictureChoice>(DEFAULT_PICTURES)
  const [starting, setStarting] = useState(false)

  const look = async (e?: FormEvent): Promise<void> => {
    e?.preventDefault()
    if (!address.trim()) return
    setChecking(true)
    setCheck(null)
    try {
      setCheck(await window.api.wikiCheck(address))
      setPictures(DEFAULT_PICTURES)
    } catch (err) {
      notify(err)
    } finally {
      setChecking(false)
    }
  }

  const start = async (): Promise<void> => {
    if (!check) return
    setStarting(true)
    try {
      await window.api.wikiAdd(check.base, pictures)
      setCheck(null)
      setAddress('')
    } catch (err) {
      notify(err)
    } finally {
      setStarting(false)
    }
  }

  return (
    <section className="wiki-add">
      <h3>Download a wiki</h3>
      <form className="wiki-add-row" onSubmit={(e) => void look(e)}>
        <input className="text-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Paste a Fandom address, like walkingdead.fandom.com" spellCheck={false} />
        <button className="btn" type="submit" disabled={checking || !address.trim()}>
          {checking ? 'Looking…' : 'Look it up'}
        </button>
      </form>
      {check && (
        <div className="wiki-check">
          <p>
            <strong>{check.name}</strong> · about {check.articles.toLocaleString()} pages
            {check.already && ' · already downloaded (this carries on, with the pictures you choose now for pages still to come)'}
          </p>
          <p className="screens-note">
            Its text is shared under{' '}
            <a href={check.licence.url} target="_blank" rel="noreferrer">
              {check.licence.text}
            </a>
            . Each page in Orbit says where it came from, with a link to the original.
          </p>

          <h4>Pictures</h4>
          {PICTURE_CHOICES.map((c) => (
            <label key={c.value} className="wiki-tick">
              <input type="radio" name="wiki-pictures" checked={pictures === c.value} onChange={() => setPictures(c.value)} /> {c.name} <span className="wiki-faint">{c.blurb}</span>
            </label>
          ))}
          <p className="screens-note">
            Pages download two at a time with short pauses, so the wiki isn’t overloaded. A big wiki can take a couple of hours. You can keep using Orbit, read pages as they arrive, and pause: it carries on from where it stopped.
          </p>
          <div className="wiki-add-row">
            <button className="btn btn-primary" onClick={() => void start()} disabled={starting}>
              <Download size={13} /> Download
            </button>
            <button className="btn" onClick={() => setCheck(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

// ---------- reading ----------

function Reader({ wiki, wikis, place }: { wiki: WikiInfo; wikis: WikiInfo[]; place: WikiPlace }) {
  const canBack = useWiki((s) => s.back.length > 0)
  const canForward = useWiki((s) => s.forward.length > 0)
  const [side, setSide] = useState<'brain' | 'spoilers' | null>(() => {
    try {
      return localStorage.getItem('wiki:brain') === 'off' ? null : 'brain'
    } catch {
      return 'brain'
    }
  })
  const title = place.title ?? wiki.mainPage
  const limit = !!wiki.spoilers?.limit
  // Pages and search are looked at again when the spoiler settings change.
  const version = wiki.spoilers?.updated ?? 0

  const toggle = (which: 'brain' | 'spoilers'): void => {
    setSide((now) => {
      const next = now === which ? null : which
      try {
        if (which === 'brain') localStorage.setItem('wiki:brain', next ? 'on' : 'off')
      } catch {
        // only a convenience
      }
      return next
    })
  }

  return (
    <div className="wiki-page wiki-reader">
      <div className="wiki-toolbar">
        <button className="btn" onClick={wikiBack} disabled={!canBack} title="Back">
          <ArrowLeft size={14} />
        </button>
        <button className="btn" onClick={wikiForward} disabled={!canForward} title="Forward">
          <ArrowRight size={14} />
        </button>
        <button className="btn" onClick={() => goWiki(null)} title="All wikis">
          <Library size={14} />
        </button>
        <select className="wiki-select" value={wiki.id} onChange={(e) => goWiki({ wikiId: e.target.value, title: null })} title="Which wiki">
          {wikis
            .filter((w) => w.done > 0)
            .map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
        </select>
        <button className="btn" onClick={() => goWiki({ wikiId: wiki.id, title: null })} title="The wiki’s main page">
          <House size={14} />
        </button>
        <TitleSearch key={version} wiki={wiki} />
        <button className={`btn${side === 'spoilers' ? ' active' : ''}`} onClick={() => toggle('spoilers')} title="Spoiler limit and how far you are">
          {limit ? <ShieldCheck size={14} /> : <Shield size={14} />} Spoilers
        </button>
        <button className={`btn${side === 'brain' ? ' active' : ''}`} onClick={() => toggle('brain')} title="Wiki brain: ask questions">
          <Brain size={14} /> Ask
        </button>
      </div>
      {wiki.status !== 'done' && <div className="wiki-notice">{statusText(wiki)}. Pages that haven’t arrived yet can’t be opened.</div>}
      <div className="wiki-body">
        {place.search ? <SearchResults key={version} wiki={wiki} query={place.search} /> : <Article key={`${wiki.id}/${title}/${version}`} wiki={wiki} title={title} fragment={place.fragment} />}
        {side === 'brain' && <BrainPanel wiki={wiki} wikis={wikis} />}
        {side === 'spoilers' && <SpoilerPanel key={wiki.id} wiki={wiki} />}
      </div>
    </div>
  )
}

function TitleSearch({ wiki }: { wiki: WikiInfo }) {
  const [titles, setTitles] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(0)

  useEffect(() => {
    if (open) void window.api.wikiTitles(wiki.id).then(setTitles, notify)
  }, [wiki.id, wiki.done, open])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const starts: string[] = []
    const inside: string[] = []
    for (const t of titles) {
      const l = t.toLowerCase()
      if (l.startsWith(q)) starts.push(t)
      else if (l.includes(q)) inside.push(t)
      if (starts.length >= 10) break
    }
    return [...starts.sort((a, b) => a.length - b.length), ...inside.sort((a, b) => a.length - b.length)].slice(0, 10)
  }, [titles, query])

  const go = (title: string | null): void => {
    const q = query.trim()
    if (title) goWiki({ wikiId: wiki.id, title })
    else if (q) goWiki({ wikiId: wiki.id, title: null, search: q })
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="wiki-search">
      <Search size={13} className="wiki-search-icon" />
      <input
        className="text-input"
        value={query}
        placeholder={`Search ${wiki.name}`}
        onChange={(e) => {
          setQuery(e.target.value)
          setAt(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setAt((a) => Math.min(a + 1, matches.length))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setAt((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter') go(matches[at] ?? null)
          else if (e.key === 'Escape') {
            setQuery('')
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
      {open && query.trim() && (
        <div className="wiki-search-list">
          {matches.map((t, i) => (
            <button key={t} className={i === at ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => go(t)}>
              {t}
            </button>
          ))}
          <button className={at === matches.length ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => go(null)}>
            <Search size={12} /> Search inside pages for “{query.trim()}”
          </button>
        </div>
      )}
    </div>
  )
}

/** Clicks on links in a page: other pages open here, the web opens in your browser. */
function useLinkClicks(wikiId: string): (e: MouseEvent<HTMLElement>) => void {
  return (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-wiki],[data-anchor],[data-ext]')
    if (!a) return
    e.preventDefault()
    if (a.dataset.wiki) goWiki({ wikiId, title: a.dataset.wiki, fragment: a.dataset.frag })
    else if (a.dataset.anchor) findAnchor(e.currentTarget, a.dataset.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else if (a.dataset.ext) window.open(a.dataset.ext)
  }
}

function Article({ wiki, title, fragment }: { wiki: WikiInfo; title: string; fragment?: string }) {
  const [page, setPage] = useState<WikiPageView | null | undefined>(undefined)
  const [showUnplaced, setShowUnplaced] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const onClick = useLinkClicks(wiki.id)
  // A page that hadn't arrived yet is looked for again as more pages arrive.
  const waiting = page === null && wiki.status !== 'done' ? wiki.done : -1

  useEffect(() => {
    let live = true
    void window.api.wikiPage(wiki.id, title, showUnplaced).then(
      (p) => live && setPage(p),
      (err) => {
        notify(err)
        if (live) setPage(null)
      }
    )
    return () => {
      live = false
    }
  }, [wiki.id, title, waiting, showUnplaced])

  const html = useMemo(() => (page ? cleanWikiHtml(page.html, page, wiki.base) : ''), [page, wiki.base])

  useEffect(() => {
    if (!body.current) return
    const target = fragment ? findAnchor(body.current, fragment) : null
    if (target) target.scrollIntoView({ block: 'start' })
    else body.current.closest('.wiki-article')?.scrollTo(0, 0)
  }, [html, fragment])

  if (page === undefined) return <div className="wiki-article" />
  if (page?.blocked)
    return (
      <div className="wiki-article">
        <div className="wiki-missing">
          <h1>{page.blocked === 'part' ? page.displayTitle : 'Hidden'}</h1>
          <p>
            {page.blocked === 'later' && 'This page is about something you haven’t reached yet, so it’s hidden. Change how far you are in Spoilers to see it.'}
            {page.blocked === 'part' && 'This page is about a part of the story you’ve switched off (in Spoilers).'}
            {page.blocked === 'unchecked' && 'Orbit hasn’t checked this page for spoilers yet. It will after more of the wiki has downloaded.'}
            {page.blocked === 'unplaced' && 'Orbit couldn’t tell when anything on this page happens, so it might spoil something.'}
          </p>
          {page.blocked === 'unplaced' && (
            <button className="btn" onClick={() => setShowUnplaced(true)}>
              Show it anyway
            </button>
          )}
        </div>
      </div>
    )
  if (!page)
    return (
      <div className="wiki-article">
        <div className="wiki-missing">
          <h1>{title}</h1>
          <p>
            {wiki.status === 'done' ? 'This page isn’t in the downloaded wiki.' : 'This page isn’t downloaded yet (or isn’t in the wiki).'}{' '}
            <a href="#" onClick={(e) => (e.preventDefault(), window.open(pageUrl(wiki.base, title)))}>
              Open it on the wiki’s website
            </a>
          </p>
        </div>
      </div>
    )
  return (
    <div className="wiki-article">
      <article className="wiki-content">
        <h1 className="wiki-title">{page.displayTitle}</h1>
        {!!page.hiddenUnplaced && !showUnplaced && (
          <div className="wiki-spoiler-note">
            Some parts are hidden because the wiki doesn’t say when they happen, so they might spoil something.{' '}
            <button className="btn" onClick={() => setShowUnplaced(true)}>
              Show them anyway
            </button>
          </div>
        )}
        <div ref={body} className="wiki-html" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
        <footer className="wiki-credit">
          From {wiki.name} on Fandom. Its text is shared under{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), window.open(wiki.licence.url))}>
            {wiki.licence.text}
          </a>
          , written by the wiki’s editors.{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), window.open(page.url))}>
            See the original page and who wrote it
          </a>
          .
        </footer>
      </article>
    </div>
  )
}

function SearchResults({ wiki, query }: { wiki: WikiInfo; query: string }) {
  const [hits, setHits] = useState<WikiHit[] | null>(null)
  useEffect(() => {
    let live = true
    setHits(null)
    void window.api.wikiSearch(wiki.id, query).then(
      (h) => live && setHits(h),
      (err) => {
        notify(err)
        if (live) setHits([])
      }
    )
    return () => {
      live = false
    }
  }, [wiki.id, query])
  return (
    <div className="wiki-article">
      <div className="wiki-content">
        <h1 className="wiki-title">Search: {query}</h1>
        {!hits && <p className="screens-note">Searching… (the first search after downloading takes a little longer)</p>}
        {hits?.length === 0 && <p className="screens-note">Nothing in the downloaded pages matches that.</p>}
        {hits?.map((h) => (
          <button key={h.title} className="wiki-hit" onClick={() => goWiki({ wikiId: wiki.id, title: h.title })}>
            <strong>{h.title}</strong>
            {h.section && <span className="wiki-faint"> · {h.section}</span>}
            <span className="wiki-hit-text">{h.snippet}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- the wiki brain ----------

/** The answer's text, with its [1] [2] marks as buttons that open the page they point to. */
function AnswerText({ answer, onSource }: { answer: WikiAnswer; onSource: (n: number) => void }) {
  const parts: ReactNode[] = []
  const re = /\[(\d+(?:\s*[,;]\s*\d+)*)\]/g
  let at = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(answer.text))) {
    parts.push(answer.text.slice(at, m.index))
    for (const n of m[1].split(/[,;]/).map((x) => Number(x.trim()))) {
      if (answer.sources.some((s) => s.n === n))
        parts.push(
          <button key={`${m.index}-${n}`} className="wiki-cite" onClick={() => onSource(n)}>
            {n}
          </button>
        )
    }
    at = m.index + m[0].length
  }
  parts.push(answer.text.slice(at))
  return <div className="wiki-answer-text">{parts}</div>
}

function BrainPanel({ wiki, wikis }: { wiki: WikiInfo; wikis: WikiInfo[] }) {
  const ready = wikis.filter((w) => w.done > 0)
  const [scope, setScope] = useState<'one' | 'all'>('one')
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<{ q: string; a: WikiAnswer } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const ask = async (e?: FormEvent): Promise<void> => {
    e?.preventDefault()
    const q = question.trim()
    if (!q || asking) return
    setAsking(true)
    setProblem(null)
    try {
      const a = await window.api.wikiAsk(q, scope === 'all' ? ready.map((w) => w.id) : [wiki.id])
      setAnswer({ q, a })
    } catch (err) {
      setProblem(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setAsking(false)
    }
  }

  const openSource = (n: number): void => {
    const s = answer?.a.sources.find((x) => x.n === n)
    if (s) goWiki({ wikiId: s.wikiId, title: s.title })
  }

  return (
    <aside className="wiki-brain">
      <h3>
        <Brain size={15} /> Wiki brain
      </h3>
      <p className="screens-note">Ask about anything in the downloaded wiki. The offline AI on this computer answers from the wiki’s pages only, and nothing is sent online.</p>
      {ready.length > 1 && (
        <select className="wiki-select" value={scope} onChange={(e) => setScope(e.target.value as 'one' | 'all')}>
          <option value="one">Ask {wiki.name}</option>
          <option value="all">Ask all {ready.length} wikis</option>
        </select>
      )}
      <form onSubmit={(e) => void ask(e)}>
        <textarea
          className="text-input wiki-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Like: How did Glenn meet Maggie?"
          rows={3}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void ask()
            }
          }}
        />
        <button className="btn btn-primary" type="submit" disabled={asking || !question.trim()}>
          {asking ? 'Thinking…' : 'Ask'}
        </button>
      </form>
      {problem && (
        <div className="wiki-problem">
          <p>{problem}</p>
          {/downloaded yet|AI helper/i.test(problem) && (
            <button
              className="btn"
              onClick={() => {
                openSpecialTab(SETTINGS_TAB)
                useUI.setState({ settingsSection: 'ai' })
              }}
            >
              Get the offline AI
            </button>
          )}
        </div>
      )}
      {answer && (
        <div className="wiki-answer">
          <div className="wiki-answer-q">
            {answer.q}
            <button className="wiki-x" onClick={() => setAnswer(null)} title="Clear">
              <X size={12} />
            </button>
          </div>
          <AnswerText answer={answer.a} onSource={openSource} />
          {answer.a.sources.length > 0 && <p className="wiki-faint">{answer.a.cited ? 'From these pages:' : 'It read these pages:'}</p>}
          <ul className="wiki-sources">
            {answer.a.sources.map((s) => (
              <li key={s.n}>
                <button onClick={() => openSource(s.n)}>
                  <span className="wiki-cite">{s.n}</span> {s.title}
                  {s.section && <span className="wiki-faint"> · {s.section}</span>}
                  {scope === 'all' && <span className="wiki-faint"> ({s.wikiName})</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )
}

// ---------- the spoiler limit ----------

function SpoilerPanel({ wiki }: { wiki: WikiInfo }) {
  const [view, setView] = useState<WikiSpoilerView | null>(null)
  const version = wiki.spoilers?.updated ?? 0
  const status = wiki.status

  useEffect(() => {
    let live = true
    void window.api.wikiSpoilers(wiki.id).then((v) => live && setView(v), notify)
    return () => {
      live = false
    }
  }, [wiki.id, version, status])

  if (!view) return <aside className="wiki-brain" />
  const s = view.settings
  const set = (patch: Partial<WikiSpoilerSettings>): void => {
    // Shown straight away; the saved setting follows.
    setView((v) => v && { ...v, settings: { ...v.settings, ...patch, progress: { ...v.settings.progress, ...(patch.progress ?? {}) } } })
    void window.api.wikiSetSpoilers(wiki.id, patch).catch(notify)
  }
  const hasShow = view.series.some((x) => x.part === 'show')
  const hasComics = view.series.some((x) => x.part === 'comics')
  const shown = view.series.filter((x) => s.parts === 'both' || x.part === (s.parts === 'show' ? 'show' : 'comics'))

  return (
    <aside className="wiki-brain wiki-spoilers">
      <h3>
        <Shield size={15} /> Spoilers
      </h3>
      {hasShow && hasComics && (
        <div className="wiki-spoiler-group">
          <p className="wiki-spoiler-label">This wiki has the show and the comics. Show me:</p>
          {(
            [
              ['show', 'The show'],
              ['comics', 'The comics'],
              ['both', 'Both']
            ] as [WikiPartsChoice, string][]
          ).map(([value, name]) => (
            <label key={value} className="wiki-tick">
              <input type="radio" name="wiki-parts" checked={s.parts === value} onChange={() => set({ parts: value })} /> {name}
            </label>
          ))}
          <p className="screens-note">Pages about the other one are hidden everywhere: reading, search and the wiki brain.</p>
        </div>
      )}
      <label className="wiki-tick">
        <input type="checkbox" checked={s.limit} onChange={(e) => set({ limit: e.target.checked })} /> Spoiler limit: hide anything past where I am
      </label>
      {s.limit && (
        <>
          {!view.ready && <p className="screens-note">Orbit works out the wiki’s episodes once some pages have downloaded. Until then, pages stay hidden.</p>}
          {view.ready && shown.length === 0 && <p className="screens-note">Orbit couldn’t find a list of episodes or issues in this wiki, so it can’t tell what’s a spoiler. Everything it can’t place stays hidden.</p>}
          {shown.map((series) => (
            <div key={series.name} className="wiki-spoiler-group">
              <p className="wiki-spoiler-label">
                {series.name} <span className="wiki-faint">({series.part === 'show' ? 'show' : 'comics'})</span>
              </p>
              <select className="wiki-select wiki-progress" value={s.progress[series.name] ?? 0} onChange={(e) => set({ progress: { [series.name]: Number(e.target.value) } })}>
                <option value={0}>Not started</option>
                {series.points.map((p) => (
                  <option key={p.order} value={p.order}>
                    Up to {p.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <p className="screens-note">
            Each paragraph is checked against the episodes and issues the wiki links it to. Where the wiki doesn’t say which episode something happens in, it may only be accurate to the season, and parts Orbit can’t place at all are hidden (each page lets you show them).
            {!view.finished && ' While the wiki is still downloading, some episodes aren’t known yet, so more stays hidden.'}
          </p>
          <p className="screens-note">How far you are is shared with your other computers through your notes folder.</p>
        </>
      )}
    </aside>
  )
}
