import { useEffect, useRef, useState } from 'react'
import { Loader2, Pause, Play, Scissors } from 'lucide-react'
import { localSongUrl, type LocalSong } from '@shared/localMusic'
import { decodeAudio, SAMPLE_RATE } from '../../lib/convert/audio'
import { clamp, fixSelection, formatTime, type Selection } from '../../lib/audioTrim'
import { errorMessage } from '../../lib/paths'
import { applyLibrary, localPause, stopLocal, useLocalMusic } from '../../store/localMusic'
import { currentPosition, useMusic } from '../../store/music'
import { notify } from '../../store/notify'
import type { OpenAudio } from '../../store/audioEditor'
import { TimeBox, Waveform } from '../AudioEditor/Waveform'

/**
 * A small window for cutting the bits off the start or end of a song in your music (an intro or
 * outro that came with a YouTube download, say). The song file itself is trimmed; the original goes
 * to the Recycle Bin / Bin.
 */

/** "Hear the end" plays this much before where the song will stop. */
const END_PREVIEW = 4

export default function TrimSong({ song, onClose }: { song: LocalSong; onClose: () => void }) {
  const [audio, setAudio] = useState<OpenAudio | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [sel, setSelState] = useState<Selection>({ start: 0, end: 0 })
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const ctx = useRef<AudioContext | null>(null)
  const buffer = useRef<AudioBuffer | null>(null)
  const node = useRef<AudioBufferSourceNode | null>(null)
  const frame = useRef(0)
  const selRef = useRef(sel)
  selRef.current = sel
  const playheadRef = useRef(0)

  /** Whether this song is the one in the player. */
  const isCurrent = (): boolean => {
    const { queue, index } = useLocalMusic.getState()
    return useMusic.getState().local && queue[index]?.path === song.path
  }

  // Opening the window pauses the music, so you can listen to the trim instead, and starts where the song was.
  const [resumeAt] = useState(() => {
    const { state, at } = useMusic.getState()
    if (!isCurrent() || state?.source !== 'local') return 0
    if (state.playing) localPause()
    return currentPosition(state, at) / 1000
  })

  useEffect(() => {
    let gone = false
    void (async () => {
      try {
        const res = await fetch(localSongUrl(song.path), { cache: 'no-store' })
        if (!res.ok) throw new Error('The song’s file couldn’t be read.')
        const channels = await decodeAudio(await res.arrayBuffer())
        const duration = channels[0].length / SAMPLE_RATE
        if (gone) return
        setAudio({ name: song.title, channels, sampleRate: SAMPLE_RATE, duration })
        setSelState({ start: 0, end: duration })
        setHead(clamp(resumeAt, 0, duration))
      } catch (err) {
        if (!gone) setProblem(errorMessage(err))
      }
    })()
    return () => {
      gone = true
    }
  }, [song.path, song.title])

  const stop = (): void => {
    cancelAnimationFrame(frame.current)
    if (node.current) {
      node.current.onended = null
      try {
        node.current.stop()
      } catch {
        // Already stopped.
      }
    }
    node.current = null
    setPlaying(false)
  }

  useEffect(
    () => () => {
      stop()
      void ctx.current?.close()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const setHead = (t: number): void => {
    playheadRef.current = t
    setPlayhead(t)
  }

  /** Plays from `from` to where the song will end. */
  const play = (from: number): void => {
    if (!audio) return
    stop()
    const end = selRef.current.end
    const at = clamp(from, 0, end - 0.05)
    const c = (ctx.current ??= new AudioContext())
    void c.resume()
    if (!buffer.current) {
      const b = c.createBuffer(audio.channels.length, audio.channels[0].length, audio.sampleRate)
      audio.channels.forEach((ch, i) => b.copyToChannel(ch as Float32Array<ArrayBuffer>, i))
      buffer.current = b
    }
    const n = c.createBufferSource()
    n.buffer = buffer.current
    n.connect(c.destination)
    const t0 = c.currentTime + 0.02
    n.start(t0, at, end - at)
    n.onended = () => {
      if (node.current !== n) return
      stop()
      setHead(end)
    }
    node.current = n
    setPlaying(true)
    const tick = (): void => {
      if (node.current !== n) return
      setHead(Math.min(end, at + Math.max(0, c.currentTime - t0)))
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }

  const select = (next: Selection): void => {
    if (!audio) return
    setSelState(fixSelection(next, audio.duration))
    if (node.current) stop()
  }

  const seek = (t: number): void => {
    if (node.current) play(t)
    else setHead(t)
  }

  const trim = async (): Promise<void> => {
    if (!audio) return
    stop()
    setBusy(true)
    try {
      // The player lets go of the song first, or Windows won't let the file be replaced.
      if (isCurrent()) stopLocal()
      applyLibrary(await window.api.musicTagsTrim(song.path, sel.start, sel.end))
      notify(`Trimmed “${song.title}”. The untrimmed song is in the ${navigator.platform.startsWith('Mac') ? 'Bin' : 'Recycle Bin'} if you want it back.`, 'info')
      onClose()
    } catch (err) {
      setProblem(errorMessage(err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setBusy(false)
    }
  }

  const changed = audio && (sel.start > 0.01 || sel.end < audio.duration - 0.01)
  const cutStart = sel.start
  const cutEnd = audio ? audio.duration - sel.end : 0

  return (
    <div className="modal-backdrop mp-modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="modal mp-modal wide mp-trim"
        role="dialog"
        aria-label="Trim song"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape' && !busy) onClose()
          if (e.key === ' ' && audio && !(e.target as HTMLElement).closest('input, button')) {
            e.preventDefault()
            if (playing) stop()
            else play(playheadRef.current >= sel.end - 0.05 ? sel.start : playheadRef.current)
          }
        }}
        tabIndex={-1}
        data-mp-dialog="Trim song"
      >
        <h3>
          <Scissors size={15} /> Trim “{song.title}”
        </h3>
        <p className="mp-modal-intro">Drag the green edges in to cut off the start or end, then listen to check. Only the green part is kept.</p>
        {!audio ? (
          problem ? (
            <p className="setting-warning">{problem}</p>
          ) : (
            <div className="mp-trim-loading">
              <Loader2 size={15} className="spin" /> Reading the song…
            </div>
          )
        ) : (
          <>
            <div className="ae">
              <Waveform audio={audio} view={{ from: 0, to: audio.duration }} sel={sel} mode="keep" playhead={playhead} onSeek={seek} onZoom={() => undefined} onPan={() => undefined} onSelect={select} />
            </div>
            <div className="mp-trim-row">
              <button className="btn btn-primary ae-play" onClick={() => (playing ? stop() : play(playheadRef.current >= sel.end - 0.05 ? sel.start : Math.max(playheadRef.current, sel.start)))} data-mp-trim-play>
                {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? 'Pause' : 'Play'}
              </button>
              <button className="btn" onClick={() => play(sel.start)} data-mp-trim-hear-start>
                Hear the start
              </button>
              <button className="btn" onClick={() => play(sel.end - END_PREVIEW)} data-mp-trim-hear-end>
                Hear the end
              </button>
              <span className="ae-clock">{formatTime(playhead)}</span>
            </div>
            <div className="mp-trim-row ae-times">
              <TimeBox label="Start" value={sel.start} max={audio.duration} onChange={(start) => select({ start, end: sel.end })} onFromPlayhead={() => select({ start: playheadRef.current, end: sel.end })} hint="where it’s playing" />
              <TimeBox label="End" value={sel.end} max={audio.duration} onChange={(end) => select({ start: sel.start, end })} onFromPlayhead={() => select({ start: sel.start, end: playheadRef.current })} hint="where it’s playing" />
            </div>
            <p className="mp-nav-note" data-mp-trim-summary>
              {changed
                ? `Cuts ${[cutStart > 0.01 && `${formatTime(cutStart)} off the start`, cutEnd > 0.01 && `${formatTime(cutEnd)} off the end`].filter(Boolean).join(' and ')}. The song will be ${formatTime(sel.end - sel.start)} long.`
                : 'Nothing is cut yet.'}{' '}
              The sound isn’t re-encoded, so it keeps its quality, details and cover.
            </p>
            {problem && <p className="setting-warning">{problem}</p>}
          </>
        )}
        <div className="mp-modal-actions">
          <button className="btn btn-primary" disabled={!changed || busy} onClick={() => void trim()} data-mp-trim-save>
            {busy ? (
              <>
                <Loader2 size={13} className="spin" /> Trimming…
              </>
            ) : (
              'Trim song'
            )}
          </button>
          <button className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
