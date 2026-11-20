import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AudioLines, Captions, Download, FileAudio, Play, RotateCcw, Square, Trash2, X } from 'lucide-react'
import { clock, transcribeModelById, TRANSCRIBE_MODELS, type SpokenWord } from '@shared/transcribe'
import type { VideoItem, VideoProject } from '../../lib/videos'
import { vaultUrl } from '../../lib/fileKinds'
import { MARKER_INFO } from '../../lib/script'
import { lineUp, sentences, type LinedUp, type Transcript } from '../../lib/transcript'
import { UNDO_KEY, useUndoChanges } from '../../lib/undo'
import { notify } from '../../store/notify'
import { deleteTranscript, loadTranscript, makeTranscript, setUpTranscripts, stopTranscript, useTranscripts, watchTranscriber } from '../../store/transcripts'
import Private from '../Streamer/Private'
import './postProduction.css'

/**
 * The video page's post-production section: an auto transcript of each recording, lined up with
 * the script so every line and marker gets the time it was said at.
 */

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** Ctrl+K "Transcripts": asks the open video page to show this section. */
export const POST_PRODUCTION_EVENT = 'videos:post-production'

export function PostProductionSection({ project: p, has }: { project: VideoProject; has: (path: string) => boolean }) {
  const recordings = p.items.filter((i) => i.kind === 'recording' && i.path)
  const engine = useTranscripts((s) => s.engine)
  const [open, setOpen] = useState<VideoItem | null>(null)
  const box = useRef<HTMLElement>(null)
  useEffect(() => watchTranscriber(), [])
  useEffect(() => {
    const show = (): void => box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.addEventListener(POST_PRODUCTION_EVENT, show)
    return () => window.removeEventListener(POST_PRODUCTION_EVENT, show)
  }, [])

  return (
    <section className="video-section post-production" ref={box} data-post-production>
      <h3>
        <Captions size={15} /> Transcripts
        <span className="video-section-hint">What you said in each recording, lined up with the script</span>
      </h3>
      {engine && engine.state !== 'ready' && <SetUp />}
      {!recordings.length && <div className="pp-empty">Add a recording above, then Orbit can write down what you said and line it up with the script.</div>}
      {recordings.map((i) => (
        <RecordingRow key={i.id} project={p} item={i} missing={!has(i.path!)} ready={engine?.state === 'ready'} onOpen={() => setOpen(i)} />
      ))}
      {engine?.state === 'ready' && recordings.length > 0 && (
        <div className="pp-foot">
          Made on this computer with the {transcribeModelById(engine.model)?.name.toLowerCase() ?? ''} speech model
          {engine.gpu === false ? ' (on the processor, so it takes about as long as the recording)' : ''}.{' '}
          <button
            className="link-btn"
            onClick={() => void window.api.transcriberRemove().then((e) => useTranscripts.setState({ engine: e }))}
            title="Frees the space it takes; your transcripts are kept"
          >
            Remove the model
          </button>
        </div>
      )}
      {open && <TranscriptView project={p} item={open} onClose={() => setOpen(null)} />}
    </section>
  )
}

