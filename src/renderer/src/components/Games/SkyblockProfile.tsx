import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { describeMinutes, shortNumber } from '@shared/skyblock'
import { MC_COLORS } from '@shared/skyblockGoals'
import type { Level, SbProfileView, SbViewItem } from '@shared/skyblockProfile'

const fmt = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-GB'))

const RARITY_COLOR: Record<string, string> = {
  COMMON: '#e9ecef',
  UNCOMMON: '#51cf66',
  RARE: '#5c7cfa',
  EPIC: '#ae3ec9',
  LEGENDARY: '#f59f00',
  MYTHIC: '#f783ac',
  DIVINE: '#3bc9db',
  SPECIAL: '#ff6b6b',
  'VERY SPECIAL': '#ff6b6b'
}
const rarityColor = (r: string): string => RARITY_COLOR[r] ?? 'var(--border-strong)'

/** Text with Minecraft's § colour and style codes, drawn in those colours. */
export function McText({ text }: { text: string }) {
  const parts: ReactNode[] = []
  let color = 'inherit'
  let bold = false
  let italic = false
  let strike = false
  let under = false
  const bits = text.split(/(§.)/)
  bits.forEach((b, i) => {
    if (/^§.$/.test(b)) {
      const c = b[1].toLowerCase()
      if (MC_COLORS[c] !== undefined) {
        color = c === 'f' ? 'var(--text-strong)' : MC_COLORS[c]
        bold = italic = strike = under = false
      } else if (c === 'l') bold = true
      else if (c === 'o') italic = true
      else if (c === 'm') strike = true
      else if (c === 'n') under = true
      else if (c === 'r') ((color = 'inherit'), (bold = italic = strike = under = false))
      return
    }
    if (!b) return
    parts.push(
      <span
        key={i}
        style={{
          color,
          fontWeight: bold ? 700 : undefined,
          fontStyle: italic ? 'italic' : undefined,
          textDecoration: [strike && 'line-through', under && 'underline'].filter(Boolean).join(' ') || undefined
        }}
      >
        {b}
      </span>
    )
  })
  return <>{parts}</>
}

const plain = (s: string): string => s.replace(/§./g, '')

/** Two letters for an item's tile, from its name ("Hyperion" → "Hy", "Necron's Chestplate" → "NC"). */
function initials(name: string): string {
  const words = plain(name)
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2)
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

let tipSetter: ((t: { item: SbViewItem; x: number; y: number } | null) => void) | null = null

function ItemTip() {
  const [tip, setTip] = useState<{
    item: SbViewItem
    x: number
    y: number
  } | null>(null)
  useEffect(() => {
    tipSetter = setTip
    return () => {
      tipSetter = null
    }
  }, [])
  if (!tip) return null
  const left = Math.min(tip.x + 16, window.innerWidth - 380)
  const top = Math.min(tip.y + 12, window.innerHeight - 40 - Math.min(600, 22 + tip.item.lore.length * 18))
  return (
    <div className="sbp-tip" style={{ left, top }}>
      <div className="sbp-tip-name">
        <McText text={tip.item.name} />
        {tip.item.count > 1 && <span className="faint"> ×{tip.item.count}</span>}
      </div>
      {tip.item.lore.map((l, i) => (
        <div key={i} className="sbp-tip-line">
          {l ? <McText text={l} /> : ' '}
        </div>
      ))}
    </div>
  )
}

function Slot({ item }: { item: SbViewItem | null }) {
  if (!item) return <div className="sbp-slot empty" />
  return (
    <div
      className="sbp-slot"
      style={{
        borderColor: rarityColor(item.rarity),
        color: rarityColor(item.rarity)
      }}
      onMouseMove={(e) => tipSetter?.({ item, x: e.clientX, y: e.clientY })}
      onMouseLeave={() => tipSetter?.(null)}
      data-sbp-item={item.id}
    >
      <span>{initials(item.name)}</span>
      {item.count > 1 && <b>{item.count}</b>}
      {item.stars > 0 && <i>{'✪'.repeat(Math.min(5, item.stars))}</i>}
    </div>
  )
}

