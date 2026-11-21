import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AudioLines, Captions, Clapperboard, Copy, Crosshair, Download, FileAudio, Image as ImageIcon, Play, RotateCcw, Square, Trash2, Undo2, X } from 'lucide-react'
import { clock, transcribeModelById, TRANSCRIBE_MODELS, type SpokenWord } from '@shared/transcribe'
import type { VideoItem, VideoProject } from '../../lib/videos'
import { vaultUrl } from '../../lib/fileKinds'
import { MARKER_INFO } from '../../lib/script'
import { lineUp, sentences, type LinedUp, type Transcript } from '../../lib/transcript'
import { UNDO_KEY, useUndoChanges } from '../../lib/undo'
import { notify } from '../../store/notify'
import {
  deleteTranscript,
  loadCues,
  loadShotOverrides,
  loadTranscript,
  makeTranscript,
  setShotPrefer,
  setShotTime,
  setUpTranscripts,
  stopTranscript,
  useCues,
  useTranscripts,
  watchTranscriber
} from '../../store/transcripts'
import { buildShots, fineClock, parseClock, shotListText, type Shot } from '../../lib/shotList'
import { resolveImage } from '../../lib/script'
import { vaultImages } from '../Editor/scriptTools'
import { usePrefs } from '../../store/prefs'
import Private from '../Streamer/Private'
import './postProduction.css'

/**
 * The video page's post-production section: an auto transcript of each recording, lined up with
 * the script so every line and marker gets the time it was said at, and the shot list (when each
 * picture and clip goes on screen) built from it or from the teleprompter's times.
 */

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** Ctrl+K "Transcripts": asks the open video page to show this section. */
export const POST_PRODUCTION_EVENT = 'videos:post-production'

export function PostProductionSection({ project: p, has }: { project: VideoProject; has: (path: string) => boolean }) {
  const recordings = p.items.filter((i) => i.kind === 'recording' && i.path)
  const engine = useTranscripts((s) => s.engine)
  const [open, setOpen] = useState<{ item: VideoItem; tab: Tab } | null>(null)
  const box = useRef<HTMLElement>(null)
  useEffect(() => watchTranscriber(), [])
  useEffect(() => {
    const show = (e: Event): void => {
      box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      // Ctrl+K "Shot list": straight to the first recording's shot list.
      const first = p.items.find((i) => i.kind === 'recording' && i.path)
      if ((e as CustomEvent<string | undefined>).detail === 'shots' && first) setOpen({ item: first, tab: 'shots' })
    }
    window.addEventListener(POST_PRODUCTION_EVENT, show)
    return () => window.removeEventListener(POST_PRODUCTION_EVENT, show)
  }, [p.items])

  return (
    <section className="video-section post-production" ref={box} data-post-production>
      <h3>
        <Captions size={15} /> Transcripts and shot lists
        <span className="video-section-hint">What you said in each recording, and when each picture goes on screen</span>
      </h3>
      {engine && engine.state !== 'ready' && <SetUp />}
      {!recordings.length && <div className="pp-empty">Add a recording above, then Orbit can write down what you said and line it up with the script.</div>}
      {recordings.map((i) => (
        <RecordingRow key={i.id} project={p} item={i} missing={!has(i.path!)} ready={engine?.state === 'ready'} onOpen={(tab) => setOpen({ item: i, tab })} />
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
      {open && <TranscriptView key={open.item.id} project={p} item={open.item} start={open.tab} onClose={() => setOpen(null)} />}
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

function RecordingRow({ project: p, item, missing, ready, onOpen }: { project: VideoProject; item: VideoItem; missing: boolean; ready: boolean; onOpen: (tab: Tab) => void }) {
  const t = useTranscripts((s) => s.byItem[item.id])
  const cues = useCues((s) => s.byItem[item.id])
  useEffect(() => void loadCues(item.id, item.path!), [item.id, item.path])
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
        {cues?.length ? ' · teleprompter times' : ''}
      </span>
    )
  } else
    status = (
      <span className="pp-status faint">
        {missing ? 'Can’t find this recording' : 'No transcript yet'}
        {!missing && cues?.length ? ' · teleprompter times' : ''}
      </span>
    )
  const shotButton = p.script && (t || cues?.length) && (
    <button className="btn" onClick={() => onOpen('shots')} title="When each picture and clip goes on screen" data-pp-shots>
      <Clapperboard size={13} /> Shot list
    </button>
  )

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
            {shotButton}
            <button className="btn btn-primary" onClick={() => onOpen(p.script ? 'script' : 'said')} data-pp-open>
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
          <>
            {shotButton}
            <button className="btn" disabled={!ready || missing || !!job} title={ready ? '' : 'Set up transcripts first'} onClick={() => void makeTranscript(item.id, item.path!, name)} data-pp-make>
              <Captions size={13} /> Make transcript
            </button>
          </>
        )}
      </span>
    </div>
  )
}

