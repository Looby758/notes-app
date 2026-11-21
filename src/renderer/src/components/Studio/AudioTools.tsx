import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Download, FolderOpen, Headphones, Mic, Pencil, Save, Sparkles, Trash2, X } from 'lucide-react'
import { formatDuration } from '@shared/studio'
import { cleanMicLabel, meterPosition, toDb, VOICE_STYLES, voiceStyleOf, type VoiceFx } from '@shared/studioAudio'
import { activePreset, deletePreset, loadPreset, micDevices, renamePreset, savePreset, setMicClean, setTrim, setVoice, setVoiceStyle, updatePreset, useMonitor, useStudio, type MicSwitch } from '../../store/studio'
import { getConverterAndTrim, hasChannel, level, trimRecording } from '../../lib/studio'

/**
 * The Studio's voiceover tools: mic presets, the mic clean-up switches, the level meter with its
 * clipping warning, the audio-only panel and trimming the silences out of a recording.
 */

/** The mics plugged in, kept up to date; includes the system's "Default" entry so its name is known. */
function useMics(): { deviceId: string; label: string }[] {
  const [list, setList] = useState<{ deviceId: string; label: string }[]>([])
  useEffect(() => {
    const load = (): void =>
      void navigator.mediaDevices
        .enumerateDevices()
        .then((d) => setList(d.filter((x) => x.kind === 'audioinput').map((x) => ({ deviceId: x.deviceId, label: x.label }))))
        .catch(() => undefined)
    load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => navigator.mediaDevices.removeEventListener('devicechange', load)
  }, [])
  return list
}

/** The name of the mic in use ("HyperX QuadCast 2"), for naming a preset after it. */
function micName(micId: string, mics: { deviceId: string; label: string }[]): string {
  const id = micId || 'default'
  const d = mics.find((m) => m.deviceId === id)
  return cleanMicLabel(d?.label ?? '')
}

export function MicPresets() {
  const presets = useStudio((s) => s.presets)
  const presetId = useStudio((s) => s.presetId)
  const micId = useStudio((s) => s.micId)
  const active = useStudio((s) => activePreset(s))
  const recording = useStudio((s) => !!s.recording)
  const mics = useMics()
  const [renaming, setRenaming] = useState<string | null>(null)
  const chosen = presets.find((p) => p.id === presetId) ?? null
  const changed = !!chosen && !active

  if (renaming !== null && chosen) {
    const done = (): void => {
      renamePreset(chosen.id, renaming)
      setRenaming(null)
    }
    return (
      <div className="studio-row studio-presets">
        <input
          autoFocus
          value={renaming}
          aria-label="Preset name"
          onChange={(e) => setRenaming(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') done()
            if (e.key === 'Escape') setRenaming(null)
          }}
        />
        <button className="icon-btn" title="Save the name" onClick={done}>
          <Check size={14} />
        </button>
        <button className="icon-btn" title="Cancel" onClick={() => setRenaming(null)}>
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="studio-presets" data-studio-presets>
      <div className="studio-row">
        <select
          value={presetId ?? ''}
          disabled={recording}
          aria-label="Mic preset"
          title={recording ? 'Stop recording to change presets' : 'Load a saved mic preset'}
          onChange={(e) => {
            const id = e.target.value
            if (id) void micDevices().then((d) => loadPreset(id, d))
            else useStudio.setState({ presetId: null })
          }}
        >
          <option value="">{presets.length ? 'No preset' : 'No presets saved yet'}</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.id === presetId && changed ? ' (changed)' : ''}
            </option>
          ))}
        </select>
        {chosen && (
          <>
            <button className="icon-btn" title="Rename this preset" onClick={() => setRenaming(chosen.name)}>
              <Pencil size={13} />
            </button>
            <button className="icon-btn" title="Delete this preset" onClick={() => deletePreset(chosen.id)}>
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
      <div className="studio-row">
        {changed && chosen && (
          <button className="btn" onClick={() => updatePreset(chosen.id, micName(micId, mics))} title={`Save these settings into “${chosen.name}”`}>
            <Save size={13} /> Update “{chosen.name}”
          </button>
        )}
        {(!chosen || changed) && (
          <button
            className="btn"
            onClick={() => savePreset(micName(micId, mics))}
            data-studio-save-preset
            title="Save the mic, its volume and the clean-up switches, to load again any time"
          >
            <Save size={13} /> Save as a preset
          </button>
        )}
      </div>
    </div>
  )
}

