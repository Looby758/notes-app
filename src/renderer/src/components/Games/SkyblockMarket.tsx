import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Activity, Brain, Check, CircleHelp, Clock, Loader2, Pause, Play, Search, Send, Sparkles, Trash2, TrendingDown, TrendingUp, Undo2, X } from 'lucide-react'
import {
  cleanName,
  mid,
  questionHeadline,
  ruleScore,
  shownContext,
  ruleText,
  shortCoins,
  span,
  type MarketAnswer,
  type MarketChart,
  type MarketItemHit,
  type MarketQuestion,
  type MarketState,
  type Point
} from '@shared/skyblockMarket'
import { addHomeCard } from '../../lib/home'
import { openSpecialTab, SKYBLOCK_GOALS_TAB } from '../../lib/editorController'
import { HomeBox } from '../Home/HomePage'
import { Nothing, Panel } from './SkyblockProfile'
import { ItemPic } from './SkyblockPic'
import { cleanErr } from './SkyblockExtras'
import { notify } from '../../store/notify'

/**
 * The SkyBlock market tracker's page (the Market tab on the SkyBlock page) and its Home box.
 * Orbit records the Bazaar in the background (src/main/skyblockMarket.ts); this shows the
 * questions it has about odd moves, charts with mayors and events behind them, the rules being
 * checked, and a chat with Claude that can look through all of it.
 */

// ---------- opening the Market tab from elsewhere ----------

let wantedTab: string | null = null
/** Opens the SkyBlock page on a tab (the Home box uses it for Market). */
export function openSkyblockTab(tab: string): void {
  wantedTab = tab
  openSpecialTab(SKYBLOCK_GOALS_TAB)
  window.dispatchEvent(new CustomEvent('sbx:tab', { detail: tab }))
}
/** The tab something asked for, once. */
export function takeWantedTab(): string | null {
  const t = wantedTab
  wantedTab = null
  return t
}

// ---------- shared bits ----------

export function useMarket(): [MarketState | null, (s: MarketState) => void] {
  const [state, setState] = useState<MarketState | null>(null)
  useEffect(() => {
    let live = true
    const get = (): void => void window.api.marketState().then((s) => live && setState(s)).catch(() => {})
    get()
    const off = window.api.onMarketChanged(get)
    return () => {
      live = false
      off()
    }
  }, [])
  return [state, setState]
}

const pct = (x: number): string => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(Math.abs(x) < 0.1 ? 1 : 0)}%`
const when = (t: number): string => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const ago = (t: number): string => `${span(Date.now() - t)} ago`

const KIND_ICON = { up: TrendingUp, down: TrendingDown, spread: Activity, volume: Activity }

function Sparkline({ id, at }: { id: string; at: number }) {
  const [pts, setPts] = useState<Point[]>([])
  useEffect(() => {
    void window.api
      .marketChart(id, '1d')
      .then((c) => setPts(c.points))
      .catch(() => {})
  }, [id, at])
  if (pts.length < 2) return null
  const xs = pts.map((p) => p.at)
  const ys = pts.map(mid)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const X = (x: number): number => ((x - x0) / (x1 - x0 || 1)) * 200
  const Y = (y: number): number => 36 - ((y - y0) / (y1 - y0 || 1)) * 32
  return (
    <svg className="sbm-spark" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden>
      <path d={pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.at).toFixed(1)},${Y(mid(p)).toFixed(1)}`).join('')} fill="none" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      {at >= x0 && <line x1={X(at)} x2={X(at)} y1={0} y2={40} className="sbm-spark-at" />}
    </svg>
  )
}

