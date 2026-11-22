import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { CalendarDays, Check, HelpCircle, ListChecks, Lock, Copy, Download, Hammer, Loader2, RefreshCw, Search, Star, Trash2, TrendingUp, X } from 'lucide-react'
import { MODE_NAMES, shortNumber } from '@shared/skyblock'
import {
  describeSbDate,
  friendSummary,
  seriesOf,
  type Craftable,
  type MinionStep,
  type MpStep,
  type SbDate,
  type SbEvent,
  type SbFriend,
  type SbMayor,
  type SbProfilePage,
  type SbSnapshot
} from '@shared/skyblockMore'
import { addHomeCard } from '../../lib/home'
import { openSpecialTab, SKYBLOCK_GOALS_TAB } from '../../lib/editorController'
import { errorMessage } from '../../lib/paths'
import { notify } from '../../store/notify'
import { HomeBox } from '../Home/HomePage'
import { Bar, Chip, fmt, levelColor, Nothing, Panel, rarityColor, Ring } from './SkyblockProfile'
import { Head, ItemPic, useNeuIcons } from './SkyblockPic'
import { DailyChecklist } from './SkyblockPlanners'
import type { SbProfileView } from '@shared/skyblockProfile'

/**
 * The SkyBlock page's other pages: Progress (graphs, since last time, milestones), Helpers (ironman:
 * craftable now, Magical Power, minions), Compare (side by side and the friends board), the player
 * search, the share card, the drifting background, and the SkyBlock calendar on Home.
 */

