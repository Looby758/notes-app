import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'

// Music dipping on Orbit's own music player: the <audio> element and Web Audio are stand-ins, the
// player and its dip are real.

class FakeParam {
  value = 1
  target: number | null = null
  setTargetAtTime(v: number): void {
    this.target = v
  }
  cancelScheduledValues(): void {}
  /** Where it ends up once any glide is over. */
  get settled(): number {
    return this.target ?? this.value
  }
}

const gains: { gain: FakeParam; to: unknown[] }[] = []
const contexts: FakeContext[] = []

class FakeContext {
  state = 'running'
  currentTime = 0
  destination = { name: 'speakers' }
  wired: unknown[] = []
  constructor() {
    contexts.push(this)
  }
  createMediaElementSource(el: unknown) {
    this.wired.push(el)
    return { connect: vi.fn() }
  }
  createGain() {
    const node = { gain: new FakeParam(), to: [] as unknown[], connect: (n: unknown) => node.to.push(n) }
    gains.push(node)
    return node
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
  addEventListener = vi.fn()
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

vi.mock('./music', () => ({ useMusic: create(() => ({ local: false, state: null, at: 0, error: null })) }))
vi.mock('./musicData', () => ({ recordPlay: vi.fn() }))
vi.mock('../lib/media', () => ({ unloadMedia: vi.fn() }))

const song = (n: number) => ({ path: `C:/Music/song${n}.mp3`, title: `Song ${n}`, artist: 'Band', album: 'Album' }) as never

/** The dip's gain: the one wired straight to the speakers. */
const dipGain = () => gains.find((g) => g.to.some((n) => (n as { name?: string }).name === 'speakers'))

describe('music dipping on the Music page player', () => {
  beforeEach(() => {
    vi.resetModules()
    gains.length = 0
    contexts.length = 0
  })

  it('starts a song dipped when a friend was already talking', async () => {
    const { localDuck, playLocal } = await import('./localMusic')
    localDuck(0.3)
    await playLocal([song(1)], 0)
    expect(contexts).toHaveLength(1)
    expect(dipGain()?.gain.settled).toBe(0.3)
    // …and comes back up when they stop.
    localDuck(1)
    expect(dipGain()?.gain.settled).toBe(1)
  })

  it('dips a song that is already playing, and brings it back', async () => {
    const { localDuck, playLocal } = await import('./localMusic')
    await playLocal([song(1)], 0)
    localDuck(0.3)
    expect(dipGain()?.gain.settled).toBe(0.3)
    localDuck(1)
    expect(dipGain()?.gain.settled).toBe(1)
  })

  it('stays dipped on the next song', async () => {
    const { localDuck, playLocal, localNext } = await import('./localMusic')
    await playLocal([song(1), song(2)], 0)
    localDuck(0.3)
    await localNext()
    // Same player, same dip: nothing new is wired in.
    expect(contexts).toHaveLength(1)
    expect(contexts[0].wired).toHaveLength(1)
    expect(dipGain()?.gain.settled).toBe(0.3)
  })

  it('leaves the sound alone when nothing is dipped', async () => {
    const { playLocal } = await import('./localMusic')
    await playLocal([song(1)], 0)
    expect(contexts).toHaveLength(0)
  })

  it('takes a new level from the mixer while dipped', async () => {
    const { localDuck, playLocal } = await import('./localMusic')
    await playLocal([song(1)], 0)
    localDuck(0.3)
    localDuck(0.5)
    expect(dipGain()?.gain.settled).toBe(0.5)
  })
})