/** One question Orbit has, with the ways to answer it. */
export function QuestionCard({ q, onState, compact }: { q: MarketQuestion; onState?: (s: MarketState) => void; compact?: boolean }) {
  const [writing, setWriting] = useState(false)
  const [text, setText] = useState(q.answer ?? '')
  const [busy, setBusy] = useState(false)
  const Icon = KIND_ICON[q.kind]
  const send = async (a: MarketAnswer): Promise<void> => {
    setBusy(true)
    try {
      const s = await window.api.marketAnswer(q.id, a)
      onState?.(s)
      setWriting(false)
    } catch (err) {
      notify(cleanErr(err))
    } finally {
      setBusy(false)
    }
  }
  const open = q.status === 'open' || q.status === 'later'
  const lead = q.items[0]
  const others = q.items.slice(1)
  const context = shownContext(q.context)
  const badge = q.kind === 'spread' ? `${Math.round((lead?.now ?? 0) * 100)}% gap` : q.kind === 'volume' ? `trading ${pct(lead?.change ?? 0)}` : pct(lead?.change ?? 0)
  return (
    <div className={`sbm-q ${q.status} ${compact ? 'compact' : ''}`} data-sbm-question={q.status}>
      <div className="sbm-q-head">
        <ItemPic id={lead?.id ?? ''} name={lead?.name ?? ''} size={28} />
        <div className="sbm-q-title">
          <b>
            <Icon size={13} className={`sbm-kind ${q.kind}`} /> {cleanName(lead?.name ?? '')}
            <span className={`sbm-pct ${q.kind}`}> {badge}</span>
          </b>
          <small className="faint">
            {ago(q.at)}
            {q.status === 'later' && ' · looking into it'}
            {q.status === 'settled' && ' · filed as unexplained'}
            {q.status === 'unknown' && ' · you weren’t sure'}
          </small>
        </div>
      </div>
      <Sparkline id={lead?.id ?? ''} at={q.at} />
      <p className="sbm-q-text">{questionHeadline(q.kind, [lead])}</p>
      {others.length > 0 && (
        <p className="sbm-q-also faint">
          Also: {others.slice(0, 4).map((i) => cleanName(i.name)).join(', ')}
          {others.length > 4 ? ` and ${others.length - 4} more` : ''}
        </p>
      )}
      <div className="sbm-q-context">
        <small>Around then</small>
        {context.length ? (
          <ul>
            {context.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        ) : (
          <span className="faint">Nothing on the SkyBlock calendar.</span>
        )}
      </div>
      {q.history.length > 0 && (
        <ul className="sbm-q-history">
          {q.history.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      )}
      {q.followUp && q.status === 'later' && <p className="sbm-q-follow">Since then: {q.followUp}</p>}
      {q.status === 'explained' && !writing && (
        <p className="sbm-q-answer">
          <b>You said:</b> {q.answer}
        </p>
      )}
      {writing ? (
        <div className="sbm-q-write">
          <textarea autoFocus value={text} placeholder="What do you think happened? (An update, a mayor perk, someone buying it all up…)" onChange={(e) => setText(e.target.value)} rows={3} data-sbm-explain-text />
          <div className="sbm-q-actions">
            <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void send({ action: 'explain', text })} data-sbm-explain-save>
              <Check size={13} /> Save
            </button>
            <button className="btn" onClick={() => setWriting(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : open ? (
        <div className="sbm-q-actions one-row">
          <button className="btn btn-primary" disabled={busy} onClick={() => setWriting(true)} title="Say what you think happened" data-sbm-explain>
            Explain
          </button>
          {q.status !== 'later' && (
            <button className="btn" disabled={busy} onClick={() => void send({ action: 'later' })} title="Keep it open and say how it goes" data-sbm-later>
              <Clock size={13} /> Later
            </button>
          )}
          <button className="btn" disabled={busy} onClick={() => void send({ action: 'unknown' })} title="Orbit watches for it happening again" data-sbm-unknown>
            <CircleHelp size={13} /> Don’t know
          </button>
          <button className="link-button" disabled={busy} onClick={() => void send({ action: 'ignore' })} title="Stop asking about this kind of move for this item" data-sbm-ignore>
            Not interesting
          </button>
        </div>
      ) : (
        !compact && (
          <div className="sbm-q-actions">
            {(q.status === 'explained' || q.status === 'unknown' || q.status === 'settled') && (
              <button className="link-button" onClick={() => setWriting(true)}>
                {q.status === 'explained' ? 'Change answer' : 'Explain it now'}
              </button>
            )}
            {q.status === 'ignored' && (
              <button className="link-button" onClick={() => void send({ action: 'reopen' })}>
                <Undo2 size={12} /> Ask about this again
              </button>
            )}
            {q.notePath && <span className="faint">Saved to {q.notePath}</span>}
          </div>
        )
      )}
    </div>
  )
}

// ---------- the Home box ----------

function MarketHomeCard() {
  const [state, setState] = useMarket()
  if (!state || (!state.recording && !state.questions.some((q) => q.status === 'open'))) return null
  const open = state.questions.filter((q) => q.status === 'open')
  return (
    <HomeBox
      icon={<Activity size={15} />}
      title="SkyBlock market"
      action={
        <button className="link-button home-box-action" onClick={() => openSkyblockTab('market')}>
          Market
        </button>
      }
    >
      <div className="sbm-home" data-sbm-home>
        {open.length ? (
          <>
            <p className="faint sbm-home-count">
              {open.length} question{open.length === 1 ? '' : 's'} waiting
            </p>
            <QuestionCard key={open[0].id} q={open[0]} onState={setState} compact />
            {open.length > 1 && (
              <button className="link-button" onClick={() => openSkyblockTab('market')}>
                See the other {open.length - 1}
              </button>
            )}
          </>
        ) : (
          <p className="home-empty">
            {state.learning
              ? `Recording the Bazaar. Orbit is still learning what normal looks like (${state.historyHours} of ${72} hours), so no questions yet.`
              : 'No odd moves right now. Orbit will ask here when something does.'}
          </p>
        )}
      </div>
    </HomeBox>
  )
}

addHomeCard({ id: 'skyblock-market', order: 48, title: 'SkyBlock market', Card: MarketHomeCard })

// ---------- the chart ----------

const RANGES = [
  ['1d', 'Day'],
  ['7d', 'Week'],
  ['30d', 'Month'],
  ['all', 'All']
] as const

function PriceChart({ chart }: { chart: MarketChart }) {
  const [hover, setHover] = useState<number | null>(null)
  const pts = chart.points
  const w = 760
  const h = 260
  const pad = { l: 60, r: 14, t: 26, b: 26 }
  if (pts.length < 2) return <Nothing what="Not enough recorded for this item yet. Leave Orbit recording and it fills in." />
  const x0 = pts[0].at
  const x1 = pts[pts.length - 1].at
  const all = pts.flatMap((p) => [p.buy, p.sell].filter((v) => v > 0))
  let y0 = Math.min(...all)
  let y1 = Math.max(...all)
  if (y0 === y1) (y0 *= 0.95), (y1 *= 1.05)
  const X = (x: number): number => pad.l + ((Math.min(Math.max(x, x0), x1) - x0) / (x1 - x0 || 1)) * (w - pad.l - pad.r)
  const Y = (y: number): number => pad.t + (1 - (y - y0) / (y1 - y0)) * (h - pad.t - pad.b)
  const line = (pick: (p: Point) => number): string =>
    pts
      .filter((p) => pick(p) > 0)
      .map((p, i) => `${i ? 'L' : 'M'}${X(p.at).toFixed(1)},${Y(pick(p)).toFixed(1)}`)
      .join('')
  const hp = hover === null ? null : pts[hover]
  const label = (t: number): string => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' }) + (x1 - x0 < 2 * 86_400_000 ? ` ${new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '')
  return (
    <svg
      className="sbm-chart"
      viewBox={`0 0 ${w} ${h}`}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        const x = x0 + ((((e.clientX - r.left) / r.width) * w - pad.l) / (w - pad.l - pad.r)) * (x1 - x0)
        let best = 0
        for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].at - x) < Math.abs(pts[best].at - x)) best = i
        setHover(best)
      }}
      onMouseLeave={() => setHover(null)}
      data-sbm-chart
    >
      {chart.mayors.map((m, i) => (
        <g key={`m${i}`}>
          <rect x={X(m.start)} width={Math.max(0, X(m.end) - X(m.start))} y={pad.t} height={h - pad.t - pad.b} className={`sbm-mayor m${i % 2}`} />
          {X(m.end) - X(m.start) > 40 && (
            <text x={X(m.start) + 4} y={pad.t - 8} className="sbm-band-label">
              {m.name}
            </text>
          )}
        </g>
      ))}
      {chart.events.map((e, i) => (
        <g key={`e${i}`}>
          <rect x={X(e.start)} width={Math.max(2, X(e.end) - X(e.start))} y={h - pad.b - 8} height={8} className="sbm-event" />
          <title>{`${e.name}: ${when(e.start)}`}</title>
        </g>
      ))}
      {chart.marks
        .filter((m) => m.kind === 'gap')
        .map((m, i) => (
          <rect key={`g${i}`} x={X(m.at)} width={Math.max(1, X(m.end ?? m.at) - X(m.at))} y={pad.t} height={h - pad.t - pad.b} className="sbm-gap">
            <title>{m.text}</title>
          </rect>
        ))}
      {[0, 0.5, 1].map((t) => {
        const v = y0 + t * (y1 - y0)
        return (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={Y(v)} y2={Y(v)} className="sbx-grid" />
            <text x={pad.l - 8} y={Y(v) + 4} textAnchor="end" className="sbx-axis">
              {shortCoins(v)}
            </text>
          </g>
        )
      })}
      <text x={pad.l} y={h - 6} className="sbx-axis">
        {label(x0)}
      </text>
      <text x={w - pad.r} y={h - 6} textAnchor="end" className="sbx-axis">
        {label(x1)}
      </text>
      <path d={line((p) => p.buy)} className="sbm-line buy" vectorEffect="non-scaling-stroke" />
      <path d={line((p) => p.sell)} className="sbm-line sell" vectorEffect="non-scaling-stroke" />
      {chart.questions
        .filter((q) => q.at >= x0 && q.at <= x1)
        .map((q) => (
          <g key={q.id}>
            <circle cx={X(q.at)} cy={pad.t + 6} r={5} className={`sbm-pin ${q.status}`} />
            <title>{`${when(q.at)}: ${q.text}${q.answer ? `\nYou said: ${q.answer}` : ''}`}</title>
          </g>
        ))}
      {hp && (
        <g>
          <line x1={X(hp.at)} x2={X(hp.at)} y1={pad.t} y2={h - pad.b} className="sbx-grid hover" />
          <text x={Math.min(X(hp.at) + 8, w - 230)} y={pad.t + 22} className="sbx-tip">
            {when(hp.at)} · buy {shortCoins(hp.buy)} · sell {shortCoins(hp.sell)}
          </text>
        </g>
      )}
    </svg>
  )
}