export const cleanErr = (err: unknown): string => errorMessage(err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const ago = (at: number): string => {
  const m = Math.round((Date.now() - at) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`
}

const day = (at: number): string => new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' })

// ---------- finding a player ----------

/** Search by Minecraft name, with the players you've starred and looked up before. */
export function PlayerSearch({ onOpen, friends, onStar }: { onOpen: (who: string) => void; friends: SbFriend[]; onStar: (uuid: string, on: boolean) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [])
  const needle = q.trim().toLowerCase()
  const shown = friends.filter((f) => !needle || f.name.toLowerCase().includes(needle))
  const starred = shown.filter((f) => f.starred)
  const recent = shown.filter((f) => !f.starred).slice(0, 8)
  const go = (who: string): void => {
    if (!who.trim()) return
    onOpen(who.trim())
    setQ('')
    setOpen(false)
  }
  const row = (f: SbFriend) => (
    <li key={f.uuid}>
      <button className="sbx-find-row" onClick={() => go(f.uuid)} data-sbx-find-player={f.name}>
        {f.skin ? <Head skin={f.skin} size={22} /> : <ItemPic id="SKULL_ITEM-3" size={22} />}
        <b>{f.name}</b>
        <span className="faint">{f.summary ? `Level ${Math.floor(f.summary.level)} · ${f.summary.profileName}` : ''}</span>
      </button>
      <button className={`icon-btn sbx-star ${f.starred ? 'on' : ''}`} title={f.starred ? 'Unstar' : 'Star (keep on the friends board)'} onClick={() => onStar(f.uuid, !f.starred)}>
        <Star size={13} fill={f.starred ? 'currentColor' : 'none'} />
      </button>
    </li>
  )
  return (
    <div className="sbx-find" ref={box}>
      <div className="sbx-find-box">
        <Search size={14} />
        <input
          value={q}
          placeholder="Look up any player"
          spellCheck={false}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go(q)
            if (e.key === 'Escape') setOpen(false)
          }}
          data-sbx-find
        />
      </div>
      {open && (starred.length > 0 || recent.length > 0 || needle) && (
        <div className="sbx-find-menu" data-sbx-find-menu>
          {needle && (
            <button className="sbx-find-row go" onClick={() => go(q)}>
              <Search size={14} /> Look up <b>{q.trim()}</b>
            </button>
          )}
          {starred.length > 0 && (
            <>
              <span className="sbx-find-head">Starred</span>
              <ul>{starred.map(row)}</ul>
            </>
          )}
          {recent.length > 0 && (
            <>
              <span className="sbx-find-head">Looked up before</span>
              <ul>{recent.map(row)}</ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- graphs ----------

type Metric = { id: string; label: string; icon: string; pick: (s: SbSnapshot) => number | null; short?: boolean }

const METRICS: Metric[] = [
  { id: 'level', label: 'SkyBlock level', icon: 'NETHER_STAR', pick: (s) => s.level },
  { id: 'networth', label: 'Networth', icon: 'EMERALD', pick: (s) => s.networth, short: true },
  { id: 'skills', label: 'Skill average', icon: 'DIAMOND_SWORD', pick: (s) => s.skillAverage },
  { id: 'cata', label: 'Catacombs', icon: 'ESSENCE_WITHER', pick: (s) => s.catacombs },
  { id: 'mp', label: 'Magical power', icon: 'HEGEMONY_ARTIFACT', pick: (s) => s.magicalPower },
  { id: 'coins', label: 'Purse and bank', icon: 'GOLD_INGOT', pick: (s) => s.coins, short: true },
  { id: 'minions', label: 'Minion tiers', icon: 'COBBLESTONE_GENERATOR_1', pick: (s) => s.minions },
  { id: 'fairy', label: 'Fairy souls', icon: 'GHAST_TEAR', pick: (s) => s.fairySouls }
]

/** A line over time, with a soft fill and the newest value labelled. */
export function LineGraph({ points, short, height = 220 }: { points: [number, number][]; short?: boolean; height?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const w = 760
  const h = height
  const pad = { l: 56, r: 16, t: 16, b: 28 }
  if (points.length < 2) return <Nothing what="Orbit saves your numbers every time it reads your profile. The graph fills in as you play (it needs at least two readings)." />
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  let y0 = Math.min(...ys)
  let y1 = Math.max(...ys)
  if (y0 === y1) {
    y0 -= 1
    y1 += 1
  }
  const X = (x: number): number => pad.l + ((x - x0) / (x1 - x0 || 1)) * (w - pad.l - pad.r)
  const Y = (y: number): number => pad.t + (1 - (y - y0) / (y1 - y0)) * (h - pad.t - pad.b)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('')
  const area = `${line}L${X(x1).toFixed(1)},${h - pad.b}L${X(x0).toFixed(1)},${h - pad.b}Z`
  const label = (n: number): string => (short ? shortNumber(n) : Number.isInteger(n) ? fmt(n) : n.toFixed(1))
  const ticks = [0, 0.5, 1].map((t) => y0 + t * (y1 - y0))
  const hp = hover === null ? null : points[hover]
  return (
    <svg
      className="sbx-graph"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        const x = x0 + (((e.clientX - r.left) / r.width) * w - pad.l) / ((w - pad.l - pad.r) / (x1 - x0 || 1))
        let best = 0
        for (let i = 1; i < points.length; i++) if (Math.abs(points[i][0] - x) < Math.abs(points[best][0] - x)) best = i
        setHover(best)
      }}
      onMouseLeave={() => setHover(null)}
      data-sbx-graph
    >
      <defs>
        <linearGradient id="sbx-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--sbx-hi)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--sbx-hi)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="sbx-stroke" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="var(--sbx-violet)" />
          <stop offset="100%" stopColor="var(--sbx-hi)" />
        </linearGradient>
      </defs>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={w - pad.r} y1={Y(t)} y2={Y(t)} className="sbx-grid" />
          <text x={pad.l - 8} y={Y(t) + 4} textAnchor="end" className="sbx-axis">
            {label(t)}
          </text>
        </g>
      ))}
      <text x={pad.l} y={h - 8} className="sbx-axis">
        {day(x0)}
      </text>
      <text x={w - pad.r} y={h - 8} textAnchor="end" className="sbx-axis">
        {day(x1)}
      </text>
      <path d={area} fill="url(#sbx-fill)" />
      <path d={line} fill="none" stroke="url(#sbx-stroke)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
      {hp && (
        <g>
          <line x1={X(hp[0])} x2={X(hp[0])} y1={pad.t} y2={h - pad.b} className="sbx-grid hover" />
          <circle cx={X(hp[0])} cy={Y(hp[1])} r={4} className="sbx-dot" />
          <text x={Math.min(X(hp[0]) + 8, w - 150)} y={Math.max(Y(hp[1]) - 10, 14)} className="sbx-tip">
            {label(hp[1])} · {new Date(hp[0]).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </text>
        </g>
      )}
    </svg>
  )
}

/** Your numbers over time on this profile, what's moved since you last looked, and your milestones. */
export function ProgressPage({ page }: { page: SbProfilePage }) {
  const [metric, setMetric] = useState('level')
  const [skill, setSkill] = useState<string | null>(null)
  const [allMilestones, setAllMilestones] = useState(false)
  const m = METRICS.find((x) => x.id === metric) ?? METRICS[0]
  const points = useMemo(() => seriesOf(page.history, skill ? (s) => s.skills[skill] ?? null : m.pick), [page.history, m, skill])
  const skills = Object.keys(page.history[page.history.length - 1]?.skills ?? {})
  const since = page.since
  return (
    <div className="sbp-panels" data-sbx-progress>
      <Panel title={since ? `Since you last looked (${ago(since.at)})` : 'Since you last looked'} wide>
        {since && since.changes.length ? (
          <div className="sbx-changes">
            {since.changes.map((c, i) => {
              const d = c.to - c.from
              const big = c.kind === 'coins' || c.kind === 'networth' || c.kind === 'collection'
              return (
                <div key={i} className={`sbx-change ${d < 0 ? 'down' : 'up'}`}>
                  {c.icon ? <ItemPic id={c.icon} name={c.label} size={26} /> : <TrendingUp size={18} />}
                  <span className="sbx-change-label">{c.label}</span>
                  <b>
                    {d > 0 ? '+' : ''}
                    {big ? shortNumber(d) : c.levels ? `${c.levels} level${c.levels === 1 ? '' : 's'}` : Number.isInteger(d) ? fmt(d) : d.toFixed(2)}
                  </b>
                  <small className="faint">{big ? `${shortNumber(c.from)} → ${shortNumber(c.to)}` : `${fmtLv(c.from)} → ${fmtLv(c.to)}`}</small>
                </div>
              )
            })}
          </div>
        ) : (
          <Nothing what={since ? 'Nothing’s changed since you last looked.' : 'Come back after playing and this shows what went up.'} />
        )}
      </Panel>
      <Panel
        title="Over time"
        wide
        right={
          <span className="faint">
            {page.history.length} reading{page.history.length === 1 ? '' : 's'}
            {page.history[0] ? ` since ${day(page.history[0].at)}` : ''}
          </span>
        }
      >
        <div className="sbx-metrics">
          {METRICS.map((x) => (
            <button
              key={x.id}
              className={!skill && metric === x.id ? 'active' : ''}
              onClick={() => {
                setMetric(x.id)
                setSkill(null)
              }}
              data-sbx-metric={x.id}
            >
              <ItemPic id={x.icon} size={18} /> {x.label}
            </button>
          ))}
          {skills.length > 0 && (
            <select value={skill ?? ''} onChange={(e) => setSkill(e.target.value || null)} className={skill ? 'active' : ''}>
              <option value="">One skill…</option>
              {skills.map((s) => (
                <option key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          )}
        </div>
        <LineGraph points={points} short={!skill && m.short} />
      </Panel>
      <Panel title="Milestones" wide>
        {page.milestones.length ? (
          <>
            <ol className="sbx-feed">
              {page.milestones.slice(0, allMilestones ? undefined : 12).map((x, i) => (
                <li key={i}>
                  <span className="sbx-feed-dot" />
                  {x.icon ? <ItemPic id={x.icon} size={22} /> : <Check size={16} />}
                  <span>{x.text}</span>
                  <small className="faint">{new Date(x.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
                </li>
              ))}
            </ol>
            {page.milestones.length > 12 && (
              <button className="link-btn" onClick={() => setAllMilestones(!allMilestones)}>
                {allMilestones ? 'Show fewer' : `Show all ${page.milestones.length}`}
              </button>
            )}
          </>
        ) : (
          <Nothing what="Level-ups, new collection tiers and accessories show up here as Orbit sees them." />
        )}
      </Panel>
    </div>
  )
}

const fmtLv = (n: number): string => (Number.isInteger(n) ? fmt(n) : n.toFixed(1))

// ---------- ironman helpers ----------

type Helpers = { craftable: Craftable[]; mp: MpStep[]; minions: MinionStep[] }

/** What you can make now, the cheapest Magical Power, and your next minion tiers. */
export function HelpersPage({ profileId, view }: { profileId: string; view?: SbProfileView }) {
  const [h, setH] = useState<Helpers | null | undefined>(undefined)
  const [tab, setTab] = useState<'daily' | 'craft' | 'mp' | 'minions'>(() => {
    try {
      return (localStorage.getItem('orbit-skyblock-helper') as 'daily' | null) ?? 'craft'
    } catch {
      return 'craft'
    }
  })
  const pickTab = (t: 'daily' | 'craft' | 'mp' | 'minions'): void => {
    setTab(t)
    try {
      localStorage.setItem('orbit-skyblock-helper', t)
    } catch {
      // Just not remembered.
    }
  }
  useEffect(() => {
    let live = true
    setH(undefined)
    void window.api
      .skyblockHelpers()
      .then((x) => live && setH(x))
      .catch(() => live && setH(null))
    return () => {
      live = false
    }
  }, [profileId])
  const add = async (id: string, name: string): Promise<void> => {
    try {
      await window.api.skyblockGoalsAdd(id, 1)
      notify(`Added ${name.replace(/§./g, '')} to your goals.`)
    } catch (err) {
      notify(cleanErr(err))
    }
  }
  const tabs = (
    <div className="sbx-tabs">
      {view && (
        <button className={tab === 'daily' ? 'active' : ''} onClick={() => pickTab('daily')} data-sbx-helper="daily">
          <ListChecks size={14} /> Daily checklist
        </button>
      )}
      <button className={tab === 'craft' ? 'active' : ''} onClick={() => pickTab('craft')} data-sbx-helper="craft">
        <Hammer size={14} /> Craftable now{h ? ` (${h.craftable.length})` : ''}
      </button>
      <button className={tab === 'mp' ? 'active' : ''} onClick={() => pickTab('mp')} data-sbx-helper="mp">
        <ItemPic id="HEGEMONY_ARTIFACT" size={18} /> Magical Power planner
      </button>
      <button className={tab === 'minions' ? 'active' : ''} onClick={() => pickTab('minions')} data-sbx-helper="minions">
        <ItemPic id="COBBLESTONE_GENERATOR_1" size={18} /> Minion helper
      </button>
    </div>
  )
  if (tab === 'daily' && view)
    return (
      <div className="sbx-helpers" data-sbx-helpers>
        {tabs}
        <DailyChecklist v={view} />
      </div>
    )
  if (h === undefined)
    return (
      <p className="faint sbx-loading">
        <Loader2 size={14} className="spin" /> Working it out…
      </p>
    )
  if (!h) return <Nothing what="The helpers need your profile and the item list. Press Refresh at the top." />
  return (
    <div className="sbx-helpers" data-sbx-helpers>
      {tabs}
      {tab === 'craft' && (
        <Panel title="You have everything to make these" wide>
          {h.craftable.length ? (
            <div className="sbx-cards">
              {h.craftable.map((c) => (
                <button key={c.id} className="sbx-card" onClick={() => void add(c.id, c.name)} title="Add as a goal">
                  <ItemPic id={c.id} name={c.name} size={40} />
                  <span style={{ color: `var(--mc-${c.color}, inherit)` }}>{c.name.replace(/§./g, '')}</span>
                  <small className="faint">{c.times > 1 ? `${fmt(c.times)} times` : 'once'}</small>
                </button>
              ))}
            </div>
          ) : (
            <Nothing what="Nothing new to craft from what’s in your inventory, sacks and storage." />
          )}
        </Panel>
      )}
      {tab === 'mp' && (
        <Panel title="Accessories worth getting next" wide right={<span className="faint">most Magical Power for the least work first</span>}>
          {h.mp.length ? (
            <div className="sbx-rows">
              {h.mp.map((s) => (
                <div key={s.id} className="sbx-row" style={{ '--rarity': rarityColor(s.rarity) } as CSSProperties} data-sbx-mp={s.id}>
                  <ItemPic id={s.id} name={s.name} size={32} />
                  <span className="sbx-row-name">
                    <b style={{ color: rarityColor(s.rarity) }}>{s.name.replace(/§./g, '')}</b>
                    <small className="faint">
                      {s.upgrade ? 'Upgrade · ' : ''}
                      {s.uncraftable
                        ? 'not crafted (a drop or a shop)'
                        : s.ready
                          ? 'you can craft it now'
                          : s.hoursLeft !== null
                            ? `about ${describeH(s.hoursLeft)} of play`
                            : `${Math.round(s.progress * 100)}% of the materials`}
                    </small>
                  </span>
                  <Bar progress={s.progress} color="var(--sbx-hi)" />
                  <Chip label="MP" value={`+${s.mp}`} tone="#b4a2ff" />
                  <button className="btn" onClick={() => void add(s.id, s.name)}>
                    Goal
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <Nothing what="No missing accessories found. Nice." />
          )}
        </Panel>
      )}
      {tab === 'minions' && <Minions list={h.minions} add={add} />}
    </div>
  )
}

const describeH = (h: number): string => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)} h` : `${Math.round(h / 24)} days`)

function Minions({ list, add }: { list: MinionStep[]; add: (id: string, name: string) => Promise<void> }) {
  const [all, setAll] = useState(false)
  const shown = all ? list : list.filter((m) => m.next && (m.tier > 0 || m.progress > 0)).slice(0, 40)
  return (
    <Panel
      title="Next minion tiers"
      wide
      right={
        <button className="link-btn" onClick={() => setAll(!all)}>
          {all ? 'Only the ones you’ve started' : 'Show every minion'}
        </button>
      }
    >
      {shown.length ? (
        <div className="sbx-rows">
          {shown.map((m) => (
            <div key={m.type} className={`sbx-row ${m.ready ? 'ready' : (m.requires ?? []).some((r) => r.met === false) ? 'locked' : ''}`} data-sbx-minion={m.type}>
              <ItemPic id={m.next ?? `${m.type}_GENERATOR_${m.maxTier}`} name={m.name} size={32} />
              <span className="sbx-row-name">
                <b>{m.name}</b>
                <small className="faint">
                  {m.next ? `Tier ${m.tier} → ${m.tier + 1}` : `All ${m.maxTier} tiers`}
                  {m.ready ? ' · ready to craft' : (m.requires ?? []).some((r) => r.met === false) ? ' · locked' : ''}
                </small>
              </span>
              <span className="sbx-needs">
                {m.needs.map((n) => (
                  <span key={n.id} className={n.have >= n.need ? 'ok' : ''} title={n.name}>
                    <ItemPic id={n.id} name={n.name} size={18} /> {shortNumber(n.have)}/{shortNumber(n.need)}
                  </span>
                ))}
                {(m.requires ?? []).map((r) => (
                  <span key={r.label} className={`sbx-req ${r.met === true ? 'ok' : r.met === false ? 'no' : 'unknown'}`} title={r.detail} data-sbx-req={r.label}>
                    {r.met === true ? <Check size={12} /> : r.met === false ? <Lock size={12} /> : <HelpCircle size={12} />} {r.label}
                  </span>
                ))}
              </span>
              <Bar progress={m.progress} color={m.ready ? '#8fe3ff' : '#b4a2ff'} />
              {m.next && (
                <button className="btn" onClick={() => void add(m.next!, `${m.name} ${m.tier + 1}`)}>
                  Goal
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <Nothing what="You haven’t crafted any minions yet. Show every minion to pick one to start." />
      )}
    </Panel>
  )
}

// ---------- comparing ----------

type Stat = { label: string; icon: string; of: (p: SbProfilePage) => number | null; short?: boolean; dp?: number }

const COMPARE: Stat[] = [
  { label: 'SkyBlock level', icon: 'NETHER_STAR', of: (p) => p.view.skyblockLevel.level + p.view.skyblockLevel.progress, dp: 1 },
  { label: 'Networth', icon: 'EMERALD', of: (p) => p.view.networth?.total ?? null, short: true },
  { label: 'Purse and bank', icon: 'GOLD_INGOT', of: (p) => (p.view.purse ?? 0) + (p.view.bank ?? 0), short: true },
  { label: 'Skill average', icon: 'DIAMOND_SWORD', of: (p) => p.view.skillAverage, dp: 1 },
  { label: 'Catacombs', icon: 'ESSENCE_WITHER', of: (p) => (p.view.dungeons ? p.view.dungeons.catacombs.level + p.view.dungeons.catacombs.progress : null), dp: 1 },
  { label: 'Slayer XP', icon: 'REVENANT_FLESH', of: (p) => p.view.slayers.reduce((a, s) => a + s.level.xp, 0), short: true },
  { label: 'Magical power', icon: 'HEGEMONY_ARTIFACT', of: (p) => p.view.accessories?.magicalPower ?? null },
  { label: 'Minion tiers', icon: 'COBBLESTONE_GENERATOR_1', of: (p) => p.view.craftedMinions },
  { label: 'Pets', icon: 'BONE', of: (p) => p.view.pets.length },
  { label: 'Fairy souls', icon: 'GHAST_TEAR', of: (p) => p.view.fairySouls.collected }
]

const show = (s: Stat, n: number | null): string => (n === null ? '—' : s.short ? shortNumber(n) : s.dp ? n.toFixed(s.dp) : fmt(n))

/** Two profiles stat by stat, with skills and slayers as bars. */
function SideBySide({ a, b }: { a: SbProfilePage; b: SbProfilePage }) {
  const head = (p: SbProfilePage) => (
    <div className="sbx-vs-head">
      {p.player.skin ? <Head skin={p.player.skin} size={48} /> : <ItemPic id="SKULL_ITEM-3" size={48} />}
      <div>
        <b>{p.player.name}</b>
        <small className="faint">
          {p.view.profileName}
          {MODE_NAMES[p.view.mode] ? ` · ${MODE_NAMES[p.view.mode]}` : ''}
        </small>
      </div>
    </div>
  )
  const skills = [...new Set([...(a.view.skills ?? []).map((s) => s.id), ...(b.view.skills ?? []).map((s) => s.id)])]
  const pair = (l: number, r: number, label: ReactNode, key: string) => {
    const most = Math.max(l, r, 1)
    return (
      <div key={key} className="sbx-vs-bar">
        <span className={`sbx-vs-l ${l > r ? 'win' : ''}`}>
          <i style={{ width: `${(l / most) * 100}%` }} />
          <b>{fmtLv(Math.round(l * 10) / 10)}</b>
        </span>
        <span className="sbx-vs-label">{label}</span>
        <span className={`sbx-vs-r ${r > l ? 'win' : ''}`}>
          <i style={{ width: `${(r / most) * 100}%` }} />
          <b>{fmtLv(Math.round(r * 10) / 10)}</b>
        </span>
      </div>
    )
  }
  return (
    <Panel title="Side by side" wide>
      <div className="sbx-vs" data-sbx-vs>
        <div className="sbx-vs-heads">
          {head(a)}
          <span className="sbx-vs-x">vs</span>
          {head(b)}
        </div>
        <div className="sbx-vs-table">
          {COMPARE.map((s) => {
            const l = s.of(a)
            const r = s.of(b)
            return (
              <div key={s.label} className="sbx-vs-row">
                <b className={l !== null && r !== null && l > r ? 'win' : ''}>{show(s, l)}</b>
                <span>
                  <ItemPic id={s.icon} size={18} /> {s.label}
                </span>
                <b className={l !== null && r !== null && r > l ? 'win' : ''}>{show(s, r)}</b>
              </div>
            )
          })}
        </div>
        {skills.length > 0 && <h4 className="sbx-vs-sub">Skills</h4>}
        {skills.map((id) => {
          const sa = a.view.skills?.find((s) => s.id === id)
          const sb = b.view.skills?.find((s) => s.id === id)
          return pair(sa ? sa.level + sa.progress : 0, sb ? sb.level + sb.progress : 0, (sa ?? sb)?.name ?? id, id)
        })}
        <h4 className="sbx-vs-sub">Slayers</h4>
        {a.view.slayers.map((s) => {
          const o = b.view.slayers.find((x) => x.id === s.id)
          return pair(s.level.level + s.level.progress, o ? o.level.level + o.level.progress : 0, s.name, s.id)
        })}
      </div>
    </Panel>
  )
}

/** Side by side with anyone, and the friends board of everyone you've starred. */
export function ComparePage({
  mine,
  other,
  friends,
  setFriends,
  open
}: {
  mine: SbProfilePage | null
  other: SbProfilePage | null
  friends: SbFriend[]
  setFriends: (f: SbFriend[]) => void
  open: (who: string) => void
}) {
  const [vs, setVs] = useState<SbProfilePage | null>(null)
  const [who, setWho] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sort, setSort] = useState<keyof NonNullable<SbFriend['summary']>>('networth')
  const left = mine
  const right = other ?? vs
  const lookup = async (name: string): Promise<void> => {
    if (!name.trim()) return
    setBusy(true)
    setErr('')
    try {
      setVs(await window.api.skyblockPlayersLookup(name.trim()))
      setFriends(await window.api.skyblockPlayersList())
    } catch (e) {
      setErr(cleanErr(e))
    } finally {
      setBusy(false)
    }
  }
  const refresh = async (): Promise<void> => {
    setBusy(true)
    try {
      setFriends(await window.api.skyblockPlayersRefreshStarred())
    } finally {
      setBusy(false)
    }
  }
  // You're on the board too, so you can see where you stand.
  const you: SbFriend | null = mine
    ? { uuid: mine.player.uuid, name: mine.player.name || 'You', skin: mine.player.skin, starred: false, at: mine.view.at, summary: friendSummary(mine.view) }
    : null
  const board = [...friends.filter((f) => f.uuid !== you?.uuid), ...(you ? [you] : [])]
    .filter((f) => f.summary)
    .sort((x, y) => Number(y.summary?.[sort] ?? -1) - Number(x.summary?.[sort] ?? -1))
  const cols: [keyof NonNullable<SbFriend['summary']>, string][] = [
    ['level', 'Level'],
    ['networth', 'Networth'],
    ['skillAverage', 'Skill avg'],
    ['catacombs', 'Catacombs'],
    ['slayerXp', 'Slayer XP'],
    ['magicalPower', 'MP']
  ]
  return (
    <div className="sbp-panels" data-sbx-compare>
      {!other && (
        <Panel title="Compare with someone" wide>
          <div className="sbx-compare-find">
            <input
              value={who}
              placeholder="Minecraft name"
              spellCheck={false}
              onChange={(e) => setWho(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void lookup(who)}
              data-sbx-compare-name
            />
            <button className="btn btn-primary" disabled={busy || !who.trim()} onClick={() => void lookup(who)}>
              {busy ? <Loader2 size={13} className="spin" /> : <Search size={13} />} Compare
            </button>
            {friends.slice(0, 6).map((f) => (
              <button key={f.uuid} className="sbx-pill" onClick={() => void lookup(f.uuid)}>
                {f.skin ? <Head skin={f.skin} size={16} /> : null} {f.name}
              </button>
            ))}
          </div>
          {err && <p className="setting-warning">{err}</p>}
        </Panel>
      )}
      {left && right ? (
        <SideBySide a={left} b={right} />
      ) : !left && other ? (
        <Nothing what="Orbit needs your own profile to compare against. Set up Hypixel on the Games page." />
      ) : null}
      <Panel
        title="Friends board"
        wide
        right={
          <button className="btn" disabled={busy || !friends.some((f) => f.starred)} onClick={() => void refresh()} title="Look every starred player up again">
            <RefreshCw size={13} className={busy ? 'spin' : ''} /> Update starred
          </button>
        }
      >
        {board.length ? (
          <div className="sbx-board" data-sbx-board>
            <div className="sbx-board-row head">
              <span />
              <span>Player</span>
              {cols.map(([k, label]) => (
                <button key={k} className={sort === k ? 'active' : ''} onClick={() => setSort(k)}>
                  {label}
                </button>
              ))}
              <span />
            </div>
            {board.map((f, i) => (
              <div key={f.uuid} className={`sbx-board-row ${f === you ? 'you' : ''}`} data-sbx-board-player={f.name}>
                <span className="sbx-rank">{i + 1}</span>
                <button className="sbx-board-name" onClick={() => open(f.uuid)}>
                  {f.skin ? <Head skin={f.skin} size={26} /> : <ItemPic id="SKULL_ITEM-3" size={26} />}
                  <span>
                    <b>{f.name}</b>
                    <small className="faint">
                      {f.summary!.profileName} · {ago(f.at)}
                    </small>
                  </span>
                </button>
                {cols.map(([k]) => {
                  const n = f.summary![k] as number | null
                  return <span key={k}>{n === null ? '—' : k === 'networth' || k === 'slayerXp' ? shortNumber(n) : k === 'magicalPower' ? fmt(n) : n.toFixed(1)}</span>
                })}
                <span className="sbx-board-acts">
                  {f === you ? (
                    <span className="sbp-badge">You</span>
                  ) : (
                    <>
                      <button
                        className={`icon-btn sbx-star ${f.starred ? 'on' : ''}`}
                        title={f.starred ? 'Unstar' : 'Star'}
                        onClick={() => void window.api.skyblockPlayersStar(f.uuid, !f.starred).then(setFriends)}
                      >
                        <Star size={13} fill={f.starred ? 'currentColor' : 'none'} />
                      </button>
                      <button className="icon-btn" title="Forget" onClick={() => void window.api.skyblockPlayersForget(f.uuid).then(setFriends)}>
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Nothing what="Look up a few players and star them to make a leaderboard of your friends." />
        )}
      </Panel>
    </div>
  )
}

// ---------- the share card ----------

/** Draws a profile card as a picture (no item pictures, so it always works offline). */
export function drawCard(p: SbProfilePage): HTMLCanvasElement {
  const v = p.view
  const c = document.createElement('canvas')
  const W = 1200
  const H = 630
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const bg = g.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#05040d')
  bg.addColorStop(0.55, '#0e1030')
  bg.addColorStop(1, '#1a1150')
  g.fillStyle = bg
  g.fillRect(0, 0, W, H)
  // Soft lights, like the app.
  for (const [x, y, r, col] of [
    [980, 80, 420, '63,91,255'],
    [160, 620, 380, '180,162,255'],
    [700, 300, 260, '143,227,255']
  ] as [number, number, number, string][]) {
    const l = g.createRadialGradient(x, y, 0, x, y, r)
    l.addColorStop(0, `rgba(${col},0.28)`)
    l.addColorStop(1, `rgba(${col},0)`)
    g.fillStyle = l
    g.fillRect(0, 0, W, H)
  }
  const glass = (x: number, y: number, w: number, h: number): void => {
    g.save()
    g.beginPath()
    g.roundRect(x, y, w, h, 22)
    g.fillStyle = 'rgba(14,15,34,0.55)'
    g.fill()
    g.strokeStyle = 'rgba(255,255,255,0.16)'
    g.lineWidth = 1.5
    g.stroke()
    g.restore()
  }
  glass(40, 40, W - 80, H - 80)
  const font = (size: number, weight = 600): string => `${weight} ${size}px Inter, "Segoe UI", system-ui, sans-serif`
  // Level ring.
  const lvl = v.skyblockLevel.level
  g.lineWidth = 12
  g.strokeStyle = 'rgba(255,255,255,0.1)'
  g.beginPath()
  g.arc(150, 160, 62, 0, Math.PI * 2)
  g.stroke()
  g.strokeStyle = levelColor(lvl)
  g.beginPath()
  g.arc(150, 160, 62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, v.skyblockLevel.progress))
  g.stroke()
  g.fillStyle = levelColor(lvl)
  g.font = font(44, 800)
  g.textAlign = 'center'
  g.fillText(String(lvl), 150, 175)
  g.textAlign = 'left'
  const title = g.createLinearGradient(250, 0, 800, 0)
  title.addColorStop(0, '#ffffff')
  title.addColorStop(1, '#8fe3ff')
  g.fillStyle = title
  g.font = font(64, 800)
  g.fillText(p.player.name || v.player?.name || 'Player', 250, 160)
  g.fillStyle = 'rgba(255,255,255,0.65)'
  g.font = font(26, 500)
  let sx = 252
  const sub = (text: string): void => {
    g.fillStyle = 'rgba(255,255,255,0.65)'
    g.font = font(26, 500)
    g.fillText(text, sx, 204)
    sx += g.measureText(text).width
  }
  sub(v.profileName)
  const modeName = MODE_NAMES[v.mode]
  if (modeName) {
    // A pill so the game mode stands out, with Hypixel's ♲ for ironman.
    const iron = v.mode === 'ironman'
    const label = iron ? `♲ ${modeName}` : modeName
    g.font = `700 22px Inter, "Segoe UI", "Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", system-ui, sans-serif`
    const w = g.measureText(label).width + 28
    const x = sx + 14
    g.beginPath()
    g.roundRect(x, 178, w, 36, 18)
    g.fillStyle = iron ? 'rgba(200,205,215,0.22)' : 'rgba(143,227,255,0.16)'
    g.fill()
    g.lineWidth = 2
    g.strokeStyle = iron ? 'rgba(220,225,235,0.75)' : 'rgba(143,227,255,0.6)'
    g.stroke()
    g.fillStyle = '#ffffff'
    g.fillText(label, x + 14, 204)
    sx = x + w - 2
  }
  if (v.coopMembers > 1) sub(` · co-op of ${v.coopMembers}`)
  const stats: [string, string][] = [
    ['Networth', v.networth ? shortNumber(v.networth.total) : '—'],
    ['Skill average', v.skillAverage === null ? '—' : v.skillAverage.toFixed(1)],
    ['Catacombs', v.dungeons ? String(v.dungeons.catacombs.level) : '—'],
    ['Slayer XP', shortNumber(v.slayers.reduce((a, s) => a + s.level.xp, 0))],
    ['Magical power', v.accessories ? fmt(v.accessories.magicalPower) : '—'],
    ['Purse and bank', shortNumber((v.purse ?? 0) + (v.bank ?? 0))]
  ]
  stats.forEach(([label, value], i) => {
    const x = 80 + (i % 3) * 360
    const y = 262 + Math.floor(i / 3) * 135
    glass(x, y, 330, 115)
    g.fillStyle = 'rgba(255,255,255,0.6)'
    g.font = font(22, 500)
    g.fillText(label, x + 26, y + 42)
    g.fillStyle = '#ffffff'
    g.font = font(44, 800)
    g.fillText(value, x + 26, y + 92)
  })
  g.fillStyle = 'rgba(255,255,255,0.4)'
  g.font = font(20, 500)
  g.fillText(`Hypixel SkyBlock · ${new Date(v.at).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}`, 80, H - 66)
  g.textAlign = 'right'
  g.fillText('Orbit', W - 80, H - 66)
  return c
}

/** The share card, ready to copy or save. */
export function ShareCard({ page, close }: { page: SbProfilePage; close: () => void }) {
  const url = useMemo(() => drawCard(page).toDataURL('image/png'), [page])
  const name = `${page.player.name || 'skyblock'}-${page.view.profileName}`.replace(/[^\w-]+/g, '-')
  const copy = async (): Promise<void> => {
    try {
      const blob = await (await fetch(url)).blob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      notify('Copied the card. Paste it anywhere.')
    } catch (err) {
      notify(cleanErr(err))
    }
  }
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [close])
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal sbx-share" onMouseDown={(e) => e.stopPropagation()} data-sbx-share>
        <header className="sba-browser-head">
          <strong>Share card</strong>
          <button className="icon-btn" onClick={close} title="Close">
            <X size={15} />
          </button>
        </header>
        <img src={url} alt="Profile card" />
        <footer className="sba-browser-foot">
          <span className="faint">1200 × 630, sized for Discord and most sites.</span>
          <button className="btn" onClick={() => void copy()} data-sbx-share-copy>
            <Copy size={13} /> Copy
          </button>
          <a className="btn btn-primary" href={url} download={`${name}.png`}>
            <Download size={13} /> Save picture
          </a>
        </footer>
      </div>
    </div>
  )
}

// ---------- the SkyBlock calendar on Home ----------

addHomeCard({ id: 'skyblock-calendar', order: 49, title: 'SkyBlock calendar', Card: SkyblockCalendarCard })

const until = (at: number, now: number): string => {
  const m = Math.max(0, Math.round((at - now) / 60_000))
  if (m < 60) return `in ${m} min`
  if (m < 48 * 60) return `in ${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim()
  return `in ${Math.round(m / 1440)} days`
}

/** Home: the SkyBlock date, the mayor, and what's on next in your own time. Hidden until the add-on is in. */
function SkyblockCalendarCard() {
  const [cal, setCal] = useState<{ now: SbDate; events: SbEvent[]; mayor: SbMayor | null } | null>(null)
  const [ready, setReady] = useState(false)
  const [now, setNow] = useState(Date.now())
  useNeuIcons()
  useEffect(() => {
    let live = true
    const load = (): void => {
      void window.api.skyblockAddonState().then((s) => live && setReady(s.state === 'ready'))
      void window.api
        .skyblockCalendar()
        .then((c) => live && setCal(c))
        .catch(() => undefined)
    }
    load()
    const t = setInterval(() => {
      setNow(Date.now())
      load()
    }, 60_000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [])
  if (!ready || !cal) return null
  return (
    <HomeBox
      icon={<CalendarDays size={15} />}
      title="SkyBlock calendar"
      action={
        <button className="link-button home-box-action" onClick={() => openSpecialTab(SKYBLOCK_GOALS_TAB)}>
          Open SkyBlock
        </button>
      }
    >
      <div className="sbx-cal" data-sbx-calendar>
        <div className="sbx-cal-now">
          <b>{describeSbDate(cal.now)}</b>
          {cal.mayor && (
            <span className="faint" title={cal.mayor.perks.map((p) => `${p.name}: ${p.description}`).join('\n')}>
              Mayor {cal.mayor.name}
              {cal.mayor.minister ? `, minister ${cal.mayor.minister.name}` : ''}
            </span>
          )}
        </div>
        <ul>
          {cal.events
            .filter((e, i, all) => all.findIndex((x) => x.name === e.name) === i)
            .slice(0, 6)
            .map((e) => (
              <li key={e.id} className={e.live ? 'live' : ''}>
                <ItemPic id={e.icon} name={e.name} size={20} />
                <span>{e.name}</span>
                <small className={e.live ? '' : 'faint'}>
                  {e.live
                    ? `on now, ends ${until(e.end, now).replace('in ', 'in ')}`
                    : `${new Date(e.start).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · ${until(e.start, now)}`}
                </small>
              </li>
            ))}
        </ul>
      </div>
    </HomeBox>
  )
}

/** A frosted level badge, for the top bar. */
export const LevelRing = ({ page }: { page: SbProfilePage }) => (
  <Ring progress={page.view.skyblockLevel.progress} size={30}>
    <b style={{ color: levelColor(page.view.skyblockLevel.level), fontSize: 11 }}>{page.view.skyblockLevel.level}</b>
  </Ring>
)
