import { describe, expect, it } from 'vitest'
import {
  ClipWatch,
  autoMakeupDb,
  cleanVoice,
  compressorFor,
  voiceStyleOf,
  VOICE_STYLES,
  DEFAULT_VOICE,
  cleanMicLabel,
  cleanPresets,
  cleanTrim,
  cleanSummary,
  cleanedPath,
  DEFAULT_TRIM,
  isRecordingExt,
  levelZone,
  matchesPreset,
  meterPosition,
  pickAudioType,
  presetName,
  resolvePresetMic,
  cutArgs,
  detectArgs,
  keepSegments,
  keptLength,
  parseSilences,
  trimmedPath,
  trimSummary,
  type MicPreset
} from './studioAudio'
import { recordingFileName } from './studio'

const preset = (over: Partial<MicPreset> = {}): MicPreset => ({
  id: 'p1',
  name: 'HyperX QuadCast 2',
  micId: 'abc',
  micLabel: 'HyperX QuadCast 2 (0951:16f9)',
  gain: 1.2,
  noiseSuppression: true,
  echoCancellation: false,
  autoGain: false,
  lowCut: true,
  voice: DEFAULT_VOICE,
  ...over
})

describe('mic presets', () => {
  it('cleans saved presets, dropping junk and repeated ids', () => {
    const out = cleanPresets([preset(), preset(), null, { name: 'no id' }, { id: 'p2', gain: 99, name: '  ' }])
    expect(out.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(out[1].gain).toBe(2)
    expect(out[1].name).toBe('Mic preset')
    expect(out[1].noiseSuppression).toBe(true)
    expect(cleanPresets('nope')).toEqual([])
  })

  it('names a preset after the mic, without the bit in brackets, and never twice', () => {
    expect(presetName('HyperX QuadCast 2 (0951:16f9)', [])).toBe('HyperX QuadCast 2')
    expect(presetName('HyperX QuadCast 2 (0951:16f9)', ['hyperx quadcast 2'])).toBe('HyperX QuadCast 2 2')
    expect(presetName('', [])).toBe('Mic preset')
  })

  it('finds the mic’s own name in what Windows, macOS and Chromium call it', () => {
    expect(cleanMicLabel('Microphone (2- HyperX QuadCast 2)')).toBe('HyperX QuadCast 2')
    expect(cleanMicLabel('Default - Microphone (HyperX QuadCast 2)')).toBe('HyperX QuadCast 2')
    expect(cleanMicLabel('HyperX QuadCast 2 (0951:16f9)')).toBe('HyperX QuadCast 2')
    expect(cleanMicLabel('MacBook Pro Microphone (Built-in)')).toBe('MacBook Pro Microphone (Built-in)')
    expect(presetName('Microphone (2- HyperX QuadCast 2)', [])).toBe('HyperX QuadCast 2')
  })

  it('knows when the settings in use still match the preset', () => {
    const p = preset()
    const s = { gain: 1.2, noiseSuppression: true, echoCancellation: false, autoGain: false, lowCut: true, voice: DEFAULT_VOICE }
    expect(matchesPreset(p, 'abc', s)).toBe(true)
    expect(matchesPreset(p, 'abc', { ...s, gain: 1.3 })).toBe(false)
    expect(matchesPreset(p, 'other', s)).toBe(false)
    expect(matchesPreset(p, 'abc', { ...s, lowCut: false })).toBe(false)
  })

  it('finds the preset’s mic by id, then by name, then falls back to the default', () => {
    const p = preset()
    expect(resolvePresetMic(p, [{ deviceId: 'abc', label: 'x' }])).toEqual({ micId: 'abc', missing: false })
    expect(resolvePresetMic(p, [{ deviceId: 'new-id', label: 'HyperX QuadCast 2 (0951:16f9)' }])).toEqual({ micId: 'new-id', missing: false })
    expect(resolvePresetMic(p, [{ deviceId: 'zzz', label: 'Laptop mic' }])).toEqual({ micId: '', missing: true })
    // No list yet (no mic permission): trust the saved id.
    expect(resolvePresetMic(p, [])).toEqual({ micId: 'abc', missing: false })
    expect(resolvePresetMic(preset({ micId: '' }), [])).toEqual({ micId: '', missing: false })
  })
})

describe('level meter and clipping', () => {
  it('puts levels on a −60 to 0 dB scale', () => {
    expect(meterPosition(1)).toBe(1)
    expect(meterPosition(0)).toBe(0)
    expect(meterPosition(0.001)).toBeCloseTo(0)
    expect(meterPosition(0.1)).toBeCloseTo(2 / 3)
  })

  it('colours a level by how loud it is', () => {
    expect(levelZone(0.01)).toBe('quiet')
    expect(levelZone(0.2)).toBe('good')
    expect(levelZone(0.7)).toBe('loud')
    expect(levelZone(1)).toBe('clip')
  })

  it('counts each clip once and holds the warning for a moment', () => {
    const w = new ClipWatch(2000)
    w.push(0.5, 0)
    expect(w.clipping(0)).toBe(false)
    w.push(1, 100)
    w.push(1, 150)
    w.push(0.99, 200)
    expect(w.clips).toBe(1)
    w.push(0.4, 300)
    w.push(1, 400)
    expect(w.clips).toBe(2)
    expect(w.clipping(2000)).toBe(true)
    expect(w.clipping(2401)).toBe(false)
    w.reset()
    expect(w.clips).toBe(0)
    expect(w.clipping(2401)).toBe(false)
  })
})

describe('audio-only recordings', () => {
  it('picks M4A, then WebM', () => {
    expect(pickAudioType(() => true)?.ext).toBe('m4a')
    expect(pickAudioType((m) => m.startsWith('audio/webm'))?.ext).toBe('webm')
    expect(pickAudioType(() => false)).toBeNull()
  })

  it('names voiceovers and only allows recording extensions', () => {
    expect(recordingFileName(new Date(2026, 10, 20, 9, 5, 7), 'm4a', 'Voiceover')).toBe('Voiceover 2026-11-20 09-05-07.m4a')
    expect(recordingFileName(new Date(2026, 10, 20, 9, 5, 7), 'mp4')).toBe('Recording 2026-11-20 09-05-07.mp4')
    expect(isRecordingExt('m4a')).toBe(true)
    expect(isRecordingExt('exe')).toBe(false)
  })
})

describe('trimming silences', () => {
  it('saves the trimmed copy beside the original as a WAV', () => {
    expect(trimmedPath('C:\\Videos\\Voiceover 1.m4a')).toBe('C:\\Videos\\Voiceover 1 (trimmed).wav')
    expect(trimmedPath('/a/b.c/take')).toBe('/a/b.c/take (trimmed).wav')
  })

  it('keeps the settings sensible', () => {
    expect(cleanTrim({ longerThan: 0.5, keep: 2, threshold: -200 })).toEqual({ ...DEFAULT_TRIM, longerThan: 0.5, keep: 0.5, threshold: -80 })
    expect(cleanTrim(null).longerThan).toBe(0.8)
  })

  it('finds the pauses ffmpeg reports, even one still going at the end', () => {
    const log = `[silencedetect @ 0x1] silence_start: -0.01\n[silencedetect @ 0x1] silence_end: 1.5 | silence_duration: 1.5\nsilence_start: 4\nsilence_end: 7 | silence_duration: 3\nsilence_start: 9.2`
    expect(parseSilences(log, 10)).toEqual([
      { start: 0, end: 1.5 },
      { start: 4, end: 7 },
      { start: 9.2, end: 10 }
    ])
  })

  it('shortens each pause to the length kept, half each side, and trims the start and end', () => {
    const segs = keepSegments(
      [
        { start: 0, end: 1.5 },
        { start: 4, end: 7 },
        { start: 9.2, end: 10 }
      ],
      10,
      0.4
    )
    expect(segs).toEqual([
      { start: 1.1, end: 4.2 },
      { start: 6.8, end: 9.6 }
    ])
    expect(keptLength(segs)).toBeCloseTo(5.9)
    // Nothing to take out: the whole thing.
    expect(keepSegments([], 8, 0.4)).toEqual([{ start: 0, end: 8 }])
  })

  it('builds the two ffmpeg passes', () => {
    expect(detectArgs('in.m4a', { ...DEFAULT_TRIM, longerThan: 1, keep: 0.3, threshold: -45 })).toEqual(['-i', 'in.m4a', '-vn', '-af', 'silencedetect=noise=-45dB:d=1', '-f', 'null', '-'])
    const cut = cutArgs('in.m4a', 'out.wav', [
      { start: 0, end: 2.25 },
      { start: 4, end: 6 }
    ])
    expect(cut[cut.indexOf('-af') + 1]).toBe("aselect='between(t,0,2.25)+between(t,4,6)',asetpts=N/SR/TB")
    expect(cut).toContain('pcm_s16le')
    expect(cut.at(-1)).toBe('out.wav')
  })

  it('cleans up mouth clicks, hiss and loudness in the same pass', () => {
    const all = cutArgs('in.m4a', 'out.wav', [{ start: 0, end: 2 }], { declick: true, denoise: true, loudness: true })
    const af = all[all.indexOf('-af') + 1]
    expect(af).toMatch(/^aselect='between\(t,0,2\)',asetpts=N\/SR\/TB,adeclick=[^,]+,afftdn=[^,]+,loudnorm=I=-16:/)
    expect(all.slice(all.indexOf('-ar'), all.indexOf('-ar') + 2)).toEqual(['-ar', '48000'])
    // Pauses left alone: no aselect, just the clean-up.
    const keepAll = cutArgs('in.m4a', 'out.wav', null, { declick: true })
    expect(keepAll[keepAll.indexOf('-af') + 1]).toMatch(/^adeclick=/)
    expect(cutArgs('in.m4a', 'out.wav', null)).not.toContain('-af')
  })

  it('names the copy after what was done', () => {
    const onlyPauses = { ...DEFAULT_TRIM, declick: false, loudness: false }
    expect(cleanedPath('/v/Voiceover.m4a', onlyPauses)).toBe('/v/Voiceover (trimmed).wav')
    expect(cleanedPath('/v/Voiceover.m4a', DEFAULT_TRIM)).toBe('/v/Voiceover (clean).wav')
  })

  it('says what the clean-up did', () => {
    expect(cleanSummary(520, 448, DEFAULT_TRIM)).toBe('Took out 1:12 of silence (8:40 → 7:28). Removed mouth clicks and evened out the loudness for YouTube.')
    expect(cleanSummary(60, 60, { ...DEFAULT_TRIM, pauses: false, loudness: false, denoise: true })).toBe('Removed mouth clicks and took out the hiss.')
    expect(cleanSummary(60, 50, { ...DEFAULT_TRIM, declick: false, loudness: false })).toMatch(/^Took out 0:10/)
  })

  it('says how much was taken out', () => {
    expect(trimSummary(520, 448)).toBe('Took out 1:12 of silence (8:40 → 7:28).')
    expect(trimSummary(60, 59.8)).toMatch(/weren’t any long pauses/)
  })
})

describe('voice effects', () => {
  it('knows how much the browser compressor turns itself up', () => {
    // Measured in Chromium: −24 dB, 4:1, no knee lifts a quiet sound by 10.8 dB.
    expect(autoMakeupDb(-24, 4)).toBeCloseTo(10.8)
    expect(autoMakeupDb(0, 1)).toBe(0)
    expect(autoMakeupDb(-1.5, 20)).toBeCloseTo(0.855)
  })

  it('gives back about half of what the compressor takes off the loudest bits', () => {
    const gentle = compressorFor(0)
    const heavy = compressorFor(1)
    expect(heavy.threshold).toBeLessThan(gentle.threshold)
    expect(heavy.ratio).toBeGreaterThan(gentle.ratio)
    const reduction = -heavy.threshold * (1 - 1 / heavy.ratio)
    expect(heavy.makeup).toBeCloseTo(reduction / 2)
    // Never more than the browser already adds, so the extra gain is a small cut, not a boost.
    expect(heavy.makeup).toBeLessThan(autoMakeupDb(heavy.threshold, heavy.ratio))
  })

  it('recognises the ready-made styles and keeps settings in range', () => {
    for (const st of VOICE_STYLES) expect(voiceStyleOf(st.voice, st.lowCut)).toBe(st.id)
    const broadcast = VOICE_STYLES.find((x) => x.id === 'broadcast')!
    expect(voiceStyleOf({ ...broadcast.voice, warmth: 5 }, true)).toBeNull()
    expect(cleanVoice({ gateThreshold: 10, warmth: -40, lowCutHz: 1000, deessAmount: 'lots' })).toMatchObject({ gateThreshold: -25, warmth: -6, lowCutHz: 200, deessAmount: 0.4 })
  })
})
