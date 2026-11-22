import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import { DEFAULT_PREFS } from '@shared/prefs'

// Music dipping on Orbit's own music player (both crossfade decks, the equaliser): the <audio>
// elements and Web Audio are stand-ins, the player and its sound chain are real.

class FakeParam {
  value = 1
  target: number | null = null
  setTargetAtTime(v: number): void {
    this.target = v
  }
  setValueCurveAtTime(): void {}
  cancelScheduledValues(): void {}
  /** Where it ends up once any glide is over. */
  get settled(): number {
    return this.target ?? this.value
  }
}

interface FakeNode {
  kind: string
  to: FakeNode[]
  gain: FakeParam
  connect(n: FakeNode): void
}

const node = (kind: string): FakeNode => {
  const n: FakeNode = { kind, to: [], gain: new FakeParam(), connect: (next) => void n.to.push(next) }
  return n
}

const contexts: FakeContext[] = []

class FakeContext {
  state = 'running'
  currentTime = 0
  destination = node('speakers')
  sources = new Map<unknown, FakeNode>()
  gains: FakeNode[] = []
  constructor() {
    contexts.push(this)
  }
  createMediaElementSource(el: unknown) {
    const n = node('source')
    this.sources.set(el, n)
    return n
  }
  createGain() {
    const n = node('gain')
    this.gains.push(n)
    return n
  }
  createBiquadFilter() {
    return Object.assign(node('filter'), { type: '', frequency: new FakeParam(), Q: new FakeParam() })
  }
  resume = vi.fn(async () => undefined)
}

class FakeAudio {
  src = ''
  paused = true
  volume = 1
  currentTime = 0
  duration = 200
  preload = ''
  crossOrigin = ''
  handlers = new Map<string, (() => void)[]>()
  addEventListener(event: string, run: () => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), run])
  }
  fire(event: string) {
    for (const run of this.handlers.get(event) ?? []) run()
  }
  getAttribute = (name: string) => (name === 'src' ? this.src : null)
  removeAttribute = vi.fn()
  load = vi.fn()
  play = vi.fn(async () => {
    this.paused = false
  })
  pause = vi.fn(() => {
    this.paused = true
  })
}

vi.stubGlobal('Audio', FakeAudio)
vi.stubGlobal('AudioContext', FakeContext)
vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
vi.stubGlobal('window', { api: { musicControl: vi.fn(async () => undefined), writeAppData: vi.fn(async () => undefined) } })

const prefs = create(() => ({ prefs: { ...DEFAULT_PREFS } }))
vi.mock('./prefs', () => ({ usePrefs: prefs }))
vi.mock('./music', () => ({ useMusic: create(() => ({ local: false, state: null, at: 0, error: null, sleep: null })) }))
vi.mock('./musicData', () => ({ recordPlay: vi.fn() }))
vi.mock('../lib/media', () => ({ unloadMedia: vi.fn() }))

const song = (n: number) => ({ path: `C:/Music/song${n}.mp3`, title: `Song ${n}`, artist: 'Band', album: 'Album', durationMs: 200_000 }) as never

/** The dip: the gain wired straight to the speakers. */
const dip = () => contexts[0]?.gains.find((g) => g.to.includes(contexts[0].destination))

/** Whether a deck's sound reaches the speakers only through the dip. */
function goesThroughDip(el: unknown): boolean {
  const ctx = contexts[0]
  const start = ctx.sources.get(el)
  if (!start) return false
  const seen = new Set<FakeNode>()
  const walk = (n: FakeNode): boolean => {
    if (n === ctx.destination) return false // reached the speakers without the dip
    if (n === dip()) return n.to.includes(ctx.destination)
    if (seen.has(n)) return true
    seen.add(n)
    return n.to.length > 0 && n.to.every((next) => next.kind === 'analyser' || walk(next))
  }
  return walk(start)
}

describe('music dipping on the Music page player', () => {
  beforeEach(() => {
    vi.resetModules()
    contexts.length = 0
    prefs.setState({ prefs: { ...DEFAULT_PREFS } })
  })

  it('starts a song dipped when a friend was already talking', async () => {
    const { localDuck, playLocal } = await import('./localMusic')
    localDuck(0.3)
    await playLocal([song(1)], 0)
    expect(dip()?.gain.settled).toBe(0.3)
    // …and comes back up when they stop.
    localDuck(1)
    expect(dip()?.gain.settled).toBe(1)
  })

  it('dips a song that is already playing, and brings it back', async () => {
    const { localDuck, playLocal } = await import('./localMusic')
    await playLocal([song(1)], 0)
    expect(dip()?.gain.settled).toBe(1)
    localDuck(0.3)
    expect(dip()?.gain.settled).toBe(0.3)
    localDuck(1)
    expect(dip()?.gain.settled).toBe(1)
  })

  it('sends the song through the equaliser and then the dip', async () => {
    const { playLocal } = await import('./localMusic')
    await playLocal([song(1)], 0)
    const deck = [...contexts[0].sources.keys()][0]
    expect(goesThroughDip(deck)).toBe(true)
    // The equaliser is before the dip, so turning it up can't undo a dip.
    const path: string[] = []
    let n: FakeNode | undefined = contexts[0].sources.get(deck)
    while (n && n !== contexts[0].destination) {
      path.push(n.kind)
      n = n.to.find((next) => next.kind !== 'analyser')
    }
    expect(path.indexOf('filter')).toBeGreaterThan(-1)
    expect(path.lastIndexOf('filter')).toBeLessThan(path.length - 1)
  })

  it('keeps both songs dipped during a crossfade', async () => {
    prefs.setState({ prefs: { ...DEFAULT_PREFS, musicCrossfade: 5 } })
    const { localDuck, playLocal } = await import('./localMusic')
    await playLocal([song(1), song(2)], 0)
    localDuck(0.3)
    const first = [...contexts[0].sources.keys()][0] as FakeAudio
    first.currentTime = 197
    first.fire('timeupdate')
    await Promise.resolve()
    const decks = [...contexts[0].sources.keys()]
    expect(decks).toHaveLength(2)
    for (const d of decks) expect(goesThroughDip(d)).toBe(true)
    expect(contexts).toHaveLength(1)
    expect(dip()?.gain.settled).toBe(0.3)
  })

  it('stays dipped on the next song', async () => {
    const { localDuck, playLocal, localNext } = await import('./localMusic')
    await playLocal([song(1), song(2)], 0)
    localDuck(0.3)
    await localNext()
    expect(contexts).toHaveLength(1)
    expect(dip()?.gain.settled).toBe(0.3)
  })

  it('takes a new level from the mixer while dipped', async () => {
    const { localDuck, playLocal } = await import('./localMusic')
    await playLocal([song(1)], 0)
    localDuck(0.3)
    localDuck(0.5)
    expect(dip()?.gain.settled).toBe(0.5)
  })
})
