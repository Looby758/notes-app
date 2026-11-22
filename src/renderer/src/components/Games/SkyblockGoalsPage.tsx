import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Download, HelpCircle, Lock, Pickaxe, Pin, PinOff, Plus, RefreshCw, Search, Target, Trash2 } from 'lucide-react'
import {
  API_SETTINGS_PATH,
  describeHours,
  MC_COLORS,
  tagLabel,
  type GoalPlan,
  type PlanNode,
  type SkyblockGoalsState,
  type SkyblockItemHit
} from '@shared/skyblockGoals'
import { MODE_NAMES } from '@shared/skyblock'
import { addHomeCard } from '../../lib/home'
import { GAMES_TAB, openSpecialTab, SKYBLOCK_GOALS_TAB } from '../../lib/editorController'
import { errorMessage } from '../../lib/paths'
import { HomeBox } from '../Home/HomePage'

addHomeCard({ id: 'skyblock-goals', order: 48, title: 'SkyBlock goals', Card: SkyblockGoalsHomeCard })

const clean = (err: unknown): string => errorMessage(err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const fmt = (n: number): string => Math.round(n).toLocaleString('en-GB')
const colorOf = (c: string): string => MC_COLORS[c] ?? 'inherit'

/** The planner's state from the main process, kept fresh. */
function useGoals(page: boolean): [SkyblockGoalsState | null, (s: SkyblockGoalsState) => void] {
  const [state, setState] = useState<SkyblockGoalsState | null>(null)
  useEffect(() => {
    let alive = true
    const load = (): void => void window.api.skyblockGoalsState(page).then((s) => alive && setState(s))
    load()
    const off = window.api.onSkyblockGoalsChanged(load)
    return () => {
      alive = false
      off()
    }
  }, [page])
  return [state, setState]
}

function timeLeft(p: GoalPlan): string {
  if (p.done) return 'Done!'
  if (p.hoursLeft === null) return p.noRate ? 'No time estimate yet' : ''
  return `About ${describeHours(p.hoursLeft)} of play left${p.noRate ? `, plus ${p.noRate} item${p.noRate === 1 ? '' : 's'} with no rate yet` : ''}`
}

function ago(at: number): string {
  const m = Math.round((Date.now() - at) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)} days ago`
}

/**
 * SkyBlock goals: search any item and add it as a goal, then see its whole crafting tree down to raw
 * materials with what you have, a flat shopping list, what's stopping you crafting it, and time left
 * at your own rates. Ironman only: nothing here uses the Bazaar or Auction House.
 */
export default function SkyblockGoalsPage() {
  const [state, setState] = useGoals(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState<'tree' | 'raw' | 'blockers'>('tree')
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (job: () => Promise<SkyblockGoalsState>): Promise<void> => {
      setError(null)
      try {
        setState(await job())
      } catch (err) {
        setError(clean(err))
      }
    },
    [setState]
  )

  if (!state) return <div className="sbg-page" />
  const plan = state.plans.find((p) => p.goal.id === selected) ?? state.plans[0] ?? null

  return (
    <div className="sbg-page" data-skyblock-goals>
      <div className="sbg-inner">
        <div className="sbg-head">
          <div>
            <h2>
              <Target size={20} /> SkyBlock goals
            </h2>
            <p className="faint">
              {state.profile ? (
                <>
                  {state.profile.profileName}
                  {MODE_NAMES[state.profile.mode] ? ` (${MODE_NAMES[state.profile.mode]})` : ''} · items checked {ago(state.profile.at)}
                </>
              ) : state.ready ? (
                'Not checked with Hypixel yet'
              ) : (
                'Set up Hypixel to see what you have'
              )}
              {state.data && <> · item list from {new Date(state.data.at).toLocaleDateString([], { day: 'numeric', month: 'short' })}</>}
            </p>
          </div>
          <div className="sbg-head-actions">
            <button className="btn" disabled={!state.ready || state.refreshing} onClick={() => run(() => window.api.skyblockGoalsRefresh())} title="Ask Hypixel what you have now" data-sbg-refresh>
              <RefreshCw size={13} className={state.refreshing ? 'spin' : ''} /> {state.refreshing ? 'Checking…' : 'Refresh'}
            </button>
            <button className="btn" disabled={!!state.downloading} onClick={() => run(() => window.api.skyblockGoalsDownload())} title="Download the latest recipes from the NEU item repo" data-sbg-download>
              <Download size={13} /> Update recipes
            </button>
          </div>
        </div>

        {!state.ready && (
          <div className="sbg-warning">
            <AlertTriangle size={14} />
            <span>
              Orbit needs your Hypixel API key and Minecraft name to see what you have. Add them on the{' '}
              <button className="link-btn" onClick={() => openSpecialTab(GAMES_TAB)}>
                Games page → SkyBlock
              </button>
              . You can still plan without them.
            </span>
          </div>
        )}
        {state.keyWarning && (
          <div className="sbg-warning" data-sbg-key-warning>
            <AlertTriangle size={14} />
            <span>{state.keyWarning}</span>
          </div>
        )}
        {state.profile && state.profile.hidden.length > 0 && (
          <div className="sbg-warning" data-sbg-api-off>
            <AlertTriangle size={14} />
            <span>
              {state.profile.hidden.join(' ')} Turn it on in game: <b>{API_SETTINGS_PATH}</b>, then press Refresh in a few minutes.
            </span>
          </div>
        )}
        {state.profile && state.profile.mode !== 'ironman' && (
          <p className="faint sbg-note">This profile isn’t ironman. The planner still works, but it never uses the Bazaar or Auction House.</p>
        )}
        {state.profileError && <p className="setting-warning">{state.profileError}</p>}
        {state.dataError && <p className="setting-warning">{state.dataError}</p>}
        {error && <p className="setting-warning">{error}</p>}

        {state.downloading ? (
          <div className="sbg-empty">
            <RefreshCw size={18} className="spin" />
            <p>{state.downloading}</p>
            <p className="faint">The recipes come from the NEU item repo on GitHub. It’s a one-off download, kept offline and refreshed weekly.</p>
          </div>
        ) : !state.data ? (
          <div className="sbg-empty">
            <p>Orbit needs the item list (recipes, drops, NPC shops and the Forge) from the NEU item repo.</p>
            <button className="btn btn-primary" onClick={() => run(() => window.api.skyblockGoalsDownload())}>
              <Download size={14} /> Download it
            </button>
          </div>
        ) : (
          <>
            <AddGoal onAdd={(id, amount) => run(() => window.api.skyblockGoalsAdd(id, amount)).then(() => setSelected(id))} />
            {state.plans.length === 0 ? (
              <div className="sbg-empty">
                <Pickaxe size={22} />
                <p>Search for something you want, like a Terminator or Aspect of the End, and add it as a goal.</p>
              </div>
            ) : (
              <div className="sbg-body">
                <ul className="sbg-list" data-sbg-list>
                  {state.plans.map((p) => (
                    <li key={p.goal.id} className={plan?.goal.id === p.goal.id ? 'active' : ''}>
                      <button className="sbg-list-main" onClick={() => setSelected(p.goal.id)}>
                        <span className="sbg-list-name" style={{ color: colorOf(p.color) }}>
                          {p.goal.amount > 1 && <span className="faint">{p.goal.amount} × </span>}
                          {p.name}
                        </span>
                        <span className="sbg-bar">
                          <i style={{ width: `${Math.round(p.progress * 100)}%` }} />
                        </span>
                        <span className="faint sbg-list-meta">
                          {Math.round(p.progress * 100)}% · {timeLeft(p) || 'No time estimate yet'}
                          {p.blockers.some((b) => b.check.met === false) && (
                            <>
                              {' '}
                              · <Lock size={10} /> {p.blockers.filter((b) => b.check.met === false).length}
                            </>
                          )}
                        </span>
                      </button>
                      <button className="icon-btn" title={p.goal.pinned ? 'Unpin (hide from Home)' : 'Pin (show on Home)'} onClick={() => run(() => window.api.skyblockGoalsUpdate(p.goal.id, { pinned: !p.goal.pinned }))}>
                        {p.goal.pinned ? <Pin size={13} className="sbg-pinned" /> : <PinOff size={13} />}
                      </button>
                    </li>
                  ))}
                </ul>
                {plan && <GoalView plan={plan} view={view} setView={setView} run={run} hasProfile={!!state.profile} />}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function AddGoal({ onAdd }: { onAdd: (id: string, amount: number) => void }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SkyblockItemHit[]>([])
  const [amount, setAmount] = useState(1)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!query.trim()) return setHits([])
    let alive = true
    const t = setTimeout(() => void window.api.skyblockGoalsSearch(query).then((h) => alive && setHits(h)), 120)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query])
  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [])
  const pick = (h: SkyblockItemHit): void => {
    onAdd(h.id, amount)
    setQuery('')
    setAmount(1)
    setOpen(false)
  }
  return (
    <div className="sbg-add" ref={box}>
      <div className="games-search sbg-search">
        <Search size={14} />
        <input
          value={query}
          placeholder="Add a goal: search any item"
          spellCheck={false}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) pick(hits[0])
            if (e.key === 'Escape') setOpen(false)
          }}
          data-sbg-search
        />
      </div>
      <label className="sbg-amount" title="How many you want">
        ×
        <input type="number" min={1} value={amount} onChange={(e) => setAmount(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
      </label>
      {open && hits.length > 0 && (
        <ul className="sbg-hits" data-sbg-hits>
          {hits.map((h) => (
            <li key={h.id}>
              <button onClick={() => pick(h)}>
                <span style={{ color: colorOf(h.color) }}>{h.name}</span>
                <span className="faint">{h.crafted ? 'crafted' : ''}</span>
                <Plus size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function GoalView({
  plan,
  view,
  setView,
  run,
  hasProfile
}: {
  plan: GoalPlan
  view: 'tree' | 'raw' | 'blockers'
  setView: (v: 'tree' | 'raw' | 'blockers') => void
  run: (job: () => Promise<SkyblockGoalsState>) => Promise<void>
  hasProfile: boolean
}) {
  const locked = plan.blockers.filter((b) => b.check.met === false).length
  return (
    <section className="sbg-goal" data-sbg-goal={plan.goal.id}>
      <header className="sbg-goal-head">
        <div>
          <h3 style={{ color: colorOf(plan.color) }}>{plan.name}</h3>
          <div className="sbg-bar big">
            <i style={{ width: `${Math.round(plan.progress * 100)}%` }} />
          </div>
          <p className="faint">
            {Math.round(plan.progress * 100)}% of the raw materials · {timeLeft(plan) || 'Collect for a session and Orbit will learn your rates'}
            {plan.forgeHours > 0 && ` · plus ${describeHours(plan.forgeHours)} in the Forge`}
          </p>
        </div>
        <div className="sbg-goal-actions">
          <label className="sbg-amount" title="How many you want">
            ×
            <input type="number" min={1} defaultValue={plan.goal.amount} key={plan.goal.amount} onBlur={(e) => Number(e.target.value) !== plan.goal.amount && void run(() => window.api.skyblockGoalsUpdate(plan.goal.id, { amount: Number(e.target.value) }))} />
          </label>
          <button className="icon-btn" title="Remove this goal" onClick={() => run(() => window.api.skyblockGoalsRemove(plan.goal.id))} data-sbg-remove>
            <Trash2 size={13} />
          </button>
        </div>
      </header>
      <div className="segmented sbg-tabs">
        <button className={view === 'tree' ? 'selected' : ''} onClick={() => setView('tree')}>
          Crafting tree
        </button>
        <button className={view === 'raw' ? 'selected' : ''} onClick={() => setView('raw')} data-sbg-tab-raw>
          Raw shopping list
        </button>
        <button className={view === 'blockers' ? 'selected' : ''} onClick={() => setView('blockers')} data-sbg-tab-blockers>
          What’s blocking me{locked ? ` (${locked})` : ''}
        </button>
      </div>
      {!hasProfile && <p className="faint sbg-note">Have counts show once Orbit has checked your items with Hypixel.</p>}
      {view === 'tree' && plan.tree && (
        <div className="sbg-tree" data-sbg-tree>
          <TreeRow node={plan.tree} depth={0} />
        </div>
      )}
      {view === 'raw' && <RawList plan={plan} />}
      {view === 'blockers' && <Blockers plan={plan} />}
    </section>
  )
}

function Tags({ node }: { node: Pick<PlanNode, 'tags' | 'where'> }) {
  return (
    <span className="sbg-tags">
      {node.tags.map((t) => (
        <span key={t} className={`sbg-tag tag-${t}`}>
          {tagLabel(t)}
        </span>
      ))}
      {node.where.length > 0 && (
        <span className="faint sbg-where" title={node.where.join('\n')}>
          {node.where.join(' · ')}
        </span>
      )}
    </span>
  )
}

function TreeRow({ node, depth }: { node: PlanNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2)
  const done = node.have >= node.need
  const covered = done || (node.crafts > 0 && node.missing === 0 && !hasMissing(node))
  return (
    <div className="sbg-node">
      <div className={`sbg-row ${done ? 'done' : ''}`} style={{ paddingLeft: depth * 18 + 6 }}>
        {node.children.length ? (
          <button className="icon-btn sbg-toggle" onClick={() => setOpen(!open)}>
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="sbg-toggle" />
        )}
        {done ? <Check size={13} className="sbg-tick" /> : node.locked.length ? <Lock size={13} className="sbg-lock" /> : <span className="sbg-dot" />}
        <span className="sbg-name" style={{ color: colorOf(node.color) }} title={node.locked.map((l) => `${l.label}: ${l.detail}`).join('\n')}>
          {node.name}
        </span>
        <span className={`sbg-count ${covered ? 'ok' : ''}`}>
          {fmt(node.have)}/{fmt(node.need)}
        </span>
        {node.crafts > 0 && <span className="faint sbg-crafts">make {fmt(node.crafts)}×</span>}
        <Tags node={node} />
      </div>
      {open && node.children.map((c, i) => <TreeRow key={`${c.id}-${i}`} node={c} depth={depth + 1} />)}
    </div>
  )
}

const hasMissing = (n: PlanNode): boolean => n.missing > 0 || n.children.some(hasMissing)

function RawList({ plan }: { plan: GoalPlan }) {
  const [showDone, setShowDone] = useState(false)
  const lines = useMemo(() => plan.raw.filter((l) => showDone || l.missing > 0), [plan.raw, showDone])
  const doneCount = plan.raw.length - plan.raw.filter((l) => l.missing > 0).length
  return (
    <div className="sbg-raw" data-sbg-raw>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Have</th>
            <th className="num">Need</th>
            <th className="num">Still to get</th>
            <th>Your rate</th>
            <th>Where from</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className={l.missing ? '' : 'done'}>
              <td style={{ color: colorOf(l.color) }}>{l.name}</td>
              <td className="num">{fmt(l.have)}</td>
              <td className="num">{fmt(l.need)}</td>
              <td className="num">{l.missing ? fmt(l.missing) : <Check size={12} />}</td>
              <td className="faint sbg-rate">{l.perHour ? `${fmt(l.perHour)}/h${l.missing ? ` · ${describeHours(l.missing / l.perHour)}` : ''}` : '—'}</td>
              <td>
                <Tags node={l} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {doneCount > 0 && (
        <button className="link-btn" onClick={() => setShowDone(!showDone)}>
          {showDone ? 'Hide' : 'Show'} the {doneCount} you already have enough of
        </button>
      )}
      <p className="faint sbg-note">
        Shared materials are only counted once: anything used by a goal higher up the list isn’t counted again here. Rates come from your SkyBlock session
        summaries, using only the sessions where that collection went up.
      </p>
    </div>
  )
}

function Blockers({ plan }: { plan: GoalPlan }) {
  if (!plan.blockers.length)
    return (
      <div className="sbg-empty small" data-sbg-blockers>
        <Check size={18} />
        <p>Nothing’s locked. Every recipe in this goal is unlocked for you.</p>
      </div>
    )
  return (
    <ul className="sbg-blockers" data-sbg-blockers>
      {plan.blockers.map((b) => (
        <li key={b.check.label} className={b.check.met === null ? 'unknown' : ''}>
          {b.check.met === null ? <HelpCircle size={15} /> : <Lock size={15} />}
          <div>
            <b>{b.check.label}</b>
            <span>{b.check.detail}</span>
            <span className="faint">For {b.for.join(', ')}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Home: a progress bar for each pinned goal, with time left. Hidden until something's pinned. */
function SkyblockGoalsHomeCard() {
  const [state] = useGoals(false)
  const pinned = state?.plans.filter((p) => p.goal.pinned) ?? []
  if (!pinned.length) return null
  return (
    <HomeBox
      icon={<Target size={15} />}
      title="SkyBlock goals"
      action={
        <button className="link-button home-box-action" onClick={() => openSpecialTab(SKYBLOCK_GOALS_TAB)}>
          All goals
        </button>
      }
    >
      <div className="sbg-home" data-sbg-home>
        {state?.keyWarning && <p className="setting-warning">{state.keyWarning}</p>}
        {pinned.map((p) => (
          <button key={p.goal.id} className="sbg-home-goal" onClick={() => openSpecialTab(SKYBLOCK_GOALS_TAB)}>
            <span className="sbg-home-top">
              <span style={{ color: colorOf(p.color) }}>{p.name}</span>
              <b>{Math.round(p.progress * 100)}%</b>
            </span>
            <span className="sbg-bar">
              <i style={{ width: `${Math.round(p.progress * 100)}%` }} />
            </span>
            <span className="faint">{timeLeft(p) || 'No time estimate yet'}</span>
          </button>
        ))}
      </div>
    </HomeBox>
  )
}
