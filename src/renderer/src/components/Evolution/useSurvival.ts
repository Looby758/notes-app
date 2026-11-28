import { useCallback, useEffect, useRef, useState } from 'react'
import { DAY, SURVIVAL_STEPS_PER_SECOND, type SurvivalWorld } from '@shared/survival'
import { areaById, createGlobe, pendingCount, snapshotGlobe, stepGlobe, type Globe } from '@shared/globe'

/** A copy of the world is kept every this many steps (in-game minutes) for rewinding. */
const SNAPSHOT_EVERY = DAY / 4
const MAX_SNAPSHOTS = 160
const FRAME_BUDGET_MS = 12

/** 1× is one in-game day per real minute. */
export const SURVIVAL_SPEEDS = [0.25, 0.5, 1, 2, 5, 20, 60] as const
export type SurvivalSpeed = (typeof SURVIVAL_SPEEDS)[number]

const OPTIONS_KEY = 'orbit.survival.options'

export interface SurvivalOptionsState {
  seed: number
  harshness: number
}

function readOptions(): SurvivalOptionsState {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY)
    const o = raw ? JSON.parse(raw) : null
    if (o && Number.isFinite(o.seed) && Number.isFinite(o.harshness)) return { seed: o.seed | 0, harshness: Math.min(1, Math.max(0, o.harshness)) }
  } catch {
    // Fall through to the defaults.
  }
  return { seed: 30, harshness: 0.5 }
}

/** A globe with nothing in it yet: not worth a rewind point once something's been placed. */
const isEmpty = (g: Globe): boolean => !g.parties.length && g.areas.every((a) => !a.world.groups.length && !a.world.walkers.length && !a.world.fallen.length)

function thin<T>(list: T[]): T[] {
  const half = Math.floor(list.length / 2)
  return [...list.slice(0, half).filter((_, i) => i % 2 === 0), ...list.slice(half)]
}

export interface Survival {
  /** The whole world: every area on the globe, and everyone on the road between them. */
  globe: React.MutableRefObject<Globe>
  /** The area you're looking at. */
  world: React.MutableRefObject<SurvivalWorld>
  areaId: number
  setArea: (id: number) => void
  /** The first area with a question waiting for you, if any. */
  pendingArea: () => number | null
  snapshots: React.MutableRefObject<Globe[]>
  options: SurvivalOptionsState
  running: boolean
  setRunning: (on: boolean) => void
  speed: SurvivalSpeed
  setSpeed: (s: SurvivalSpeed) => void
  version: number
  refresh: () => void
  stepOnce: () => void
  /** A fresh, empty world. */
  restart: (opts?: Partial<SurvivalOptionsState>) => void
  /**
   * Look at an earlier rewind point. Nothing is thrown away: the points after it stay on the slider
   * (so you can drag forward again) until you play on or change something from there.
   */
  rewindTo: (index: number) => void
  /** Jump back to the latest point after looking back. */
  backToNow: () => void
  /** True while you're looking at the past and later rewind points are still kept. */
  lookingBack: () => boolean
  /** Adds a rewind point for right now (after you place something), dropping any kept future. */
  mark: () => void
  /** Swap in a saved globe. It's paused, and rewinding starts again from here. */
  load: (g: Globe) => void
  /**
   * Jump to a copy of the world (undo/redo), paused. With `snaps`, the rewind points are put back
   * exactly as they were; otherwise later ones are dropped.
   */
  restore: (g: Globe, snaps?: Globe[]) => void
}

