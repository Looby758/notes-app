import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PRESETS,
  cleanSetup,
  createWorld,
  sample,
  snapshot,
  step,
  type Sample,
  type Setup,
  type World
} from '@shared/evolution'

/** How often the charts get a new point, in steps. */
const SAMPLE_EVERY = 20
/** How often a copy of the world is kept for rewinding, in steps. */
const SNAPSHOT_EVERY = 300
/** The most copies kept. Past that, every other old one is dropped, so rewinding still reaches the start. */
const MAX_SNAPSHOTS = 160
/** The most chart points kept (older ones are thinned the same way). */
const MAX_SAMPLES = 1500
/** How long the simulation may take per frame, so the page stays smooth at high speeds. */
const FRAME_BUDGET_MS = 12

export const SPEEDS = [0.25, 0.5, 1, 2, 5, 20, 100, 1000] as const
/** Steps a second at 1× speed, the same on any screen (it doesn't depend on the monitor's refresh rate). */
const STEPS_PER_SECOND = 20
export type Speed = (typeof SPEEDS)[number]

const SETUP_KEY = 'orbit.evolution.setup'
const SAVED_KEY = 'orbit.evolution.saved'

export interface SavedSetup {
  name: string
  setup: Setup
  savedAt: number
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked: the lab still works, it just won't remember.
  }
}

function firstSetup(): Setup {
  const saved = readJson<unknown>(SETUP_KEY)
  return saved ? cleanSetup(saved) : PRESETS[0].make()
}

/** Halves a list by dropping every other item from its older half. */
function thin<T>(list: T[]): T[] {
  const half = Math.floor(list.length / 2)
  return [...list.slice(0, half).filter((_, i) => i % 2 === 0), ...list.slice(half)]
}

export interface Lab {
  setup: Setup
  /** Change the setup. Changes to food, harshness, diets and so on apply straight away. */
  update: (fn: (s: Setup) => Setup) => void
  world: React.MutableRefObject<World>
  samples: React.MutableRefObject<Sample[]>
  snapshots: React.MutableRefObject<World[]>
  running: boolean
  setRunning: (on: boolean) => void
  speed: Speed
  setSpeed: (s: Speed) => void
  /** Bumped a few times a second while running, so panels re-read the world. */
  version: number
  refresh: () => void
  /** Steps actually taken per second lately. */
  stepsPerSecond: number
  stepOnce: () => void
  /** Start the world again from the current setup. */
  restart: (setup?: Setup) => void
  /** Go back to the copy of the world at this index of `snapshots`. */
  rewindTo: (index: number) => void
  saved: SavedSetup[]
  saveAs: (name: string) => void
  removeSaved: (name: string) => void
}

export function useLab(): Lab {
  const [setup, setSetup] = useState<Setup>(firstSetup)
  const setupRef = useRef(setup)
  const world = useRef<World>(null as unknown as World)
  if (!world.current) world.current = createWorld(setup)
  const samples = useRef<Sample[]>([sample(world.current, setup)])
  const snapshots = useRef<World[]>([snapshot(world.current)])
  const [running, setRunning] = useState(true)
  const [speed, setSpeed] = useState<Speed>(1)
  const [version, setVersion] = useState(0)
  const [stepsPerSecond, setStepsPerSecond] = useState(0)
  const [saved, setSaved] = useState<SavedSetup[]>(() => {
    const list = readJson<SavedSetup[]>(SAVED_KEY)
    return Array.isArray(list) ? list.filter((s) => s && typeof s.name === 'string').map((s) => ({ ...s, setup: cleanSetup(s.setup) })) : []
  })

  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  const update = useCallback((fn: (s: Setup) => Setup) => {
    setSetup((prev) => {
      const next = fn(prev)
      setupRef.current = next
      // Creatures of a species that's been removed die out.
      const ids = new Set(next.species.map((s) => s.id))
      world.current.creatures = world.current.creatures.filter((c) => ids.has(c.species))
      return next
    })
  }, [])

  // Remember the setup between visits (a little after the last change).
  useEffect(() => {
    const t = setTimeout(() => writeJson(SETUP_KEY, setup), 400)
    return () => clearTimeout(t)
  }, [setup])

  const advance = useCallback((n: number, budgetMs: number): number => {
    const start = performance.now()
    let done = 0
    const w = world.current
    const s = setupRef.current
    while (done < n) {
      step(w, s)
      done++
      if (w.tick % SAMPLE_EVERY === 0) {
        samples.current.push(sample(w, s))
        if (samples.current.length > MAX_SAMPLES) samples.current = thin(samples.current)
      }
      if (w.tick % SNAPSHOT_EVERY === 0) {
        snapshots.current.push(snapshot(w))
        if (snapshots.current.length > MAX_SNAPSHOTS) snapshots.current = thin(snapshots.current)
      }
      if (performance.now() - start > budgetMs) break
    }
    return done
  }, [])

  // The main loop: a few steps every frame, as many as the speed asks for and the frame allows.
  useEffect(() => {
    if (!running) return
    let frame = 0
    let lastUi = 0
    let counted = 0
    let countStart = performance.now()
    let carry = 0
    let last = performance.now()
    const loop = (now: number): void => {
      // Paced by the clock, not by frames, so a 144 Hz monitor doesn't run it faster.
      const dt = Math.min(100, now - last)
      last = now
      carry += (speed * STEPS_PER_SECOND * dt) / 1000
      const want = Math.floor(carry)
      carry -= want
      counted += advance(want, FRAME_BUDGET_MS)
      if (speed >= 1000) carry = 0
      if (now - lastUi > 250) {
        lastUi = now
        setVersion((v) => v + 1)
      }
      if (now - countStart > 1000) {
        setStepsPerSecond(Math.round((counted * 1000) / (now - countStart)))
        counted = 0
        countStart = now
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [running, speed, advance])

  const stepOnce = useCallback(() => {
    advance(1, 1000)
    refresh()
  }, [advance, refresh])

  const restart = useCallback(
    (next?: Setup) => {
      const s = next ?? setupRef.current
      if (next) {
        setupRef.current = next
        setSetup(next)
      }
      world.current = createWorld(s)
      samples.current = [sample(world.current, s)]
      snapshots.current = [snapshot(world.current)]
      refresh()
    },
    [refresh]
  )

  const rewindTo = useCallback(
    (index: number) => {
      const snap = snapshots.current[index]
      if (!snap) return
      world.current = snapshot(snap)
      snapshots.current = snapshots.current.slice(0, index + 1)
      samples.current = samples.current.filter((p) => p.tick <= snap.tick)
      refresh()
    },
    [refresh]
  )

  const saveAs = useCallback((name: string) => {
    setSaved((list) => {
      const next = [{ name, setup: setupRef.current, savedAt: Date.now() }, ...list.filter((s) => s.name !== name)]
      writeJson(SAVED_KEY, next)
      return next
    })
  }, [])

  const removeSaved = useCallback((name: string) => {
    setSaved((list) => {
      const next = list.filter((s) => s.name !== name)
      writeJson(SAVED_KEY, next)
      return next
    })
  }, [])

  return {
    setup,
    update,
    world,
    samples,
    snapshots,
    running,
    setRunning,
    speed,
    setSpeed,
    version,
    refresh,
    stepsPerSecond,
    stepOnce,
    restart,
    rewindTo,
    saved,
    saveAs,
    removeSaved
  }
}
