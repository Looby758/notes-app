import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) })
vi.stubGlobal('window', { api: {}, dispatchEvent: () => true, addEventListener: () => undefined })
vi.stubGlobal('CustomEvent', class {})

const s = await import('./studio')
const { history } = await import('../lib/undo')


describe('studio mic presets and Ctrl+Z', () => {
  beforeEach(() => {
    s.useStudio.setState({ presets: [], presetId: null, micId: 'quadcast', micGain: 1, audioOnly: false, recording: null, live: null })
    history.clear()
  })

  it('saves a preset named after the mic, and undoes it', async () => {
    s.setMicGain(1.4)
    s.setMicClean('lowCut', true)
    const p = s.savePreset('HyperX QuadCast 2')
    expect(p.name).toBe('HyperX QuadCast 2')
    expect(p.gain).toBe(1.4)
    expect(p.lowCut).toBe(true)
    expect(s.activePreset()?.id).toBe(p.id)
    expect(await history.undo()).toBe('Saved the mic preset “HyperX QuadCast 2”')
    expect(s.useStudio.getState().presets).toEqual([])
  })

  it('loads a preset, finding its mic again by name', async () => {
    s.setMicGain(1.5)
    const p = s.savePreset('HyperX QuadCast 2')
    s.setMic('laptop')
    s.setMicGain(0.6)
    expect(s.activePreset()).toBeNull()
    s.loadPreset(p.id, [{ deviceId: 'new-port', label: 'HyperX QuadCast 2' }])
    const st = s.useStudio.getState()
    expect(st.micId).toBe('new-port')
    expect(st.micGain).toBe(1.5)
    expect(st.presets[0].micId).toBe('new-port')
    expect(s.activePreset()?.id).toBe(p.id)
    await history.undo()
    expect(s.useStudio.getState().micId).toBe('laptop')
    expect(s.useStudio.getState().micGain).toBe(0.6)
  })

  it('updates, renames and deletes presets, each one undoable', async () => {
    const p = s.savePreset('HyperX QuadCast 2')
    s.setMicClean('noiseSuppression', false)
    s.updatePreset(p.id, 'HyperX QuadCast 2')
    expect(s.useStudio.getState().presets[0].noiseSuppression).toBe(false)
    s.renamePreset(p.id, 'Voiceover mic')
    expect(s.useStudio.getState().presets[0].name).toBe('Voiceover mic')
    s.deletePreset(p.id)
    expect(s.useStudio.getState().presets).toEqual([])
    expect(s.useStudio.getState().presetId).toBeNull()
    expect(await history.undo()).toBe('Deleted the mic preset “Voiceover mic”')
    expect(s.useStudio.getState().presets[0].name).toBe('Voiceover mic')
    expect(s.useStudio.getState().presetId).toBe(p.id)
    expect(await history.undo()).toBe('Renamed the mic preset to “Voiceover mic”')
    expect(s.useStudio.getState().presets[0].name).toBe('HyperX QuadCast 2')
  })

  it('joins a mic volume drag into one undo step', async () => {
    s.setMicGain(1.1)
    s.setMicGain(1.2)
    s.setMicGain(1.3)
    expect(await history.undo()).toBe('Changed the mic volume')
    expect(s.useStudio.getState().micGain).toBe(1)
  })

  it('picks a voice style, fine-tunes it, saves it in a preset and undoes each step', async () => {
    s.setVoiceStyle('broadcast')
    let st = s.useStudio.getState()
    expect(st.micClean.voice.gate).toBe(true)
    expect(st.micClean.lowCut).toBe(true)
    s.setVoice('gateThreshold', -60)
    s.setVoice('gateThreshold', -62)
    s.setVoice('deess', false)
    const p = s.savePreset('HyperX QuadCast 2')
    expect(p.voice.gateThreshold).toBe(-62)
    expect(p.voice.deess).toBe(false)
    await history.undo()
    expect(await history.undo()).toBe('Turned off the de-esser')
    // A slider drag is one step.
    expect(await history.undo()).toBe('Changed the noise gate level')
    st = s.useStudio.getState()
    expect(st.micClean.voice.gateThreshold).toBe(-48)
    expect(await history.undo()).toBe('Changed the voice to Broadcast')
    s.setVoice('gateThreshold', -500)
    expect(s.useStudio.getState().micClean.voice.gateThreshold).toBe(-75)
  })

  it('switches audio only on and off, but not while recording', async () => {
    s.setAudioOnly(true)
    expect(s.useStudio.getState().audioOnly).toBe(true)
    await history.undo()
    expect(s.useStudio.getState().audioOnly).toBe(false)
    s.useStudio.setState({ recording: { startedAt: 0, path: 'x', audioOnly: false } })
    s.setAudioOnly(true)
    expect(s.useStudio.getState().audioOnly).toBe(false)
  })

  it('remembers presets and audio settings between sessions', async () => {
    s.savePreset('HyperX QuadCast 2')
    s.setAudioOnly(true)
    s.setTrim({ auto: true })
    await vi.waitFor(() => expect(JSON.parse(store.get('studio.settings') ?? '{}').audioOnly).toBe(true), { timeout: 2000 })
    const saved = JSON.parse(store.get('studio.settings')!)
    expect(saved.presets[0].name).toBe('HyperX QuadCast 2')
    expect(saved.trim.auto).toBe(true)
    expect(saved.presetId).toBe(saved.presets[0].id)
  })
})
