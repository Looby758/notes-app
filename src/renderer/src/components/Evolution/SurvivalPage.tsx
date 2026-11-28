import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, Save, Footprints, History, Moon, MousePointer2, Package, Pause, Play, RotateCcw, Skull, Sparkles, StepForward, Sun, Users, Volume2 } from 'lucide-react'
import {
  answerDecision,
  buildingAt,
  clockText,
  darkness,
  dayOf,
  giveOrder,
  groupById,
  makeNoise,
  partOfDay,
  personById,
  quickStart,
  spawnGroup,
  spawnSupplies,
  spawnWalkers,
  type OrderKind,
  type SurvivalWorld
} from '@shared/survival'
import { SURVIVAL_SPEEDS, useSurvival } from './useSurvival'
import SurvivalView, { type Selection } from './SurvivalView'
import { BuildingCard, CreatorPanel, GroupCard, GroupList, PersonCard, StoryPanel, newCreator, when, type Creator } from './SurvivalPanels'
import { Slider, Toggle } from './Panels'
import SavesDialog from './SavesDialog'
import { AUTOSAVE, writeSave } from './saveFiles'

type Tool = 'select' | 'people' | 'walker' | 'herd' | 'supplies' | 'noise'
type PanelId = 'groups' | 'add' | 'story' | 'world'

const TOOLS: { id: Tool; label: string; hint: string; icon: typeof Users }[] = [
  { id: 'select', label: 'Look', hint: 'Click people, groups and buildings to see what’s going on. Drag to move, scroll to zoom.', icon: MousePointer2 },
  { id: 'people', label: 'People', hint: 'Put a survivor group, a lone survivor or raiders on the map', icon: Users },
  { id: 'walker', label: 'Walkers', hint: 'Drop a few walkers where you click', icon: Skull },
  { id: 'herd', label: 'Herd', hint: 'A herd of walkers that drifts across the land together', icon: Footprints },
  { id: 'supplies', label: 'Supplies', hint: 'A stash of food, water, ammo and medicine, for whoever finds it', icon: Package },
  { id: 'noise', label: 'Noise', hint: 'A loud noise, like a car alarm. Walkers nearby come to see.', icon: Volume2 }
]

const PANELS: { id: PanelId; label: string }[] = [
  { id: 'groups', label: 'Groups' },
  { id: 'add', label: 'Add' },
  { id: 'story', label: 'Story' },
  { id: 'world', label: 'World' }
]

/**
 * Survival mode: a walker outbreak a month in, outside Atlanta. Put people and walkers wherever you
 * like and watch the groups get by on their own, learning as they go.
 */
