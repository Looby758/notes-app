import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
const studioWriteCues = vi.fn(async (_path: string, _json: string) => undefined)
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) })
vi.stubGlobal('window', { api: { studioWriteCues }, dispatchEvent: () => true, addEventListener: () => undefined })
vi.stubGlobal('CustomEvent', class {})

const t = await import('./teleprompter')
const { useStudio } = await import('./studio')
const { history } = await import('../lib/undo')

describe('teleprompter', () => {
  beforeEach(() => {
    t.usePrompter.setState({ open: true, script: 'Videos/Maggie/Script.md', playing: false, countdown: null, autoStart: false, speed: 1, fontSize: 40 })
    useStudio.setState({ recording: null })
    history.clear()
    studioWriteCues.mockClear()
  })

  it('changes and undoes its look, keeping values in range', async () => {
    t.setLook('fontSize', 500)
    expect(t.usePrompter.getState().fontSize).toBe(96)
    expect(await history.undo()).toBe('Changed the teleprompter text size')
    expect(t.usePrompter.getState().fontSize).toBe(40)
    t.nudgeSpeed(0.05)
    t.nudgeSpeed(0.05)
    expect(t.usePrompter.getState().speed).toBeCloseTo(1.1)
    await history.undo()
    expect(t.usePrompter.getState().speed).toBe(1)
  })

  it('pauses and carries on', () => {
    t.togglePrompter()
    expect(t.usePrompter.getState().playing).toBe(true)
    t.togglePrompter()
    expect(t.usePrompter.getState().playing).toBe(false)
  })

  it('counts 3, 2, 1 then scrolls when you press Record', () => {
    vi.useFakeTimers()
    t.usePrompter.setState({ autoStart: true })
    useStudio.setState({ recording: { startedAt: Date.now(), path: '/rec/Voiceover.m4a', audioOnly: true } })
    expect(t.usePrompter.getState().countdown).toBe(3)
    vi.advanceTimersByTime(3000)
    expect(t.usePrompter.getState().playing).toBe(true)
    useStudio.setState({ recording: null })
    expect(t.usePrompter.getState().playing).toBe(false)
    vi.useRealTimers()
  })

  it('saves when each marker reached the line beside the recording', async () => {
    const startedAt = Date.now() - 5000
    useStudio.setState({ recording: { startedAt, path: '/rec/Voiceover.m4a', audioOnly: true } })
    t.markerReached(42, '[IMAGE: rick.png]')
    useStudio.setState({ recording: null })
    await vi.waitFor(() => expect(studioWriteCues).toHaveBeenCalled())
    const [path, json] = studioWriteCues.mock.calls[0]
    expect(path).toBe('/rec/Voiceover.m4a')
    const file = JSON.parse(json)
    expect(file.version).toBe(1)
    expect(file.script).toBe('Videos/Maggie/Script.md')
    expect(file.cues[0].at).toBe(42)
    expect(file.cues[0].marker).toBe('[IMAGE: rick.png]')
    expect(file.cues[0].t).toBeGreaterThanOrEqual(5)
  })

  it('doesn’t save cues for a recording made with the teleprompter closed', async () => {
    t.usePrompter.setState({ open: false })
    useStudio.setState({ recording: { startedAt: Date.now(), path: '/rec/x.mp4', audioOnly: false } })
    t.markerReached(1, '[PAUSE]')
    useStudio.setState({ recording: null })
    await new Promise((r) => setTimeout(r, 20))
    expect(studioWriteCues).not.toHaveBeenCalled()
  })
})
