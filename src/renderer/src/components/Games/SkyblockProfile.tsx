import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Plus, Search, Share2, Star, X } from 'lucide-react'
import { describeMinutes, MODE_NAMES, shortNumber } from '@shared/skyblock'
import { MC_COLORS } from '@shared/skyblockGoals'
import type { Level, SbPet, SbProfileView, SbViewItem } from '@shared/skyblockProfile'
import { groupStats, statBreakdown, type SbProfilePage, type StatGroup } from '@shared/skyblockMore'
import { errorMessage } from '../../lib/paths'
import { notify } from '../../store/notify'
import { Head, ItemPic } from './SkyblockPic'

export const fmt = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-GB'))
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
export const rarityColor = (r: string | undefined): string => (r && RARITY_COLOR[r]) || 'var(--border-strong)'
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

/** How much the SkyBlock page is zoomed (Ctrl + scroll), so fixed-position pop-ups land under the mouse. */
let uiZoom = 1
export const setSkyblockZoom = (z: number): void => {
  uiZoom = z
}

/**
 * The item tooltip. It only re-renders when the item changes; following the mouse just moves it,
 * once per frame, so it glides instead of redrawing the description on every mouse move.
 */
function ItemTip() {
  const [item, setItem] = useState<SbViewItem | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const at = useRef({ x: 0, y: 0 })
  const frame = useRef(0)
  const place = (): void => {
    frame.current = 0
    const el = box.current
    if (!el) return
    const z = uiZoom || 1
    const w = el.offsetWidth * z
    const h = el.offsetHeight * z
    let x = at.current.x + 16
    let y = at.current.y + 14
    if (x + w > window.innerWidth - 8) x = Math.max(8, at.current.x - 16 - w)
    if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - 8 - h)
    el.style.transform = `translate(${x / z}px, ${y / z}px)`
  }
  useEffect(() => {
    let shown: SbViewItem | null = null
    tipSetter = (t) => {
      if (!t) {
        shown = null
        setItem(null)
        return
      }
      at.current = { x: t.x, y: t.y }
      if (t.item !== shown) {
        shown = t.item
        setItem(t.item)
      }
      if (!frame.current) frame.current = requestAnimationFrame(place)
    }
    return () => {
      tipSetter = null
      cancelAnimationFrame(frame.current)
    }
  }, [])
  // Placed again once the new description is drawn (its size changes).
  useLayoutEffect(() => {
    if (item) place()
  }, [item])
  if (!item) return null
  return (
    // On top of everything (the dock too), at the page's zoom.
    createPortal(
      <div className="sbp-tip" ref={box} style={{ zoom: uiZoom }}>
        <Lore item={item} />
      </div>,
      document.body
    )
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

function Detail({ mine }: { mine: boolean }) {
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
      {p.id && mine && (
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

export function Slot({ item, size = 40 }: { item: SbViewItem | null; size?: number }) {
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
export function Ring({ progress, size = 64, children, maxed }: { progress: number; size?: number; children?: ReactNode; maxed?: boolean }) {
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
export function LevelCard({ icon, name, l, sub, extra }: { icon: ReactNode; name: string; l: Level; sub?: ReactNode; extra?: ReactNode }) {
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

export function Bar({ progress, color }: { progress: number; color?: string }) {
  return (
    <span className="sbp-bar2">
      <i style={{ width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`, background: color }} />
    </span>
  )
}

export function Chip({ label, value, icon, tone }: { label: string; value: ReactNode; icon?: ReactNode; tone?: string }) {
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

export function Panel({ title, children, wide, right }: { title: ReactNode; children: ReactNode; wide?: boolean; right?: ReactNode }) {
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

export const Nothing = ({ what }: { what: string }) => <p className="faint sbp-nothing">{what}</p>

/** Small tile with a picture: collections, minions, missing accessories, museum… */
export function Tile({
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
  ['networth', 'Networth', 'EMERALD'],
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
  ['coop', 'Co-op', 'CAKE'],
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
export function levelColor(l: number): string {
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

/** A SkyBlock profile page (yours or anyone's), like SkyCrypt inside Orbit. */
export default function SkyblockProfile({ page, onChoose, onShare }: { page: SbProfilePage; onChoose: (profileId: string) => void; onShare: () => void }) {
  const [section, setSection] = useState<Section>('overview')
  const view = page.view
  const shown = SECTIONS.filter(([id]) => id !== 'coop' || (view.coop?.length ?? 0) > 1)
  return (
    <div className="sbp" data-sbp>
      <ItemTip />
      <Detail mine={page.mine} />
      <Hero page={page} go={setSection} onChoose={onChoose} onShare={onShare} />
      <div className="sbp-layout">
        <nav className="sbp-nav">
          {shown.map(([id, name, icon]) => (
            <button key={id} className={section === id ? 'active' : ''} onClick={() => setSection(id)} data-sbp-section={id}>
              <ItemPic id={icon} name={name} size={20} />
              <span>{name}</span>
            </button>
          ))}
        </nav>
        <SectionGuard key={section}>
          <div className="sbp-body">
            {section === 'overview' && <Overview v={view} go={setSection} />}
            {section === 'networth' && <NetworthSection v={view} />}
            {section === 'coop' && <Coop v={view} />}
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
        </SectionGuard>
      </div>
    </div>
  )
}

function Hero({ page, go, onChoose, onShare }: { page: SbProfilePage; go: (s: Section) => void; onChoose: (profileId: string) => void; onShare: () => void }) {
  const v = page.view
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open])
  const lvl = v.skyblockLevel.level
  const mp = v.accessories ? (v.accessories.highestMagicalPower ?? v.accessories.magicalPower) : null
  const name = page.player.name || v.player?.name || 'You'
  const skin = page.player.skin || v.player?.skin
  return (
    <header className="sbp-hero" style={{ '--lvl': levelColor(lvl) } as CSSProperties}>
      <div className="sbp-hero-head">{skin ? <Head skin={skin} size={84} /> : <ItemPic id="SKULL_ITEM-3" name="Steve" size={84} />}</div>
      <div className="sbp-hero-main">
        <div className="sbp-hero-name">
          <Ring progress={v.skyblockLevel.progress} size={46}>
            <b className="sbp-hero-lvl">{lvl}</b>
          </Ring>
          <div>
            <h3>
              {name}
              {page.starred && <Star size={14} className="sbp-hero-star" fill="currentColor" />}
            </h3>
            <span className="sbp-hero-sub">
              <span className="sbp-switch">
                <button className="sbp-badge sbp-switch-btn" onClick={() => setOpen((o) => !o)} disabled={page.choices.length < 2} title="Switch profile" data-sbp-switch>
                  {v.profileName || 'Profile'}
                  {page.choices.length > 1 && <ChevronDown size={12} />}
                </button>
                {open && (
                  <>
                    <div className="sbp-switch-shield" onMouseDown={() => setOpen(false)} />
                    <div className="sbp-switch-menu" data-sbp-switch-menu>
                      {page.choices.map((c) => (
                        <button
                          key={c.id}
                          className={c.id === v.profileId ? 'active' : ''}
                          onClick={() => {
                            setOpen(false)
                            if (c.id !== v.profileId) onChoose(c.id)
                          }}
                          data-sbp-choice={c.name}
                        >
                          <b>{c.name}</b>
                          {c.mode && <span className={`sbp-badge mode-${c.mode}`}>{c.mode === 'ironman' && '♲ '}{MODE_NAMES[c.mode] ?? c.mode}</span>}
                          <span className="faint">
                            Level {c.level}
                            {c.members > 1 ? ` · co-op of ${c.members}` : ''}
                            {c.selected ? ' · on now' : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </span>
              {v.mode && <span className={`sbp-badge mode-${v.mode}`}>{v.mode === 'ironman' && '♲ '}{MODE_NAMES[v.mode] ?? v.mode}</span>}
              {v.coopMembers > 1 && (
                <button className="sbp-badge sbp-badge-btn" onClick={() => go('coop')}>
                  Co-op of {v.coopMembers}
                </button>
              )}
              <span className="faint">checked {new Date(v.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </span>
          </div>
          <button className="btn sbp-hero-share" onClick={onShare} title="Make a picture of this profile to share" data-sbp-share>
            <Share2 size={13} /> Share card
          </button>
        </div>
        <div className="sbp-hero-chips">
          {v.networth && (
            <button className="sbp-chip-btn" onClick={() => go('networth')}>
              <Chip label="Networth" value={shortNumber(v.networth.total)} icon={<ItemPic id="EMERALD" size={22} />} tone="#8fe3ff" />
            </button>
          )}
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

const SECTION_ICONS: Record<string, string> = {
  armor: 'DIAMOND_CHESTPLATE',
  wardrobe: 'ARMOR_STAND',
  inventory: 'CHEST',
  ender: 'ENDER_CHEST',
  backpacks: 'LARGE_BACKPACK',
  vault: 'IRON_CHEST',
  bags: 'LARGE_FISHING_BAG',
  sacks: 'LARGE_ENCHANTED_MINING_SACK',
  accessories: 'HEGEMONY_ARTIFACT',
  pets: 'BEE;4',
  museum: 'ITEM_FRAME'
}

function NetworthSection({ v }: { v: SbProfileView }) {
  const [open, setOpen] = useState<string | null>(null)
  const nw = v.networth
  if (!nw) return <Nothing what="Orbit is still fetching item prices. Networth shows up here in a moment." />
  const most = Math.max(1, ...nw.sections.map((s) => s.value), nw.coins)
  const top = nw.sections
    .flatMap((s) => s.items)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12)
  return (
    <div className="sbp-panels">
      <Panel
        title="Networth"
        wide
        right={<span className="faint">prices from {nw.pricesAt ? new Date(nw.pricesAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'earlier'}</span>}
      >
        <div className="sbp-nw-total" data-sbp-networth>
          <b>{fmt(nw.total)}</b>
          <span className="faint">coins · {shortNumber(nw.total)}</span>
        </div>
        <p className="faint sbp-hint">
          Items are valued at their lowest Auction House BIN or Bazaar price{v.mode === 'ironman' ? ', even on Ironman where you can’t sell them' : ''}.
          {nw.unpriced > 0 && ` ${fmt(nw.unpriced)} item${nw.unpriced === 1 ? ' has' : 's have'} no price and ${nw.unpriced === 1 ? 'isn’t' : 'aren’t'} counted.`}
        </p>
        <div className="sbp-nw-rows">
          <div className="sbp-nw-row">
            <ItemPic id="GOLD_INGOT" size={22} />
            <span>Purse and bank</span>
            <Bar progress={nw.coins / most} color="#fcc419" />
            <b>{shortNumber(nw.coins)}</b>
          </div>
          {nw.sections
            .filter((s) => s.value > 0)
            .sort((a, b) => b.value - a.value)
            .map((s) => (
              <div key={s.id} className="sbp-nw-group">
                <button className="sbp-nw-row" onClick={() => setOpen(open === s.id ? null : s.id)} data-sbp-nw-section={s.id}>
                  <ItemPic id={SECTION_ICONS[s.id] ?? 'CHEST'} size={22} />
                  <span>{s.name}</span>
                  <Bar progress={s.value / most} color="#8fe3ff" />
                  <b>{shortNumber(s.value)}</b>
                </button>
                {open === s.id && (
                  <div className="sbp-nw-items">
                    {[...s.items]
                      .sort((a, b) => b.value - a.value)
                      .slice(0, 40)
                      .map((it, i) => (
                        <div key={i} className="sbp-nw-item">
                          <ItemPic id={it.id} name={it.name} size={20} />
                          <span>
                            {it.name}
                            {it.count > 1 && <span className="faint"> ×{fmt(it.count)}</span>}
                          </span>
                          <b>{shortNumber(it.value)}</b>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ))}
        </div>
      </Panel>
      <Panel title="Most valuable" wide>
        <div className="sbp-nw-top">
          {top.map((it, i) => (
            <div key={i} className="sbp-nw-card">
              <ItemPic id={it.id} name={it.name} size={36} />
              <span>{it.name}</span>
              <b>{shortNumber(it.value)}</b>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function Coop({ v }: { v: SbProfileView }) {
  const members = v.coop ?? []
  const [sort, setSort] = useState<string | null>(null)
  const names = useMemo(() => {
    const m = new Map<string, string>()
    for (const g of v.collections ?? []) for (const c of g.items) m.set(c.id, c.name)
    return m
  }, [v.collections])
  const ids = useMemo(() => {
    const total = new Map<string, number>()
    for (const mem of members) for (const [id, n] of Object.entries(mem.collections)) total.set(id, (total.get(id) ?? 0) + n)
    return [...total].sort((a, b) => b[1] - a[1]).map(([id]) => id)
  }, [members])
  if (members.length < 2) return <Nothing what="This profile isn’t a co-op." />
  const shownIds = sort ? [sort, ...ids.filter((i) => i !== sort)] : ids
  return (
    <div className="sbp-panels">
      <Panel title={`Co-op of ${members.length}`} wide>
        <div className="sbp-coop-members">
          {members.map((m) => (
            <div key={m.uuid} className={`sbp-coop-member ${m.you ? 'you' : ''}`} data-sbp-coop={m.name || m.uuid}>
              <b>{m.name || 'Loading name…'}</b>
              {m.you && <span className="sbp-badge">This player</span>}
              <span className="faint">
                Level {m.skyblockLevel} · {m.minionTiers} minion tiers
              </span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Who collected what" wide right={<span className="faint">click a row to put it first</span>}>
        <div className="sbp-coop-table">
          <div className="sbp-coop-row head">
            <span>Collection</span>
            {members.map((m) => (
              <span key={m.uuid}>{m.name || '…'}</span>
            ))}
          </div>
          {shownIds.slice(0, 60).map((id) => {
            const total = members.reduce((a, m) => a + (m.collections[id] ?? 0), 0) || 1
            return (
              <button key={id} className="sbp-coop-row" onClick={() => setSort(id)}>
                <span className="sbp-coop-name">
                  <ItemPic id={id} size={18} /> {names.get(id) ?? id.toLowerCase().replace(/_/g, ' ')}
                </span>
                {members.map((m) => {
                  const n = m.collections[id] ?? 0
                  return (
                    <span key={m.uuid} className="sbp-coop-cell">
                      <Bar progress={n / total} color={m.you ? '#8fe3ff' : '#b4a2ff'} />
                      <small>{shortNumber(n)}</small>
                    </span>
                  )
                })}
              </button>
            )
          })}
        </div>
      </Panel>
    </div>
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

/** Keeps one section's mistake (say, from profile data saved by an older Orbit) from blanking the whole app. */
class SectionGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  componentDidCatch(err: unknown): void {
    console.error('SkyBlock profile section', err)
  }
  render(): ReactNode {
    if (this.state.failed) return <Nothing what="This part of your profile couldn’t be shown. Press Refresh at the top to read your profile again." />
    return this.props.children
  }
}

type ItemSet = { slot: number; pieces: (SbViewItem | null)[] }
const petKey = (uuid: string): string => uuid.replace(/-/g, '').toLowerCase()

/** One row of saved sets (wardrobe or Equipment Wardrobe); hovering one shows it on the character. */
function SetRow({ sets, on, picked, pick, what }: { sets: ItemSet[]; on: number | null; picked: number | null; pick: (slot: number) => void; what: string }) {
  if (!sets.length) return <Nothing what={`${what} is empty.`} />
  return (
    <div className="sbp-wardrobe">
      {sets.map((w) => (
        <div
          key={w.slot}
          className={`sbp-wardrobe-set ${on === w.slot ? 'on' : ''} ${picked === w.slot ? 'picked' : ''}`}
          onMouseEnter={() => pick(w.slot)}
          data-sbp-wardrobe={w.slot}
        >
          <span className="sbp-wardrobe-num">{on === w.slot ? 'On' : w.slot}</span>
          {w.pieces.map((p, i) => (
            <Slot key={i} item={p} size={40} />
          ))}
        </div>
      ))}
    </div>
  )
}

function Gear({ v }: { v: SbProfileView }) {
  // What the character shows: an armour set, an equipment set, or both from a loadout.
  const [preview, setPreview] = useState<{ armor?: number | null; equip?: number | null; label: string } | null>(null)
  if (!v.gear) return <Nothing what="Turn on the Inventory API to see your gear." />
  // Profiles saved by an older Orbit have no loadouts or equipment sets until the next Refresh.
  const g = {
    ...v.gear,
    wardrobe: v.gear.wardrobe ?? [],
    equipmentSets: v.gear.equipmentSets ?? [],
    equipmentEquipped: v.gear.equipmentEquipped ?? null,
    loadouts: v.gear.loadouts ?? []
  }
  const tools = [...g.inventory, ...g.enderChest].filter((it): it is SbViewItem => !!it && TOOL_RE.test(plain(it.lore[it.lore.length - 1] ?? '')))
  const armorSet = (n: number | null | undefined): ItemSet | undefined => (n ? g.wardrobe.find((w) => w.slot === n) : undefined)
  const equipSet = (n: number | null | undefined): ItemSet | undefined => (n ? g.equipmentSets.find((w) => w.slot === n) : undefined)
  const shownArmor = armorSet(preview?.armor)?.pieces ?? g.armor
  const shownEquip = equipSet(preview?.equip)?.pieces ?? g.equipment
  const pets = new Map(v.pets.filter((p) => p.uuid).map((p) => [petKey(p.uuid!), p]))
  const back = preview && (
    <button className="link-btn" onClick={() => setPreview(null)}>
      Show what I’m wearing
    </button>
  )
  return (
    <div className="sbp-panels">
      <Panel title="Your character">
        <div className="sbp-paperdoll">
          <div className="sbp-paperdoll-col">
            {shownArmor.map((it, i) => (
              <Slot key={i} item={it} size={52} />
            ))}
          </div>
          <div className="sbp-paperdoll-me">{v.player?.skin ? <Head skin={v.player.skin} size={96} /> : <ItemPic id="SKULL_ITEM-3" size={96} />}</div>
          <div className="sbp-paperdoll-col">
            {shownEquip.map((it, i) => (
              <Slot key={i} item={it} size={52} />
            ))}
          </div>
        </div>
        <p className="faint sbp-hint">{preview ? `Showing ${preview.label}.` : 'Click any item to see it in full, or to add it as a goal.'}</p>
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
      {g.loadouts.length > 0 && (
        <Panel title={`Loadouts (${g.loadouts.length})`} wide right={back}>
          <div className="sbp-loadouts">
            {g.loadouts.map((l) => {
              const pet = l.pet ? pets.get(petKey(l.pet)) : undefined
              const a = armorSet(l.armorSet)
              const e = equipSet(l.equipmentSet)
              return (
                <div
                  key={l.slot}
                  className={`sbp-loadout ${preview?.label === plain(l.name) ? 'picked' : ''}`}
                  onMouseEnter={() => setPreview({ armor: l.armorSet, equip: l.equipmentSet, label: plain(l.name) })}
                  data-sbp-loadout={l.slot}
                >
                  <strong>
                    <McText text={l.name} />
                  </strong>
                  <div className="sbp-loadout-items">
                    {(a?.pieces ?? [null, null, null, null]).map((p, i) => (
                      <Slot key={`a${i}`} item={p} size={32} />
                    ))}
                    {(e?.pieces ?? [null, null, null, null]).map((p, i) => (
                      <Slot key={`e${i}`} item={p} size={32} />
                    ))}
                  </div>
                  <small className="faint">
                    {[
                      l.armorSet ? `Armour set ${l.armorSet}` : 'Armour as worn',
                      l.equipmentSet ? `equipment set ${l.equipmentSet}` : '',
                      pet ? `${pet.name} pet` : l.pet ? 'a pet' : '',
                      l.power ? `${l.power} power` : ''
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </div>
              )
            })}
          </div>
        </Panel>
      )}
      <GearStats armor={shownArmor} equipment={shownEquip} accessories={v.accessories?.items ?? []} label={preview?.label} />
      {g.loadouts.length + g.wardrobe.length > 1 && <CompareSets g={g} />}
      <Panel title={`Wardrobe (${g.wardrobe.length})`} wide right={!g.loadouts.length && back}>
        <SetRow
          sets={g.wardrobe}
          on={g.wardrobeEquipped}
          picked={preview?.armor ?? null}
          pick={(slot) => setPreview({ armor: slot, equip: preview?.equip, label: `wardrobe set ${slot}` })}
          what="Wardrobe"
        />
      </Panel>
      {(g.equipmentSets.length > 0 || g.loadouts.length > 0) && (
        <Panel title={`Equipment wardrobe (${g.equipmentSets.length})`} wide>
          <SetRow
            sets={g.equipmentSets}
            on={g.equipmentEquipped}
            picked={preview?.equip ?? null}
            pick={(slot) => setPreview({ armor: preview?.armor, equip: slot, label: `equipment set ${slot}` })}
            what="Equipment wardrobe"
          />
        </Panel>
      )}
    </div>
  )
}

/** Every stat from the armour, equipment and accessories (as their descriptions give it), and where it comes from. */
function GearStats({ armor, equipment, accessories, label }: { armor: (SbViewItem | null)[]; equipment: (SbViewItem | null)[]; accessories: SbViewItem[]; label?: string }) {
  const [open, setOpen] = useState<string | null>(null)
  const lines = useMemo(
    () =>
      statBreakdown([
        { source: 'Armour', items: armor },
        { source: 'Equipment', items: equipment },
        { source: 'Accessories', items: accessories }
      ]),
    [armor, equipment, accessories]
  )
  return (
    <Panel title="Stats from your gear" wide right={<span className="faint">{label ? `with ${label}` : 'as worn'}</span>}>
      {lines.length ? (
        <div className="sbp-stats-grid" data-sbp-stats>
          {lines.map((l) => (
            <button key={l.stat} className={`sbp-stat ${open === l.stat ? 'open' : ''}`} onClick={() => setOpen(open === l.stat ? null : l.stat)}>
              <span className="sbp-stat-name">{l.stat}</span>
              <b>
                {l.total > 0 ? '+' : ''}
                {fmt(l.total)}
              </b>
              <span className="sbp-stat-split">
                {l.from.map((f) => (
                  <span
                    key={f.source}
                    className={`sbp-stat-src src-${f.source.toLowerCase()}`}
                    style={{ flexGrow: Math.max(1, Math.abs(f.value)) }}
                    title={`${f.source}: ${fmt(f.value)}`}
                  />
                ))}
              </span>
              {open === l.stat && (
                <span className="sbp-stat-items">
                  {l.from.flatMap((f) =>
                    f.items
                      .sort((a, b) => b.value - a.value)
                      .slice(0, 8)
                      .map((it, i) => (
                        <small key={`${f.source}${i}`}>
                          <span className="faint">{f.source}</span> {it.name} <b>{fmt(it.value)}</b>
                        </small>
                      ))
                  )}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <Nothing what="No stats found on your gear." />
      )}
      <p className="faint sbp-hint">Added up from each item’s description, so reforges, enchants and gemstones are in. Skills, pets and potions aren’t.</p>
    </Panel>
  )
}

type GearSets = {
  wardrobe: ItemSet[]
  equipmentSets: ItemSet[]
  loadouts: NonNullable<NonNullable<SbProfileView['gear']>['loadouts']>
  armor: (SbViewItem | null)[]
  equipment: (SbViewItem | null)[]
}

/** Two loadouts or wardrobe sets side by side, stat by stat. */
function CompareSets({ g }: { g: GearSets }) {
  const options = useMemo(() => {
    const out: { key: string; label: string; items: (SbViewItem | null)[] }[] = [{ key: 'worn', label: 'What you’re wearing', items: [...g.armor, ...g.equipment] }]
    for (const l of g.loadouts) {
      const a = g.wardrobe.find((w) => w.slot === l.armorSet)?.pieces ?? g.armor
      const e = g.equipmentSets.find((w) => w.slot === l.equipmentSet)?.pieces ?? g.equipment
      out.push({ key: `l${l.slot}`, label: `Loadout: ${plain(l.name)}`, items: [...a, ...e] })
    }
    for (const w of g.wardrobe) out.push({ key: `w${w.slot}`, label: `Wardrobe set ${w.slot}`, items: w.pieces })
    return out
  }, [g])
  const [a, setA] = useState(options[0]?.key ?? '')
  const [b, setB] = useState(options[1]?.key ?? '')
  const left = options.find((o) => o.key === a)
  const right = options.find((o) => o.key === b)
  const rows = useMemo(() => {
    const ls = statBreakdown([{ source: 'A', items: left?.items ?? [] }])
    const rs = statBreakdown([{ source: 'B', items: right?.items ?? [] }])
    const stats = [...new Set([...ls.map((l) => l.stat), ...rs.map((l) => l.stat)])]
    return stats.map((stat) => ({ stat, a: ls.find((l) => l.stat === stat)?.total ?? 0, b: rs.find((l) => l.stat === stat)?.total ?? 0 }))
  }, [left, right])
  const pickBox = (value: string, set: (k: string) => void, name: string) => (
    <select value={value} onChange={(e) => set(e.target.value)} data-sbp-compare={name}>
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  )
  return (
    <Panel title="Compare sets" wide>
      <div className="sbp-compare-pick">
        {pickBox(a, setA, 'a')}
        <span className="faint">against</span>
        {pickBox(b, setB, 'b')}
      </div>
      <div className="sbp-compare-sets">
        <div className="sbp-loadout-items">
          {left?.items.map((p, i) => (
            <Slot key={i} item={p} size={36} />
          ))}
        </div>
        <div className="sbp-loadout-items">
          {right?.items.map((p, i) => (
            <Slot key={i} item={p} size={36} />
          ))}
        </div>
      </div>
      <div className="sbp-compare-table">
        {rows.map((r) => {
          const d = r.b - r.a
          return (
            <div key={r.stat} className="sbp-compare-row">
              <span>{r.stat}</span>
              <b>{fmt(r.a)}</b>
              <b>{fmt(r.b)}</b>
              <span className={d > 0 ? 'up' : d < 0 ? 'down' : 'faint'}>{d === 0 ? 'same' : `${d > 0 ? '+' : ''}${fmt(d)}`}</span>
            </div>
          )
        })}
      </div>
    </Panel>
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

const statValue = (key: string, value: number): string => (/time|_ms$/.test(key) && value > 60_000 ? describeMinutes(value / 60_000) : fmt(value))

function Stats({ v }: { v: SbProfileView }) {
  const [q, setQ] = useState('')
  const groups = useMemo(() => groupStats(v.stats), [v.stats])
  const list = useMemo(() => (q ? v.stats.filter((s) => s.key.toLowerCase().includes(q.toLowerCase().trim().replace(/\s+/g, '_'))) : []), [v.stats, q])
  const nice = (k: string): string => k.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  return (
    <div className="sbp-stats">
      <div className="games-search sbp-filter">
        <Search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find in ${v.stats.length} stats`} spellCheck={false} data-sbp-stats-search />
      </div>
      {q ? (
        <table className="sbp-table">
          <tbody>
            {list.slice(0, 400).map((s) => (
              <tr key={s.key}>
                <td>{nice(s.key)}</td>
                <td className="num">{statValue(s.key, s.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="sbp-panels">
          {groups.map((g) => (
            <StatGroupPanel key={g.id} g={g} />
          ))}
        </div>
      )}
    </div>
  )
}

/** One group of stats: its lines (the first dozen until you ask for more) and any per-festival tables. */
function StatGroupPanel({ g }: { g: StatGroup }) {
  const [all, setAll] = useState(false)
  const [allRows, setAllRows] = useState<Record<string, boolean>>({})
  const rows = all ? g.rows : g.rows.slice(0, 12)
  const wide = g.series.length > 0 || g.rows.length > 12
  return (
    <Panel title={g.name} wide={wide} right={<span className="faint">{g.rows.length + g.series.reduce((a, s) => a + s.rows.length, 0)}</span>}>
      {rows.length > 0 && (
        <div className={`sbp-stat-lines ${wide ? 'cols' : ''}`} data-sbp-stat-group={g.id}>
          {rows.map((r) => (
            <div key={r.key} className="sbp-stat-line">
              <span>{r.label}</span>
              <b>{statValue(r.key, r.value)}</b>
            </div>
          ))}
        </div>
      )}
      {g.rows.length > 12 && (
        <button className="link-btn" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${g.rows.length}`}
        </button>
      )}
      {g.series.map((ser) => {
        const open = allRows[ser.name]
        const shown = open ? ser.rows : ser.rows.slice(0, 5)
        const totalCol = ser.columns.indexOf('Total')
        const best = totalCol >= 0 ? ser.rows.reduce<(typeof ser.rows)[number] | null>((b, r) => ((r.values[totalCol] ?? 0) > (b?.values[totalCol] ?? -1) ? r : b), null) : null
        return (
          <div key={ser.name} className="sbp-series" data-sbp-series={ser.name}>
            <h5>
              {ser.name} <span className="faint">· {ser.rows.length} times</span>
              {best && (
                <span className="faint">
                  {' '}
                  · best was {ser.name} {best.label} with {fmt(best.values[totalCol] ?? 0)}
                </span>
              )}
            </h5>
            <table className="sbp-table sbp-series-table">
              <thead>
                <tr>
                  <th>{ser.name}</th>
                  {ser.columns.map((c) => (
                    <th key={c} className="num">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.label} className={r === best ? 'best' : ''}>
                    <td>{r.label}</td>
                    {r.values.map((x, i) => (
                      <td key={i} className="num">
                        {x === null ? '—' : fmt(x)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {ser.rows.length > 5 && (
              <button className="link-btn" onClick={() => setAllRows({ ...allRows, [ser.name]: !open })}>
                {open ? 'Show the latest 5' : `Show all ${ser.rows.length}`}
              </button>
            )}
          </div>
        )
      })}
    </Panel>
  )
}