// ---------- the transcript ----------

type Tab = 'script' | 'said' | 'shots'

function TranscriptView({ project: p, item, start, onClose }: { project: VideoProject; item: VideoItem; start: Tab; onClose: () => void }) {
  const t = useTranscripts((s) => s.byItem[item.id])
  const cues = useCues((s) => s.byItem[item.id])
  const [script, setScript] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>(start)
  const [now, setNow] = useState(0)
  const [duration, setDuration] = useState<number | null>(null)
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

  if (!t && !cues?.length) return null
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
              disabled={!p.script || !t}
              onClick={() => setTab('script')}
              title={!p.script ? 'This video has no script note' : !t ? 'Make a transcript first' : ''}
            >
              Lined up with the script
            </button>
            <button role="tab" aria-selected={tab === 'said'} className={tab === 'said' ? 'on' : ''} disabled={!t} onClick={() => setTab('said')}>
              What you said
            </button>
            <button role="tab" aria-selected={tab === 'shots'} className={tab === 'shots' ? 'on' : ''} disabled={!p.script} onClick={() => setTab('shots')} data-pp-tab-shots>
              Shot list
            </button>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            <X size={15} />
          </button>
        </div>
        <audio
          ref={audio}
          className="pp-audio"
          src={vaultUrl(item.path!)}
          controls
          preload="metadata"
          onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        />
        {t && tab !== 'shots' && <Summary t={t} lined={tab === 'script' ? lined : null} onRefresh={() => setScriptAgain((n) => n + 1)} />}
        <div className="pp-body">
          {tab === 'shots' && script !== null ? (
            <ShotList project={p} item={item} text={script} lined={lined} length={t?.length ?? duration} now={now} play={play} onRefresh={() => setScriptAgain((n) => n + 1)} />
          ) : tab === 'script' && lined && script !== null ? (
            <LinedUpScript text={script} lined={lined} now={now} play={play} />
          ) : t ? (
            <Said words={t.words} now={now} play={play} />
          ) : null}
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

// ---------- the shot list ----------

const SOURCE_TEXT: Record<string, string> = {
  transcript: 'From the transcript',
  teleprompter: 'From the teleprompter (when it reached the reading line)',
  you: 'Set by you'
}

/** When each picture and clip goes on screen, with a way to fix any time that's off. */
function ShotList({
  project: p,
  item,
  text,
  lined,
  length,
  now,
  play,
  onRefresh
}: {
  project: VideoProject
  item: VideoItem
  text: string
  lined: LinedUp | null
  length: number | null
  now: number
  play: (at: number) => void
  onRefresh: () => void
}) {
  const cues = useCues((s) => s.byItem[item.id])
  const own = useCues((s) => s.shots[item.id])
  const folder = usePrefs((s) => s.prefs.attachmentFolder)
  useEffect(() => void loadShotOverrides(item.id), [item.id])
  useUndoChanges('transcripts', onRefresh)
  const shots = useMemo(() => buildShots(text, { lined, cues, overrides: own?.times, prefer: own?.prefer, length: length ?? undefined }), [text, lined, cues, own, length])
  const images = vaultImages()
  const pictures = shots.filter((s) => s.kind !== 'SECTION')
  const timed = pictures.filter((s) => s.time !== null).length
  let current: string | null = null
  for (const s of [...pictures].filter((x) => x.time !== null).sort((a, b) => a.time! - b.time!)) if (s.time! <= now + 0.05) current = s.key

  const copy = (): void => {
    void navigator.clipboard.writeText(shotListText(shots, p.title || '')).then(
      () => notify('Copied the shot list.', 'info'),
      () => notify('Couldn’t copy the shot list.')
    )
  }

  if (!shots.length) return <div className="pp-empty pp-shots-empty">The script has no pictures, clips or sections yet. Add some with / in the script note ([IMAGE: …], [CLIP: …], [SECTION: …]).</div>

  return (
    <div className="pp-shots" data-pp-shot-list>
      <div className="pp-shots-bar">
        <span>
          <strong>{timed}</strong> of {pictures.length} pictures and clips timed
        </span>
        {lined && !!cues?.length && (
          <label className="pp-prefer">
            Time from
            <select
              className="text-input"
              value={own?.prefer ?? 'transcript'}
              onChange={(e) => void setShotPrefer(item.id, e.target.value as 'transcript' | 'teleprompter').catch(notify)}
              data-pp-prefer
            >
              <option value="transcript">the transcript</option>
              <option value="teleprompter">the teleprompter</option>
            </select>
          </label>
        )}
        <span className="pp-shots-tools">
          <button className="btn" onClick={onRefresh} title="Read the script note again (after changing it)">
            <RotateCcw size={12} /> Script changed?
          </button>
          <button className="btn" onClick={copy} data-pp-copy-shots>
            <Copy size={12} /> Copy as text
          </button>
        </span>
      </div>
      {!lined && !cues?.length && <div className="pp-empty">Make a transcript (or record with the teleprompter) to time these.</div>}
      {shots.map((s) =>
        s.kind === 'SECTION' ? (
          <div key={s.key} className="pp-shot-section">
            <span className="pp-shot-time-text">{s.time === null ? '–' : clock(s.time)}</span>
            <span>§ {s.value || 'Section'}</span>
          </div>
        ) : (
          <ShotRow key={s.key} shot={s} item={item} picture={s.kind === 'IMAGE' ? resolveImage(s.value, images, folder) : null} current={s.key === current} now={now} play={play} />
        )
      )}
    </div>
  )
}

function ShotRow({ shot: s, item, picture, current, now, play }: { shot: Shot; item: VideoItem; picture: string | null; current: boolean; now: number; play: (at: number) => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const name = s.kind === 'CLIP' ? `the clip “${s.value}”` : s.value || 'a picture'
  const set = (time: number | null): void => void setShotTime(item.id, s.key, time, name).catch(notify)
  const commit = (): void => {
    if (editing === null) return
    const t = parseClock(editing)
    setEditing(null)
    if (t === null) return notify('Type a time like 2:14.', 'info')
    set(t)
  }
  return (
    <div className={`pp-shot ${current ? 'now' : ''} ${s.time === null ? 'untimed' : ''}`} data-pp-shot={s.key}>
      {editing !== null ? (
        <input
          className="text-input pp-shot-input"
          autoFocus
          value={editing}
          aria-label="Start time"
          onChange={(e) => setEditing(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              e.stopPropagation()
              setEditing(null)
            }
          }}
        />
      ) : (
        <button className="pp-shot-time" onClick={() => setEditing(s.time === null ? '' : fineClock(s.time))} title="Click to type a time">
          {s.time === null ? '--:--' : fineClock(s.time)}
        </button>
      )}
      <span className="pp-shot-thumb">{picture ? <img src={vaultUrl(picture)} alt="" loading="lazy" /> : s.kind === 'CLIP' ? <Clapperboard size={16} /> : <ImageIcon size={16} />}</span>
      <span className="pp-shot-name">
        {s.kind === 'CLIP' && <span className="pp-shot-kind">Clip</span>}
        <Private>{s.value || '(no name)'}</Private>
        {s.kind === 'IMAGE' && !picture && (
          <span className="pp-shot-missing" title="No picture with this name in your notes">
            not found
          </span>
        )}
      </span>
      <span className="pp-shot-length" title="How long it’s on screen (until the next one)">
        {s.length !== null ? `${s.length < 10 ? s.length.toFixed(1) : Math.round(s.length)}s` : ''}
      </span>
      <span className={`pp-shot-source ${s.source ?? 'none'}`} title={s.source ? SOURCE_TEXT[s.source] : 'Not in this recording'}>
        {s.source === 'you' ? 'yours' : s.source === 'teleprompter' ? 'prompter' : s.source === 'transcript' ? 'transcript' : 'not timed'}
      </span>
      <span className="pp-shot-actions">
        <button className="icon-btn" disabled={s.time === null} onClick={() => s.time !== null && play(s.time)} title="Play from here">
          <Play size={12} />
        </button>
        <button className="icon-btn" disabled={s.time === null} onClick={() => s.time !== null && set(s.time - 0.5)} title="Half a second earlier">
          −½
        </button>
        <button className="icon-btn" disabled={s.time === null} onClick={() => s.time !== null && set(s.time + 0.5)} title="Half a second later">
          +½
        </button>
        <button className="icon-btn" onClick={() => set(now)} title={`Start it where the recording is now (${clock(now)})`}>
          <Crosshair size={12} />
        </button>
        {s.source === 'you' && (
          <button className="icon-btn" onClick={() => set(null)} title="Go back to the transcript or teleprompter time">
            <Undo2 size={12} />
          </button>
        )}
      </span>
    </div>
  )
}