const CLEANUP: { key: MicSwitch; label: string; hint: string }[] = [
  {
    key: 'noiseSuppression',
    label: 'Reduce background noise',
    hint: 'Takes out fans, hum and keyboard sounds.'
  },
  {
    key: 'lowCut',
    label: 'Cut low rumble',
    hint: 'Removes desk knocks, traffic and air con (set how much under Voice effects, Fine-tune).'
  },
  {
    key: 'echoCancellation',
    label: 'Cancel echo',
    hint: 'Stops your speakers coming back through the mic. Not needed with headphones.'
  },
  {
    key: 'autoGain',
    label: 'Automatic mic volume',
    hint: 'Lets the computer turn you up and down. Off keeps a voiceover steady.'
  }
]

export function MicCleanupSettings() {
  const clean = useStudio((s) => s.micClean)
  const off = useStudio((s) => s.micId === 'off')
  return (
    <div className="studio-cleanup" data-studio-cleanup>
      {CLEANUP.map((c) => (
        <label key={c.key} className="studio-check" title={c.hint}>
          <input type="checkbox" checked={clean[c.key]} disabled={off} onChange={(e) => setMicClean(c.key, e.target.checked)} /> {c.label}
        </label>
      ))}
    </div>
  )
}

const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')

/** A switch with a slider under it, for one voice effect. */
function Effect<K extends keyof VoiceFx>({ on, label, hint, children }: { on?: K; label: string; hint: string; children?: ReactNode }) {
  const voice = useStudio((s) => s.micClean.voice)
  const off = useStudio((s) => s.micId === 'off')
  return (
    <div className="studio-fx">
      {on ? (
        <label className="studio-check" title={hint}>
          <input type="checkbox" checked={voice[on] as boolean} disabled={off} onChange={(e) => setVoice(on, e.target.checked as VoiceFx[K])} /> {label}
        </label>
      ) : (
        <span className="studio-fx-name" title={hint}>
          {label}
        </span>
      )}
      <p className="studio-hint">{hint}</p>
      {children}
    </div>
  )
}