function Grid({ items, cols = 9 }: { items: (SbViewItem | null)[]; cols?: number }) {
  if (!items.length) return <p className="faint">Empty.</p>
  return (
    <div className="sbp-grid" style={{ gridTemplateColumns: `repeat(${cols}, 40px)` }}>
      {items.map((it, i) => (
        <Slot key={i} item={it} />
      ))}
    </div>
  )
}

function Bar({ l, label, sub }: { l: Level; label: ReactNode; sub?: ReactNode }) {
  const maxed = l.level >= l.max
  return (
    <div className={`sbp-bar ${maxed ? 'maxed' : ''}`}>
      <div className="sbp-bar-top">
        <span>{label}</span>
        <b>{l.level}</b>
      </div>
      <span className="sbg-bar">
        <i style={{ width: `${Math.round(l.progress * 100)}%` }} />
      </span>
      <span className="faint sbp-bar-sub">{sub ?? (maxed ? `Max · ${fmt(l.xp)} XP` : `${shortNumber(l.into)} / ${shortNumber(l.needed)} XP`)}</span>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="sbp-stat">
      <span className="faint">{label}</span>
      <b>{value}</b>
    </div>
  )
}

function Box({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`sbp-box ${wide ? 'wide' : ''}`}>
      <h4>{title}</h4>
      {children}
    </section>
  )
}

const SECTIONS = [
  ['overview', 'Overview'],
  ['gear', 'Gear'],
  ['inventories', 'Inventories'],
  ['accessories', 'Accessories'],
  ['pets', 'Pets'],
  ['collections', 'Collections'],
  ['dungeons', 'Dungeons'],
  ['slayer', 'Slayer'],
  ['mining', 'Mining'],
  ['bestiary', 'Bestiary'],
  ['garden', 'Garden'],
  ['fishing', 'Trophy fish'],
  ['crimson', 'Crimson Isle'],
  ['rift', 'Rift'],
  ['museum', 'Museum'],
  ['stats', 'Misc stats']
] as const
type Section = (typeof SECTIONS)[number][0]

/** Your SkyBlock profile, like SkyCrypt but only for you and inside Orbit. */
export default function SkyblockProfile() {
  const [view, setView] = useState<SbProfileView | null | undefined>(undefined)
  const [section, setSection] = useState<Section>('overview')
  useEffect(() => {
    let alive = true
    const load = (): void => void window.api.skyblockProfileView().then((v) => alive && setView(v))
    load()
    const off = window.api.onSkyblockGoalsChanged(load)
    return () => {
      alive = false
      off()
    }
  }, [])
  if (view === undefined) return null
  if (!view)
    return (
      <div className="sbg-empty">
        <p>Your profile shows here once Orbit has asked Hypixel. Press Refresh above.</p>
      </div>
    )
  return (
    <div className="sbp" data-sbp>
      <ItemTip />
      <nav className="sbp-nav">
        {SECTIONS.map(([id, name]) => (
          <button key={id} className={section === id ? 'active' : ''} onClick={() => setSection(id)} data-sbp-section={id}>
            {name}
          </button>
        ))}
      </nav>
      <div className="sbp-body">
        {section === 'overview' && <Overview v={view} />}
        {section === 'gear' && <Gear v={view} />}
        {section === 'inventories' && <Inventories v={view} />}
        {section === 'accessories' && <Accessories v={view} />}
        {section === 'pets' && <Pets v={view} />}
        {section === 'collections' && <Collections v={view} />}
        {section === 'dungeons' && <Dungeons v={view} />}
        {section === 'slayer' && <Slayers v={view} />}
        {section === 'mining' && <Mining v={view} />}
        {section === 'bestiary' && <Bestiary v={view} />}
        {section === 'garden' && <Garden v={view} />}
        {section === 'fishing' && <TrophyFish v={view} />}
        {section === 'crimson' && <Crimson v={view} />}
        {section === 'rift' && <Rift v={view} />}
        {section === 'museum' && <Museum v={view} />}
        {section === 'stats' && <Stats v={view} />}
      </div>
    </div>
  )
}