function SetUp() {
  const engine = useTranscripts((s) => s.engine)!
  const [model, setModel] = useState<string>('')
  if (engine.state === 'downloading') {
    const pct = Math.round((engine.progress ?? 0) * 100)
    return (
      <div className="pp-setup" data-pp-setup>
        <div className="pp-setup-text">
          Downloading the speech model ({transcribeModelById(engine.model)?.name ?? ''})… {pct}%{engine.bytes ? ` of ${Math.round(engine.bytes / 1e6)} MB` : ''}
        </div>
        <div className="pp-bar">
          <div style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }
  return (
    <div className="pp-setup" data-pp-setup>
      <div className="pp-setup-text">
        Transcripts are made on this computer by Whisper, a speech-to-text model, so your recordings never leave it. It’s a one-time download
        {engine.ffmpeg ? '' : ' (with ffmpeg, which reads the sound out of recordings)'}.{engine.error && <div className="pp-error">{engine.error}</div>}
      </div>
      <div className="video-actions">
        <select className="text-input pp-model" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Speech model">
          <option value="">Best for this computer</option>
          {TRANSCRIBE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} (about {m.mb} MB)
            </option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={() => void setUpTranscripts(model || undefined)} data-pp-setup-go>
          <Download size={13} /> Set up transcripts
        </button>
      </div>
    </div>
  )
}

function RecordingRow({ project: p, item, missing, ready, onOpen }: { project: VideoProject; item: VideoItem; missing: boolean; ready: boolean; onOpen: () => void }) {
  const t = useTranscripts((s) => s.byItem[item.id])
  const job = useTranscripts((s) => s.job)
  const [found, setFound] = useState<number | null>(null)
  const name = fileName(item.path!)
  useEffect(() => void loadTranscript(item.id), [item.id])
  // How much of the script is in it, for the row.
  useEffect(() => {
    setFound(null)
    if (!t || !p.script) return
    let live = true
    window.api.readNote(p.script).then(
      (text) => live && setFound(lineUp(text, t.words).found),
      () => undefined
    )
    return () => {
      live = false
    }
  }, [t, p.script])
  const busy = job?.itemId === item.id
  const progress = busy ? job.progress : null
  const pct = progress ? Math.round(progress.progress * 100) : 0

  let status: ReactNode
  if (busy) {
    status = (
      <span className="pp-status">
        {!progress || progress.stage === 'reading' ? 'Reading the sound…' : `Listening… ${clock(progress.at ?? 0)} of ${clock(progress.length ?? 0)}`}
        <span className="pp-bar small">
          <span style={{ width: `${progress?.stage === 'listening' ? pct : 0}%` }} />
        </span>
      </span>
    )
  } else if (t) {
    status = (
      <span className="pp-status">
        {clock(t.length)} · {t.words.length} words
        {found !== null && ` · ${Math.round(found * 100)}% of the script`}
      </span>
    )
  } else status = <span className="pp-status faint">{missing ? 'Can’t find this recording' : 'No transcript yet'}</span>

  return (
    <div className="pp-row" data-pp-row={item.id}>
      <FileAudio size={14} className="pp-row-icon" />
      <span className="pp-row-name" title={item.path}>
        <Private>{name}</Private>
      </span>
      {status}
      <span className="pp-row-actions">
        {busy ? (
          <button className="btn" onClick={stopTranscript} data-pp-stop>
            <Square size={12} /> Stop
          </button>
        ) : t ? (
          <>
            <button className="btn btn-primary" onClick={onOpen} data-pp-open>
              <AudioLines size={13} /> Open
            </button>
            <button className="icon-btn" title="Make it again" disabled={!ready || missing || !!job} onClick={() => void makeTranscript(item.id, item.path!, name)}>
              <RotateCcw size={13} />
            </button>
            <button
              className="icon-btn danger"
              title="Delete the transcript (the recording stays)"
              onClick={() => void deleteTranscript(item.id, name).then(() => notify(`Deleted the transcript. ${UNDO_KEY} brings it back.`, 'info'), notify)}
            >
              <Trash2 size={13} />
            </button>
          </>
        ) : (
          <button className="btn" disabled={!ready || missing || !!job} title={ready ? '' : 'Set up transcripts first'} onClick={() => void makeTranscript(item.id, item.path!, name)} data-pp-make>
            <Captions size={13} /> Make transcript
          </button>
        )}
      </span>
    </div>
  )
}

// ---------- the transcript ----------

type Tab = 'script' | 'said'

function TranscriptView({ project: p, item, onClose }: { project: VideoProject; item: VideoItem; onClose: () => void }) {
  const t = useTranscripts((s) => s.byItem[item.id])
  const [script, setScript] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>(p.script ? 'script' : 'said')
  const [now, setNow] = useState(0)
  const audio = useRef<HTMLAudioElement>(null)
  const [scriptAgain, setScriptAgain] = useState(0)
  useUndoChanges('transcripts', () => void loadTranscript(item.id))
  useEffect(() => {
    if (!p.script) return setScript(null)
    let live = true
    window.api.readNote(p.script).then(
      (text) => live && setScript(text),
      () => live && setScript(null)
    )
    return () => {
      live = false
    }
  }, [p.script, scriptAgain])
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  const lined = useMemo(() => (t && script !== null ? lineUp(script, t.words) : null), [t, script])

  const play = (at: number): void => {
    const a = audio.current
    if (!a) return
    a.currentTime = Math.max(0, at - 0.15)
    void a.play()
  }

  if (!t) return null
  return (
    <div className="modal-backdrop pp-backdrop" onMouseDown={onClose}>
      <div className="modal pp-modal" onMouseDown={(e) => e.stopPropagation()} data-transcript-view>
        <div className="pp-head">
          <div className="pp-title">
            <Captions size={16} />
            <Private>{fileName(item.path!)}</Private>
          </div>
          <div className="pp-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'script'}
              className={tab === 'script' ? 'on' : ''}
              disabled={!p.script}
              onClick={() => setTab('script')}
              title={p.script ? '' : 'This video has no script note'}
            >
              Lined up with the script
            </button>
            <button role="tab" aria-selected={tab === 'said'} className={tab === 'said' ? 'on' : ''} onClick={() => setTab('said')}>
              What you said
            </button>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            <X size={15} />
          </button>
        </div>
        <audio ref={audio} className="pp-audio" src={vaultUrl(item.path!)} controls preload="metadata" onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} />
        <Summary t={t} lined={tab === 'script' ? lined : null} onRefresh={() => setScriptAgain((n) => n + 1)} />
        <div className="pp-body">
          {tab === 'script' && lined && script !== null ? <LinedUpScript text={script} lined={lined} now={now} play={play} /> : <Said words={t.words} now={now} play={play} />}
        </div>
      </div>
    </div>
  )
}