function Slider({ value, min, max, step, disabled, label, onChange }: { value: number; min: number; max: number; step: number; disabled?: boolean; label: string; onChange: (v: number) => void }) {
  return (
    <label className={`studio-fx-slider ${disabled ? 'off' : ''}`}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

/**
 * The voice effects: one-click styles, and under "Fine-tune" each effect on its own (a noise gate
 * for the clicks and breaths between words, a de-esser, EQ, a compressor and a limiter). They're
 * heard in the recording as you make it, and saved with your mic presets.
 */
export function VoiceEffects() {
  const clean = useStudio((s) => s.micClean)
  const off = useStudio((s) => s.micId === 'off')
  const monitor = useMonitor((s) => s.on)
  const v = clean.voice
  const style = voiceStyleOf(v, clean.lowCut)
  const styleHint = VOICE_STYLES.find((x) => x.id === style)?.hint ?? 'Your own mix (changed under Fine-tune).'
  return (
    <div className="studio-voice" data-studio-voice>
      <div className="studio-voice-head">
        <Sparkles size={13} /> Voice effects
      </div>
      <div className="studio-voice-styles" role="group" aria-label="Voice style">
        {VOICE_STYLES.map((st) => (
          <button key={st.id} className={`studio-voice-style ${style === st.id ? 'on' : ''}`} disabled={off} title={st.hint} aria-pressed={style === st.id} onClick={() => setVoiceStyle(st.id)}>
            {st.label}
          </button>
        ))}
      </div>
      <p className="studio-hint">{styleHint}</p>
      <details className="studio-voice-more" data-studio-voice-more>
        <summary>Fine-tune</summary>
        <Effect on="gate" label="Noise gate" hint="Turns the gaps between your words right down, so mouth clicks, breaths and room noise there mostly disappear.">
          <Slider
            label={`Opens above ${v.gateThreshold} dB${v.gateThreshold > -40 ? ' (may cut soft words)' : ''}`}
            value={v.gateThreshold}
            min={-75}
            max={-25}
            step={1}
            disabled={off || !v.gate}
            onChange={(n) => setVoice('gateThreshold', n)}
          />
        </Effect>
        <Effect on="deess" label="De-esser" hint="Softens harsh “s”, “sh” and lip sounds without dulling your voice.">
          <Slider label={`Amount ${Math.round(v.deessAmount * 100)}%`} value={v.deessAmount} min={0} max={1} step={0.05} disabled={off || !v.deess} onChange={(n) => setVoice('deessAmount', n)} />
        </Effect>
        <Effect label="Tone" hint="Small changes go a long way: a couple of dB is usually enough.">
          <Slider label={`Warmth ${signed(v.warmth)} dB`} value={v.warmth} min={-6} max={6} step={0.5} disabled={off} onChange={(n) => setVoice('warmth', n)} />
          <Slider label={`Clarity ${signed(v.clarity)} dB`} value={v.clarity} min={-6} max={6} step={0.5} disabled={off} onChange={(n) => setVoice('clarity', n)} />
          <Slider label={`Cut boxiness ${v.mudCut} dB`} value={v.mudCut} min={0} max={8} step={0.5} disabled={off} onChange={(n) => setVoice('mudCut', n)} />
        </Effect>
        <Effect on="compress" label="Compressor" hint="Evens out your loud and quiet bits, so you sound steady and close to the mic.">
          <Slider label={`Amount ${Math.round(v.compressAmount * 100)}%`} value={v.compressAmount} min={0} max={1} step={0.05} disabled={off || !v.compress} onChange={(n) => setVoice('compressAmount', n)} />
        </Effect>
        <Effect on="limiter" label="Limiter" hint="Catches a sudden shout or laugh before it can distort." />
        <Effect label="Low cut" hint={clean.lowCut ? 'Higher takes out more boom and breath pops; too high makes you sound thin.' : 'Turn on “Cut low rumble” above to use it.'}>
          <Slider label={`Below ${v.lowCutHz} Hz`} value={v.lowCutHz} min={40} max={200} step={5} disabled={off || !clean.lowCut} onChange={(n) => setVoice('lowCutHz', n)} />
        </Effect>
      </details>
      <label className="studio-check studio-monitor" title="Plays your mic, with the effects, back to you while you set them up.">
        <input type="checkbox" checked={monitor} disabled={off} onChange={(e) => useMonitor.setState({ on: e.target.checked })} /> <Headphones size={13} /> Hear yourself
      </label>
      {monitor && <p className="studio-hint">Use headphones: through speakers it will squeal. It isn’t recorded, and it turns off when you leave the Studio.</p>}
    </div>
  )
}

/**
 * A level meter on a decibel scale (−60 to 0 dB): green while you're speaking normally, yellow
 * when it's loud, red at the very end where it distorts. A thin line holds the loudest bit for a
 * moment, like a real mixer.
 */
export function Meter({ which, big }: { which: 'mic' | 'desktop'; big?: boolean }) {
  const bar = useRef<HTMLDivElement>(null)
  const peakLine = useRef<HTMLDivElement>(null)
  const readout = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let raf = 0
    let shown = 0
    let peak = 0
    let peakAt = 0
    const tick = (now: number): void => {
      const v = level(which)
      shown = Math.max(v, shown * 0.9)
      if (v >= peak || now - peakAt > 1200) {
        peak = v
        peakAt = now
      }
      const pos = meterPosition(shown)
      if (bar.current) bar.current.style.clipPath = `inset(0 ${(1 - pos) * 100}% 0 0)`
      if (peakLine.current) {
        peakLine.current.style.left = `${meterPosition(peak) * 100}%`
        peakLine.current.style.opacity = peak > 0.001 ? '1' : '0'
      }
      if (readout.current) {
        const db = toDb(peak)
        readout.current.textContent = db <= -60 ? '−∞ dB' : `${Math.round(db)} dB`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [which])
  return (
    <div className={`studio-meter-wrap ${big ? 'big' : ''}`}>
      <div className="studio-meter" data-studio-meter={which}>
        <div ref={bar} className="studio-meter-fill" />
        <div ref={peakLine} className="studio-meter-peak" />
        {big && (
          <div className="studio-meter-ticks" aria-hidden>
            {[-48, -36, -24, -12, -6, 0].map((db) => (
              <span key={db} style={{ left: `${((db + 60) / 60) * 100}%` }}>
                {db}
              </span>
            ))}
          </div>
        )}
      </div>
      <span ref={readout} className="studio-meter-db" />
    </div>
  )
}

/** "Too loud" while the mic clips, saying which knob to turn. */
export function ClipWarning() {
  const clipping = useStudio((s) => s.clipping)
  const clips = useStudio((s) => s.clips)
  const recording = useStudio((s) => !!s.recording)
  if (!clipping && !(recording && clips)) return null
  return (
    <p className={`studio-clip ${clipping ? 'on' : ''}`} role="status" data-studio-clip>
      <AlertTriangle size={13} />
      {clipping === 'mic'
        ? 'Too loud: your mic is distorting. Turn the gain knob on the mic itself down, or sit a little further back.'
        : clipping === 'gain'
          ? 'Too loud: turn the mic volume slider down a bit.'
          : `The mic was too loud ${clips === 1 ? 'once' : `${clips} times`} in this recording.`}
      {clipping && recording && clips > 0 && <span className="studio-clip-count">{clips}×</span>}
    </p>
  )
}

/** The middle of the Studio in audio-only mode: a big meter instead of the picture. */
export function AudioOnlyPanel() {
  const recording = useStudio((s) => s.recording)
  const micId = useStudio((s) => s.micId)
  const muted = useStudio((s) => s.micMuted)
  const preset = useStudio((s) => activePreset(s))
  const problem = useStudio((s) => s.audioProblem)
  const mics = useMics()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!recording) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [recording])
  const name = micId === 'off' ? 'No microphone' : micName(micId, mics) || 'Default microphone'
  return (
    <div className="studio-audio-panel" data-studio-audio-panel>
      <div className={`studio-audio-icon ${recording ? 'rec' : ''}`}>
        <Mic size={34} />
      </div>
      <div className="studio-audio-what">
        <strong>{name}</strong>
        <span>{preset ? `Preset: ${preset.name}` : 'No preset loaded'}</span>
      </div>
      <div className="studio-audio-time">{recording ? formatDuration(now - recording.startedAt) : 'Ready'}</div>
      <Meter which="mic" big />
      <ClipWarning />
      {muted && <p className="studio-problem">The mic is muted.</p>}
      {problem && <p className="studio-problem">{problem}</p>}
      {!hasChannel('mic') && micId !== 'off' && !problem && <p className="studio-hint">Starting the microphone…</p>}
      <p className="studio-hint">Speak at your normal voiceover volume: aim for the loud parts to land in the yellow, never the red.</p>
      <LastRecording />
    </div>
  )
}

/** A slim version of the audio-only panel, above the teleprompter: the mic, the time and the meter. */
export function AudioStrip() {
  const recording = useStudio((s) => s.recording)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!recording) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [recording])
  return (
    <div className="studio-audio-strip" data-studio-audio-strip>
      <span className={`studio-strip-dot ${recording ? 'rec' : ''}`}>
        <Mic size={14} />
      </span>
      <span className="studio-strip-time">{recording ? formatDuration(now - recording.startedAt) : 'Ready'}</span>
      <Meter which="mic" />
      <ClipWarning />
    </div>
  )
}