const Nothing = ({ what }: { what: string }) => <p className="faint sbp-nothing">{what}</p>

function Overview({ v }: { v: SbProfileView }) {
  return (
    <div className="sbp-boxes">
      <Box title="Profile" wide>
        <div className="sbp-stats">
          <Stat label="SkyBlock level" value={`${v.skyblockLevel.level} (${Math.round(v.skyblockLevel.progress * 100)}%)`} />
          <Stat label="Skill average" value={v.skillAverage === null ? '—' : v.skillAverage.toFixed(2)} />
          <Stat label="Purse" value={fmt(v.purse)} />
          <Stat label="Bank" value={v.bank === null ? 'Banking API off' : fmt(v.bank)} />
          <Stat label="Fairy souls" value={`${v.fairySouls.collected} / ${v.fairySouls.max || '?'}`} />
          <Stat label="Minions crafted" value={fmt(v.craftedMinions)} />
          {v.motes !== null && <Stat label="Motes" value={fmt(v.motes)} />}
          {v.accessories && <Stat label="Magical power" value={fmt(v.accessories.highestMagicalPower ?? v.accessories.magicalPower)} />}
        </div>
      </Box>
      <Box title="Skills" wide>
        {v.skills ? (
          <div className="sbp-bars">
            {v.skills.map((s) => (
              <Bar key={s.id} l={s} label={s.name} />
            ))}
          </div>
        ) : (
          <Nothing what="Turn on the Skills API to see these." />
        )}
      </Box>
      <Box title="Slayers" wide>
        <div className="sbp-bars">
          {v.slayers.map((s) => (
            <Bar key={s.id} l={s.level} label={s.name} sub={`${fmt(s.level.xp)} XP`} />
          ))}
        </div>
      </Box>
      {v.essence.length > 0 && (
        <Box title="Essence">
          <div className="sbp-stats">
            {v.essence.map((e) => (
              <Stat key={e.id} label={e.id} value={fmt(e.amount)} />
            ))}
          </div>
        </Box>
      )}
      {v.pets.find((p) => p.active) && (
        <Box title="Active pet">
          <PetCard p={v.pets.find((p) => p.active)!} />
        </Box>
      )}
    </div>
  )
}

function Gear({ v }: { v: SbProfileView }) {
  if (!v.gear) return <Nothing what="Turn on the Inventory API to see your gear." />
  const g = v.gear
  return (
    <div className="sbp-boxes">
      <Box title="Armour">
        <div className="sbp-list-items">{g.armor.filter(Boolean).length ? g.armor.map((it, i) => it && <ItemLine key={i} item={it} />) : <Nothing what="Nothing worn." />}</div>
      </Box>
      <Box title="Equipment">
        <div className="sbp-list-items">
          {g.equipment.filter(Boolean).length ? g.equipment.map((it, i) => it && <ItemLine key={i} item={it} />) : <Nothing what="No equipment." />}
        </div>
      </Box>
      <Box title="Wardrobe" wide>
        {g.wardrobe.length ? (
          <div className="sbp-wardrobe">
            {g.wardrobe.map((w) => (
              <div key={w.slot} className={`sbp-wardrobe-set ${g.wardrobeEquipped === w.slot ? 'on' : ''}`}>
                {w.pieces.map((p, i) => (
                  <Slot key={i} item={p} />
                ))}
                <span className="faint">{w.slot}</span>
              </div>
            ))}
          </div>
        ) : (
          <Nothing what="Wardrobe is empty." />
        )}
      </Box>
      <Box title="Weapons and tools in your inventory" wide>
        <div className="sbp-list-items">
          {[...g.inventory, ...g.enderChest]
            .filter(
              (it): it is SbViewItem =>
                !!it &&
                /\b(SWORD|BOW|WAND|DUNGEON SWORD|DUNGEON BOW|LONGSWORD|PICKAXE|DRILL|GAUNTLET|AXE|HOE|SHOVEL|FISHING ROD|FISHING WEAPON)\b/.test(
                  plain(it.lore[it.lore.length - 1] ?? '')
                )
            )
            .map((it, i) => (
              <ItemLine key={i} item={it} />
            ))}
        </div>
      </Box>
    </div>
  )
}

