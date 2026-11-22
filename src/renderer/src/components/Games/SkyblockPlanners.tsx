import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Check, Plus, Search, X } from 'lucide-react'
import { shortNumber } from '@shared/skyblock'
import type { SbProfileView } from '@shared/skyblockProfile'
import { bestiaryClosest, dailyTasks, powderName, type TreeNode, type TreeView } from '@shared/skyblockPlanners'
import { Bar, Chip, fmt, McText, Nothing, Panel, rarityColor, Tile } from './SkyblockProfile'
import { ItemPic } from './SkyblockPic'

/** The planners on the profile page and the daily checklist on the Helpers page. */

const POWDER_TONE: Record<string, string> = {
  MITHRIL: '#69db7c',
  GEMSTONE: '#f783ac',
  GLACITE: '#74c0fc',
  FOREST_WHISPERS: '#8ce99a',
  DESERT_WHISPERS: '#ffd43b'
}
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']

// ---------- museum ----------

export function MuseumPlanner({ v }: { v: SbProfileView }) {
  const plan = v.museum?.plan
  const [cat, setCat] = useState<string>('all')
  const [q, setQ] = useState('')
  const [all, setAll] = useState(false)
  if (!plan) return null
  const donated = plan.categories.reduce((a, c) => a + c.donated, 0)
  const total = plan.categories.reduce((a, c) => a + c.total, 0)
  const list = plan.missing.filter((m) => (cat === 'all' || (cat === 'owned' ? m.owned : m.category === cat)) && (!q || m.name.toLowerCase().includes(q.toLowerCase())))
  const owned = plan.missing.filter((m) => m.owned).length
  const shown = all ? list : list.slice(0, 60)
  return (
    <>
      <Panel title={`Museum progress · ${donated}/${total}`} wide>
        <div className="sbpl-cats">
          {plan.categories.map((c) => (
            <button key={c.id} className={`sbpl-cat ${cat === c.id ? 'active' : ''}`} onClick={() => setCat(cat === c.id ? 'all' : c.id)} data-sbpl-museum={c.id}>
              <span>{c.name}</span>
              <Bar progress={c.total ? c.donated / c.total : 0} color={c.donated >= c.total ? '#fcc419' : undefined} />
              <small className="faint">
                {c.donated}/{c.total}
              </small>
            </button>
          ))}
        </div>
      </Panel>
      <Panel
        title={`Not donated yet · ${plan.missing.length}`}
        wide
        right={
          <span className="sbpl-filters">
            <button className={`sbg-tag ${cat === 'owned' ? 'on' : ''}`} onClick={() => setCat(cat === 'owned' ? 'all' : 'owned')} data-sbpl-museum="owned">
              You have {owned}
            </button>
          </span>
        }
      >
        <div className="games-search sbp-filter">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a missing item" spellCheck={false} />
        </div>
        {shown.length ? (
          <div className="sbp-tiles">
            {shown.map((m) => (
              <Tile key={m.id} id={m.pieces?.[0] ?? m.id} name={m.name} tone={m.owned ? '#51cf66' : undefined}>
                <small className="faint sbpl-plain">
                  {m.xp} XP · {m.category}
                </small>
                {m.owned && <span className="sbpl-have">You have it</span>}
              </Tile>
            ))}
          </div>
        ) : (
          <Nothing what={cat === 'owned' ? 'Nothing you own is waiting to be donated.' : 'Nothing missing here.'} />
        )}
        {list.length > shown.length && (
          <button className="btn sbpl-more" onClick={() => setAll(true)}>
            Show all {list.length}
          </button>
        )}
      </Panel>
    </>
  )
}

// ---------- slayer ----------

