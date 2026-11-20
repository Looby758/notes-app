import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
const api = {
  studioWriteCues: vi.fn(async (_path: string, _json: string) => undefined),
  videoConverterStatus: vi.fn(async () => ({ state: 'ready' })),
  studioJoinTakes: vi.fn(async (_parts: unknown, _script: string) => ({ path: '/rec/Script sections/Script voiceover (joined).wav', length: 9 }))
}
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) })
vi.stubGlobal('window', { api, dispatchEvent: () => true, addEventListener: () => undefined })
vi.stubGlobal('CustomEvent', class {})

// The recording engine needs a browser: a stand-in that "records" a numbered take file.
let takeNo = 0
vi.mock('../lib/studio', async () => {
  const { useStudio } = await import('./studio')
  return {
    startRecording: vi.fn(async (opts: { take?: { index: number; title: string } }) => {
      takeNo++
      const n = String(opts.take!.index + 1).padStart(2, '0')
      useStudio.setState({ recording: { startedAt: Date.now(), path: `/rec/Script sections/${n} ${opts.take!.title} - take ${takeNo}.m4a`, audioOnly: true } })
    }),
    stopRecording: vi.fn(async () => {
      const r = useStudio.getState().recording
      if (!r) return
      useStudio.setState({ recording: null, lastRecording: r.path, lastRecordingInfo: { audioOnly: true, clips: 0, length: (Date.now() - r.startedAt) / 1000 } })
    }),
    trimRecording: vi.fn(async () => undefined)
  }
})

const t = await import('./takes')
const p = await import('./teleprompter')
const { useStudio } = await import('./studio')
const { sectionsOf } = await import('../lib/takes')
const { history } = await import('../lib/undo')

const SCRIPT = 'Videos/Script.md'
const text = 'Hello there.\n\n[SECTION: The prison]\nRick is in prison.\n\n[SECTION: The escape]\nHe gets out.'
const sections = sectionsOf(text, 150)
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('record by section', () => {
  beforeEach(() => {
    vi.useRealTimers()
    takeNo = 0
    p.usePrompter.setState({ open: true, script: SCRIPT, playing: false, countdown: null, autoStart: true })
    useStudio.setState({ recording: null, audioOnly: true, lastRecording: null, lastRecordingInfo: null })
    t.useTakes.setState({ on: true, active: null, byScript: {}, joining: null, script: null, sections: [], current: null })
    t.setTakeSections(SCRIPT, sections)
    history.clear()
  })

  it('records a section, stops after its end reaches the line, and moves on to the next', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] })
    t.selectSection('the prison#1')
    expect(p.usePrompter.getState().jump?.from).toBe(sections[1].from)
    await t.recordSection()
    expect(t.useTakes.getState().active?.key).toBe('the prison#1')
    // 3, 2, 1, then the words.
    expect(p.usePrompter.getState().countdown).toBe(3)
    vi.advanceTimersByTime(3000)
    expect(p.usePrompter.getState().playing).toBe(true)
    vi.advanceTimersByTime(4000)
    // Its own marker doesn't stop it; the next section's does (after a moment for the last words).
    t.sectionMarkerReached(sections[1].from)
    expect(t.useTakes.getState().active?.ended).toBe(false)
    t.sectionMarkerReached(sections[2].from)
    expect(t.useTakes.getState().active?.ended).toBe(true)
    await vi.advanceTimersByTimeAsync(t.TAIL_MS)
    const st = t.useTakes.getState()
    expect(st.active).toBeNull()
    const [take] = t.takesOf(st).takes
    expect(take.key).toBe('the prison#1')
    expect(take.n).toBe(1)
    expect(take.early).toBe(false)
    // The words start just before the count-in ended.
    expect(take.start).toBeCloseTo(2.65, 1)
    expect(t.takesOf(st).chosen['the prison#1']).toBe(take.path)
    expect(st.current).toBe('the escape#1')
  })

  it('quick retake keeps the take aside and starts the section again', async () => {
    t.selectSection('(opening)#1')
    await t.recordSection()
    t.quickRetake()
    await flush()
    await new Promise((r) => setTimeout(r, 300))
    const st = t.useTakes.getState()
    expect(st.active?.key).toBe('(opening)#1')
    expect(t.takesOf(st).takes[0].scrapped).toBe(true)
    expect(t.takesOf(st).chosen['(opening)#1']).toBeUndefined()
    await t.stopSection()
    const after = t.takesOf(t.useTakes.getState())
    expect(after.takes).toHaveLength(2)
    expect(after.takes[1].early).toBe(true)
    // Stopped early: stays on this section.
    expect(t.useTakes.getState().current).toBe('(opening)#1')
  })

  it('picks and forgets takes, each undoable', async () => {
    await t.recordSection('(opening)#1')
    await t.stopSection()
    await t.recordSection('(opening)#1')
    await t.stopSection()
    const [a, b] = t.takesOf(t.useTakes.getState()).takes
    expect(t.takesOf(t.useTakes.getState()).chosen['(opening)#1']).toBe(b.path)
    t.chooseTake(a.path)
    expect(t.takesOf(t.useTakes.getState()).chosen['(opening)#1']).toBe(a.path)
    expect(await history.undo()).toBe('Picked take 1')
    expect(t.takesOf(t.useTakes.getState()).chosen['(opening)#1']).toBe(b.path)
    t.forgetTake(b.path)
    expect(t.takesOf(t.useTakes.getState()).takes).toHaveLength(1)
    expect(await history.undo()).toBe('Took take 2 off the list')
    expect(t.takesOf(t.useTakes.getState()).takes).toHaveLength(2)
  })

  it('joins the chosen takes and makes the joined file the one to clean up', async () => {
    await t.recordSection('(opening)#1')
    await t.stopSection()
    await t.recordSection('the escape#1')
    await t.stopSection()
    await t.joinTakes()
    const [parts, script] = api.studioJoinTakes.mock.calls[0] as unknown as [{ path: string }[], string]
    expect(script).toBe(SCRIPT)
    expect(parts.map((x) => x.path.split('/').pop())).toEqual(['01 Opening - take 1.m4a', '03 The escape - take 2.m4a'])
    const j = t.useTakes.getState().joining
    expect(j?.state).toBe('done')
    expect(j?.message).toMatch(/“The prison” has no take yet/)
    expect(useStudio.getState().lastRecording).toBe('/rec/Script sections/Script voiceover (joined).wav')
  })

  it('remembers takes for each script', async () => {
    await t.recordSection('(opening)#1')
    await t.stopSection()
    await new Promise((r) => setTimeout(r, 350))
    const saved = JSON.parse(store.get('studio.takes')!)
    expect(saved.on).toBe(true)
    expect(saved.byScript[SCRIPT].takes).toHaveLength(1)
  })
})