function ItemLine({ item }: { item: SbViewItem }) {
  return (
    <div className="sbp-item-line" onMouseMove={(e) => tipSetter?.({ item, x: e.clientX, y: e.clientY })} onMouseLeave={() => tipSetter?.(null)}>
      <Slot item={item} />
      <span>
        <McText text={item.name} />
        {item.recomb && <span className="faint"> · recombobulated</span>}
      </span>
    </div>
  )
}

function Inventories({ v }: { v: SbProfileView }) {
  const [tab, setTab] = useState('inventory')
  if (!v.gear) return <Nothing what="Turn on the Inventory API to see your inventories." />
  const g = v.gear
  const tabs: [string, string][] = [
    ['inventory', 'Inventory'],
    ['ender', 'Ender chest'],
    ...g.backpacks.map((b): [string, string] => [`bp${b.slot}`, `Backpack ${b.slot}`]),
    ['vault', 'Vault'],
    ...g.bags.map((b): [string, string] => [`bag:${b.name}`, b.name]),
    ['sacks', 'Sacks']
  ]
  // The hotbar is the first 9 slots; show it last, like in game.
  const inv = g.inventory.length >= 9 ? [...g.inventory.slice(9), ...g.inventory.slice(0, 9)] : g.inventory
  return (
    <div>
      <div className="sbp-subtabs">
        {tabs.map(([id, name]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {name}
          </button>
        ))}
      </div>
      {tab === 'inventory' && <Grid items={inv} />}
      {tab === 'ender' && <Grid items={g.enderChest} />}
      {tab.startsWith('bp') && <Grid items={g.backpacks.find((b) => `bp${b.slot}` === tab)?.items ?? []} />}
      {tab === 'vault' && <Grid items={g.vault} />}
      {tab.startsWith('bag:') && <Grid items={g.bags.find((b) => `bag:${b.name}` === tab)?.items ?? []} />}
      {tab === 'sacks' && (
        <table className="sbp-table">
          <tbody>
            {g.sacks.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="num">{fmt(s.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Accessories({ v }: { v: SbProfileView }) {
  const [showMissing, setShowMissing] = useState(true)
  if (!v.accessories) return <Nothing what="Turn on the Inventory API to see your accessories." />
  const a = v.accessories
  return (
    <div className="sbp-boxes">
      <Box title="Accessory bag" wide>
        <div className="sbp-stats">
          <Stat label="Accessories" value={a.items.length} />
          <Stat label="Magical power (worked out)" value={fmt(a.magicalPower)} />
          {a.highestMagicalPower !== null && <Stat label="Highest magical power" value={fmt(a.highestMagicalPower)} />}
          {a.selectedPower && <Stat label="Power" value={a.selectedPower} />}
        </div>
        <Grid items={a.items} />
      </Box>
      <Box title={`Missing accessories (${a.missing.length})`} wide>
        <button className="link-btn" onClick={() => setShowMissing(!showMissing)}>
          {showMissing ? 'Hide' : 'Show'}
        </button>
        {showMissing && (
          <ul className="sbp-missing">
            {a.missing.map((m) => (
              <li key={m.id} style={{ color: rarityColor(m.rarity) }}>
                {m.name}
                {m.upgrade && <span className="faint"> (upgrade)</span>}
              </li>
            ))}
          </ul>
        )}
      </Box>
    </div>
  )
}

function PetCard({ p }: { p: SbProfileView['pets'][number] }) {
  return (
    <div className={`sbp-pet ${p.active ? 'on' : ''}`} style={{ borderColor: rarityColor(p.rarity) }}>
      <div className="sbp-pet-top">
        <b style={{ color: rarityColor(p.rarity) }}>
          [Lvl {p.level.level}] {p.name}
        </b>
        {p.active && <span className="sbg-tag">Active</span>}
      </div>
      <span className="sbg-bar">
        <i style={{ width: `${Math.round(p.level.progress * 100)}%` }} />
      </span>
      <span className="faint">
        {p.rarity.toLowerCase()}
        {p.heldItem && ` · ${p.heldItem}`}
        {p.candy > 0 && ` · ${p.candy} candy`}
        {p.skin && ` · ${p.skin} skin`}
      </span>
    </div>
  )
}

function Pets({ v }: { v: SbProfileView }) {
  if (!v.pets.length) return <Nothing what="No pets." />
  return (
    <div className="sbp-pets">
      {v.pets.map((p, i) => (
        <PetCard key={i} p={p} />
      ))}
    </div>
  )
}

function Collections({ v }: { v: SbProfileView }) {
  const [q, setQ] = useState('')
  if (!v.collections) return <Nothing what="Turn on the Collections API to see your collections." />
  return (
    <div>
      <div className="games-search sbp-filter">
        <Search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a collection" spellCheck={false} />
      </div>
      <div className="sbp-boxes">
        {v.collections.map((g) => {
          const items = g.items.filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()))
          if (!items.length) return null
          const maxed = g.items.filter((i) => i.tier >= i.maxTier).length
          return (
            <Box key={g.group} title={`${g.group} · ${maxed}/${g.items.length} maxed`}>
              <div className="sbp-bars">
                {items.map((i) => (
                  <Bar
                    key={i.id}
                    l={{
                      level: i.tier,
                      max: i.maxTier,
                      xp: i.count,
                      progress: i.next === null ? 1 : Math.min(1, i.count / i.next),
                      into: i.count,
                      needed: i.next ?? 0
                    }}
                    label={i.name}
                    sub={i.next === null ? `Max · ${fmt(i.count)}` : `${fmt(i.count)} / ${fmt(i.next)}`}
                  />
                ))}
              </div>
            </Box>
          )
        })}
        <Box title={`Minions (${v.minions.length} types, ${v.craftedMinions} crafted)`} wide>
          <table className="sbp-table">
            <tbody>
              {v.minions.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td className="num">Tier {m.highest}</td>
                  <td className="faint">{m.tiers.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      </div>
    </div>
  )
}

const time = (ms: number | null): string => {
  if (!ms) return '—'
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Dungeons({ v }: { v: SbProfileView }) {
  const d = v.dungeons
  if (!d) return <Nothing what="No dungeons played yet." />
  return (
    <div className="sbp-boxes">
      <Box title="Catacombs" wide>
        <div className="sbp-bars">
          <Bar l={d.catacombs} label="Catacombs" />
          {d.classes.map((c) => (
            <Bar key={c.id} l={c} label={`${c.name}${d.selected === c.name ? ' (selected)' : ''}`} />
          ))}
        </div>
        <div className="sbp-stats">
          <Stat label="Secrets found" value={fmt(d.secrets)} />
          <Stat label="Class average" value={d.classes.length ? (d.classes.reduce((a, c) => a + c.level, 0) / d.classes.length).toFixed(1) : '—'} />
        </div>
      </Box>
      <Box title="Floors" wide>
        <table className="sbp-table">
          <thead>
            <tr>
              <th>Floor</th>
              <th className="num">Completions</th>
              <th className="num">Master mode</th>
              <th className="num">Fastest</th>
              <th className="num">Best score</th>
            </tr>
          </thead>
          <tbody>
            {d.floors.map((f) => (
              <tr key={f.floor}>
                <td>{f.floor}</td>
                <td className="num">{fmt(f.normal)}</td>
                <td className="num">{fmt(f.master)}</td>
                <td className="num">{time(f.fastest)}</td>
                <td className="num">{fmt(f.bestScore)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </div>
  )
}

function Slayers({ v }: { v: SbProfileView }) {
  return (
    <div className="sbp-boxes">
      {v.slayers.map((s) => (
        <Box key={s.id} title={s.name}>
          <Bar l={s.level} label={`Level`} sub={s.level.level >= s.level.max ? `Max · ${fmt(s.level.xp)} XP` : `${fmt(s.level.into)} / ${fmt(s.level.needed)} XP`} />
          <div className="sbp-stats">{s.kills.map((k, i) => (k ? <Stat key={i} label={`Tier ${['I', 'II', 'III', 'IV', 'V'][i]} kills`} value={fmt(k)} /> : null))}</div>
        </Box>
      ))}
    </div>
  )
}

function Mining({ v }: { v: SbProfileView }) {
  const m = v.mining
  if (!m) return <Nothing what="No mining data yet." />
  return (
    <div className="sbp-boxes">
      <Box title="Heart of the Mountain">
        <Bar l={m.hotm} label="Tier" />
        <div className="sbp-stats">
          {m.ability && <Stat label="Pickaxe ability" value={m.ability} />}
          {m.commissions !== null && <Stat label="Commissions" value={fmt(m.commissions)} />}
        </div>
      </Box>
      <Box title="Powder">
        <div className="sbp-stats">
          {m.powder.map((p) => (
            <Fragment key={p.kind}>
              <Stat label={`${p.kind} (now)`} value={fmt(p.available)} />
              <Stat label={`${p.kind} (total)`} value={fmt(p.available + p.spent)} />
            </Fragment>
          ))}
        </div>
      </Box>
      {m.crystals.length > 0 && (
        <Box title="Crystals" wide>
          <table className="sbp-table">
            <tbody>
              {m.crystals.map((c) => (
                <tr key={c.id}>
                  <td>{c.id}</td>
                  <td>{c.state}</td>
                  <td className="num">{fmt(c.found)} found</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}
    </div>
  )
}

function Bestiary({ v }: { v: SbProfileView }) {
  if (!v.bestiary.length) return <Nothing what="No bestiary kills yet." />
  return (
    <div className="sbp-boxes">
      {v.bestiaryMilestone !== null && (
        <Box title="Milestone" wide>
          <b>{v.bestiaryMilestone}</b>
        </Box>
      )}
      {v.bestiary.map((i) => (
        <Box key={i.island} title={i.island}>
          <table className="sbp-table">
            <tbody>
              {i.mobs.map((m) => (
                <tr key={m.name} className={m.tier >= m.maxTier ? 'maxed' : ''}>
                  <td>{m.name}</td>
                  <td className="num">
                    {m.tier}/{m.maxTier}
                  </td>
                  <td className="num faint">{fmt(m.kills)} kills</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      ))}
    </div>
  )
}

function Garden({ v }: { v: SbProfileView }) {
  const g = v.garden
  return (
    <div className="sbp-boxes">
      {g ? (
        <>
          <Box title="Garden">
            <Bar l={g.level} label="Garden level" />
            <div className="sbp-stats">
              <Stat label="Visitors served" value={fmt(g.visitors)} />
              <Stat label="Unique visitors" value={fmt(g.uniqueVisitors)} />
              <Stat label="Plots unlocked" value={g.plots} />
            </div>
          </Box>
          <Box title="Crop milestones" wide>
            <div className="sbp-bars">
              {g.crops.map((c) => (
                <Bar key={c.id} l={c.milestone} label={c.name} sub={`${fmt(c.collected)} collected`} />
              ))}
            </div>
          </Box>
          {g.upgrades.length > 0 && (
            <Box title="Crop upgrades">
              <div className="sbp-stats">
                {g.upgrades.map((u) => (
                  <Stat key={u.id} label={u.id} value={u.level} />
                ))}
              </div>
            </Box>
          )}
        </>
      ) : (
        <Nothing what="No garden yet (or Hypixel hasn’t been asked since this update: press Refresh)." />
      )}
      {v.jacob && (
        <Box title="Jacob’s contests" wide>
          <div className="sbp-stats">
            <Stat label="Contests" value={fmt(v.jacob.contests)} />
            {Object.entries(v.jacob.medals).map(([k, n]) => (
              <Stat key={k} label={`${k[0].toUpperCase()}${k.slice(1)} medals`} value={fmt(n)} />
            ))}
            {Object.entries(v.jacob.perks).map(([k, n]) => (
              <Stat key={k} label={k} value={n} />
            ))}
          </div>
          {v.jacob.personalBests.length > 0 && (
            <table className="sbp-table">
              <tbody>
                {v.jacob.personalBests.map((p) => (
                  <tr key={p.crop}>
                    <td>{p.crop}</td>
                    <td className="num">{fmt(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Box>
      )}
    </div>
  )
}

function TrophyFish({ v }: { v: SbProfileView }) {
  const t = v.trophyFish
  if (!t || !t.fish.length) return <Nothing what="No trophy fish caught yet." />
  return (
    <Box title={`Trophy fish · ${fmt(t.total)} caught`} wide>
      <table className="sbp-table">
        <thead>
          <tr>
            <th>Fish</th>
            <th className="num">Bronze</th>
            <th className="num">Silver</th>
            <th className="num">Gold</th>
            <th className="num">Diamond</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {t.fish.map((f) => (
            <tr key={f.id}>
              <td>{f.name}</td>
              <td className="num">{fmt(f.bronze)}</td>
              <td className="num">{fmt(f.silver)}</td>
              <td className="num">{fmt(f.gold)}</td>
              <td className="num">{fmt(f.diamond)}</td>
              <td className="num">{fmt(f.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  )
}

function Crimson({ v }: { v: SbProfileView }) {
  const c = v.crimson
  if (!c) return <Nothing what="You haven’t been to the Crimson Isle yet." />
  return (
    <div className="sbp-boxes">
      <Box title="Factions">
        <div className="sbp-stats">
          <Stat label="Faction" value={c.faction || '—'} />
          <Stat label="Mage reputation" value={fmt(c.mage)} />
          <Stat label="Barbarian reputation" value={fmt(c.barbarian)} />
        </div>
      </Box>
      <Box title="Kuudra">
        <div className="sbp-stats">
          {c.kuudra.map((k) => (
            <Stat key={k.tier} label={k.tier} value={fmt(k.completions)} />
          ))}
        </div>
      </Box>
      {c.dojo.length > 0 && (
        <Box title="Dojo" wide>
          <div className="sbp-stats">
            {c.dojo.map((d) => (
              <Stat key={d.test} label={d.test} value={fmt(d.points)} />
            ))}
          </div>
        </Box>
      )}
    </div>
  )
}

function Rift({ v }: { v: SbProfileView }) {
  const r = v.rift
  if (!r) return <Nothing what="You haven’t been to the Rift yet." />
  return (
    <Box title="The Rift" wide>
      <div className="sbp-stats">
        <Stat label="Enigma souls" value={fmt(r.enigmaSouls)} />
        <Stat label="Timecharms" value={fmt(r.timecharms)} />
        <Stat label="Motes" value={fmt(r.motes)} />
        <Stat label="Visits" value={fmt(r.visits)} />
      </div>
    </Box>
  )
}

function Museum({ v }: { v: SbProfileView }) {
  const m = v.museum
  if (!m) return <Nothing what="Hypixel hasn’t been asked about the museum yet: press Refresh." />
  return (
    <Box title={`Museum · ${m.donated} donated`} wide>
      <div className="sbp-stats">
        <Stat label="Value" value={m.value === null ? '—' : shortNumber(m.value)} />
      </div>
      <ul className="sbp-missing">
        {m.items.map((i) => (
          <li key={i.id}>{i.name}</li>
        ))}
      </ul>
    </Box>
  )
}

function Stats({ v }: { v: SbProfileView }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => v.stats.filter((s) => !q || s.key.toLowerCase().includes(q.toLowerCase().replace(/\s+/g, '_'))), [v.stats, q])
  const nice = (k: string): string => k.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  return (
    <div>
      <div className="games-search sbp-filter">
        <Search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find in ${v.stats.length} stats`} spellCheck={false} />
      </div>
      <table className="sbp-table">
        <tbody>
          {list.slice(0, 400).map((s) => (
            <tr key={s.key}>
              <td>{nice(s.key)}</td>
              <td className="num">{/time|_ms$/.test(s.key) && s.value > 60_000 ? describeMinutes(s.value / 60_000) : fmt(s.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