/** After an audio-only recording: show it, and clean it up. */
export function LastRecording() {
  const last = useStudio((s) => s.lastRecording)
  const info = useStudio((s) => s.lastRecordingInfo)
  const trimming = useStudio((s) => s.trimming)
  const recording = useStudio((s) => !!s.recording)
  if (!last || !info?.audioOnly || recording) return null
  const t = trimming?.source === last ? trimming : null
  const name = last.split(/[\\/]/).pop()
  return (
    <div className="studio-last" data-studio-last>
      <div className="studio-row">
        <span className="studio-last-name" title={last}>
          {name}
        </span>
        <span className="studio-hint">{formatDuration(info.length * 1000)}</span>
        <button className="icon-btn" title="Show in its folder" onClick={() => void window.api.studioReveal(last)}>
          <FolderOpen size={14} />
        </button>
      </div>
      {info.clips > 0 && <p className="studio-problem">The mic was too loud {info.clips === 1 ? 'once' : `${info.clips} times`} in this one. Listen back before you use it.</p>}
      {!t && (
        <button className="btn" onClick={() => void trimRecording(last)} data-studio-trim title="Shortens long pauses, takes out mouth clicks and evens out the loudness, as set under Recording">
          <Sparkles size={13} /> Clean up
        </button>
      )}
      {t?.state === 'working' && <p className="studio-hint">{t.message ?? 'Cleaning it up…'}</p>}
      {t?.state === 'done' && t.path && (
        <div className="studio-row">
          <p className="studio-ok">
            <Check size={13} /> {t.message} Saved as “{t.path.split(/[\\/]/).pop()}”.
          </p>
          <button className="icon-btn" title="Show it in its folder" onClick={() => void window.api.studioReveal(t.path!)}>
            <FolderOpen size={14} />
          </button>
        </div>
      )}
      {t?.state === 'error' && (
        <p className="studio-problem">
          {t.message}{' '}
          {t.needsFfmpeg ? (
            <button className="btn" onClick={() => void getConverterAndTrim()}>
              <Download size={12} /> Download it (about 25 MB)
            </button>
          ) : (
            <button className="btn" onClick={() => void trimRecording(last)}>
              Try again
            </button>
          )}
        </p>
      )}
    </div>
  )
}