function ItemSearch({ onPick }: { onPick: (hit: MarketItemHit) => void }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<MarketItemHit[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => void window.api.marketSearch(query).then(setHits).catch(() => {}), 150)
    return () => clearTimeout(t)
  }, [query])
  return (
    <div className="sbm-search">
      <Search size={13} />
      <input value={query} placeholder="Find a Bazaar item…" onChange={(e) => setQuery(e.target.value)} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} data-sbm-search />
      {open && hits.length > 0 && (
        <ul className="sbm-hits">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                onMouseDown={() => {
                  onPick(h)
                  setQuery('')
                  setOpen(false)
                }}
              >
                <ItemPic id={h.id} name={h.name} size={20} />
                <span className="sbm-name">{h.name}</span>
                <small className="faint">
                  {shortCoins(h.price)} · {shortCoins(h.coins)}/day
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- asking Claude ----------

/** Claude's replies: paragraphs, "- " lists and **bold**, without the asterisks showing. */
function Rich({ text }: { text: string }) {
  const italic = (t: string, k: number): ReactNode[] => t.split(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g).map((p, i) => (i % 2 ? <i key={`${k}-${i}`}>{p}</i> : p))
  const inline = (line: string): ReactNode[] => line.split(/\*\*(.+?)\*\*/g).flatMap((part, i): ReactNode[] => (i % 2 ? [<b key={i}>{part}</b>] : italic(part, i)))
  const blocks = text.replace(/^#+\s*/gm, '').split(/\n{2,}/)
  return (
    <div className="sbm-rich">
      {blocks.flatMap((b, i) => {
        // Within a block, runs of "- " lines become a list and other lines their own paragraph.
        const out: ReactNode[] = []
        let list: string[] = []
        let para: string[] = []
        const flushList = (): void => {
          if (list.length)
            out.push(
              <ul key={`${i}-${out.length}`}>
                {list.map((l, j) => (
                  <li key={j}>{inline(l)}</li>
                ))}
              </ul>
            )
          list = []
        }
        const flushPara = (): void => {
          if (para.length) out.push(<p key={`${i}-${out.length}`}>{inline(para.join(' '))}</p>)
          para = []
        }
        for (const line of b.split('\n').filter((l) => l.trim())) {
          const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
          if (bullet) {
            flushPara()
            list.push(bullet[1])
          } else {
            flushList()
            // A line ending in ":" (or a numbered heading) stands on its own.
            para.push(line)
            if (/:\**\s*$/.test(line) || /^\s*\**\d+\./.test(line)) flushPara()
          }
        }
        flushList()
        flushPara()
        return out
      })}
    </div>
  )
}

interface Turn {
  role: 'user' | 'assistant'
  content: string
}

function AskPanel({ ready }: { ready: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [turns, busy])
  const send = async (q: string): Promise<void> => {
    if (!q.trim() || busy) return
    const next = [...turns, { role: 'user' as const, content: q.trim() }]
    setTurns(next)
    setText('')
    setBusy(true)
    try {
      const reply = await window.api.marketAsk(next)
      setTurns([...next, { role: 'assistant', content: reply }])
    } catch (err) {
      setTurns([...next, { role: 'assistant', content: `⚠ ${cleanErr(err)}` }])
    } finally {
      setBusy(false)
    }
  }
  const examples = ['What’s unusual this week?', 'What moves when the mayor changes?', 'Which items rose before the last Spooky Festival?']
  return (
    <Panel title="Ask about the data" wide right={<span className="faint">Claude looks through everything Orbit recorded</span>}>
      {!ready ? (
        <Nothing what="Asking about the data uses Claude. Add your Anthropic API key in Settings → AI helper." />
      ) : (
        <div className="sbm-ask" data-sbm-ask>
          {turns.length === 0 && (
            <div className="sbm-examples">
              {examples.map((e) => (
                <button key={e} className="sbp-chip" onClick={() => void send(e)}>
                  {e}
                </button>
              ))}
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={`sbm-turn ${t.role}`}>
              <Rich text={t.content} />
            </div>
          ))}
          {busy && (
            <div className="sbm-turn assistant faint">
              <Loader2 size={13} className="spin" /> Looking through the data…
            </div>
          )}
          <div ref={end} />
          <form
            className="sbm-ask-box"
            onSubmit={(e) => {
              e.preventDefault()
              void send(text)
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask anything about prices, mayors, events…" data-sbm-ask-input />
            <button className="btn btn-primary" disabled={busy || !text.trim()}>
              <Send size={13} />
            </button>
          </form>
        </div>
      )}
    </Panel>
  )
}

// ---------- the page ----------

export function MarketPage() {
  const [state, setState] = useMarket()
  const [item, setItem] = useState<{ id: string; name: string } | null>(null)
  const [range, setRange] = useState('7d')
  const [chart, setChart] = useState<MarketChart | null>(null)
  const [moves, setMoves] = useState<Awaited<ReturnType<typeof window.api.marketMovers>> | null>(null)
  const [showAnswered, setShowAnswered] = useState(false)
  const [finding, setFinding] = useState(false)
  const [found, setFound] = useState<string | null>(null)

  const lastAt = state?.lastAt ?? 0
  const [chartRange, setChartRange] = useState(range)
  useEffect(() => {
    if (!item) return
    // Only the answer for what's picked now: a slow earlier one mustn't land on top of it.
    let live = true
    void window.api
      .marketChart(item.id, range)
      .then((c) => {
        if (!live) return
        setChart(c)
        setChartRange(range)
      })
      .catch((err) => live && notify(cleanErr(err)))
    return () => {
      live = false
    }
  }, [item, range, lastAt])
  useEffect(() => {
    void window.api
      .marketMovers(24)
      .then(setMoves)
      .catch(() => {})
  }, [lastAt])
  // Start on the busiest item, or the one with the newest question.
  useEffect(() => {
    if (item || !state) return
    const q = state.questions.find((x) => x.status === 'open')
    if (q) setItem({ id: q.items[0].id, name: q.items[0].name })
    else void window.api.marketSearch('').then((h) => h[0] && setItem({ id: h[0].id, name: h[0].name }))
  }, [state, item])

  const record = useCallback(
    (on: boolean) =>
      void window.api
        .marketRecord(on)
        .then(setState)
        .catch((err) => notify(cleanErr(err))),
    [setState]
  )
  const open = useMemo(() => state?.questions.filter((q) => q.status === 'open' || q.status === 'later') ?? [], [state])
  const answered = useMemo(() => state?.questions.filter((q) => q.status !== 'open' && q.status !== 'later') ?? [], [state])
  if (!state) return <div className="sbg-empty">Loading…</div>

  const findRules = async (): Promise<void> => {
    setFinding(true)
    setFound(null)
    try {
      const r = await window.api.marketSuggestRules()
      setFound(r.text)
    } catch (err) {
      setFound(`⚠ ${cleanErr(err)}`)
    } finally {
      setFinding(false)
    }
  }

  return (
    <div className="sbp-panels sbm" data-sbm-page>
      <Panel
        title="Recording the Bazaar"
        wide
        right={
          <button className={`btn ${state.recording ? '' : 'btn-primary'}`} onClick={() => record(!state.recording)} data-sbm-record>
            {state.recording ? (
              <>
                <Pause size={13} /> Stop recording
              </>
            ) : (
              <>
                <Play size={13} /> Start recording
              </>
            )}
          </button>
        }
      >
        {!state.recording && !state.startedAt ? (
          <p className="sbm-intro">
            Hypixel only shows what the Bazaar is doing right now, so Orbit keeps its own history: every item’s prices and trading every 5 minutes while Orbit is open (even with the window closed), along with the mayor, fire sales
            and news. After a few days it knows what’s normal for each item, and asks you on Home when something isn’t. Your answers are saved as notes in your vault under <b>SkyBlock Market</b>. It uses about 110 MB for the detailed last two weeks, plus about 20 MB a month for the hourly history it keeps for good.
          </p>
        ) : (
          <div className="sbm-stats">
            <div>
              <b>{state.recording ? (state.lastAt ? `Last look ${ago(state.lastAt)}` : 'Starting…') : 'Paused'}</b>
              <small className="faint">{state.startedAt ? `since ${when(state.startedAt)}` : ''}</small>
            </div>
            <div>
              <b>{state.items}</b>
              <small className="faint">items, {state.watched} busy enough to watch</small>
            </div>
            <div>
              <b>{state.historyHours < 48 ? `${state.historyHours} hours` : `${Math.round(state.historyHours / 24)} days`}</b>
              <small className="faint">of history{state.learning ? ', still learning what’s normal (needs 3 days)' : ''}</small>
            </div>
            <div>
              <b>{state.mayor?.name ?? '?'}</b>
              <small className="faint">mayor{state.mayor?.minister ? `, ${state.mayor.minister} minister` : ''}</small>
            </div>
            <div>
              <b>{state.mb} MB</b>
              <small className="faint">on disk</small>
            </div>
          </div>
        )}
        {state.problem && <p className="sbm-problem">{state.problem}</p>}
        {state.learning && (
          <p className="faint sbm-headstart">
            {state.headStart.running ? (
              <>
                <Loader2 size={12} className="spin" /> Getting the last few days from Coflnet: {state.headStart.done} of {state.headStart.total} items…
              </>
            ) : state.headStart.at ? (
              <>Head start from Coflnet done {ago(state.headStart.at)}.</>
            ) : (
              <>
                Don’t want to wait 3 days?{' '}
                <button className="link-button" onClick={() => void window.api.marketHeadStart().then(setState)} data-sbm-headstart>
                  Get a head start from Coflnet
                </button>{' '}
                (the last few days for the 300 busiest items, about 15 minutes in the background).
              </>
            )}
          </p>
        )}
      </Panel>

      <Panel title={`Questions${open.length ? ` (${open.length})` : ''}`} wide right={answered.length > 0 && <button className="link-button" onClick={() => setShowAnswered(!showAnswered)}>{showAnswered ? 'Hide answered' : `Answered and filed (${answered.length})`}</button>}>
        {open.length === 0 ? (
          <Nothing what={state.learning ? 'Questions start once Orbit has learned what normal looks like for each item.' : 'Nothing odd right now. New questions show up here and on Home.'} />
        ) : (
          <div className="sbm-qs">
            {open.map((q) => (
              <QuestionCard key={q.id} q={q} onState={setState} />
            ))}
          </div>
        )}
        {showAnswered && (
          <div className="sbm-qs answered">
            {answered.map((q) => (
              <QuestionCard key={q.id} q={q} onState={setState} />
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title={item ? item.name : 'Prices'}
        wide
        right={
          <div className="sbm-chart-tools">
            <ItemSearch onPick={(h) => setItem({ id: h.id, name: h.name })} />
            <div className="segmented sbm-ranges" data-sbm-ranges>
              {RANGES.map(([id, name]) => {
                const short = id === '30d' && state.historyHours < 8 * 24
                return (
                  <button
                    key={id}
                    className={range === id ? 'selected' : ''}
                    disabled={short}
                    title={short ? 'Needs more than a week of history: until then it’s the same as Week' : undefined}
                    onClick={() => setRange(id)}
                  >
                    {name}
                  </button>
                )
              })}
            </div>
          </div>
        }
      >
        {chart && item && chart.id === item.id ? <PriceChart chart={chart} key={`${chart.id}-${chartRange}`} /> : <Nothing what="Pick an item to see its history." />}
        <p className="faint sbm-legend">
          <i className="buy" /> Buy now <i className="sell" /> Sell now <i className="mayor" /> Mayor terms <i className="event" /> Events <i className="pin" /> Questions
          {chart?.imported && ' · the start is from Coflnet (every 2 hours)'}
        </p>
      </Panel>

      <Panel title="Biggest moves, last 24 hours">
        {!moves || (!moves.up.length && !moves.down.length) ? (
          <Nothing what="Shows once Orbit has a day of history." />
        ) : (
          <div className="sbm-movers">
            {[...moves.up.slice(0, 5), ...moves.down.slice(0, 5)].map((m) => (
              <button key={m.id} className="sbm-mover" onClick={() => setItem({ id: m.id, name: m.name })}>
                <ItemPic id={m.id} name={m.name} size={20} />
                <span className="sbm-name" title={m.name}>
                  {m.name}
                </span>
                <b className={m.change >= 0 ? 'up' : 'down'}>{pct(m.change)}</b>
              </button>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Rules being checked"
        right={
          state.aiReady && (
            <button className="btn" disabled={finding} onClick={() => void findRules()} title="Claude looks for patterns and adds the ones with evidence" data-sbm-find-rules>
              {finding ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />} Find rules
            </button>
          )
        }
      >
        {found && (
          <div className="sbm-found">
            <Rich text={found} />
          </div>
        )}
        {state.rules.length === 0 ? (
          <Nothing what="Rules are patterns like “Enchanted Gold rises before every Spooky Festival”. Orbit checks each one every time it happens and keeps score. Press Find rules, or ask the AI to add one." />
        ) : (
          <ul className="sbm-rules">
            {state.rules.map((r) => {
              const sc = ruleScore(r)
              return (
                <li key={r.id}>
                  <Brain size={13} />
                  <div>
                    <span>{ruleText(r, state.eventKinds)}</span>
                    <small className="faint">
                      {sc.label}
                      {r.why ? ` · ${r.why}` : ''}
                    </small>
                  </div>
                  <b className={sc.total ? (sc.hits / sc.total >= 0.6 ? 'up' : 'down') : 'faint'}>{sc.total ? `${Math.round((sc.hits / sc.total) * 100)}%` : '–'}</b>
                  <button className="icon-btn" title="Stop checking this rule" onClick={() => void window.api.marketRemoveRule(r.id).then(setState)}>
                    <Trash2 size={13} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {state.mutes.length > 0 && (
          <p className="faint sbm-mutes">
            Not asking about:{' '}
            {state.mutes.map((m) => (
              <button key={`${m.item}-${m.kind}`} className="sbp-chip" onClick={() => void window.api.marketUnmute(m.item, m.kind).then(setState)} title="Ask about this again">
                {m.item} ({m.kind}) <X size={10} />
              </button>
            ))}
          </p>
        )}
      </Panel>

      <AskPanel ready={state.aiReady} />
    </div>
  )
}