export default function SurvivalPage({ switcher }: { switcher: React.ReactNode }) {
  const sv = useSurvival()
  const w = sv.world.current
  const [tool, setTool] = useState<Tool>('select')
  const [panel, setPanel] = useState<PanelId>('groups')
  const [selection, setSelection] = useState<Selection>(null)
  const [creator, setCreator] = useState<Creator>(() => newCreator(w, 'group'))
  const [herdSize, setHerdSize] = useState(40)
  const [walkerCount, setWalkerCount] = useState(5)
  const [picking, setPicking] = useState<{ group: number; order: OrderKind } | null>(null)
  const [showFog, setShowFog] = useState(true)
  const [fitKey, setFitKey] = useState(0)
  const [focus, setFocus] = useState<{ x: number; y: number; n: number } | null>(null)
  const [savesOpen, setSavesOpen] = useState(false)
  const [lastSave, setLastSave] = useState<{ text: string; at: number } | null>(null)

  // Autosave every 5 minutes into one slot, whenever something has happened since the last one.
  const autoTick = useRef(-1)
  useEffect(() => {
    const timer = setInterval(() => {
      const world = sv.world.current
      if (world.tick === autoTick.current || (!world.groups.length && !world.walkers.length)) return
      autoTick.current = world.tick
      writeSave(AUTOSAVE, world, true)
        .then(() => setLastSave({ text: 'Autosaved', at: Date.now() }))
        .catch(() => setLastSave({ text: "Autosave failed", at: Date.now() }))
    }, 5 * 60 * 1000)
    return () => clearInterval(timer)
  }, [sv.world])

  // Whose fog of war is shown: the group you're looking at.
  const selGroupId = selection?.kind === 'group' ? selection.id : selection?.kind === 'person' ? personById(w, selection.id)?.group ?? null : null
  const selGroup = selGroupId != null ? groupById(w, selGroupId) : undefined
  const fogGroup = showFog && selGroup?.alive ? selGroup.id : null

  // A selected person who died: fall back to their group.
  useEffect(() => {
    if (selection?.kind === 'person' && !personById(w, selection.id)) {
      const f = w.fallen.find((x) => x.id === selection.id)
      setSelection(f && groupById(w, f.group)?.alive ? { kind: 'group', id: f.group } : null)
    }
    if (selection?.kind === 'group' && !groupById(w, selection.id)?.alive) setSelection(null)
  }, [sv.version, selection, w])

  // Space pauses.
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"]') || !document.querySelector('[data-sv-page]')) return
      if (e.key === ' ') {
        e.preventDefault()
        if (!w.pending.length) sv.setRunning(!sv.running)
      } else if (e.key === 'Escape') {
        setPicking(null)
        setTool('select')
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [sv, w])

  const select = (s: Selection): void => {
    setSelection(s)
    if (s) setPanel('groups')
  }

  const onPick = (x: number, y: number, hit: Selection): void => {
    const world = sv.world.current
    if (picking) {
      const g = groupById(world, picking.group)
      if (g) {
        if (picking.order === 'explore') giveOrder(world, g, { kind: 'explore', x, y })
        else {
          const b = buildingAt(world, x, y, 1)
          if (!b) return // Keep waiting for a click on a building.
          giveOrder(world, g, { kind: picking.order, building: b.id })
        }
      }
      setPicking(null)
      sv.refresh()
      return
    }
    switch (tool) {
      case 'select':
        if (hit?.kind === 'person' && selection?.kind === 'group' && personById(world, hit.id)?.group !== selection.id) select({ kind: 'group', id: personById(world, hit.id)!.group })
        else if (hit?.kind === 'person' && selection?.kind !== 'person' && selection?.kind !== 'group') select({ kind: 'group', id: personById(world, hit.id)!.group })
        else select(hit)
        return
      case 'people': {
        const g = spawnGroup(world, creator.draft, x, y)
        setCreator(newCreator(world, creator.kind))
        select({ kind: 'group', id: g.id })
        setTool('select')
        break
      }
      case 'walker':
        spawnWalkers(world, x, y, walkerCount, false)
        break
      case 'herd':
        spawnWalkers(world, x, y, herdSize, true)
        break
      case 'supplies':
        spawnSupplies(world, x, y)
        break
      case 'noise':
        makeNoise(world, x, y, 50)
        break
    }
    sv.refresh()
  }

  const people = w.people.length
  const groupsAlive = w.groups.filter((g) => g.alive).length
  const snaps = sv.snapshots.current
  const dark = darkness(w.tick)
  const decision = w.pending[0]

  // Pop-ups for the big moments.
  const [seenBig, setSeenBig] = useState(0)
  const toasts = useMemo(() => w.log.filter((l) => l.big && l.tick >= w.tick - 240).slice(-3), [w.log, w.tick, sv.version])
  const toastsShown = toasts.filter((l) => w.log.indexOf(l) >= seenBig)
  const pageRef = useRef<HTMLDivElement>(null)

  return (
    <div className="evo-page sv-page" data-evo-page data-sv-page ref={pageRef}>
      <header className="evo-bar">
        {switcher}
        <div className="evo-transport">
          <button
            className="evo-play"
            onClick={() => sv.setRunning(!sv.running)}
            disabled={!!decision}
            title={decision ? 'Answer the question first' : sv.running ? 'Pause (Space)' : 'Play (Space)'}
            data-evo-play
          >
            {sv.running ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button className="icon-btn" onClick={sv.stepOnce} disabled={sv.running || !!decision} title="Ten minutes on">
            <StepForward size={15} />
          </button>
          <div className="evo-seg" role="radiogroup" aria-label="Speed">
            {SURVIVAL_SPEEDS.map((s) => (
              <button key={s} className={sv.speed === s ? 'on' : ''} onClick={() => sv.setSpeed(s)} title={s === 1 ? 'One day a minute' : s === 60 ? 'One day a second' : `${s}× speed`}>
                {s}×
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={() => sv.restart()} title="Start again with an empty map">
            <RotateCcw size={15} />
          </button>
          <button
            className="btn"
            onClick={() => {
              sv.setRunning(false)
              setSavesOpen(true)
            }}
            title="Save this world, or go back to a save"
            data-sv-saves-open
          >
            <Save size={13} /> Save / load
          </button>
          {lastSave && (
            <span className="sv-autosaved">
              {lastSave.text} {new Date(lastSave.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <div className="evo-stats">
          <span className="sv-clock">
            {dark > 0.5 ? <Moon size={14} /> : <Sun size={14} />} Day <b>{dayOf(w.tick)}</b> <b>{clockText(w.tick)}</b>
            <em>{partOfDay(w.tick)}</em>
          </span>
          <span>
            Groups <b>{groupsAlive}</b>
          </span>
          <span>
            Alive <b>{people}</b>
          </span>
          <span>
            Walkers <b>{w.walkers.length}</b>
          </span>
        </div>
      </header>

      <div className="evo-main">
        <div className="evo-stage">
          <SurvivalView world={sv.world} selection={selection} fogGroup={fogGroup} placing={tool !== 'select' || !!picking} onPick={onPick} fitKey={fitKey} focus={focus} />
          <div className="evo-toolbox" role="toolbar" aria-label="Tools">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                className={tool === t.id && !picking ? 'on' : ''}
                onClick={() => {
                  setPicking(null)
                  setTool(t.id)
                  if (t.id !== 'select') setPanel('add')
                }}
                title={`${t.label}: ${t.hint}`}
                data-sv-tool={t.id}
              >
                <t.icon size={15} />
              </button>
            ))}
          </div>
          <div className="sv-region">
            {w.map.region} · Day {dayOf(w.tick)} of the outbreak
            {fogGroup != null && selGroup && (
              <span>
                <Eye size={12} /> Showing what {selGroup.name} knows
              </span>
            )}
          </div>

          {toastsShown.length > 0 && !decision && (
            <div className="sv-toasts">
              {toastsShown.map((l, i) => {
                const g = l.group != null ? groupById(w, l.group) : undefined
                return (
                  <button
                    key={`${l.tick}-${i}`}
                    className="sv-toast"
                    style={{ borderLeftColor: g?.color }}
                    onClick={() => {
                      const p = l.people?.map((id) => personById(w, id)).find(Boolean)
                      if (p) {
                        select({ kind: 'person', id: p.id })
                        setFocus({ x: p.x, y: p.y, n: Date.now() })
                      } else if (g?.alive) select({ kind: 'group', id: g.id })
                    }}
                  >
                    <span>{l.text}</span>
                    <time>{when(l.tick)}</time>
                  </button>
                )
              })}
              <button className="sv-toast-close" onClick={() => setSeenBig(w.log.length)}>
                Dismiss
              </button>
            </div>
          )}

          {savesOpen && (
            <SavesDialog
              world={w}
              onClose={() => setSavesOpen(false)}
              onSaved={() => setLastSave({ text: 'Saved', at: Date.now() })}
              onLoad={(loaded, name) => {
                sv.load(loaded)
                autoTick.current = loaded.tick
                setSelection(null)
                setSavesOpen(false)
                setLastSave({ text: `Loaded "${name}"`, at: Date.now() })
              }}
            />
          )}

          {decision && !savesOpen && <DecisionCard world={w} onAnswer={(choice) => {
            answerDecision(w, decision.id, choice)
            if (!w.pending.length) sv.setRunning(true)
            sv.refresh()
          }} />}

          {groupsAlive === 0 && !w.fallen.length && tool === 'select' && (
            <div className="sv-start" data-sv-start>
              <h3>Survival mode</h3>
              <p>It's Day {dayOf(w.tick)} of the outbreak, in the country outside Atlanta, Georgia. The map is empty until you fill it.</p>
              <ol>
                <li>
                  <b>Put some people down.</b> Pick <Users size={12} /> People on the left, set up a group (or a lone survivor, or raiders), then click the map.
                </li>
                <li>
                  <b>Add walkers.</b> Drop a few with <Skull size={12} />, or a herd with <Footprints size={12} />. Without walkers it's a quiet life.
                </li>
                <li>
                  <b>Press play.</b> At 1× a day takes a minute. They plan their days, scavenge, fight, sleep, and learn from what goes wrong.
                </li>
              </ol>
              <p className="muted">Click a group to follow it: you'll see its fog of war, its plans, its story and what it has learned. You can give it orders any time.</p>
              <div className="sv-start-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    const g = quickStart(w)
                    select({ kind: 'group', id: g.id })
                    setFocus({ x: g.homeX, y: g.homeY, n: Date.now() })
                    sv.setRunning(true)
                    sv.refresh()
                  }}
                  data-sv-quick
                >
                  <Sparkles size={13} /> Ready-made start
                </button>
                <button className="btn" onClick={() => { setTool('people'); setPanel('add') }}>
                  <Users size={13} /> Make my own group
                </button>
              </div>
            </div>
          )}

          <div className="evo-rewind" title="Rewind: drag back to any earlier point. Carrying on from there replaces what came after.">
            <History size={14} />
            <input
              type="range"
              min={0}
              max={Math.max(0, snaps.length - 1)}
              value={snaps.length - 1}
              onChange={(e) => {
                sv.setRunning(false)
                sv.rewindTo(Number(e.target.value))
              }}
              disabled={snaps.length < 2}
              aria-label="Rewind"
              data-evo-rewind
            />
            <span>{snaps.length < 2 ? 'Rewind points appear every 6 hours' : `Back as far as ${when(snaps[0].tick)}`}</span>
          </div>
        </div>

        <aside className="evo-side">
          <nav className="evo-tabs">
            {PANELS.map((p) => (
              <button key={p.id} className={panel === p.id ? 'on' : ''} onClick={() => setPanel(p.id)} data-evo-tab={p.id}>
                {p.label}
              </button>
            ))}
          </nav>
          <div className="evo-side-scroll">
            {panel === 'groups' && <GroupsTab world={w} selection={selection} select={select} picking={picking} setPicking={setPicking} refresh={sv.refresh} fogGroup={fogGroup} version={sv.version} />}
            {panel === 'add' && (
              <AddTab
                world={w}
                tool={tool}
                setTool={setTool}
                creator={creator}
                setCreator={setCreator}
                herdSize={herdSize}
                setHerdSize={setHerdSize}
                walkerCount={walkerCount}
                setWalkerCount={setWalkerCount}
              />
            )}
            {panel === 'story' && <StoryPanel world={w} />}
            {panel === 'world' && (
              <div className="evo-panel-body">
                <Toggle label="Show the fog of war for the group I'm looking at" on={showFog} onChange={setShowFog} />
                <p className="evo-hint">
                  {showFog ? <Eye size={12} /> : <EyeOff size={12} />} You always see everything. The fog shows what the group you've clicked knows: dark where they've never been, dimmed where what they know is out of date. A scout's discoveries only reach the others when they get back.
                </p>
                <Slider
                  label="Harshness"
                  hint="How picked-over the land is, how fast people get hungry, how dangerous bites are. Applies to new maps (hunger and bites change now)."
                  value={w.harshness}
                  min={0}
                  max={1}
                  step={0.05}
                  show={(v) => (v < 0.25 ? 'Forgiving' : v < 0.6 ? 'Tough' : v < 0.85 ? 'Hard' : 'Brutal')}
                  onChange={(v) => {
                    w.harshness = v
                    sv.refresh()
                  }}
                />
                <div className="evo-sub">The map</div>
                <p className="muted">
                  {w.map.towns.map((t) => t.name).join(', ')}, and the farms and woods between them. Map {w.map.seed}.
                </p>
                <div className="sv-row">
                  <button
                    className="btn"
                    onClick={() => {
                      sv.restart({ harshness: w.harshness })
                      setSelection(null)
                      setFitKey((k) => k + 1)
                    }}
                  >
                    <RotateCcw size={13} /> Empty this map
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      sv.restart({ seed: (Math.random() * 1e6) | 0, harshness: w.harshness })
                      setSelection(null)
                      setFitKey((k) => k + 1)
                    }}
                  >
                    New map
                  </button>
                </div>
                <p className="muted">Stage one is one made-up area. The whole globe, real cities and following several groups across it come next.</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

function DecisionCard({ world, onAnswer }: { world: SurvivalWorld; onAnswer: (choice?: string) => void }) {
  const d = world.pending[0]
  const g = groupById(world, d.group)
  return (
    <div className="sv-decision" role="dialog" aria-label={d.title} data-sv-decision>
      <div className="sv-decision-card" style={{ borderTopColor: g?.color }}>
        <em>{g?.name} is asking you · {when(world.tick)}</em>
        <h3>{d.title}</h3>
        <p>{d.text}</p>
        <div className="sv-decision-options">
          {d.options.map((o) => (
            <button key={o.id} className="sv-option" onClick={() => onAnswer(o.id)}>
              <b>{o.label}</b>
              <span>{o.hint}</span>
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => onAnswer()}>
          Let them decide
        </button>
      </div>
    </div>
  )
}

function GroupsTab({
  world,
  selection,
  select,
  picking,
  setPicking,
  refresh,
  fogGroup
}: {
  world: SurvivalWorld
  selection: Selection
  select: (s: Selection) => void
  picking: { group: number; order: OrderKind } | null
  setPicking: (p: { group: number; order: OrderKind } | null) => void
  refresh: () => void
  fogGroup: number | null
  version: number
}) {
  if (selection?.kind === 'person') {
    const p = personById(world, selection.id)
    if (p) return <PersonCard world={world} p={p} onSelect={select} />
  }
  if (selection?.kind === 'building') return <BuildingCard world={world} id={selection.id} onSelect={select} fogGroup={fogGroup} />
  if (selection?.kind === 'group') {
    const g = groupById(world, selection.id)
    if (g?.alive)
      return (
        <GroupCard
          world={world}
          g={g}
          onSelect={select}
          picking={picking?.group === g.id ? picking.order : null}
          onPickOrder={(o) => setPicking(o ? { group: g.id, order: o } : null)}
          onChanged={refresh}
        />
      )
  }
  return (
    <div className="evo-panel-body">
      <GroupList world={world} onSelect={select} />
    </div>
  )
}

function AddTab({
  world,
  tool,
  setTool,
  creator,
  setCreator,
  herdSize,
  setHerdSize,
  walkerCount,
  setWalkerCount
}: {
  world: SurvivalWorld
  tool: Tool
  setTool: (t: Tool) => void
  creator: Creator
  setCreator: (c: Creator) => void
  herdSize: number
  setHerdSize: (n: number) => void
  walkerCount: number
  setWalkerCount: (n: number) => void
}) {
  return (
    <>
      <div className="evo-panel-body">
        <div className="evo-tools sv-tools">
          {TOOLS.filter((t) => t.id !== 'select').map((t) => (
            <button key={t.id} className={`evo-tool ${tool === t.id ? 'on' : ''}`} onClick={() => setTool(t.id)} title={t.hint}>
              <t.icon size={16} />
              {t.label}
            </button>
          ))}
        </div>
        {tool === 'select' && <p className="evo-hint">Pick something to add, then click the map. Groups only find out about what you add when they see it.</p>}
        {tool === 'walker' && <Slider label="Walkers per click" value={walkerCount} min={1} max={30} step={1} onChange={setWalkerCount} />}
        {tool === 'herd' && (
          <>
            <Slider label="Herd size" value={herdSize} min={10} max={300} step={5} onChange={setHerdSize} />
            <p className="evo-hint">A herd sticks together and drifts, often along the roads. Anything loud nearby pulls it in.</p>
          </>
        )}
        {tool === 'supplies' && <p className="evo-hint">Drops a stash of food, water, ammo, medicine and materials where you click.</p>}
        {tool === 'noise' && <p className="evo-hint">Walkers in a wide circle around it come to see. Good for pulling a herd onto someone, or away from them.</p>}
      </div>
      {tool === 'people' && <CreatorPanel world={world} creator={creator} setCreator={setCreator} />}
    </>
  )
}