export function SlayerPlan({ s }: { s: SbProfileView['slayers'][number] }) {
  const p = s.plan
  if (!p || p.left === null) return null
  const highest = s.kills.reduce((h, k, i) => (k > 0 ? i + 1 : h), 0)
  return (
    <div className="sbpl-slayer" data-sbpl-slayer={s.id}>
      <small className="faint">
        {fmt(p.left)} XP to level {p.nextLevel}, that’s:
      </small>
      <div className="sbpl-slayer-tiers">
        {p.tiers.map((t) => (
          <span key={t.tier} className={t.tier === highest ? 'hi' : ''} title={`${fmt(t.xp)} XP a boss · ${fmt(t.cost)} ${t.currency} to start them all`}>
            <small>T{ROMAN[t.tier]}</small>
            <b>× {fmt(t.bosses)}</b>
            <small className="faint">{shortNumber(t.cost)}</small>
          </span>
        ))}
      </div>
      <small className="faint">{highest ? 'Your highest tier so far is marked. ' : ''}Costs are to start the bosses, before any mayor discount.</small>
    </div>
  )
}

// ---------- dungeons ----------

export function DungeonPlanner({ v }: { v: SbProfileView }) {
  const p = v.dungeons?.plan
  if (!p || !p.goals.length || !p.floors.length) return null
  return (
    <Panel title="Runs to go" wide right={<span className="faint">S+ runs, before XP boosts</span>}>
      <div className="sbpl-table-wrap">
        <table className="sbpl-table" data-sbpl-dungeons>
          <thead>
            <tr>
              <th>Floor</th>
              <th>XP a run</th>
              {p.goals.map((g) => (
                <th key={g.id}>
                  {g.name}
                  <small className="faint">{shortNumber(g.left)} XP</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.floors.map((f) => (
              <tr key={f.floor} className={f.master ? 'master' : ''}>
                <td>{f.floor}</td>
                <td>{shortNumber(f.xp)}</td>
                {f.runs.map((r, i) => (
                  <td key={i}>
                    <b>{fmt(r)}</b>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="faint sbpl-note">Your selected class gets each run’s full XP; your other classes get a quarter of it.</p>
    </Panel>
  )
}

// ---------- Heart of the Mountain / Forest ----------

export function TreePanel({ tree, title, powders }: { tree: TreeView; title: string; powders: { kind: string; available: number }[] }) {
  const [pick, setPick] = useState<TreeNode | null>(null)
  const node = pick ? (tree.nodes.find((n) => n.id === pick.id) ?? null) : null
  const have = (powder: string): number | null => powders.find((p) => p.kind.toUpperCase().replace(/ /g, '_') === powder)?.available ?? null
  const cells = useMemo(() => {
    const out: (TreeNode | null)[] = Array.from({ length: tree.width * tree.height }, () => null)
    for (const n of tree.nodes) out[n.y * tree.width + n.x] = n
    return out
  }, [tree])
  return (
    <Panel title={`${title} · ${tree.bought}/${tree.nodes.length} perks`} wide>
      <div className="sbpl-tree-wrap">
        <div className="sbpl-tree" style={{ gridTemplateColumns: `repeat(${tree.width}, 46px)` }} data-sbpl-tree={tree.kind}>
          {cells.map((n, i) =>
            n ? (
              <button
                key={n.id}
                className={`sbpl-node ${n.level ? 'on' : ''} ${n.level >= n.maxLevel ? 'max' : ''} ${n.ability ? 'ability' : ''} ${n.selected ? 'selected' : ''} ${n.disabled ? 'off' : ''} ${node?.id === n.id ? 'picked' : ''}`}
                style={{ '--tone': POWDER_TONE[n.next?.powder ?? ''] ?? 'var(--sbx-hi, #8fe3ff)' } as CSSProperties}
                onClick={() => setPick(node?.id === n.id ? null : n)}
                title={`${n.name} · ${n.level}/${n.maxLevel}`}
                data-sbpl-node={n.id}
              >
                <span>{n.maxLevel > 1 ? n.level || '' : n.level ? '✓' : ''}</span>
              </button>
            ) : (
              <span key={i} className="sbpl-gap" />
            )
          )}
        </div>
        <div className="sbpl-node-info">
          {node ? (
            <>
              <h5>{node.name}</h5>
              <span className="faint">
                {node.ability ? 'Ability · ' : ''}Level {node.level}/{node.maxLevel}
                {node.selected ? ' · selected' : ''}
                {node.disabled ? ' · turned off' : ''}
              </span>
              <div className="sbpl-lore">
                {node.lore.map((l, i) => (
                  <div key={i}>{l ? <McText text={l} /> : ' '}</div>
                ))}
              </div>
              {node.next && (
                <Chip
                  label="Next level"
                  value={`${fmt(node.next.cost)} ${powderName(node.next.powder)}`}
                  tone={POWDER_TONE[node.next.powder]}
                  icon={have(node.next.powder) !== null && have(node.next.powder)! >= node.next.cost ? <Check size={14} /> : undefined}
                />
              )}
              {Object.entries(node.toMax).map(([k, n]) => (
                <Chip key={k} label={`To max · ${powderName(k)}`} value={fmt(n)} tone={POWDER_TONE[k]} />
              ))}
              {!node.level && <small className="faint">Not unlocked yet: it takes a token of the mountain once the perk next to it is.</small>}
            </>
          ) : (
            <>
              <h5>Pick a perk</h5>
              <span className="faint">Its levels, what it does and what the rest costs.</span>
              <div className="sbp-chips">
                {Object.entries(tree.toMax).map(([k, n]) => (
                  <Chip key={k} label={`To max everything · ${powderName(k)}`} value={shortNumber(n)} tone={POWDER_TONE[k]} />
                ))}
              </div>
              {tree.kind === 'foraging' && !Object.keys(tree.toMax).length && (
                <small className="faint">The item list doesn’t have Heart of the Forest costs yet, so only levels show.</small>
              )}
            </>
          )}
        </div>
      </div>
    </Panel>
  )
}

/** The Forge's slots, with how long each has left. */
export function ForgePanel({ v }: { v: SbProfileView }) {
  const now = useNow(30_000)
  if (!v.forge.length) return null
  return (
    <Panel title="The Forge" wide>
      <div className="sbp-tiles">
        {v.forge.map((f) => {
          const left = f.ready === null ? null : f.ready - now
          return (
            <Tile
              key={f.slot}
              id={f.id}
              name={f.id
                .replace(/_/g, ' ')
                .toLowerCase()
                .replace(/\b\w/g, (c) => c.toUpperCase())}
              tone={left !== null && left <= 0 ? '#51cf66' : undefined}
            >
              <small className="faint sbpl-plain">
                Slot {f.slot} · {left === null ? 'time unknown' : left <= 0 ? 'ready' : `${describeLeft(left)} left`}
              </small>
            </Tile>
          )
        })}
      </div>
      <p className="faint sbpl-note">As of when Hypixel last answered. Quick Forge is counted.</p>
    </Panel>
  )
}

const describeLeft = (ms: number): string => {
  const m = Math.ceil(ms / 60_000)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.round(h / 24)} days`
}

function useNow(every: number): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(t)
  }, [every])
  return now
}

// ---------- garden ----------

const VISITOR_RARITIES = ['UNCOMMON', 'RARE', 'LEGENDARY', 'MYTHIC', 'SPECIAL']
const CROP_IDS: Record<string, string> = { 'INK_SACK:3': 'INK_SACK-3', MUSHROOM_COLLECTION: 'RED_MUSHROOM' }
const COMPOSTER_NAMES: Record<string, string> = {
  speed: 'Composter Speed',
  multi_drop: 'Multi Drop',
  fuel_cap: 'Fuel Cap',
  organic_matter_cap: 'Organic Matter Cap',
  cost_reduction: 'Cost Reduction'
}
const nice = (id: string): string =>
  id
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())

export function GardenPlanner({ v }: { v: SbProfileView }) {
  const p = v.garden?.plan
  const [showVisitors, setShowVisitors] = useState(false)
  if (!p) return null
  const grid = Array.from({ length: 25 }, (_, i) => p.plots.find((x) => x.y * 5 + x.x === i) ?? null)
  const copperToMax = p.crops.reduce((a, c) => a + c.copperToMax, 0)
  const unserved = p.visitors.filter((x) => !x.served)
  return (
    <>
      <Panel title={`Plots · ${p.plots.filter((x) => x.unlocked).length}/${p.plots.length}`}>
        <div className="sbpl-plots" data-sbpl-plots>
          {grid.map((x, i) =>
            i === 12 ? (
              <span key={i} className="sbpl-plot barn" title="The barn">
                Barn
              </span>
            ) : x ? (
              <span
                key={x.id}
                className={`sbpl-plot ${x.unlocked ? 'on' : ''}`}
                title={x.unlocked ? `${x.name}: unlocked` : `${x.name}: ${x.cost ? `${x.cost.amount} ${nice(x.cost.item)}` : 'locked'}`}
              >
                {x.unlocked ? x.name.replace(/^Plot /, '') : x.cost ? `${x.cost.amount}${x.cost.item === 'COMPOST' ? '' : '★'}` : '?'}
              </span>
            ) : (
              <span key={i} className="sbpl-plot" />
            )
          )}
        </div>
        {p.nextPlot ? (
          <p className="faint sbpl-note">
            Cheapest next: {p.nextPlot.name} for {p.nextPlot.amount} {nice(p.nextPlot.item)}. ★ marks plots that take Enchanted Compost.
          </p>
        ) : (
          <p className="faint sbpl-note">Every plot is unlocked.</p>
        )}
      </Panel>
      <Panel title="Composter">
        {p.composterMatter && (
          <div className="sbp-chips">
            <Chip label="Organic matter" value={shortNumber(p.composterMatter.organic)} />
            <Chip label="Fuel" value={shortNumber(p.composterMatter.fuel)} />
            <Chip label="Compost waiting" value={fmt(p.composterMatter.compost)} />
          </div>
        )}
        <div className="sbx-rows">
          {p.composter.map((c) => (
            <div key={c.id} className="sbx-row sbpl-comp">
              <span className="sbx-row-name">
                <b>
                  {COMPOSTER_NAMES[c.id] ?? nice(c.id)} {c.level}/{c.max}
                </b>
                <small className="faint">{c.tip}</small>
              </span>
              <Bar progress={c.max ? c.level / c.max : 0} />
              <small className="faint sbpl-next">
                {c.next
                  ? `Next: ${Object.entries(c.next.items)
                      .map(([i, n]) => `${fmt(n)} ${nice(i)}`)
                      .join(', ')} + ${fmt(c.next.copper)} copper`
                  : 'Maxed'}
              </small>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Crop upgrades" wide right={p.copper !== null && <span className="sbp-badge">{fmt(p.copper)} copper</span>}>
        <div className="sbp-tiles">
          {p.crops.map((c) => (
            <Tile
              key={c.id}
              id={CROP_IDS[c.id] ?? c.id}
              name={nice(
                c.id
                  .replace(/_ITEM$|_COLLECTION$|:3$/, '')
                  .replace('INK_SACK', 'Cocoa Beans')
                  .replace('NETHER_STALK', 'Nether Wart')
              )}
              tone={c.copperToMax === 0 ? '#fcc419' : undefined}
            >
              <Bar progress={c.level / 9} color={c.copperToMax === 0 ? '#fcc419' : undefined} />
              <small className="faint sbpl-plain">{c.copperToMax ? `${c.level}/9 · ${fmt(c.copperToMax)} copper to max` : 'Maxed'}</small>
            </Tile>
          ))}
        </div>
        {copperToMax > 0 && <p className="faint sbpl-note">{fmt(copperToMax)} copper to max every crop upgrade.</p>}
      </Panel>
      <Panel
        title={`Visitors · ${p.visitors.length - unserved.length}/${p.visitors.length} served`}
        wide
        right={
          <button className="btn" onClick={() => setShowVisitors((x) => !x)} data-sbpl-visitors>
            {showVisitors ? 'Hide' : `Show the ${unserved.length} not served`}
          </button>
        }
      >
        {p.waiting.length > 0 && (
          <p className="sbpl-note">
            Waiting now: <b>{p.waiting.map(nice).join(', ')}</b>
          </p>
        )}
        <div className="sbpl-rarities">
          {VISITOR_RARITIES.map((r) => {
            const of = p.visitors.filter((x) => x.rarity === r)
            if (!of.length) return null
            const done = of.filter((x) => x.served).length
            return (
              <div key={r} className="sbpl-rarity" style={{ '--tone': rarityColor(r) } as CSSProperties}>
                <span style={{ color: rarityColor(r) }}>{nice(r)}</span>
                <Bar progress={done / of.length} color={rarityColor(r)} />
                <small className="faint">
                  {done}/{of.length}
                </small>
              </div>
            )
          })}
        </div>
        {showVisitors && (
          <div className="sbpl-visitors">
            {unserved
              .sort((a, b) => VISITOR_RARITIES.indexOf(a.rarity) - VISITOR_RARITIES.indexOf(b.rarity) || a.id.localeCompare(b.id))
              .map((x) => (
                <span key={x.id} style={{ color: rarityColor(x.rarity) }}>
                  {nice(x.id)}
                </span>
              ))}
          </div>
        )}
      </Panel>
    </>
  )
}

// ---------- bestiary ----------

export function BestiaryClosest({ v }: { v: SbProfileView }) {
  const list = useMemo(() => bestiaryClosest(v.bestiary, 12), [v.bestiary])
  if (!list.length) return null
  return (
    <Panel title="Closest to their next tier" wide>
      <div className="sbp-tiles" data-sbpl-bestiary>
        {list.map((m) => (
          <Tile key={`${m.island}-${m.name}`} name={m.name} icon={<span className="sbp-mob-tier">{m.tier}</span>}>
            <Bar progress={m.share} />
            <small className="faint sbpl-plain">
              {fmt(m.left)} more for tier {m.tier + 1} · {m.island}
            </small>
          </Tile>
        ))}
      </div>
    </Panel>
  )
}

// ---------- daily checklist ----------

interface DailySave {
  day: string
  done: string[]
  custom: { id: string; name: string }[]
  hidden: string[]
}
const DAILY_KEY = 'orbit-skyblock-daily'
const today = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
function loadDaily(profileId: string): DailySave {
  try {
    const all = JSON.parse(localStorage.getItem(DAILY_KEY) ?? '{}') as Record<string, DailySave>
    const s = all[profileId]
    if (s) return s.day === today() ? s : { ...s, day: today(), done: [] }
  } catch {
    // Start fresh.
  }
  return { day: today(), done: [], custom: [], hidden: [] }
}
function saveDaily(profileId: string, s: DailySave): void {
  try {
    const all = JSON.parse(localStorage.getItem(DAILY_KEY) ?? '{}') as Record<string, DailySave>
    all[profileId] = s
    localStorage.setItem(DAILY_KEY, JSON.stringify(all))
  } catch {
    // Ticks just won't be kept.
  }
}

export function DailyChecklist({ v }: { v: SbProfileView }) {
  const now = useNow(60_000)
  const [s, setS] = useState(() => loadDaily(v.profileId))
  const [adding, setAdding] = useState('')
  const [editing, setEditing] = useState(false)
  // A new day clears the ticks.
  useEffect(() => {
    if (s.day !== today()) setS(loadDaily(v.profileId))
  }, [now, s.day, v.profileId])
  const update = (next: DailySave): void => {
    setS(next)
    saveDaily(v.profileId, next)
  }
  const nodes = v.mining?.tree?.nodes ?? []
  const tasks = dailyTasks({
    forge: v.forge,
    garden: v.garden?.plan ?? null,
    gardenUnlocked: !!v.garden,
    hotm: v.mining ? v.mining.hotm.level : 0,
    dailyPowder: nodes.some((n) => n.id === 'daily_powder' && n.level > 0),
    crimson: !!v.crimson && (v.crimson.mage > 0 || v.crimson.barbarian > 0 || !!v.crimson.faction),
    enchanting: v.skills?.find((x) => x.id === 'enchanting')?.level ?? 0,
    kuudra: !!v.crimson?.kuudra.some((k) => k.completions > 0),
    now
  })
  const all = [...tasks.map((t) => ({ ...t, custom: false })), ...s.custom.map((c) => ({ id: c.id, name: c.name, detail: '', icon: 'PAPER', auto: null, custom: true }))]
  const shown = editing ? all : all.filter((t) => !s.hidden.includes(t.id))
  const isDone = (t: { id: string; auto: boolean | null }): boolean => s.done.includes(t.id) || t.auto === true
  const left = shown.filter((t) => !s.hidden.includes(t.id) && !isDone(t)).length
  const toggle = (id: string): void => update({ ...s, done: s.done.includes(id) ? s.done.filter((x) => x !== id) : [...s.done, id] })
  const add = (): void => {
    const name = adding.trim()
    if (!name) return
    update({ ...s, custom: [...s.custom, { id: `c${Date.now()}`, name }] })
    setAdding('')
  }
  return (
    <Panel
      title={left ? `Today · ${left} to do` : 'Today · all done'}
      wide
      right={
        <button className="btn" onClick={() => setEditing((e) => !e)} data-sbpl-daily-edit>
          {editing ? 'Done' : 'Edit list'}
        </button>
      }
    >
      <div className="sbpl-daily" data-sbpl-daily>
        {shown.map((t) => {
          const hidden = s.hidden.includes(t.id)
          const done = isDone(t)
          return (
            <div key={t.id} className={`sbpl-task ${done ? 'done' : ''} ${hidden ? 'hidden' : ''}`}>
              <button className="sbpl-check" onClick={() => t.auto === null && toggle(t.id)} disabled={t.auto !== null || editing} aria-label={done ? 'Not done' : 'Done'}>
                {done && <Check size={14} />}
              </button>
              <ItemPic id={t.icon} name={t.name} size={28} />
              <span className="sbx-row-name">
                <b>{t.name}</b>
                {t.detail && <small className="faint">{t.detail}</small>}
              </span>
              {t.auto !== null && <span className="sbg-tag">from your profile</span>}
              {editing &&
                (t.custom ? (
                  <button
                    className="btn"
                    onClick={() => update({ ...s, custom: s.custom.filter((c) => c.id !== t.id), done: s.done.filter((d) => d !== t.id) })}
                    aria-label="Remove"
                  >
                    <X size={14} />
                  </button>
                ) : (
                  <button className="btn" onClick={() => update({ ...s, hidden: hidden ? s.hidden.filter((h) => h !== t.id) : [...s.hidden, t.id] })}>
                    {hidden ? 'Show' : 'Hide'}
                  </button>
                ))}
            </div>
          )
        })}
        {!shown.length && <Nothing what="Nothing on the list. Add your own below." />}
      </div>
      <form
        className="sbpl-add"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add your own daily task" spellCheck={false} data-sbpl-daily-add />
        <button className="btn" type="submit" disabled={!adding.trim()}>
          <Plus size={14} /> Add
        </button>
      </form>
      <p className="faint sbpl-note">Ticks clear at midnight your time. The list fills in from what your profile has unlocked.</p>
    </Panel>
  )
}