function Summary({ t, lined, onRefresh }: { t: Transcript; lined: LinedUp | null; onRefresh: () => void }) {
  const model = transcribeModelById(t.model)
  const timed = lined?.markers.filter((m) => m.time !== null && m.marker.type === 'IMAGE').length ?? 0
  const images = lined?.markers.filter((m) => m.marker.type === 'IMAGE').length ?? 0
  return (
    <div className="pp-summary">
      <span>{clock(t.length)} long</span>
      {lined && (
        <span title="Script words heard in the recording">
          <strong>{Math.round(lined.found * 100)}%</strong> of the script found
        </span>
      )}
      {lined && images > 0 && (
        <span>
          {timed} of {images} pictures timed
        </span>
      )}
      <span className="faint">
        Made{' '}
        {new Date(t.made).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short'
        })}
        {model ? ` with the ${model.name.toLowerCase()} model` : ''}
      </span>
      {lined && (
        <button className="btn pp-refresh" onClick={onRefresh} title="Read the script note again (after changing it)">
          <RotateCcw size={12} /> Script changed?
        </button>
      )}
    </div>
  )
}

/** The script, line by line, with when each line and marker was said. */
function LinedUpScript({ text, lined, now, play }: { text: string; lined: LinedUp; now: number; play: (at: number) => void }) {
  const { words, match, times, markers, extras } = lined
  const rows = useMemo(() => {
    const out: {
      from: number
      to: number
      heading: boolean
      w0: number
      w1: number
      m: typeof markers
      start: number | null
    }[] = []
    let at = 0
    let wi = 0
    for (const line of text.split('\n')) {
      const from = at
      const to = at + line.length
      at = to + 1
      const w0 = wi
      while (wi < words.length && words[wi].from < to) wi++
      const m = markers.filter((x) => x.marker.from >= from && x.marker.from < to)
      const heading = /^#{1,6}\s/.test(line)
      if (w0 === wi && !m.length && !heading) continue
      let start: number | null = null
      for (let k = w0; k < wi && start === null; k++) start = times[k]
      if (start === null) start = m.find((x) => x.time !== null)?.time ?? null
      out.push({ from, to, heading, w0, w1: wi, m, start })
    }
    return out
  }, [text, words, markers, times])
  const emphasis = markers.filter((m) => m.marker.type === 'EMPHASIS').map((m) => m.marker)
  const stressed = (from: number): boolean => emphasis.some((m) => from > m.from && from < m.to)
  let current = -1
  rows.forEach((r, i) => {
    if (r.start !== null && r.start <= now + 0.05) current = i
  })
  const before = extras.get(-1)

  return (
    <div className="pp-script" data-pp-script>
      {before && (
        <div className="pp-line">
          <button className="pp-time" onClick={() => play(before[0].s)}>
            {clock(before[0].s)}
          </button>
          <div className="pp-text">
            <Extra words={before} play={play} />
          </div>
        </div>
      )}
      {rows.map((r, i) => {
        if (r.heading)
          return (
            <div key={r.from} className="pp-line heading">
              <span className="pp-time none" />
              <div className="pp-text">{text.slice(r.from, r.to).replace(/^#+\s*/, '')}</div>
            </div>
          )
        // The line as pieces: plain text, words, markers and words said that aren't in the script.
        const items: { at: number; end: number; node: ReactNode }[] = []
        for (let k = r.w0; k < r.w1; k++) {
          const w = words[k]
          const said = match[k] >= 0
          items.push({
            at: w.from,
            end: w.to,
            node: (
              <Fragment key={`w${k}`}>
                <span
                  className={`pp-word ${said ? '' : 'skipped'} ${stressed(w.from) ? 'stressed' : ''}`}
                  title={said ? `${clock(times[k]!)} — click to play from here` : times[k] !== null ? 'Not heard in the recording (skipped, or said differently)' : 'Not in this recording'}
                  onClick={() => times[k] !== null && play(times[k]!)}
                >
                  {text.slice(w.from, w.to)}
                </span>
                {extras.get(k) && <Extra words={extras.get(k)!} play={play} />}
              </Fragment>
            )
          })
        }
        for (const { marker, time } of r.m) {
          if (marker.type === 'EMPHASIS') continue
          const info = MARKER_INFO[marker.type]
          items.push({
            at: marker.from,
            end: marker.to,
            node: (
              <button
                key={`m${marker.from}`}
                className={`pp-marker pp-marker-${marker.type.toLowerCase()} ${time === null ? 'untimed' : ''}`}
                title={time === null ? `${info.label}: not in this recording` : `${info.label} at ${clock(time)} — click to play from here`}
                onClick={() => time !== null && play(time)}
                data-pp-marker={marker.type}
              >
                <span aria-hidden="true">{info.icon}</span>
                {marker.value && <span className="pp-marker-value">{marker.value}</span>}
                {time !== null && <span className="pp-marker-time">{clock(time)}</span>}
              </button>
            )
          })
        }
        items.sort((a, b) => a.at - b.at)
        const parts: ReactNode[] = []
        let pos = r.from
        for (const it of items) {
          if (it.at < pos) continue
          if (it.at > pos) parts.push(gap(text.slice(pos, it.at)))
          parts.push(it.node)
          pos = it.end
        }
        if (pos < r.to) parts.push(gap(text.slice(pos, r.to)))
        return (
          <div key={r.from} className={`pp-line ${i === current ? 'now' : ''}`}>
            {r.start !== null ? (
              <button className="pp-time" onClick={() => play(r.start!)} title="Play from here">
                {clock(r.start)}
              </button>
            ) : (
              <span className="pp-time none" title="Not in this recording">
                –
              </span>
            )}
            <div className="pp-text">{parts}</div>
          </div>
        )
      })}
    </div>
  )
}

/** Text between words, without an emphasis marker's brackets (its words are shown in bold instead). */
const gap = (s: string): string => s.replace(/\[EMPHASIS:\s*/g, '').replace(/^[ \t]*\](?!\()/, '')

/** Words said that aren't in the script. */
function Extra({ words, play }: { words: SpokenWord[]; play: (at: number) => void }) {
  return (
    <span className="pp-extra" title="Said, but not in the script" onClick={() => play(words[0].s)}>
      {' '}
      {words.map((w) => w.w).join(' ')}{' '}
    </span>
  )
}

/** The transcript on its own, as sentences. */
function Said({ words, now, play }: { words: SpokenWord[]; now: number; play: (at: number) => void }) {
  const list = useMemo(() => sentences(words), [words])
  if (!list.length) return <div className="pp-empty">No speech was heard in this recording.</div>
  let current = -1
  list.forEach((s, i) => {
    if (s.start <= now + 0.05) current = i
  })
  return (
    <div className="pp-script" data-pp-said>
      {list.map((s, i) => (
        <div key={i} className={`pp-line ${i === current ? 'now' : ''}`}>
          <button className="pp-time" onClick={() => play(s.start)} title="Play from here">
            <Play size={9} /> {clock(s.start)}
          </button>
          <div className="pp-text">{s.text}</div>
        </div>
      ))}
    </div>
  )
}
