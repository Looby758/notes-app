import { useMemo, useState } from 'react'
import { Dices, MapPin, Shield, Swords, Tent, X } from 'lucide-react'
import {
  BUILDING_LABEL,
  DECIDE_STYLES,
  GROUP_COLORS,
  LESSONS,
  SKILLS,
  SUPPLY_KEYS,
  SUPPLY_LABEL,
  TRAITS,
  WEAPONS,
  campOf,
  clockText,
  dayOf,
  doingText,
  giveOrder,
  groupById,
  healthText,
  membersOf,
  mindText,
  personById,
  randomPeople,
  randomPerson,
  takenNames,
  type Group,
  type GroupDraft,
  type OrderKind,
  type Person,
  type PersonDraft,
  type SurvivalWorld,
  type Trait
} from '@shared/survival'
import { Slider, Toggle } from './Panels'
import type { Selection } from './SurvivalView'

const first = (name: string): string => name.split(' ')[0]

function Bar({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  // `bad` bars are good when low (hunger, thirst, tiredness).
  const v = Math.max(0, Math.min(100, value))
  const level = bad ? v : 100 - v
  const color = level > 70 ? '#f87171' : level > 45 ? '#f6ad55' : '#4fd1a5'
  return (
    <div className="sv-bar" title={`${label}: ${Math.round(v)}/100`}>
      <span>{label}</span>
      <i>
        <b style={{ width: `${v}%`, background: color }} />
      </i>
    </div>
  )
}

export function when(tick: number): string {
  return `Day ${dayOf(tick)}, ${clockText(tick)}`
}

// ---------- creating a group ----------

export type PeopleKind = 'group' | 'loner' | 'raiders'

export interface Creator {
  kind: PeopleKind
  draft: GroupDraft
}

export function newCreator(w: SurvivalWorld, kind: PeopleKind): Creator {
  const n = kind === 'loner' ? 1 : kind === 'raiders' ? 4 : 4
  const people = randomPeople(w, n)
  const used = new Set(w.groups.map((g) => g.color))
  const color = kind === 'raiders' ? '#fc8181' : (GROUP_COLORS.find((c) => !used.has(c) && c !== '#fc8181') ?? GROUP_COLORS[w.groups.length % GROUP_COLORS.length])
  const name = kind === 'loner' ? `${first(people[0].name)} (on their own)` : kind === 'raiders' ? 'Highway raiders' : `${people[0].name.split(' ')[1]}'s group`
  if (kind === 'raiders') for (const p of people) if (!p.traits.includes('hothead') && Math.random() < 0.5) p.traits = ['hothead', p.traits[0] === 'kind' ? 'selfish' : p.traits[0]]
  return { kind, draft: { name, color, people, hostile: kind === 'raiders', ask: false } }
}

function PersonEditor({ p, onChange, onRemove }: { p: PersonDraft; onChange: (p: PersonDraft) => void; onRemove?: () => void }) {
  const [open, setOpen] = useState(false)
  const toggleTrait = (t: Trait): void => {
    const has = p.traits.includes(t)
    onChange({ ...p, traits: has ? p.traits.filter((x) => x !== t) : [...p.traits, t].slice(-3) })
  }
  return (
    <div className="sv-draft">
      <div className="sv-draft-top">
        <input className="text-input" value={p.name} onChange={(e) => onChange({ ...p, name: e.target.value })} aria-label="Name" />
        <input className="text-input sv-age" type="number" min={6} max={90} value={p.age} onChange={(e) => onChange({ ...p, age: Math.max(6, Math.min(90, Number(e.target.value) || 30)) })} aria-label="Age" />
        <button className="icon-btn" onClick={() => setOpen(!open)} title="Edit personality and skills">
          {open ? '−' : '+'}
        </button>
        {onRemove && (
          <button className="icon-btn" onClick={onRemove} title="Remove">
            <X size={13} />
          </button>
        )}
      </div>
      <p className="muted">
        {p.traits.map((t) => TRAITS.find((x) => x.id === t)?.label).join(', ')} · {WEAPONS.find((x) => x.id === p.weapon)?.label} · best at{' '}
        {SKILLS.reduce((a, b) => (p.skills[b.id] > p.skills[a.id] ? b : a)).label.toLowerCase()}
      </p>
      {open && (
        <div className="sv-draft-more">
          <div className="evo-chips">
            {TRAITS.map((t) => (
              <button key={t.id} className={`evo-chip ${p.traits.includes(t.id) ? 'on' : ''}`} onClick={() => toggleTrait(t.id)} title={t.hint}>
                {t.label}
              </button>
            ))}
          </div>
          <select className="text-input" value={p.weapon} onChange={(e) => onChange({ ...p, weapon: e.target.value as PersonDraft['weapon'] })} aria-label="Weapon">
            {WEAPONS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
          {SKILLS.map((s) => (
            <Slider key={s.id} label={s.label} value={p.skills[s.id]} min={0} max={10} step={1} onChange={(v) => onChange({ ...p, skills: { ...p.skills, [s.id]: v } })} />
          ))}
        </div>
      )}
    </div>
  )
}

export function CreatorPanel({ world, creator, setCreator }: { world: SurvivalWorld; creator: Creator; setCreator: (c: Creator) => void }) {
  const d = creator.draft
  const set = (patch: Partial<GroupDraft>): void => setCreator({ ...creator, draft: { ...d, ...patch } })
  const resize = (n: number): void => {
    const people = d.people.slice(0, n)
    const taken = [...takenNames(world), ...people.map((p) => p.name)]
    while (people.length < n) {
      const p = randomPerson({ rng: (Math.random() * 2 ** 31) | 0 }, taken)
      taken.push(p.name)
      people.push(p)
    }
    set({ people })
  }
  return (
    <div className="evo-panel-body">
      <div className="evo-chips">
        {(
          [
            ['group', 'Survivor group'],
            ['loner', 'Lone survivor'],
            ['raiders', 'Raiders']
          ] as [PeopleKind, string][]
        ).map(([k, label]) => (
          <button key={k} className={`evo-chip ${creator.kind === k ? 'on' : ''}`} onClick={() => setCreator(newCreator(world, k))}>
            {label}
          </button>
        ))}
      </div>
      <p className="sv-callout">
        <MapPin size={14} /> Click anywhere on the map to put {d.people.length === 1 ? 'them' : 'this group'} there.
      </p>
      <div className="evo-species-top">
        <input type="color" value={d.color} onChange={(e) => set({ color: e.target.value })} aria-label="Colour" />
        <input className="text-input" value={d.name} onChange={(e) => set({ name: e.target.value })} aria-label="Group name" />
      </div>
      {creator.kind !== 'loner' && <Slider label="How many people" value={d.people.length} min={1} max={12} step={1} onChange={resize} />}
      <div className="sv-row">
        <select className="text-input" value={d.decide ?? 'leader'} onChange={(e) => set({ decide: e.target.value as GroupDraft['decide'] })} aria-label="How they decide">
          {DECIDE_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => set({ people: randomPeople({ ...world, rng: (Math.random() * 2 ** 31) | 0 }, d.people.length) })}>
          <Dices size={13} /> New random people
        </button>
      </div>
      {!d.hostile && <Toggle label="Ask me before big choices" hint="Bites, meeting strangers, where to make camp, being robbed" on={!!d.ask} onChange={(v) => set({ ask: v })} />}
      <div className="evo-sub">People</div>
      {d.people.map((p, i) => (
        <PersonEditor
          key={i}
          p={p}
          onChange={(np) => set({ people: d.people.map((x, j) => (j === i ? np : x)) })}
          onRemove={d.people.length > 1 ? () => set({ people: d.people.filter((_, j) => j !== i) }) : undefined}
        />
      ))}
    </div>
  )
}

// ---------- groups and people ----------

export function GroupList({ world, onSelect }: { world: SurvivalWorld; onSelect: (s: Selection) => void }) {
  const groups = world.groups.filter((g) => g.alive)
  if (!groups.length) return <p className="evo-hint">No one's out there yet. Use the People tool on the left to put a group on the map.</p>
  return (
    <div className="sv-groups">
      {groups.map((g) => {
        const ms = membersOf(world, g)
        const camp = campOf(world, g)
        return (
          <button key={g.id} className="sv-group-row" onClick={() => onSelect({ kind: 'group', id: g.id })} data-sv-group={g.name}>
            <i style={{ background: g.color }} />
            <span>
              <b>{g.name}</b>
              <em>
                {ms.length} {ms.length === 1 ? 'person' : 'people'} · {camp ? camp.name : 'no camp yet'}
                {g.hostile ? ' · raiders' : ''}
              </em>
            </span>
          </button>
        )
      })}
      {world.fallen.length > 0 && <p className="muted">{world.fallen.length} dead so far.</p>}
    </div>
  )
}

const ORDERS: { kind: OrderKind; label: string; pick?: 'building' | 'spot'; hint: string }[] = [
  { kind: 'stay', label: 'Stay in today', hint: 'Nobody goes out' },
  { kind: 'fortify', label: 'Barricade camp', hint: 'Everyone works on the walls (needs materials)' },
  { kind: 'hunt', label: 'Go hunting', hint: 'Two of them hunt in the nearest woods' },
  { kind: 'water', label: 'Fetch water', hint: 'From the creek, if they know where it is' },
  { kind: 'scavenge', label: 'Search a building…', pick: 'building', hint: 'Then click a building on the map' },
  { kind: 'explore', label: 'Scout a spot…', pick: 'spot', hint: 'Then click anywhere on the map' },
  { kind: 'move', label: 'Move camp…', pick: 'building', hint: 'Then click the building they should move to' }
]

export function GroupCard({
  world,
  g,
  onSelect,
  onPickOrder,
  picking,
  onChanged
}: {
  world: SurvivalWorld
  g: Group
  onSelect: (s: Selection) => void
  onPickOrder: (o: OrderKind | null) => void
  picking: OrderKind | null
  onChanged: () => void
}) {
  const ms = membersOf(world, g)
  const camp = campOf(world, g)
  const lead = personById(world, g.leader ?? -1)
  const n = Math.max(1, ms.length)
  const logs = useMemo(() => world.log.filter((l) => l.group === g.id).slice(-60).reverse(), [world.log.length, g.id, world.log])
  return (
    <div className="evo-panel-body" data-sv-group-card>
      <div className="evo-card">
        <div className="evo-card-head">
          <h4>
            <i className="evo-dot" style={{ background: g.color }} /> {g.name}
          </h4>
          <button className="icon-btn" onClick={() => onSelect(null)} title="Close">
            <X size={14} />
          </button>
        </div>
        <p className="muted">
          {ms.length} {ms.length === 1 ? 'person' : 'people'} (most ever {g.peak}) · {DECIDE_STYLES.find((d) => d.id === g.decide)?.label}
          {lead && g.decide === 'leader' ? `: ${lead.name}` : ''}
          <br />
          {camp ? (
            <>
              <Tent size={11} /> Camp: {camp.name}, barricades {Math.round(camp.fort)}%
            </>
          ) : (
            'On the move, looking for somewhere to stay'
          )}
          {g.hostile && (
            <>
              <br />
              <Swords size={11} /> Raiders: they rob or attack anyone they meet
            </>
          )}
        </p>
        <div className="sv-stash">
          {SUPPLY_KEYS.map((k) => (
            <span key={k} title={SUPPLY_LABEL[k]}>
              <b>{g.stash[k]}</b> {k === 'parts' ? 'materials' : SUPPLY_LABEL[k]}
              {k === 'food' || k === 'water' ? <em> ({Math.floor(g.stash[k] / (n * 2))}d)</em> : null}
            </span>
          ))}
        </div>
        {!g.hostile && (
          <Toggle
            label="Ask me before big choices"
            hint="Bites, meeting strangers, where to make camp, being robbed"
            on={g.ask}
            onChange={(v) => {
              g.ask = v
              onChanged()
            }}
          />
        )}
      </div>

      <div className="evo-sub">Give an order</div>
      <div className="sv-orders">
        {ORDERS.map((o) => (
          <button
            key={o.kind}
            className={`evo-chip ${picking === o.kind ? 'on' : ''}`}
            title={o.hint}
            onClick={() => {
              if (o.pick) onPickOrder(picking === o.kind ? null : o.kind)
              else {
                giveOrder(world, g, { kind: o.kind })
                onChanged()
              }
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {picking && <p className="sv-callout">{ORDERS.find((o) => o.kind === picking)?.hint}.</p>}

      <div className="evo-sub">People</div>
      <div className="sv-people">
        {ms.map((p) => (
          <button key={p.id} className="sv-person-row" onClick={() => onSelect({ kind: 'person', id: p.id })}>
            <b>
              {p.name}
              {p.id === g.leader && g.decide === 'leader' ? ' ★' : ''}
            </b>
            <em>{doingText(world, p)}</em>
            <Bar label="" value={p.health} />
          </button>
        ))}
      </div>

      <div className="evo-sub">What they've learned</div>
      {g.lessons.length ? (
        <ul className="sv-lessons">
          {g.lessons.map((l) => (
            <li key={l.id} className={LESSONS[l.id].good ? 'good' : 'bad'}>
              <b>{LESSONS[l.id].title}</b>
              <span>{LESSONS[l.id].effect}</span>
              <em>
                {when(l.tick)}: {l.why}
              </em>
            </li>
          ))}
        </ul>
      ) : (
        <p className="evo-hint">Nothing yet. They'll learn from what happens to them, and not always the right thing.</p>
      )}

      <div className="evo-sub">Their story</div>
      <LogList lines={logs} world={world} />
    </div>
  )
}

export function PersonCard({ world, p, onSelect }: { world: SurvivalWorld; p: Person; onSelect: (s: Selection) => void }) {
  const g = groupById(world, p.group)
  const rels = Object.entries(p.rel)
    .map(([id, v]) => ({ q: personById(world, Number(id)), v }))
    .filter((r): r is { q: Person; v: number } => !!r.q)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .slice(0, 5)
  return (
    <div className="evo-panel-body" data-sv-person-card>
      <div className="evo-card">
        <div className="evo-card-head">
          <h4>
            <i className="evo-dot" style={{ background: g?.color }} /> {p.name}, {p.age}
          </h4>
          <button className="icon-btn" onClick={() => onSelect(g ? { kind: 'group', id: g.id } : null)} title="Back to the group">
            <X size={14} />
          </button>
        </div>
        <p className="muted">
          {g && (
            <button className="sv-link" onClick={() => onSelect({ kind: 'group', id: g.id })}>
              {g.name}
            </button>
          )}{' '}
          · {doingText(world, p)}
          <br />
          {p.traits.map((t) => TRAITS.find((x) => x.id === t)?.label).join(', ')} · {WEAPONS.find((x) => x.id === p.weapon)?.label}
          {WEAPONS.find((x) => x.id === p.weapon)?.gun ? ` (${p.ammo} rounds)` : ''} · {p.kills} walkers put down
        </p>
        <p className="sv-state">
          {healthText(p)} · {mindText(p)}
          {p.bitten && <span className="sv-bitten"> · Bitten on the {p.bitten.limb}</span>}
        </p>
        <Bar label="Health" value={p.health} />
        <Bar label="Hunger" value={p.hunger} bad />
        <Bar label="Thirst" value={p.thirst} bad />
        <Bar label="Tired" value={p.fatigue} bad />
        <Bar label="Morale" value={p.morale} />
      </div>
      <div className="evo-sub">Skills</div>
      <div className="sv-skills">
        {SKILLS.map((s) => (
          <span key={s.id}>
            {s.label} <b>{p.skills[s.id].toFixed(1)}</b>
          </span>
        ))}
      </div>
      {rels.length > 0 && (
        <>
          <div className="evo-sub">People in their life</div>
          <div className="sv-rels">
            {rels.map(({ q, v }) => (
              <button key={q.id} onClick={() => onSelect({ kind: 'person', id: q.id })}>
                {q.name} <em className={v > 40 ? 'good' : v < -10 ? 'bad' : ''}>{v > 60 ? 'very close' : v > 30 ? 'friends' : v > 0 ? 'gets on' : v > -30 ? 'tense' : 'can’t stand them'}</em>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="evo-sub">Their story</div>
      <ul className="evo-events sv-log">
        {[...p.log].reverse().map((l, i) => (
          <li key={i}>
            <span>{l.text}</span>
            <time>{when(l.tick)}</time>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function BuildingCard({ world, id, onSelect, fogGroup }: { world: SurvivalWorld; id: number; onSelect: (s: Selection) => void; fogGroup: number | null }) {
  const b = world.buildings.find((x) => x.id === id)
  if (!b) return null
  const owner = world.groups.find((g) => g.alive && g.camp === b.id)
  const fog = fogGroup != null ? groupById(world, fogGroup) : undefined
  const knows = fog?.known[b.id]
  return (
    <div className="evo-panel-body">
      <div className="evo-card">
        <div className="evo-card-head">
          <h4>{b.name}</h4>
          <button className="icon-btn" onClick={() => onSelect(null)} title="Close">
            <X size={14} />
          </button>
        </div>
        <p className="muted">
          {BUILDING_LABEL[b.kind]}
          {b.town ? ` in ${b.town}` : ' out in the country'}
          {owner ? ` · ${owner.name}'s camp` : ''}
          {b.fort > 0 ? ` · barricades ${Math.round(b.fort)}%` : ''}
        </p>
        <div className="evo-sub">What's really inside (only you can see this)</div>
        <div className="sv-stash">
          {SUPPLY_KEYS.map((k) => (
            <span key={k}>
              <b>{b.loot[k]}</b> {k === 'parts' ? 'materials' : SUPPLY_LABEL[k]}
            </span>
          ))}
        </div>
        {fog && (
          <p className="muted">
            {fog.name}: {knows ? (knows.loot ? `searched it ${when(knows.tick)}` : `know it's there, haven't searched it`) : "don't know it's here"}
          </p>
        )}
      </div>
    </div>
  )
}

// ---------- the story ----------

export function LogList({ lines, world }: { lines: SurvivalWorld['log']; world: SurvivalWorld }) {
  return (
    <ul className="evo-events sv-log">
      {lines.map((l, i) => {
        const g = l.group != null ? groupById(world, l.group) : undefined
        return (
          <li key={`${l.tick}-${i}`} className={l.big ? 'big' : ''}>
            <i style={{ background: g?.color ?? 'var(--text-faint)' }} />
            <span>{l.text}</span>
            <time>{when(l.tick)}</time>
          </li>
        )
      })}
    </ul>
  )
}

export function StoryPanel({ world }: { world: SurvivalWorld }) {
  const [bigOnly, setBigOnly] = useState(true)
  const lines = world.log.filter((l) => !bigOnly || l.big).slice(-200).reverse()
  return (
    <div className="evo-panel-body">
      <Toggle label="Only the big moments" on={bigOnly} onChange={setBigOnly} />
      <LogList lines={lines} world={world} />
      {world.fallen.length > 0 && (
        <>
          <div className="evo-sub">
            <Shield size={11} /> The dead
          </div>
          <ul className="evo-events sv-log">
            {[...world.fallen].reverse().map((f) => (
              <li key={f.id}>
                <span>
                  {f.name} ({f.groupName}) {f.cause}
                </span>
                <time>{when(f.tick)}</time>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