/** The clean-up settings, under Recording in audio-only mode. */
export function TrimSettingsBox() {
  const trim = useStudio((s) => s.trim)
  return (
    <div className="studio-trim" data-studio-trim-settings>
      <label className="studio-check">
        <input type="checkbox" checked={trim.auto} onChange={(e) => setTrim({ auto: e.target.checked })} /> Clean up after every recording
      </label>
      <label className="studio-check" title="Finds the little spikes of mouth clicks, lip smacks and tongue clicks and smooths them away.">
        <input type="checkbox" checked={trim.declick} onChange={(e) => setTrim({ declick: e.target.checked })} /> Remove mouth clicks
      </label>
      <label className="studio-check" title="Learns the steady hiss or hum under your voice and takes it out. Leave off if your room is quiet.">
        <input type="checkbox" checked={trim.denoise} onChange={(e) => setTrim({ denoise: e.target.checked })} /> Remove hiss
      </label>
      <label className="studio-check" title="Makes it as loud as other YouTube voiceovers (−16 LUFS), without going over.">
        <input type="checkbox" checked={trim.loudness} onChange={(e) => setTrim({ loudness: e.target.checked })} /> Even out the loudness for YouTube
      </label>
      <label className="studio-check">
        <input type="checkbox" checked={trim.pauses} onChange={(e) => setTrim({ pauses: e.target.checked })} /> Shorten long pauses
      </label>
      {trim.pauses && (
        <>
          <label>
            Pauses longer than {trim.longerThan.toFixed(1)} s
            <input type="range" min={0.3} max={3} step={0.1} value={trim.longerThan} onChange={(e) => setTrim({ longerThan: Number(e.target.value) })} />
          </label>
          <label>
            …down to {trim.keep.toFixed(2)} s
            <input
              type="range"
              min={0}
              max={Math.min(1.5, trim.longerThan)}
              step={0.05}
              value={Math.min(trim.keep, trim.longerThan)}
              onChange={(e) => setTrim({ keep: Number(e.target.value) })}
            />
          </label>
          <label>
            Counts as silence below {trim.threshold} dB
            <input type="range" min={-70} max={-25} step={1} value={trim.threshold} onChange={(e) => setTrim({ threshold: Number(e.target.value) })} />
          </label>
        </>
      )}
      <p className="studio-hint">Your recording is kept as it is; the cleaned-up one is saved beside it as a WAV, ready for your editor.</p>
    </div>
  )
}
