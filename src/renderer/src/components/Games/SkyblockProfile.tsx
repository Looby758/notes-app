import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Plus, Search, X } from 'lucide-react'
import { describeMinutes, MODE_NAMES, shortNumber } from '@shared/skyblock'
import { MC_COLORS } from '@shared/skyblockGoals'
import type { Level, SbPet, SbProfileView, SbViewItem } from '@shared/skyblockProfile'
import { errorMessage } from '../../lib/paths'
import { notify } from '../../store/notify'
import { Head, ItemPic } from './SkyblockPic'

const fmt = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-GB'))
const clean = (err: unknown): string => errorMessage(err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

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
const RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC', 'DIVINE', 'SPECIAL', 'VERY SPECIAL']
const rarityColor = (r: string | undefined): string => (r && RARITY_COLOR[r]) || 'var(--border-strong)'
const plain = (s: string): string => s.replace(/§./g, '')
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX']
const roman = (n: number): string => ROMAN[n] ?? String(n)

/** Text with Minecraft's § colour and style codes, drawn in those colours. */
export function McText({ text }: { text: string }) {
  const parts: ReactNode[] = []
  let color = 'inherit'
  let bold = false
  let italic = false
  let strike = false
  let under = false
  text.split(/(§.)/).forEach((b, i) => {
    if (/^§.$/.test(b)) {
      const c = b[1].toLowerCase()
      if (MC_COLORS[c] !== undefined) {
        color = c === 'f' ? 'var(--sbp-white)' : MC_COLORS[c]
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

// ---------- hover tooltip and the picked-item panel ----------

let tipSetter: ((t: { item: SbViewItem; x: number; y: number } | null) => void) | null = null

/** What the side panel shows: one of your items, or an item you don't have (a missing accessory…). */
interface Picked {
  id: string
  name: string
  rarity?: string
  item?: SbViewItem
  note?: string
}
let pickSetter: ((p: Picked | null) => void) | null = null
const pick = (p: Picked): void => pickSetter?.(p)

function ItemTip() {
  const [tip, setTip] = useState<{ item: SbViewItem; x: number; y: number } | null>(null)
  useEffect(() => {
    tipSetter = setTip
    return () => {
      tipSetter = null
    }
  }, [])
  if (!tip) return null
  const left = Math.min(tip.x + 16, window.innerWidth - 380)
  const top = Math.max(8, Math.min(tip.y + 12, window.innerHeight - 40 - Math.min(600, 22 + tip.item.lore.length * 18)))
  return (
    <div className="sbp-tip" style={{ left, top }}>
      <Lore item={tip.item} />
    </div>
  )
}

function Lore({ item }: { item: SbViewItem }) {
  return (
    <>
      <div className="sbp-tip-name">
        <McText text={item.name} />
        {item.count > 1 && <span className="faint"> ×{item.count}</span>}
      </div>
      {item.lore.map((l, i) => (
        <div key={i} className="sbp-tip-line">
          {l ? <McText text={l} /> : ' '}
        </div>
      ))}
    </>
  )
}

function Detail() {
  const [p, setP] = useState<Picked | null>(null)
  useEffect(() => {
    pickSetter = setP
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setP(null)
    }
    window.addEventListener('keydown', esc)
    return () => {
      pickSetter = null
      window.removeEventListener('keydown', esc)
    }
  }, [])
  if (!p) return null
  const addGoal = async (): Promise<void> => {
    try {
      await window.api.skyblockGoalsAdd(p.id, 1)
      notify(`Added ${plain(p.name)} to your goals.`)
    } catch (err) {
      notify(clean(err))
    }
  }
  return (
    <aside className="sbp-detail" style={{ '--rarity': rarityColor(p.item?.rarity ?? p.rarity) } as CSSProperties} data-sbp-detail={p.id}>
      <button className="icon-btn sbp-detail-close" onClick={() => setP(null)} title="Close (Esc)">
        <X size={14} />
      </button>
      <div className="sbp-detail-pic">
        <ItemPic icon={p.item?.icon} id={p.id} name={p.name} size={72} glint={p.item?.glint} />
      </div>
      {p.item ? (
        <div className="sbp-detail-lore">
          <Lore item={p.item} />
        </div>
      ) : (
        <div className="sbp-detail-lore">
          <div className="sbp-tip-name" style={{ color: rarityColor(p.rarity) }}>
            {plain(p.name)}
          </div>
          {p.note && <div className="sbp-tip-line faint">{p.note}</div>}
        </div>
      )}
      {p.id && (
        <div className="sbp-detail-actions">
          <button className="btn btn-primary" onClick={() => void addGoal()} data-sbp-add-goal>
            <Plus size={13} /> {p.item ? 'Add another as a goal' : 'Add as a goal'}
          </button>
        </div>
      )}
      {p.item && (p.item.recomb || p.item.stars > 0) && (
        <p className="faint sbp-detail-note">
          {[p.item.recomb && 'Recombobulated', p.item.stars > 0 && `${p.item.stars} star${p.item.stars === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
        </p>
      )}
    </aside>
  )
}

// ---------- building blocks ----------

function Slot({ item, size = 40 }: { item: SbViewItem | null; size?: number }) {
  if (!item) return <div className="sbp-slot empty" style={{ width: size, height: size }} />
  return (
    <button
      className="sbp-slot"
      style={{ width: size, height: size, '--rarity': rarityColor(item.rarity) } as CSSProperties}
      onMouseMove={(e) => tipSetter?.({ item, x: e.clientX, y: e.clientY })}
      onMouseLeave={() => tipSetter?.(null)}
      onClick={() => {
        tipSetter?.(null)
        pick({ id: item.id, name: item.name, item })
      }}
      data-sbp-item={item.id}
    >
      <ItemPic icon={item.icon} name={item.name} size={Math.round(size * 0.8)} glint={item.glint} />
      {item.count > 1 && <b>{item.count}</b>}
      {item.stars > 0 && <i>{'✪'.repeat(Math.min(5, item.stars))}</i>}
    </button>
  )
}

/** A Minecraft-style container: a grid of slots. */
function Chest({ items, cols = 9, title }: { items: (SbViewItem | null)[]; cols?: number; title?: string }) {
  if (!items.length) return <Nothing what="Empty." />
  const filled = items.filter(Boolean).length
  return (
    <div className="sbp-chest">
      {title && (
        <div className="sbp-chest-title">
          {title} <span className="faint">· {filled} items</span>
        </div>
      )}
      <div className="sbp-grid" style={{ gridTemplateColumns: `repeat(${cols}, 44px)` }}>
        {items.map((it, i) => (
          <Slot key={i} item={it} size={44} />
        ))}
      </div>
    </div>
  )
}

/** A round progress ring with something in the middle. */
function Ring({ progress, size = 64, children, maxed }: { progress: number; size?: number; children?: ReactNode; maxed?: boolean }) {
  const r = size / 2 - 4
  const c = 2 * Math.PI * r
  return (
    <span className={`sbp-ring ${maxed ? 'maxed' : ''}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="track" />
        <circle cx={size / 2} cy={size / 2} r={r} className="fill" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, progress)))} />
      </svg>
      <span className="sbp-ring-in">{children}</span>
    </span>
  )
}

/** A card with a ring, a picture and a level: skills, slayers, classes, HotM… */
function LevelCard({ icon, name, l, sub, extra }: { icon: ReactNode; name: string; l: Level; sub?: ReactNode; extra?: ReactNode }) {
  const maxed = l.level >= l.max
  return (
    <div className={`sbp-lcard ${maxed ? 'maxed' : ''}`}>
      <Ring progress={maxed ? 1 : l.progress} maxed={maxed}>
        {icon}
      </Ring>
      <div className="sbp-lcard-text">
        <span className="sbp-lcard-name">{name}</span>
        <b className="sbp-lcard-level">{l.level}</b>
        <span className="faint">{sub ?? (maxed ? `Maxed · ${shortNumber(l.xp)} XP` : `${shortNumber(l.into)} / ${shortNumber(l.needed)} XP`)}</span>
        {extra}
      </div>
    </div>
  )
}

function Bar({ progress, color }: { progress: number; color?: string }) {
  return (
    <span className="sbp-bar2">
      <i style={{ width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`, background: color }} />
    </span>
  )
}

function Chip({ label, value, icon, tone }: { label: string; value: ReactNode; icon?: ReactNode; tone?: string }) {
  return (
    <div className="sbp-chip" style={tone ? ({ '--tone': tone } as CSSProperties) : undefined}>
      {icon}
      <span>
        <small>{label}</small>
        <b>{value}</b>
      </span>
    </div>
  )
}

function Panel({ title, children, wide, right }: { title: ReactNode; children: ReactNode; wide?: boolean; right?: ReactNode }) {
  return (
    <section className={`sbp-panel ${wide ? 'wide' : ''}`}>
      <header>
        <h4>{title}</h4>
        {right}
      </header>
      {children}
    </section>
  )
}

const Nothing = ({ what }: { what: string }) => <p className="faint sbp-nothing">{what}</p>

/** Small tile with a picture: collections, minions, missing accessories, museum… */
function Tile({
  id,
  name,
  children,
  onClick,
  dim,
  tone,
  icon
}: {
  id?: string
  name: string
  children?: ReactNode
  onClick?: () => void
  dim?: boolean
  tone?: string
  icon?: ReactNode
}) {
  return (
    <button
      className={`sbp-tile ${dim ? 'dim' : ''} ${onClick ? 'clickable' : ''}`}
      onClick={onClick}
      style={tone ? ({ '--tone': tone } as CSSProperties) : undefined}
      data-sbp-tile={id}
    >
      <span className="sbp-tile-pic">{icon ?? <ItemPic id={id} name={name} size={32} />}</span>
      <span className="sbp-tile-text">
        <span className="sbp-tile-name">{name}</span>
        {children}
      </span>
    </button>
  )
}

// ---------- the page ----------

const SECTIONS = [
  ['overview', 'Overview', 'NETHER_STAR'],
  ['gear', 'Gear', 'DIAMOND_CHESTPLATE'],
  ['inventories', 'Inventories', 'CHEST'],
  ['accessories', 'Accessories', 'HEGEMONY_ARTIFACT'],
  ['pets', 'Pets', 'BEE;4'],
  ['collections', 'Collections', 'WHEAT'],
  ['dungeons', 'Dungeons', 'ESSENCE_WITHER'],
  ['slayer', 'Slayer', 'REVENANT_FLESH'],
  ['mining', 'Mining', 'DIAMOND_PICKAXE'],
  ['bestiary', 'Bestiary', 'ROTTEN_FLESH'],
  ['garden', 'Garden', 'GOLD_HOE'],
  ['fishing', 'Trophy fish', 'MAGMA_FISH'],
  ['crimson', 'Crimson Isle', 'BLAZE_ROD'],
  ['rift', 'Rift', 'RIFT_PRISM'],
  ['museum', 'Museum', 'ITEM_FRAME'],
  ['stats', 'Misc stats', 'BOOK_AND_QUILL']
] as const
type Section = (typeof SECTIONS)[number][0]

const SKILL_ICONS: Record<string, string> = {
  farming: 'GOLD_HOE',
  mining: 'STONE_PICKAXE',
  combat: 'STONE_SWORD',
  foraging: 'SAPLING',
  fishing: 'FISHING_ROD',
  enchanting: 'ENCHANTMENT_TABLE',
  alchemy: 'BREWING_STAND_ITEM',
  taming: 'BONE',
  carpentry: 'WORKBENCH',
  runecrafting: 'MAGMA_CREAM',
  social: 'EMERALD',
  hunting: 'BOW'
}
const SLAYER_ICONS: Record<string, string> = {
  zombie: 'REVENANT_FLESH',
  spider: 'SPIDER_EYE',
  wolf: 'WOLF_TOOTH',
  enderman: 'ENDER_PEARL',
  blaze: 'DERELICT_ASHE',
  vampire: 'COVEN_SEAL'
}
const CLASS_ICONS: Record<string, string> = { healer: 'POTION', mage: 'BLAZE_ROD', berserk: 'IRON_SWORD', archer: 'BOW', tank: 'LEATHER_CHESTPLATE' }

/** The SkyBlock level colours, as in game. */
function levelColor(l: number): string {
  const steps: [number, string][] = [
    [480, '#aa0000'],
    [440, '#ff5555'],
    [400, '#ffaa00'],
    [360, '#aa00aa'],
    [320, '#ff55ff'],
    [280, '#5555ff'],
    [240, '#00aaaa'],
    [200, '#55ffff'],
    [160, '#00aa00'],
    [120, '#55ff55'],
    [80, '#ffff55'],
    [40, '#ffffff']
  ]
  return steps.find(([at]) => l >= at)?.[1] ?? '#aaaaaa'
}

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
      <Detail />
      <Hero v={view} go={setSection} />
      <div className="sbp-layout">
        <nav className="sbp-nav">
          {SECTIONS.map(([id, name, icon]) => (
            <button key={id} className={section === id ? 'active' : ''} onClick={() => setSection(id)} data-sbp-section={id}>
              <ItemPic id={icon} name={name} size={20} />
              <span>{name}</span>
            </button>
          ))}
        </nav>
        <div className="sbp-body" key={section}>
          {section === 'overview' && <Overview v={view} go={setSection} />}
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
    </div>
  )
}

function Hero({ v, go }: { v: SbProfileView; go: (s: Section) => void }) {
  const lvl = v.skyblockLevel.level
  const mp = v.accessories ? (v.accessories.highestMagicalPower ?? v.accessories.magicalPower) : null
  return (
    <header className="sbp-hero" style={{ '--lvl': levelColor(lvl) } as CSSProperties}>
      <div className="sbp-hero-head">{v.player?.skin ? <Head skin={v.player.skin} size={84} /> : <ItemPic id="SKULL_ITEM-3" name="Steve" size={84} />}</div>
      <div className="sbp-hero-main">
        <div className="sbp-hero-name">
          <Ring progress={v.skyblockLevel.progress} size={46}>
            <b className="sbp-hero-lvl">{lvl}</b>
          </Ring>
          <div>
            <h3>{v.player?.name || 'You'}</h3>
            <span className="sbp-hero-sub">
              <span className="sbp-badge">{v.profileName || 'Profile'}</span>
              {v.mode && <span className={`sbp-badge mode-${v.mode}`}>{MODE_NAMES[v.mode] ?? v.mode}</span>}
              {v.coopMembers > 1 && <span className="sbp-badge">Co-op of {v.coopMembers}</span>}
              <span className="faint">checked {new Date(v.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </span>
          </div>
        </div>
        <div className="sbp-hero-chips">
          <Chip label="Purse" value={shortNumber(v.purse ?? 0)} icon={<ItemPic id="GOLD_INGOT" size={22} />} tone="#fcc419" />
          <Chip label="Bank" value={v.bank === null ? 'API off' : shortNumber(v.bank)} icon={<ItemPic id="GOLD_BLOCK" size={22} />} tone="#fab005" />
          <button className="sbp-chip-btn" onClick={() => go('overview')}>
            <Chip label="Skill average" value={v.skillAverage === null ? '—' : v.skillAverage.toFixed(1)} icon={<ItemPic id="DIAMOND_SWORD" size={22} />} tone="#4dabf7" />
          </button>
          {v.dungeons && (
            <button className="sbp-chip-btn" onClick={() => go('dungeons')}>
              <Chip label="Catacombs" value={v.dungeons.catacombs.level} icon={<ItemPic id="ESSENCE_WITHER" size={22} />} tone="#868e96" />
            </button>
          )}
          {mp !== null && (
            <button className="sbp-chip-btn" onClick={() => go('accessories')}>
              <Chip label="Magical power" value={fmt(mp)} icon={<ItemPic id="HEGEMONY_ARTIFACT" size={22} />} tone="#cc5de8" />
            </button>
          )}
          <Chip label="Fairy souls" value={`${v.fairySouls.collected}/${v.fairySouls.max || '?'}`} icon={<ItemPic id="GHAST_TEAR" size={22} />} tone="#f783ac" />
        </div>
      </div>
    </header>
  )
}

function Overview({ v, go }: { v: SbProfileView; go: (s: Section) => void }) {
  const pet = v.pets.find((p) => p.active)
  return (
    <div className="sbp-panels">
      <Panel title="Skills" wide>
        {v.skills ? (
          <div className="sbp-lcards">
            {v.skills.map((s) => (
              <LevelCard key={s.id} icon={<ItemPic id={SKILL_ICONS[s.id]} name={s.name} size={28} />} name={s.name} l={s} />
            ))}
          </div>
        ) : (
          <Nothing what="Turn on the Skills API to see these." />
        )}
      </Panel>
      {v.gear && (
        <Panel
          title="Wearing"
          right={
            <button className="link-btn" onClick={() => go('gear')}>
              All gear
            </button>
          }
        >
          <div className="sbp-wearing">
            {v.gear.armor.map((it, i) => (
              <Slot key={`a${i}`} item={it} size={48} />
            ))}
            {v.gear.equipment.map((it, i) => (
              <Slot key={`e${i}`} item={it} size={48} />
            ))}
          </div>
        </Panel>
      )}
      {pet && (
        <Panel
          title="Active pet"
          right={
            <button className="link-btn" onClick={() => go('pets')}>
              All pets
            </button>
          }
        >
          <PetCard p={pet} />
        </Panel>
      )}
      <Panel
        title="Slayers"
        wide
        right={
          <button className="link-btn" onClick={() => go('slayer')}>
            More
          </button>
        }
      >
        <div className="sbp-lcards">
          {v.slayers.map((s) => (
            <LevelCard key={s.id} icon={<ItemPic id={SLAYER_ICONS[s.id]} name={s.name} size={28} />} name={s.name} l={s.level} sub={`${fmt(s.level.xp)} XP`} />
          ))}
        </div>
      </Panel>
      {v.essence.length > 0 && (
        <Panel title="Essence" wide>
          <div className="sbp-chips">
            {v.essence.map((e) => (
              <Chip key={e.id} label={e.id} value={fmt(e.amount)} icon={<ItemPic id={`ESSENCE_${e.id.toUpperCase().replace(/ /g, '_')}`} name={e.id} size={22} />} />
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}

const TOOL_RE = /\b(SWORD|BOW|WAND|DUNGEON SWORD|DUNGEON BOW|LONGSWORD|PICKAXE|DRILL|GAUNTLET|AXE|HOE|SHOVEL|FISHING ROD|FISHING WEAPON)\b/

function Gear({ v }: { v: SbProfileView }) {
  const [set, setSet] = useState<number | null>(null)
  if (!v.gear) return <Nothing what="Turn on the Inventory API to see your gear." />
  const g = v.gear
  const tools = [...g.inventory, ...g.enderChest].filter((it): it is SbViewItem => !!it && TOOL_RE.test(plain(it.lore[it.lore.length - 1] ?? '')))
  const shown = set === null ? null : g.wardrobe.find((w) => w.slot === set)
  return (
    <div className="sbp-panels">
      <Panel title="Your character">
        <div className="sbp-paperdoll">
          <div className="sbp-paperdoll-col">
            {(shown ? shown.pieces : g.armor).map((it, i) => (
              <Slot key={i} item={it} size={52} />
            ))}
          </div>
          <div className="sbp-paperdoll-me">{v.player?.skin ? <Head skin={v.player.skin} size={96} /> : <ItemPic id="SKULL_ITEM-3" size={96} />}</div>
          <div className="sbp-paperdoll-col">
            {g.equipment.map((it, i) => (
              <Slot key={i} item={it} size={52} />
            ))}
          </div>
        </div>
        <p className="faint sbp-hint">{shown ? `Showing wardrobe set ${shown.slot}.` : 'Click any item to see it in full, or to add it as a goal.'}</p>
      </Panel>
      <Panel title="Weapons and tools">
        {tools.length ? (
          <div className="sbp-item-list">
            {tools.map((it, i) => (
              <ItemLine key={i} item={it} />
            ))}
          </div>
        ) : (
          <Nothing what="None in your inventory or ender chest." />
        )}
      </Panel>
      <Panel
        title={`Wardrobe (${g.wardrobe.length})`}
        wide
        right={
          set !== null && (
            <button className="link-btn" onClick={() => setSet(null)}>
              Show what I’m wearing
            </button>
          )
        }
      >
        {g.wardrobe.length ? (
          <div className="sbp-wardrobe">
            {g.wardrobe.map((w) => (
              <div
                key={w.slot}
                className={`sbp-wardrobe-set ${g.wardrobeEquipped === w.slot ? 'on' : ''} ${set === w.slot ? 'picked' : ''}`}
                onMouseEnter={() => setSet(w.slot)}
                data-sbp-wardrobe={w.slot}
              >
                <span className="sbp-wardrobe-num">{g.wardrobeEquipped === w.slot ? 'On' : w.slot}</span>
                {w.pieces.map((p, i) => (
                  <Slot key={i} item={p} size={40} />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <Nothing what="Wardrobe is empty." />
        )}
      </Panel>
    </div>
  )
}

function ItemLine({ item }: { item: SbViewItem }) {
  return (
    <button
      className="sbp-item-line"
      style={{ '--rarity': rarityColor(item.rarity) } as CSSProperties}
      onMouseMove={(e) => tipSetter?.({ item, x: e.clientX, y: e.clientY })}
      onMouseLeave={() => tipSetter?.(null)}
      onClick={() => {
        tipSetter?.(null)
        pick({ id: item.id, name: item.name, item })
      }}
    >
      <ItemPic icon={item.icon} name={item.name} size={32} glint={item.glint} />
      <span>
        <McText text={item.name} />
        <small className="faint">
          {item.rarity.toLowerCase()}
          {item.recomb && ' · recombobulated'}
        </small>
      </span>
    </button>
  )
}

const bagIcon = (name: string): string => {
  const n = name.toLowerCase()
  return n.includes('quiver')
    ? 'ARROW'
    : n.includes('potion')
      ? 'POTION'
      : n.includes('fish')
        ? 'RAW_FISH'
        : n.includes('accessor') || n.includes('talisman')
          ? 'HEGEMONY_ARTIFACT'
          : 'CHEST'
}

function Inventories({ v }: { v: SbProfileView }) {
  const [tab, setTab] = useState('inventory')
  if (!v.gear) return <Nothing what="Turn on the Inventory API to see your inventories." />
  const g = v.gear
  const tabs: { id: string; name: string; icon: ReactNode }[] = [
    { id: 'inventory', name: 'Inventory', icon: <ItemPic id="CHEST" size={22} /> },
    { id: 'ender', name: 'Ender chest', icon: <ItemPic id="ENDER_CHEST" size={22} /> },
    ...g.backpacks.map((b) => ({ id: `bp${b.slot}`, name: `Backpack ${b.slot}`, icon: <ItemPic id="LARGE_BACKPACK" name="Backpack" size={22} /> })),
    { id: 'vault', name: 'Vault', icon: <ItemPic id="IRON_DOOR" name="Vault" size={22} /> },
    ...g.bags.map((b) => ({ id: `bag:${b.name}`, name: b.name, icon: <ItemPic id={bagIcon(b.name)} name={b.name} size={22} /> })),
    { id: 'sacks', name: 'Sacks', icon: <ItemPic id="LARGE_ENCHANTED_MINING_SACK" name="Sacks" size={22} /> }
  ]
  // The hotbar is the first 9 slots; show it last, like in game.
  const inv = g.inventory.length >= 9 ? [...g.inventory.slice(9), ...g.inventory.slice(0, 9)] : g.inventory
  const current = tabs.find((t) => t.id === tab) ?? tabs[0]
  return (
    <div className="sbp-inv">
      <div className="sbp-inv-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)} title={t.name} data-sbp-inv={t.id}>
            {t.icon}
            <span>{t.name}</span>
          </button>
        ))}
      </div>
      <div className="sbp-inv-body">
        {tab === 'inventory' && (
          <div className="sbp-chest">
            <div className="sbp-chest-title">Inventory</div>
            <div className="sbp-grid" style={{ gridTemplateColumns: 'repeat(9, 44px)' }}>
              {inv.slice(0, inv.length - 9).map((it, i) => (
                <Slot key={i} item={it} size={44} />
              ))}
            </div>
            <div className="sbp-grid sbp-hotbar" style={{ gridTemplateColumns: 'repeat(9, 44px)' }}>
              {inv.slice(-9).map((it, i) => (
                <Slot key={i} item={it} size={44} />
              ))}
            </div>
          </div>
        )}
        {tab === 'ender' && <Chest items={g.enderChest} title="Ender chest" />}
        {tab.startsWith('bp') && <Chest items={g.backpacks.find((b) => `bp${b.slot}` === tab)?.items ?? []} title={current.name} />}
        {tab === 'vault' && <Chest items={g.vault} title="Personal vault" />}
        {tab.startsWith('bag:') && <Chest items={g.bags.find((b) => `bag:${b.name}` === tab)?.items ?? []} title={current.name} />}
        {tab === 'sacks' && <Sacks sacks={g.sacks} />}
      </div>
    </div>
  )
}

function Sacks({ sacks }: { sacks: { id: string; name: string; count: number }[] }) {
  const [q, setQ] = useState('')
  const list = sacks.filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="sbp-chest">
      <div className="sbp-chest-title">
        Sacks <span className="faint">· {sacks.length} kinds</span>
      </div>
      <div className="games-search sbp-filter">
        <Search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find in your sacks" spellCheck={false} />
      </div>
      <div className="sbp-tiles">
        {list.map((s) => (
          <Tile key={s.id} id={s.id} name={s.name} onClick={() => pick({ id: s.id, name: s.name, note: `${fmt(s.count)} in your sacks` })}>
            <b>{fmt(s.count)}</b>
          </Tile>
        ))}
      </div>
    </div>
  )
}

function Accessories({ v }: { v: SbProfileView }) {
  const [rarity, setRarity] = useState<string>('')
  const [showMissing, setShowMissing] = useState(true)
  if (!v.accessories) return <Nothing what="Turn on the Inventory API to see your accessories." />
  const a = v.accessories
  const counts = RARITIES.map((r) => [r, a.items.filter((i) => i.rarity === r).length] as const).filter(([, n]) => n > 0)
  const items = a.items.filter((i) => !rarity || i.rarity === rarity).sort((x, y) => RARITIES.indexOf(y.rarity) - RARITIES.indexOf(x.rarity))
  const missing = a.missing.filter((m) => !rarity || m.rarity === rarity)
  return (
    <div className="sbp-panels">
      <Panel title="Accessory bag" wide>
        <div className="sbp-mp">
          <div className="sbp-mp-big">
            <small>Magical power</small>
            <b>{fmt(a.highestMagicalPower ?? a.magicalPower)}</b>
            <span className="faint">{a.selectedPower ? `${a.selectedPower} power` : 'No power picked'}</span>
          </div>
          <div className="sbp-chips">
            <Chip label="Accessories" value={a.items.length} />
            <Chip label="Worked out by Orbit" value={fmt(a.magicalPower)} />
            <Chip label="Still to get" value={a.missing.length} />
          </div>
        </div>
        <div className="sbp-filters">
          <button className={!rarity ? 'active' : ''} onClick={() => setRarity('')}>
            All
          </button>
          {counts.map(([r, n]) => (
            <button key={r} className={rarity === r ? 'active' : ''} style={{ '--tone': rarityColor(r) } as CSSProperties} onClick={() => setRarity(r)}>
              {r.toLowerCase()} <span className="faint">{n}</span>
            </button>
          ))}
        </div>
        <div className="sbp-grid sbp-grid-free">
          {items.map((it, i) => (
            <Slot key={i} item={it} size={48} />
          ))}
        </div>
      </Panel>
      <Panel
        title={`Missing (${missing.length})`}
        wide
        right={
          <button className="link-btn" onClick={() => setShowMissing(!showMissing)}>
            {showMissing ? 'Hide' : 'Show'}
          </button>
        }
      >
        {showMissing && (
          <div className="sbp-tiles">
            {missing.map((m) => (
              <Tile
                key={m.id}
                id={m.id}
                name={m.name}
                dim
                tone={rarityColor(m.rarity)}
                onClick={() => pick({ id: m.id, name: m.name, rarity: m.rarity, note: m.upgrade ? 'An upgrade of one you have.' : 'You don’t have this one yet.' })}
              >
                <small style={{ color: rarityColor(m.rarity) }}>
                  {m.rarity.toLowerCase()}
                  {m.upgrade && ' · upgrade'}
                </small>
              </Tile>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

function PetCard({ p }: { p: SbPet }) {
  const maxed = p.level.level >= p.level.max
  return (
    <button
      className={`sbp-pet ${p.active ? 'on' : ''}`}
      style={{ '--rarity': rarityColor(p.rarity) } as CSSProperties}
      onClick={() => pick({ id: p.neuId, name: p.name, rarity: p.rarity, note: `Level ${p.level.level}${p.heldItem ? ` · holding ${p.heldItem}` : ''}` })}
      data-sbp-pet={p.type}
    >
      <Ring progress={maxed ? 1 : p.level.progress} size={58} maxed={maxed}>
        <ItemPic id={p.neuId} name={p.name} size={34} />
      </Ring>
      <span className="sbp-pet-text">
        <span className="sbp-pet-name">
          <span className="faint">Lvl {p.level.level}</span> <b>{p.name}</b>
        </span>
        <small style={{ color: rarityColor(p.rarity) }}>{p.rarity.toLowerCase()}</small>
        {(p.heldItem || p.skin || p.candy > 0) && (
          <small className="faint sbp-pet-extra">
            {p.heldItemId && <ItemPic id={p.heldItemId} name={p.heldItem} size={14} />}
            {[p.heldItem, p.skin && `${p.skin} skin`, p.candy > 0 && `${p.candy} candy`].filter(Boolean).join(' · ')}
          </small>
        )}
      </span>
      {p.active && <span className="sbp-pet-active">Active</span>}
    </button>
  )
}

function Pets({ v }: { v: SbProfileView }) {
  const [q, setQ] = useState('')
  const [rarity, setRarity] = useState('')
  if (!v.pets.length) return <Nothing what="No pets." />
  const counts = RARITIES.map((r) => [r, v.pets.filter((p) => p.rarity === r).length] as const).filter(([, n]) => n > 0)
  const list = v.pets.filter((p) => (!rarity || p.rarity === rarity) && (!q || p.name.toLowerCase().includes(q.toLowerCase())))
  return (
    <div>
      <div className="sbp-toolbar">
        <div className="games-search sbp-filter">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find in ${v.pets.length} pets`} spellCheck={false} />
        </div>
        <div className="sbp-filters">
          <button className={!rarity ? 'active' : ''} onClick={() => setRarity('')}>
            All
          </button>
          {counts.map(([r, n]) => (
            <button key={r} className={rarity === r ? 'active' : ''} style={{ '--tone': rarityColor(r) } as CSSProperties} onClick={() => setRarity(r)}>
              {r.toLowerCase()} <span className="faint">{n}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="sbp-pets">
        {list.map((p, i) => (
          <PetCard key={i} p={p} />
        ))}
      </div>
    </div>
  )
}

function Collections({ v }: { v: SbProfileView }) {
  const [q, setQ] = useState('')
  const [group, setGroup] = useState('')
  if (!v.collections) return <Nothing what="Turn on the Collections API to see your collections." />
  const groups = v.collections
  const current = groups.find((g) => g.group === group)
  const shown = q ? groups : current ? [current] : groups
  return (
    <div>
      <div className="sbp-toolbar">
        <div className="games-search sbp-filter">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a collection" spellCheck={false} />
        </div>
        <div className="sbp-filters">
          <button className={!group ? 'active' : ''} onClick={() => setGroup('')}>
            All
          </button>
          {groups.map((g) => {
            const maxed = g.items.filter((i) => i.tier >= i.maxTier).length
            return (
              <button key={g.group} className={group === g.group ? 'active' : ''} onClick={() => setGroup(g.group)}>
                {g.group}{' '}
                <span className="faint">
                  {maxed}/{g.items.length}
                </span>
              </button>
            )
          })}
          <button className={group === 'minions' ? 'active' : ''} onClick={() => setGroup('minions')} data-sbp-minions>
            Minions <span className="faint">{v.craftedMinions}</span>
          </button>
        </div>
      </div>
      {group === 'minions' && !q ? (
        <Minions v={v} />
      ) : (
        shown.map((g) => {
          const items = g.items.filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()))
          if (!items.length) return null
          return (
            <Panel key={g.group} title={g.group} wide>
              <div className="sbp-tiles">
                {items.map((i) => {
                  const maxed = i.tier >= i.maxTier
                  return (
                    <Tile
                      key={i.id}
                      id={i.id}
                      name={i.name}
                      tone={maxed ? '#fcc419' : undefined}
                      onClick={() => pick({ id: i.id.replace(/:/g, '-'), name: i.name, note: `${fmt(i.count)} collected` })}
                    >
                      <span className="sbp-tile-row">
                        <b>{maxed ? `${roman(i.tier)} · max` : i.tier ? `Tier ${roman(i.tier)}` : 'Not started'}</b>
                        <span className="faint">{shortNumber(i.count)}</span>
                      </span>
                      <Bar progress={i.next === null ? 1 : i.count / i.next} color={maxed ? '#fcc419' : undefined} />
                    </Tile>
                  )
                })}
              </div>
            </Panel>
          )
        })
      )}
    </div>
  )
}

function Minions({ v }: { v: SbProfileView }) {
  return (
    <Panel title={`Minions · ${v.minions.length} kinds, ${v.craftedMinions} tiers crafted`} wide>
      <div className="sbp-tiles">
        {v.minions.map((m) => (
          <Tile key={m.id} id={`${m.id}_GENERATOR_${m.highest}`} name={m.name}>
            <span className="sbp-tiers">
              {Array.from({ length: Math.max(11, ...m.tiers) }, (_, i) => (
                <i key={i} className={m.tiers.includes(i + 1) ? 'on' : ''} title={`Tier ${roman(i + 1)}`} />
              ))}
            </span>
          </Tile>
        ))}
      </div>
    </Panel>
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
  const avg = d.classes.length ? d.classes.reduce((a, c) => a + c.level, 0) / d.classes.length : null
  return (
    <div className="sbp-panels">
      <Panel title="Catacombs" wide>
        <div className="sbp-lcards">
          <LevelCard icon={<ItemPic id="ESSENCE_WITHER" name="Catacombs" size={30} />} name="Catacombs" l={d.catacombs} />
          {d.classes.map((c) => (
            <LevelCard
              key={c.id}
              icon={<ItemPic id={CLASS_ICONS[c.id]} name={c.name} size={28} />}
              name={c.name}
              l={c}
              extra={d.selected === c.name ? <span className="sbg-tag">Selected</span> : undefined}
            />
          ))}
        </div>
        <div className="sbp-chips">
          <Chip label="Secrets found" value={fmt(d.secrets)} />
          <Chip label="Class average" value={avg === null ? '—' : avg.toFixed(1)} />
        </div>
      </Panel>
      <Panel title="Floors" wide>
        <div className="sbp-floors">
          {d.floors.map((f) => (
            <div key={f.floor} className={`sbp-floor ${f.normal || f.master ? '' : 'dim'}`}>
              <b>{f.floor}</b>
              <span>
                <small>Runs</small> {fmt(f.normal)}
              </span>
              <span>
                <small>Master</small> {fmt(f.master)}
              </span>
              <span>
                <small>Fastest</small> {time(f.fastest)}
              </span>
              <span>
                <small>Best score</small> {fmt(f.bestScore)}
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function Slayers({ v }: { v: SbProfileView }) {
  return (
    <div className="sbp-slayers">
      {v.slayers.map((s) => {
        const maxed = s.level.level >= s.level.max
        return (
          <div key={s.id} className={`sbp-slayer ${maxed ? 'maxed' : ''}`}>
            <Ring progress={maxed ? 1 : s.level.progress} size={78} maxed={maxed}>
              <ItemPic id={SLAYER_ICONS[s.id]} name={s.name} size={40} />
            </Ring>
            <div>
              <span className="sbp-lcard-name">{s.name}</span>
              <b className="sbp-lcard-level">Level {s.level.level}</b>
              <span className="faint">{maxed ? `Maxed · ${fmt(s.level.xp)} XP` : `${fmt(s.level.into)} / ${fmt(s.level.needed)} XP`}</span>
              <div className="sbp-kills">
                {s.kills.map((k, i) => (
                  <span key={i} className={k ? '' : 'dim'} title={`Tier ${roman(i + 1)} kills`}>
                    <small>{roman(i + 1)}</small> {fmt(k)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

const POWDER_TONE: Record<string, string> = { Mithril: '#69db7c', Gemstone: '#f783ac', Glacite: '#74c0fc' }

function Mining({ v }: { v: SbProfileView }) {
  const m = v.mining
  if (!m) return <Nothing what="No mining data yet." />
  return (
    <div className="sbp-panels">
      <Panel title="Heart of the Mountain">
        <LevelCard icon={<ItemPic id="DIAMOND_PICKAXE" size={28} />} name="HotM tier" l={m.hotm} />
        <div className="sbp-chips">
          {m.ability && <Chip label="Pickaxe ability" value={m.ability} />}
          {m.commissions !== null && <Chip label="Commissions" value={fmt(m.commissions)} />}
        </div>
      </Panel>
      <Panel title="Powder">
        <div className="sbp-powders">
          {m.powder.map((p) => (
            <div key={p.kind} className="sbp-powder" style={{ '--tone': POWDER_TONE[p.kind] ?? 'var(--accent)' } as CSSProperties}>
              <span>{p.kind}</span>
              <b>{shortNumber(p.available)}</b>
              <small className="faint">{shortNumber(p.available + p.spent)} total</small>
            </div>
          ))}
        </div>
      </Panel>
      {m.crystals.length > 0 && (
        <Panel title="Crystals" wide>
          <div className="sbp-tiles">
            {m.crystals.map((c) => (
              <Tile key={c.id} id={`${c.id.toUpperCase()}_CRYSTAL`} name={c.id} dim={!c.found} tone={c.state === 'FOUND' || c.state === 'PLACED' ? '#3bc9db' : undefined}>
                <small className="faint">
                  {c.state.toLowerCase()} · {fmt(c.found)} found
                </small>
              </Tile>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}

function Bestiary({ v }: { v: SbProfileView }) {
  const [open, setOpen] = useState<string | null>(v.bestiary[0]?.island ?? null)
  if (!v.bestiary.length) return <Nothing what="No bestiary kills yet." />
  return (
    <div>
      {v.bestiaryMilestone !== null && (
        <div className="sbp-chips">
          <Chip label="Bestiary milestone" value={v.bestiaryMilestone} icon={<ItemPic id="BOOK" size={22} />} />
        </div>
      )}
      <div className="sbp-accordion">
        {v.bestiary.map((i) => {
          const tiers = i.mobs.reduce((a, m) => a + m.tier, 0)
          const max = i.mobs.reduce((a, m) => a + m.maxTier, 0)
          return (
            <section key={i.island} className={open === i.island ? 'open' : ''}>
              <button className="sbp-acc-head" onClick={() => setOpen(open === i.island ? null : i.island)}>
                <b>{i.island}</b>
                <Bar progress={max ? tiers / max : 0} />
                <span className="faint">
                  {tiers}/{max}
                </span>
              </button>
              {open === i.island && (
                <div className="sbp-tiles">
                  {i.mobs.map((m) => (
                    <Tile key={m.name} name={m.name} tone={m.tier >= m.maxTier ? '#fcc419' : undefined} icon={<span className="sbp-mob-tier">{m.tier}</span>}>
                      <Bar progress={m.maxTier ? m.tier / m.maxTier : 0} color={m.tier >= m.maxTier ? '#fcc419' : undefined} />
                      <small className="faint">{fmt(m.kills)} kills</small>
                    </Tile>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

const CROP_ICONS: Record<string, string> = {
  COCOA_BEANS: 'INK_SACK-3',
  NETHER_WART: 'NETHER_STALK',
  MUSHROOM: 'RED_MUSHROOM',
  SUNFLOWER: 'DOUBLE_PLANT',
  CARROT: 'CARROT_ITEM',
  POTATO: 'POTATO_ITEM'
}
const MEDAL_TONE: Record<string, string> = { bronze: '#e8590c', silver: '#ced4da', gold: '#fcc419', platinum: '#66d9e8', diamond: '#4dabf7' }

function Garden({ v }: { v: SbProfileView }) {
  const g = v.garden
  return (
    <div className="sbp-panels">
      {g ? (
        <>
          <Panel title="Garden">
            <LevelCard icon={<ItemPic id="GRASS" size={28} />} name="Garden level" l={g.level} />
            <div className="sbp-chips">
              <Chip label="Visitors served" value={fmt(g.visitors)} />
              <Chip label="Unique visitors" value={fmt(g.uniqueVisitors)} />
              <Chip label="Plots" value={`${g.plots}/24`} />
            </div>
          </Panel>
          {v.jacob && (
            <Panel title="Jacob’s contests">
              <div className="sbp-chips">
                <Chip label="Contests" value={fmt(v.jacob.contests)} />
                {Object.entries(v.jacob.medals).map(([k, n]) => (
                  <Chip key={k} label={`${k} medals`} value={fmt(n)} tone={MEDAL_TONE[k]} />
                ))}
                {Object.entries(v.jacob.perks).map(([k, n]) => (
                  <Chip key={k} label={k} value={n} />
                ))}
              </div>
            </Panel>
          )}
          <Panel title="Crop milestones" wide>
            <div className="sbp-lcards">
              {g.crops.map((c) => {
                const best = v.jacob?.personalBests.find((p) => p.crop.toUpperCase().replace(/ /g, '_') === c.id)
                return (
                  <LevelCard
                    key={c.id}
                    icon={<ItemPic id={CROP_ICONS[c.id] ?? c.id} name={c.name} size={28} />}
                    name={c.name}
                    l={c.milestone}
                    sub={`${shortNumber(c.collected)} collected`}
                    extra={best ? <small className="faint">Best contest: {fmt(best.amount)}</small> : undefined}
                  />
                )
              })}
            </div>
          </Panel>
          {g.upgrades.length > 0 && (
            <Panel title="Crop upgrades" wide>
              <div className="sbp-chips">
                {g.upgrades.map((u) => (
                  <Chip key={u.id} label={u.id} value={`${u.level}/9`} icon={<ItemPic id={CROP_ICONS[u.id] ?? u.id} name={u.id} size={20} />} />
                ))}
              </div>
            </Panel>
          )}
        </>
      ) : (
        <Nothing what="No garden yet (or Hypixel hasn’t been asked since this update: press Refresh)." />
      )}
    </div>
  )
}

const FISH_TIERS = [
  ['bronze', '#e8590c'],
  ['silver', '#ced4da'],
  ['gold', '#fcc419'],
  ['diamond', '#4dabf7']
] as const

function TrophyFish({ v }: { v: SbProfileView }) {
  const t = v.trophyFish
  if (!t || !t.fish.length) return <Nothing what="No trophy fish caught yet." />
  return (
    <Panel title={`Trophy fish · ${fmt(t.total)} caught`} wide>
      <div className="sbp-fish">
        {t.fish.map((f) => {
          const best = [...FISH_TIERS].reverse().find(([k]) => f[k] > 0)
          return (
            <div key={f.id} className={`sbp-fish-card ${f.total ? '' : 'dim'}`} style={{ '--tone': best?.[1] ?? 'var(--border)' } as CSSProperties}>
              <ItemPic id={`${f.id}_${(best?.[0] ?? 'bronze').toUpperCase()}`} name={f.name} size={36} />
              <span className="sbp-fish-name">{f.name}</span>
              <span className="sbp-fish-tiers">
                {FISH_TIERS.map(([k, c]) => (
                  <span key={k} className={f[k] ? '' : 'dim'} title={k} style={{ color: c }}>
                    ● {fmt(f[k])}
                  </span>
                ))}
              </span>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

function Crimson({ v }: { v: SbProfileView }) {
  const c = v.crimson
  if (!c) return <Nothing what="You haven’t been to the Crimson Isle yet." />
  const top = Math.max(12_000, c.mage, c.barbarian)
  return (
    <div className="sbp-panels">
      <Panel title={`Factions${c.faction ? ` · ${c.faction}` : ''}`}>
        <div className="sbp-rep">
          <span>Mages</span>
          <Bar progress={c.mage / top} color="#cc5de8" />
          <b>{fmt(c.mage)}</b>
          <span>Barbarians</span>
          <Bar progress={c.barbarian / top} color="#ff6b6b" />
          <b>{fmt(c.barbarian)}</b>
        </div>
      </Panel>
      <Panel title="Kuudra">
        <div className="sbp-tiles">
          {c.kuudra.map((k) => (
            <Tile key={k.tier} name={k.tier} dim={!k.completions} icon={<ItemPic id="KUUDRA_TEETH" name="Kuudra" size={30} />}>
              <b>{fmt(k.completions)}</b>
            </Tile>
          ))}
        </div>
      </Panel>
      {c.dojo.length > 0 && (
        <Panel title="Dojo" wide>
          <div className="sbp-chips">
            {c.dojo.map((d) => (
              <Chip key={d.test} label={d.test} value={fmt(d.points)} />
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}

function Rift({ v }: { v: SbProfileView }) {
  const r = v.rift
  if (!r) return <Nothing what="You haven’t been to the Rift yet." />
  return (
    <Panel title="The Rift" wide>
      <div className="sbp-chips big">
        <Chip label="Enigma souls" value={fmt(r.enigmaSouls)} icon={<ItemPic id="RIFT_PRISM" size={26} />} tone="#da77f2" />
        <Chip label="Timecharms" value={fmt(r.timecharms)} tone="#69db7c" />
        <Chip label="Motes" value={fmt(r.motes)} tone="#f783ac" />
        <Chip label="Visits" value={fmt(r.visits)} />
      </div>
    </Panel>
  )
}

function Museum({ v }: { v: SbProfileView }) {
  const [q, setQ] = useState('')
  const m = v.museum
  if (!m) return <Nothing what="Hypixel hasn’t been asked about the museum yet: press Refresh." />
  const list = m.items.filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <Panel title={`Museum · ${m.donated} donated`} wide right={m.value !== null && <span className="sbp-badge">Value {shortNumber(m.value)}</span>}>
      <div className="games-search sbp-filter">
        <Search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a donation" spellCheck={false} />
      </div>
      <div className="sbp-tiles">
        {list.map((i) => (
          <Tile key={i.id} id={i.id} name={i.name} />
        ))}
      </div>
    </Panel>
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
