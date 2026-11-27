import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { AudioWaveform, FolderOpen, Loader2, Pause, Play, Repeat, Scissors, SkipBack, Upload, X, ZoomIn, ZoomOut } from 'lucide-react'
import { FILE_MANAGER } from '@shared/platform'
import { computerPaths, getDrag } from '../../lib/dnd'
import { encodeAudio, type AudioFormat } from '../../lib/convert/audio'
import {
  clamp,
  fadeGain,
  fitFades,
  formatTime,
  partsFrom,
  resultLength,
  resultTime,
  trimChannels,
  trimmedName
} from '../../lib/audioTrim'
import { closeAudio, openAudio, setSelection, useAudioEditor, type OpenAudio } from '../../store/audioEditor'
import { TimeBox, Waveform, type View } from './Waveform'

/**
 * The audio editor: open a sound file, see its waveform, listen, pick the part to keep (or to cut
 * out) and save it as a new MP3 or WAV. Everything happens on this computer; the original file is
 * never changed.
 */

const FADES = [0, 0.5, 1, 2, 3, 5]
/** The closest you can zoom: this many seconds across the whole waveform. */
const MIN_VIEW = 0.2

export default function AudioEditorPage() {
  const audio = useAudioEditor((s) => s.audio)
  const loading = useAudioEditor((s) => s.loading)
  const error = useAudioEditor((s) => s.error)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const choose = (): void => input.current?.click()

  const isFileDrag = (e: DragEvent): boolean => (!getDrag() || computerPaths(getDrag()).length > 0) && e.dataTransfer.types.includes('Files')
  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    setDragging(false)
    if (!isFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files[0]
    if (file) void openAudio(file.name, file)
  }

  return (
    <div
      className={`audio-editor ${dragging ? 'over' : ''}`}
      data-audio-editor
      onDragOver={onDragOver}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
      onDrop={onDrop}
    >
      <div className="audio-editor-inner">
        <h2>
          <Scissors size={18} /> Audio editor
        </h2>
        {!audio && (
          <p className="convert-intro">
            Trim a song, voice memo or recording: pick the part you want to keep, or a part to cut out, listen to how it will sound, and save it as a new MP3 or WAV. It all
            happens on this computer, and your original file is left as it is.
          </p>
        )}

        {loading ? (
          <div className="audio-editor-loading" data-audio-editor-loading>
            <Loader2 size={16} className="spin" /> Opening {loading}…
          </div>
        ) : audio ? (
          <Editor key={audio.name + audio.duration} audio={audio} onOpenAnother={choose} />
        ) : (
          <button className={`convert-drop ${dragging ? 'over' : ''}`} onClick={choose} data-audio-editor-drop>
            <Upload size={22} strokeWidth={1.5} />
            <strong>Drop a sound file here, or click to choose one</strong>
            <span>MP3, WAV, M4A, AAC, FLAC, OGG and Opus, or the sound from a video</span>
          </button>
        )}
        {error && !loading && <p className="audio-editor-error">{error}</p>}

        <input
          ref={input}
          type="file"
          accept="audio/*,video/*,.m4a,.flac,.opus,.ogg"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void openAudio(file.name, file)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}

interface Playing {
  nodes: AudioBufferSourceNode[]
  gain: GainNode
  /** When (on the AudioContext's clock) the first part starts. */
  startedAt: number
  parts: [number, number][]
}

function Editor({ audio, onOpenAnother }: { audio: OpenAudio; onOpenAnother: () => void }) {
  const sel = useAudioEditor((s) => s.sel)
  const mode = useAudioEditor((s) => s.mode)
  const fadeIn = useAudioEditor((s) => s.fadeIn)
  const fadeOut = useAudioEditor((s) => s.fadeOut)
  const format = useAudioEditor((s) => s.format)
  const { duration } = audio

  const [view, setView] = useState<View>({ from: 0, to: duration })
  const [playhead, setPlayheadState] = useState(sel.start)
  const playheadRef = useRef(sel.start)
  const setPlayhead = (t: number): void => {
    playheadRef.current = t
    setPlayheadState(t)
  }
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const loopRef = useRef(loop)
  loopRef.current = loop
  const [saving, setSaving] = useState<number | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const ctxRef = useRef<AudioContext | null>(null)
  const bufferRef = useRef<AudioBuffer | null>(null)
  const playRef = useRef<Playing | null>(null)
  const frame = useRef(0)

  const stop = useCallback((): void => {
    const p = playRef.current
    playRef.current = null
    cancelAnimationFrame(frame.current)
    if (p) {
      for (const n of p.nodes) {
        n.onended = null
        try {
          n.stop()
        } catch {
          // Already stopped.
        }
      }
      p.gain.disconnect()
    }
    setPlaying(false)
  }, [])

  const start = (from: number): void => {
    stop()
    const ctx = (ctxRef.current ??= new AudioContext())
    void ctx.resume()
    if (!bufferRef.current) {
      const buf = ctx.createBuffer(audio.channels.length, audio.channels[0].length, audio.sampleRate)
      audio.channels.forEach((ch, i) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, i))
      bufferRef.current = buf
    }
    const { sel, mode, fadeIn, fadeOut } = useAudioEditor.getState()
    const parts = partsFrom(from, sel, mode, duration)
    if (!parts.length) return
    const length = resultLength(sel, mode, duration)
    const fades = fitFades(length, fadeIn, fadeOut)
    const p0 = resultTime(parts[0][0], sel, mode, duration)
    const t0 = ctx.currentTime + 0.03

    // The fades, as you'll hear them in the saved file.
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(fadeGain(p0, length, fades.fadeIn, fades.fadeOut), t0)
    for (const at of [fades.fadeIn, length - fades.fadeOut, length].filter((x) => x > p0).sort((a, b) => a - b)) {
      gain.gain.linearRampToValueAtTime(fadeGain(at, length, fades.fadeIn, fades.fadeOut), t0 + at - p0)
    }

    let t = t0
    const nodes = parts.map(([a, b]) => {
      const n = ctx.createBufferSource()
      n.buffer = bufferRef.current
      n.connect(gain)
      n.start(t, a, b - a)
      t += b - a
      return n
    })
    const playingNow: Playing = { nodes, gain, startedAt: t0, parts }
    nodes[nodes.length - 1].onended = () => {
      if (playRef.current !== playingNow) return
      if (loopRef.current) start(partsFrom(Infinity, useAudioEditor.getState().sel, useAudioEditor.getState().mode, duration)[0][0])
      else {
        stop()
        setPlayhead(parts[parts.length - 1][1])
      }
    }
    playRef.current = playingNow
    setPlaying(true)
    const tick = (): void => {
      const p = playRef.current
      if (!p) return
      let left = Math.max(0, ctx.currentTime - p.startedAt)
      let at = p.parts[0][0]
      for (const [a, b] of p.parts) {
        at = a + Math.min(left, b - a)
        if (left <= b - a) break
        left -= b - a
      }
      setPlayhead(at)
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }

  const toggle = (): void => {
    if (playRef.current) stop()
    else {
      // From the end of the part you're keeping, start again from its beginning.
      const parts = partsFrom(playheadRef.current, sel, mode, duration)
      const atEnd = parts.length > 0 && playheadRef.current >= parts[parts.length - 1][1] - 0.01
      start(atEnd ? parts[0][0] : playheadRef.current)
    }
  }

  // Changing what's kept while it plays carries on from the same place with the change.
  useEffect(() => {
    if (!playRef.current) return
    const t = setTimeout(() => playRef.current && start(playheadRef.current), 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, mode, fadeIn, fadeOut])

  useEffect(
    () => () => {
      stop()
      void ctxRef.current?.close()
    },
    [stop]
  )

  const seek = (t: number): void => {
    const to = clamp(t, 0, duration)
    if (playRef.current) start(to)
    else setPlayhead(to)
  }

  const zoom = (factor: number, around = (view.from + view.to) / 2): void => {
    const span = clamp((view.to - view.from) * factor, Math.min(MIN_VIEW, duration), duration)
    const k = (around - view.from) / (view.to - view.from || 1)
    const from = clamp(around - span * k, 0, duration - span)
    setView({ from, to: from + span })
  }
  const zoomToSelection = (): void => {
    const pad = (sel.end - sel.start) * 0.08
    const span = clamp(sel.end - sel.start + pad * 2, Math.min(MIN_VIEW, duration), duration)
    const from = clamp((sel.start + sel.end) / 2 - span / 2, 0, duration - span)
    setView({ from, to: from + span })
  }
  const zoomed = view.to - view.from < duration - 1e-6

  // Zoomed in, the waveform follows along while it plays.
  useEffect(() => {
    if (!playing || !zoomed) return
    const span = view.to - view.from
    if (playhead > view.to || playhead < view.from) {
      const from = clamp(playhead - span * 0.1, 0, duration - span)
      setView({ from, to: from + span })
    }
  }, [playhead, playing, zoomed, view.from, view.to, duration])

  const save = async (): Promise<void> => {
    stop()
    setSaving(0)
    setSaved(null)
    setProblem(null)
    try {
      // Lets "Saving…" show before the work starts.
      await new Promise((r) => setTimeout(r, 20))
      const trimmed = trimChannels(audio.channels, audio.sampleRate, sel, mode, { fadeIn, fadeOut })
      const data = await encodeAudio(trimmed, format, (p) => setSaving(p))
      setSaving(1)
      const path = await window.api.exportFile(trimmedName(audio.name, format), format, data)
      if (path) setSaved(path)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(null)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('input, select, textarea')) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const step = e.shiftKey ? 0.1 : 1
    if (e.key === ' ') toggle()
    else if (e.key === '[' || e.key === 'i' || e.key === 'I') setSelection({ start: playheadRef.current, end: Math.max(sel.end, playheadRef.current) })
    else if (e.key === ']' || e.key === 'o' || e.key === 'O') setSelection({ start: Math.min(sel.start, playheadRef.current), end: playheadRef.current })
    else if (e.key === 'ArrowLeft') seek(playheadRef.current - step)
    else if (e.key === 'ArrowRight') seek(playheadRef.current + step)
    else if (e.key === 'Home') seek(0)
    else if (e.key === 'End') seek(duration)
    else return
    e.preventDefault()
  }

  const length = resultLength(sel, mode, duration)
  const set = useAudioEditor.setState

  return (
    <div className="ae" tabIndex={0} onKeyDown={onKeyDown} data-audio-editor-open>
      <div className="ae-file">
        <AudioWaveform size={16} className="convert-kind" />
        <div className="convert-name">
          <span title={audio.name}>{audio.name}</span>
          <small>
            {formatTime(duration)} long · {audio.channels.length === 1 ? 'mono' : 'stereo'}
          </small>
        </div>
        <button className="btn" onClick={onOpenAnother} data-audio-editor-open-another>
          <FolderOpen size={13} /> Open another
        </button>
        <button
          className="icon-btn"
          title="Close"
          onClick={() => {
            stop()
            closeAudio()
          }}
        >
          <X size={14} />
        </button>
      </div>

      <Waveform audio={audio} view={view} sel={sel} mode={mode} playhead={playhead} onSeek={seek} onZoom={zoom} onPan={(from) => setView((v) => ({ from, to: from + (v.to - v.from) }))} onSelect={setSelection} />

      {zoomed && (
        <input
          className="ae-scroll"
          type="range"
          min={0}
          max={duration - (view.to - view.from)}
          step="any"
          value={view.from}
          onChange={(e) => {
            const from = Number(e.target.value)
            setView((v) => ({ from, to: from + (v.to - v.from) }))
          }}
          aria-label="Scroll the waveform"
        />
      )}

      <div className="ae-transport">
        <button className="btn btn-primary ae-play" onClick={toggle} title="Play or pause (Space)" data-audio-editor-play>
          {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? 'Pause' : 'Play'}
        </button>
        <button className="icon-btn" title="Back to the start of what’s kept" onClick={() => seek(partsFrom(Infinity, sel, mode, duration)[0]?.[0] ?? 0)}>
          <SkipBack size={15} />
        </button>
        <button className={`icon-btn ${loop ? 'active' : ''}`} title="Play it over and over" aria-pressed={loop} onClick={() => setLoop(!loop)} data-audio-editor-loop>
          <Repeat size={15} />
        </button>
        <span className="ae-clock" data-audio-editor-clock>
          {formatTime(playhead)} <small>/ {formatTime(duration)}</small>
        </span>
        <div className="convert-spacer" />
        <button className="icon-btn" title="Zoom out" disabled={!zoomed} onClick={() => zoom(2)}>
          <ZoomOut size={15} />
        </button>
        <button className="icon-btn" title="Zoom in (or Ctrl + scroll on the waveform)" disabled={view.to - view.from <= MIN_VIEW} onClick={() => zoom(0.5, playing || (playhead > view.from && playhead < view.to) ? playhead : undefined)}>
          <ZoomIn size={15} />
        </button>
        <button className="btn ae-small" onClick={zoomToSelection}>
          Zoom to selection
        </button>
        {zoomed && (
          <button className="btn ae-small" onClick={() => setView({ from: 0, to: duration })}>
            Show all
          </button>
        )}
      </div>

      <div className="ae-panel">
        <div className="ae-row">
          <div className="segmented" role="radiogroup" aria-label="What to do with the selection">
            {(['keep', 'cut'] as const).map((m) => (
              <button key={m} className={mode === m ? 'selected' : ''} role="radio" aria-checked={mode === m} onClick={() => set({ mode: m })} data-audio-editor-mode={m}>
                {m === 'keep' ? 'Keep the selection' : 'Cut the selection out'}
              </button>
            ))}
          </div>
        </div>
        <div className="ae-row ae-times">
          <TimeBox label="Start" value={sel.start} max={duration} onChange={(start) => setSelection({ start, end: sel.end })} onFromPlayhead={() => setSelection({ start: playheadRef.current, end: Math.max(sel.end, playheadRef.current) })} hint="[ or I" />
          <TimeBox label="End" value={sel.end} max={duration} onChange={(end) => setSelection({ start: sel.start, end })} onFromPlayhead={() => setSelection({ start: Math.min(sel.start, playheadRef.current), end: playheadRef.current })} hint="] or O" />
          <div className="ae-length">
            <span>Selected</span>
            <strong>{formatTime(sel.end - sel.start)}</strong>
          </div>
        </div>
        <div className="ae-row">
          <label className="convert-option">
            <span>Fade in</span>
            <select className="select" value={fadeIn} onChange={(e) => set({ fadeIn: Number(e.target.value) })} data-audio-editor-fade-in>
              {FADES.map((f) => (
                <option key={f} value={f}>
                  {f ? `${f} second${f === 1 ? '' : 's'}` : 'None'}
                </option>
              ))}
            </select>
          </label>
          <label className="convert-option">
            <span>Fade out</span>
            <select className="select" value={fadeOut} onChange={(e) => set({ fadeOut: Number(e.target.value) })} data-audio-editor-fade-out>
              {FADES.map((f) => (
                <option key={f} value={f}>
                  {f ? `${f} second${f === 1 ? '' : 's'}` : 'None'}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="convert-actions">
        <span className="ae-result">
          The new file will be <strong>{formatTime(length)}</strong> long
          {mode === 'cut' ? `, with ${formatTime(sel.end - sel.start)} taken out` : ''}.
        </span>
        <div className="convert-spacer" />
        <label className="convert-to">
          <span>as</span>
          <select className="select" value={format} disabled={saving !== null} onChange={(e) => set({ format: e.target.value as AudioFormat })} data-audio-editor-format>
            <option value="mp3">MP3</option>
            <option value="wav">WAV (best quality)</option>
          </select>
        </label>
        <button className="btn btn-primary" disabled={saving !== null || length <= 0} onClick={() => void save()} data-audio-editor-save>
          {saving !== null ? (
            <>
              <Loader2 size={13} className="spin" /> Saving… {Math.round(saving * 100)}%
            </>
          ) : (
            <>
              <Scissors size={13} /> Save trimmed audio
            </>
          )}
        </button>
      </div>
      {problem && <p className="audio-editor-error">{problem}</p>}
      {saved && (
        <p className="convert-saved" data-audio-editor-saved>
          Saved.{' '}
          <button className="link-button" onClick={() => window.api.showExported(saved)}>
            <FolderOpen size={13} /> Show in {FILE_MANAGER}
          </button>
        </p>
      )}
      <p className="ae-keys">
        Drag on the waveform to pick a part, drag its edges to fine-tune, and click to move where it plays from. Space plays and pauses; [ and ] set the start and end where
        it’s playing.
      </p>
    </div>
  )
}
