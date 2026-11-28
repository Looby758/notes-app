import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, Globe2, Save, Footprints, History, Moon, MousePointer2, Package, Pause, Play, RotateCcw, Skull, Sparkles, StepForward, Sun, Users, Volume2 } from 'lucide-react'
import {
  answerDecision,
  buildingAt,
  clockText,
  darkness,
  dayOf,
  giveOrder,
  groupById,
  membersOf,
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
import GlobeView, { type GlobePick } from './GlobeView'
import { GlobePanel } from './GlobePanels'
import { allGroups, areaById, openArea, sendGroupTo, snapshotGlobe, turnBack } from '@shared/globe'
import { BuildingCard, CreatorPanel, GroupCard, GroupList, PersonCard, StoryPanel, newCreator, when, type Creator } from './SurvivalPanels'
import { Slider, Toggle } from './Panels'
import { recordUndo, UNDO_KEY } from '../../lib/undo'
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
  // Looking at one area up close, or the whole globe.
  const [view, setView] = useState<'area' | 'globe'>('area')
  const [globePick, setGlobePick] = useState<GlobePick>(null)
  const [globeFocus, setGlobeFocus] = useState<{ lat: number; lon: number; zoom?: number; n: number } | null>(null)
  // Picking where a group should travel to.
  const [travel, setTravel] = useState<{ areaId: number; groupId: number } | null>(null)
  const globe = sv.globe.current
  const area = areaById(globe, sv.areaId) ?? globe.areas[0]

  // Autosave into one slot: every 5 minutes, and whenever you click off (leave the page, switch to
  // Creatures, switch app or close the window), if something has happened since the last one.
  const autoTick = useRef(-1)
  const autosave = useRef<() => void>(() => undefined)
  autosave.current = () => {
    // While you're looking back, the autosave keeps the latest point, not the past you're viewing.
    const snapsNow = sv.snapshots.current
    const world = sv.lookingBack() ? snapsNow[snapsNow.length - 1] : sv.globe.current
    const empty = !world.parties.length && world.areas.every((a) => !a.world.groups.length && !a.world.walkers.length)
    if (!world || world.tick === autoTick.current || empty) return
    autoTick.current = world.tick
    writeSave(AUTOSAVE, world, true)
      .then(() => setLastSave({ text: 'Autosaved', at: Date.now() }))
      .catch(() => setLastSave({ text: 'Autosave failed', at: Date.now() }))
  }
  useEffect(() => {
    const save = (): void => autosave.current()
    const hidden = (): void => {
      if (document.visibilityState === 'hidden') save()
    }
    const timer = setInterval(save, 5 * 60 * 1000)
    window.addEventListener('blur', save)
    window.addEventListener('beforeunload', save)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      clearInterval(timer)
      window.removeEventListener('blur', save)
      window.removeEventListener('beforeunload', save)
      document.removeEventListener('visibilitychange', hidden)
      // Leaving the page (another tab in Orbit, or Creatures mode).
      save()
    }
  }, [])

  // People you make up belong where you're putting them: new names when you change place.
  useEffect(() => {
    setCreator((c) => newCreator(sv.world.current, c.kind))
  }, [sv.areaId, sv.world])

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
        if (sv.pendingArea() == null) sv.setRunning(!sv.running)
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

  /**
   * Does something you placed or ordered, and puts it on Ctrl+Z: undoing it jumps the world back to
   * the moment just before (paused), and redoing jumps to just after.
   */
  const change = (label: string, fn: () => void): void => {
    const before = snapshotGlobe(sv.globe.current)
    const snapsBefore = sv.snapshots.current.slice()
    fn()
    // A rewind point right after it, so rewinding never lands on a world from before you placed it
    // without it being a point you chose.
    sv.mark()
    const after = snapshotGlobe(sv.globe.current)
    const snapsAfter = sv.snapshots.current.slice()
    recordUndo({
      label: `${label} (Day ${dayOf(before.tick)}, ${clockText(before.tick)})`,
      undo: () => {
        sv.restore(before, snapsBefore)
        setSelection(null)
      },
      redo: () => sv.restore(after, snapsAfter)
    })
  }

  const onPick = (x: number, y: number, hit: Selection): void => {
    const world = sv.world.current
    if (picking) {
      const g = groupById(world, picking.group)
      if (g) {
        if (picking.order === 'explore') change(`Told ${g.name} to scout`, () => giveOrder(world, g, { kind: 'explore', x, y }))
        else {
          const b = buildingAt(world, x, y, 1)
          if (!b) return // Keep waiting for a click on a building.
          const order = picking.order
          change(`Told ${g.name} to ${order === 'move' ? 'move to' : 'search'} ${b.name}`, () => giveOrder(world, g, { kind: order, building: b.id }))
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
        let g = null as unknown as ReturnType<typeof spawnGroup>
        change(`Placed ${creator.draft.name}`, () => (g = spawnGroup(world, creator.draft, x, y)))
        setCreator(newCreator(world, creator.kind))
        select({ kind: 'group', id: g.id })
        setTool('select')
        break
      }
      case 'walker':
        change(`Placed ${walkerCount === 1 ? 'a walker' : `${walkerCount} walkers`}`, () => spawnWalkers(world, x, y, walkerCount, false))
        break
      case 'herd':
        change(`Placed a herd of ${herdSize}`, () => spawnWalkers(world, x, y, herdSize, true))
        break
      case 'supplies':
        change('Placed supplies', () => spawnSupplies(world, x, y))
        break
      case 'noise':
        change('Made a noise', () => makeNoise(world, x, y, 50))
        break
    }
    sv.refresh()
  }

  const everyone = allGroups(globe)
  const people = view === 'globe' ? everyone.reduce((n, x) => n + x.people, 0) : w.people.length
  const groupsAlive = view === 'globe' ? everyone.length : w.groups.filter((g) => g.alive).length
  const walkers = view === 'globe' ? globe.areas.reduce((n, a) => n + a.world.walkers.length, 0) : w.walkers.length
  const snaps = sv.snapshots.current
  const lookingBack = sv.lookingBack()
  let snapAt = snaps.length - 1
  while (snapAt > 0 && snaps[snapAt].tick > w.tick) snapAt--
  const dark = darkness(w.tick)
  const decision = w.pending[0]
  const waitingArea = sv.pendingArea()

  /** Go down to an area (and look at a group there). */
  const enter = (areaId: number, groupId?: number): void => {
    sv.setArea(areaId)
    setView('area')
    setTravel(null)
    setGlobePick(null)
    const a = areaById(sv.globe.current, areaId)
    const g = groupId != null && a ? groupById(a.world, groupId) : undefined
    setSelection(g ? { kind: 'group', id: g.id } : null)
    const lead = g && a ? membersOf(a.world, g)[0] : undefined
    if (lead) setFocus({ x: lead.x, y: lead.y, n: Date.now() })
    else {
      setFocus(null)
      setFitKey((k) => k + 1)
    }
    setPanel('groups')
  }
  const showGlobe = (): void => {
    setView('globe')
    setGlobePick({ kind: 'area', id: area.id })
    setGlobeFocus({ lat: area.lat, lon: area.lon, n: Date.now() })
  }

  // Pop-ups for the big moments.
  const [seenBig, setSeenBig] = useState(0)
  const toasts = useMemo(() => w.log.filter((l) => l.big && l.tick >= w.tick - 240).slice(-3), [w.log, w.tick, sv.version])
  const toastsShown = toasts.filter((l) => w.log.indexOf(l) >= seenBig)
  const pageRef = useRef<HTMLDivElement>(null)

  return (
    <div className="evo-page sv-page" data-evo-page data-sv-page ref={pageRef}>
      <header className="evo-bar">
        {switcher}
        <div className="evo-seg sv-views" role="radiogroup" aria-label="View">
          <button className={view === 'globe' ? 'on' : ''} onClick={showGlobe} title="The whole world: every place and every group" data-sv-view="globe">
            <Globe2 size={13} /> Globe
          </button>
          <button className={view === 'area' ? 'on' : ''} onClick={() => enter(area.id, selGroupId ?? undefined)} title="Down to the people" data-sv-view="area">
            {area.name}
          </button>
        </div>
        <div className="evo-transport">
          <button
            className="evo-play"
            onClick={() => sv.setRunning(!sv.running)}
            disabled={waitingArea != null}
            title={waitingArea != null ? 'Answer the question first' : sv.running ? 'Pause (Space)' : 'Play (Space)'}
            data-evo-play
          >
            {sv.running ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button className="icon-btn" onClick={sv.stepOnce} disabled={sv.running || waitingArea != null} title="Ten minutes on">
            <StepForward size={15} />
          </button>
          <div className="evo-seg" role="radiogroup" aria-label="Speed">
            {SURVIVAL_SPEEDS.map((s) => (
              <button key={s} className={sv.speed === s ? 'on' : ''} onClick={() => sv.setSpeed(s)} title={s === 1 ? 'One day a minute' : s === 60 ? 'One day a second' : `${s}× speed`}>
                {s}×
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={() => { sv.restart(); setView('area'); setSelection(null) }} title="Start again with an empty world">
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
            Walkers <b>{walkers}</b>
          </span>
        </div>
      </header>

      <div className="evo-main">
        <div className="evo-stage">
          {view === 'globe' ? (
            <GlobeView
              globe={sv.globe}
              version={sv.version}
              pick={globePick}
              onPick={setGlobePick}
              onEnter={(id) => enter(id)}
              focus={globeFocus}
              picking={!!travel}
            />
          ) : (
            <SurvivalView key={area.id} world={sv.world} selection={selection} fogGroup={fogGroup} placing={tool !== 'select' || !!picking} onPick={onPick} fitKey={fitKey} focus={focus} onZoomOut={showGlobe} />
          )}
          {view === 'area' && (
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
            <button onClick={showGlobe} title="Zoom out to the globe" data-sv-zoom-out>
              <Globe2 size={15} />
            </button>
          </div>
          )}
          <div className="sv-region">
            {view === 'globe' ? `The world · ${globe.areas.length} place${globe.areas.length === 1 ? '' : 's'} open` : w.map.region} · Day {dayOf(w.tick)} of the outbreak
            {view === 'area' && fogGroup != null && selGroup && (
              <span>
                <Eye size={12} /> Showing what {selGroup.name} knows
              </span>
            )}
          </div>

          {view === 'area' && toastsShown.length > 0 && !decision && (
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
              world={globe}
              onClose={() => setSavesOpen(false)}
              onSaved={() => setLastSave({ text: 'Saved', at: Date.now() })}
              onLoad={(loaded, name) => {
                sv.load(loaded)
                autoTick.current = loaded.tick
                setView('area')
                setSelection(null)
                setSavesOpen(false)
                setLastSave({ text: `Loaded "${name}"`, at: Date.now() })
              }}
            />
          )}

          {decision && !savesOpen && <DecisionCard world={w} place={globe.areas.length > 1 ? area.name : undefined} onAnswer={(choice) => {
            answerDecision(w, decision.id, choice)
            const next = sv.pendingArea()
            if (next == null) sv.setRunning(true)
            else if (next !== area.id) sv.setArea(next)
            sv.refresh()
          }} />}
          {view === 'globe' && waitingArea != null && !decision && (
            <button className="sv-callout sv-waiting" onClick={() => enter(waitingArea)}>
              A group in {areaById(globe, waitingArea)?.name} is waiting on you. Go there
            </button>
          )}

          {view === 'area' && globe.areas.length === 1 && everyone.length === 0 && !w.fallen.length && !lookingBack && tool === 'select' && (
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
              <p className="muted">
                Want to start somewhere else? <Globe2 size={12} /> Globe at the top left shows the whole world: click anywhere on land, from Paris to Tokyo, to open a place there.
              </p>
              <div className="sv-start-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    let g = null as unknown as ReturnType<typeof quickStart>
                    change('Ready-made start', () => (g = quickStart(w)))
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

          <div className="evo-rewind" title="Rewind: drag back to look at any earlier point, and forward again. Playing on from the past replaces what came after.">
            <History size={14} />
            <input
              type="range"
              min={0}
              max={Math.max(0, snaps.length - 1)}
              value={snapAt}
              onChange={(e) => {
                sv.setRunning(false)
                sv.rewindTo(Number(e.target.value))
              }}
              disabled={snaps.length < 2}
              aria-label="Rewind"
              data-evo-rewind
            />
            {lookingBack ? (
              <>
                <span data-sv-looking>Looking back at {when(w.tick)}. Play carries on from here and replaces what came after.</span>
                <button className="btn sv-now" onClick={() => sv.backToNow()} data-sv-now>
                  Back to now
                </button>
              </>
            ) : (
              <span>{snaps.length < 2 ? 'Rewind points appear every 6 hours' : `Back as far as ${when(snaps[0].tick)}`}</span>
            )}
          </div>
        </div>

        <aside className="evo-side">
          {view === 'globe' ? (
            <div className="evo-side-scroll">
              <GlobePanel
                globe={globe}
                pick={globePick}
                setPick={setGlobePick}
                onEnter={enter}
                onOpen={(lat, lon) => {
                  let opened = null as ReturnType<typeof openArea>
                  change('Opened a place', () => (opened = openArea(sv.globe.current, lat, lon)))
                  if (opened) enter(opened.id)
                }}
                travel={travel}
                onSend={(lat, lon, name) => {
                  const from = travel && areaById(sv.globe.current, travel.areaId)
                  const g = from && groupById(from.world, travel.groupId)
                  if (from && g) change(`Sent ${g.name} to ${name}`, () => sendGroupTo(from, g, lat, lon, name))
                  const back = travel
                  setTravel(null)
                  if (back) enter(back.areaId, back.groupId)
                }}
                onCancelTravel={() => {
                  const back = travel
                  setTravel(null)
                  if (back) enter(back.areaId, back.groupId)
                }}
                onTurnBack={(id) => {
                  const p = sv.globe.current.parties.find((x) => x.id === id)
                  if (p) change(`Turned ${p.group.name} back`, () => turnBack(sv.globe.current, p))
                  sv.refresh()
                }}
              />
            </div>
          ) : (
          <>
          <nav className="evo-tabs">
            {PANELS.map((p) => (
              <button key={p.id} className={panel === p.id ? 'on' : ''} onClick={() => setPanel(p.id)} data-evo-tab={p.id}>
                {p.label}
              </button>
            ))}
          </nav>
          <div className="evo-side-scroll">
            {panel === 'groups' && (
              <GroupsTab
                world={w}
                selection={selection}
                select={select}
                picking={picking}
                setPicking={setPicking}
                refresh={sv.refresh}
                fogGroup={fogGroup}
                version={sv.version}
                onOrder={change}
                onTravel={(groupId) => {
                  sv.setRunning(false)
                  setTravel({ areaId: area.id, groupId })
                  setView('globe')
                  setGlobePick(null)
                  setGlobeFocus({ lat: area.lat, lon: area.lon, zoom: 6, n: Date.now() })
                }}
              />
            )}
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
                <div className="evo-sub">This place</div>
                <p className="muted">
                  {w.map.region}: {w.map.towns.map((t) => t.name).join(', ')}, and the farms and woods between them.
                </p>
                <div className="evo-sub">The world</div>
                <p className="muted">
                  {globe.areas.length} place{globe.areas.length === 1 ? '' : 's'} open, {globe.parties.length} group{globe.parties.length === 1 ? '' : 's'} on the road. World {globe.seed}.
                </p>
                <div className="sv-row">
                  <button className="btn" onClick={showGlobe}>
                    <Globe2 size={13} /> See the globe
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      sv.restart({ harshness: w.harshness })
                      setSelection(null)
                      setFitKey((k) => k + 1)
                    }}
                  >
                    <RotateCcw size={13} /> Start again
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      sv.restart({ seed: (Math.random() * 1e6) | 0, harshness: w.harshness })
                      setSelection(null)
                      setFitKey((k) => k + 1)
                    }}
                  >
                    New world
                  </button>
                </div>
              </div>
            )}
          </div>
          </>
          )}
        </aside>
      </div>
    </div>
  )
}

function DecisionCard({ world, place, onAnswer }: { world: SurvivalWorld; place?: string; onAnswer: (choice?: string) => void }) {
  const d = world.pending[0]
  const g = groupById(world, d.group)
  return (
    <div className="sv-decision" role="dialog" aria-label={d.title} data-sv-decision>
      <div className="sv-decision-card" style={{ borderTopColor: g?.color }}>
        <em>
          {g?.name} is asking you{place ? ` in ${place}` : ''} · {when(world.tick)}
        </em>
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
  fogGroup,
  onOrder,
  onTravel
}: {
  world: SurvivalWorld
  selection: Selection
  select: (s: Selection) => void
  picking: { group: number; order: OrderKind } | null
  setPicking: (p: { group: number; order: OrderKind } | null) => void
  refresh: () => void
  fogGroup: number | null
  version: number
  onOrder: (label: string, fn: () => void) => void
  onTravel: (groupId: number) => void
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
          onOrder={onOrder}
          onTravel={() => onTravel(g.id)}
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
        <p className="evo-hint">Placed something by mistake? {UNDO_KEY} takes it back and jumps to the moment before you placed it.</p>
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
