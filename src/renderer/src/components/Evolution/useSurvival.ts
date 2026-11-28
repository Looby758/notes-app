import { useCallback, useEffect, useRef, useState } from 'react'
import { DAY, SURVIVAL_STEPS_PER_SECOND, createSurvivalWorld, snapshotSurvival, stepSurvival, type SurvivalWorld } from '@shared/survival'

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

function thin<T>(list: T[]): T[] {
  const half = Math.floor(list.length / 2)
  return [...list.slice(0, half).filter((_, i) => i % 2 === 0), ...list.slice(half)]
}

export interface Survival {
  world: React.MutableRefObject<SurvivalWorld>
  snapshots: React.MutableRefObject<SurvivalWorld[]>
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
  rewindTo: (index: number) => void
  /** Swap in a saved world. It's paused, and rewinding starts again from here. */
  load: (w: SurvivalWorld) => void
  /** Jump to a copy of the world from earlier (undo): later rewind points are dropped, and it pauses. */
  restore: (w: SurvivalWorld) => void
}

export function useSurvival(): Survival {
  const [options, setOptions] = useState(readOptions)
  const world = useRef<SurvivalWorld>(null as unknown as SurvivalWorld)
  if (!world.current) world.current = createSurvivalWorld(options)
  const snapshots = useRef<SurvivalWorld[]>([snapshotSurvival(world.current)])
  // It starts paused: there's nobody in the world until you put someone there.
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState<SurvivalSpeed>(1)
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  const advance = useCallback((n: number, budget: number): void => {
    const start = performance.now()
    const w = world.current
    for (let i = 0; i < n; i++) {
      if (w.pending.length) break
      stepSurvival(w)
      if (w.tick % SNAPSHOT_EVERY === 0) {
        snapshots.current.push(snapshotSurvival(w))
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
      if (world.current.pending.length) {
        // A group is waiting on you: stop until you've answered.
        setRunning(false)
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
  }, [running, speed, advance])

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
      world.current = createSurvivalWorld(next)
      snapshots.current = [snapshotSurvival(world.current)]
      setRunning(false)
      refresh()
    },
    [options, refresh]
  )

  const rewindTo = useCallback(
    (index: number) => {
      const snap = snapshots.current[index]
      if (!snap) return
      world.current = snapshotSurvival(snap)
      snapshots.current = snapshots.current.slice(0, index + 1)
      refresh()
    },
    [refresh]
  )

  const load = useCallback(
    (w: SurvivalWorld) => {
      world.current = w
      snapshots.current = [snapshotSurvival(w)]
      setRunning(false)
      refresh()
    },
    [refresh]
  )

  const restore = useCallback(
    (w: SurvivalWorld) => {
      world.current = snapshotSurvival(w)
      const kept = snapshots.current.filter((s) => s.tick <= w.tick && s.map === w.map)
      snapshots.current = kept.length ? kept : [snapshotSurvival(w)]
      setRunning(false)
      refresh()
    },
    [refresh]
  )

  return { world, snapshots, options, running, setRunning, speed, setSpeed, version, refresh, stepOnce, restart, rewindTo, load, restore }
}