export function useSurvival(): Survival {
  const [options, setOptions] = useState(readOptions)
  const globe = useRef<Globe>(null as unknown as Globe)
  if (!globe.current) globe.current = createGlobe(options)
  const [areaId, setAreaId] = useState(() => globe.current.areas[0].id)
  const areaRef = useRef(areaId)
  const world = useRef<SurvivalWorld>(globe.current.areas[0].world)
  /** Points `world` at the area being looked at (after the globe is swapped for another copy). */
  const sync = useCallback(() => {
    const a = areaById(globe.current, areaRef.current) ?? globe.current.areas[0]
    areaRef.current = a.id
    world.current = a.world
  }, [])
  const setArea = useCallback(
    (id: number) => {
      areaRef.current = id
      setAreaId(id)
      sync()
      setVersion((v) => v + 1)
    },
    [sync]
  )
  const pendingArea = useCallback((): number | null => globe.current.areas.find((a) => a.world.pending.length)?.id ?? null, [])
  const snapshots = useRef<Globe[]>([snapshotGlobe(globe.current)])
  // It starts paused: there's nobody in the world until you put someone there.
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState<SurvivalSpeed>(1)
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  const dropFuture = (tick: number): void => {
    const last = snapshots.current[snapshots.current.length - 1]
    if (last && last.tick > tick) snapshots.current = snapshots.current.filter((s) => s.tick <= tick)
  }

  const advance = useCallback((n: number, budget: number): void => {
    const start = performance.now()
    const g = globe.current
    // Playing on from the past: what came after is replaced by what happens now.
    if (n > 0 && !pendingCount(g)) dropFuture(g.tick)
    for (let i = 0; i < n; i++) {
      if (pendingCount(g)) break
      stepGlobe(g)
      if (g.tick % SNAPSHOT_EVERY === 0) {
        snapshots.current.push(snapshotGlobe(g))
        if (snapshots.current.length > MAX_SNAPSHOTS) snapshots.current = thin(snapshots.current)
      }
      if (performance.now() - start > budget) break
    }
  }, [])

  useEffect(() => {
    if (!running) return
    let frame = 0
    let last = performance.now()
    let lastUi = 0
    let carry = 0
    const loop = (now: number): void => {
      const dt = Math.min(100, now - last)
      last = now
      carry += (speed * SURVIVAL_STEPS_PER_SECOND * dt) / 1000
      const want = Math.floor(carry)
      carry -= want
      advance(want, FRAME_BUDGET_MS)
      const waiting = pendingArea()
      if (waiting != null) {
        // A group is waiting on you: stop until you've answered, and go to where it is.
        setRunning(false)
        if (waiting !== areaRef.current) setArea(waiting)
        setVersion((v) => v + 1)
        return
      }
      if (now - lastUi > 250) {
        lastUi = now
        setVersion((v) => v + 1)
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [running, speed, advance, pendingArea, setArea])

  const stepOnce = useCallback(() => {
    advance(10, 1000)
    refresh()
  }, [advance, refresh])

  const restart = useCallback(
    (opts?: Partial<SurvivalOptionsState>) => {
      const next = { ...options, ...opts }
      setOptions(next)
      try {
        localStorage.setItem(OPTIONS_KEY, JSON.stringify(next))
      } catch {
        // Not remembered, but it still works.
      }
      globe.current = createGlobe(next)
      areaRef.current = globe.current.areas[0].id
      setAreaId(areaRef.current)
      sync()
      snapshots.current = [snapshotGlobe(globe.current)]
      setRunning(false)
      refresh()
    },
    [options, refresh, sync]
  )

  const rewindTo = useCallback(
    (index: number) => {
      const snap = snapshots.current[index]
      if (!snap) return
      const list = snapshots.current
      const live = globe.current
      const last = list[list.length - 1]
      // Keep "now" on the slider so you can come back to it.
      if (last && live.tick > last.tick) list.push(snapshotGlobe(live))
      else if (last && live.tick === last.tick && index !== list.length - 1) list[list.length - 1] = snapshotGlobe(live)
      globe.current = snapshotGlobe(snap)
      sync()
      setRunning(false)
      refresh()
    },
    [refresh, sync]
  )

  const lookingBack = useCallback((): boolean => {
    const last = snapshots.current[snapshots.current.length - 1]
    return !!last && last.tick > globe.current.tick
  }, [])

  const backToNow = useCallback(() => {
    const list = snapshots.current
    if (list.length) globe.current = snapshotGlobe(list[list.length - 1])
    sync()
    refresh()
  }, [refresh, sync])

  const mark = useCallback(() => {
    const g = globe.current
    let list = snapshots.current.filter((s) => s.tick < g.tick)
    if (!isEmpty(g)) list = list.filter((s) => !isEmpty(s))
    list.push(snapshotGlobe(g))
    snapshots.current = list.length > MAX_SNAPSHOTS ? thin(list) : list
  }, [])

  const load = useCallback(
    (g: Globe) => {
      globe.current = g
      sync()
      setAreaId(areaRef.current)
      snapshots.current = [snapshotGlobe(g)]
      setRunning(false)
      refresh()
    },
    [refresh, sync]
  )

  const restore = useCallback(
    (g: Globe, snaps?: Globe[]) => {
      globe.current = snapshotGlobe(g)
      sync()
      setAreaId(areaRef.current)
      if (snaps) {
        snapshots.current = snaps.slice()
        setRunning(false)
        refresh()
        return
      }
      const kept = snapshots.current.filter((s) => s.tick <= g.tick && s.seed === g.seed)
      snapshots.current = kept.length ? kept : [snapshotGlobe(g)]
      setRunning(false)
      refresh()
    },
    [refresh]
  )

  return { globe, world, areaId, setArea, pendingArea, snapshots, options, running, setRunning, speed, setSpeed, version, refresh, stepOnce, restart, rewindTo, backToNow, lookingBack, mark, load, restore }
}
