import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { create } from 'zustand'
import { Check, ClipboardCopy, CornerDownLeft, Flag, HelpCircle, Loader2, Pause, Play, Plus, RotateCcw, Scissors, Search, Square, Trash2, Undo2, Volume2, X } from 'lucide-react'
import { entityById, findQuote, findScene, newId, sceneText, type Chapter, type PlotThread, type Scene, type Story } from '@shared/writing'
import { commentHeat, openThreads, scenesSince, speechChunks } from '@shared/writingTools'
import { notify } from '../../store/notify'
import { change, deleteCut, openScene, useWriting } from '../../store/writingStudio'
import { aiWhere, showAiProblem, stuckQuestions } from '../../lib/writingAi'

/**
 * The Write view's extra tools on the right: setups and payoffs, readers' comments, the cutting
 * room floor and the stuck button, plus reading a scene aloud. They talk to the page through a
 * small shared store: what's selected, text to put in at the cursor, and what's being read.
 */

export const useEditorBridge = create<{
  sel: { from: number; to: number; text: string }
  insert: { text: string; nonce: number } | null
  follow: { pos: number; nonce: number } | null
  reading: { from: number; to: number } | null
}>(() => ({ sel: { from: 0, to: 0, text: '' }, insert: null, follow: null, reading: null }))

type Jump = (scene: string, from: number, to: number) => void

const ago = (t: number): string => {
  const mins = Math.round((Date.now() - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function jumpToQuote(story: Story, scene: string, quote: string, onJump: Jump): void {
  const placed = findScene(story, scene)
  const at = placed ? findQuote(sceneText(placed.scene), quote) : null
  if (at) onJump(scene, at.start, at.end)
  else if (placed) {
    openScene(scene)
    notify('Those words have changed since, so the scene is open instead.', 'info')
  } else notify('That scene has been deleted.', 'info')
}

const short = (s: string, n = 90): string => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s)

// ---------- setups and payoffs ----------

export function ThreadsPanel({ story, scene, onJump }: { story: Story; scene: Scene; onJump: Jump }) {
  const sel = useEditorBridge((s) => s.sel)
  const picked = sel.text.trim().length >= 3 ? sel.text.trim().slice(0, 400) : ''
  const [label, setLabel] = useState('')
  const [payFor, setPayFor] = useState('')
  const open = openThreads(story)
  const paid = story.threads.filter((t) => t.payoffs.length)
  const dropped = story.threads.filter((t) => t.dropped && !t.payoffs.length)

  const plant = (): void => {
    const name = label.trim() || short(picked, 40)
    change(`Marked “${name}” as a setup`, (s) => {
      s.threads.push({ id: newId(), label: name, setup: { scene: scene.id, quote: picked }, payoffs: [], dropped: false })
    })
    setLabel('')
  }
  const pay = (): void => {
    const id = payFor || open[0]?.id
    if (!id) return
    change('Paid off a setup', (s) => {
      const t = s.threads.find((x) => x.id === id)
      if (t) {
        t.payoffs.push({ scene: scene.id, quote: picked })
        t.dropped = false
      }
    })
    setPayFor('')
  }

  return (
    <div className="ws-panel" data-ws-threads>
      <h3>Setups and payoffs</h3>
      {picked ? (
        <div className="ws-picked" data-ws-picked>
          <q>{short(picked, 140)}</q>
          <div className="ws-picked-row">
            <input className="ws-input" placeholder="Call it… (e.g. The silver ring)" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && plant()} data-ws-thread-label />
            <button className="btn btn-primary" onClick={plant} data-ws-plant>
              <Flag size={13} /> It’s a setup
            </button>
          </div>
          {open.length > 0 && (
            <div className="ws-picked-row">
              <select className="ws-select" value={payFor || open[0].id} onChange={(e) => setPayFor(e.target.value)} aria-label="Which setup this pays off">
                {open.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={pay} data-ws-payoff>
                <Check size={13} /> Pays it off
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="ws-panel-tip">Select some words in the scene to mark them as a setup, like a gun in a drawer or a promise, or as the payoff of one.</p>
      )}

      <div className="ws-thread-group">
        <h4>
          Still open <span className="ws-count">{open.length}</span>
        </h4>
        {!open.length && <p className="ws-panel-empty">Nothing waiting to pay off.</p>}
        {open.map((t, i) => (
          <ThreadRow key={t.id} story={story} t={t} i={i} here={scene.id} onJump={onJump} />
        ))}
      </div>
      {paid.length > 0 && (
        <details className="ws-thread-group">
          <summary>
            Paid off <span className="ws-count">{paid.length}</span>
          </summary>
          {paid.map((t, i) => (
            <ThreadRow key={t.id} story={story} t={t} i={i} here={scene.id} onJump={onJump} />
          ))}
        </details>
      )}
      {dropped.length > 0 && (
        <details className="ws-thread-group">
          <summary>
            Let go <span className="ws-count">{dropped.length}</span>
          </summary>
          {dropped.map((t, i) => (
            <ThreadRow key={t.id} story={story} t={t} i={i} here={scene.id} onJump={onJump} />
          ))}
        </details>
      )}
    </div>
  )
}

function ThreadRow({ story, t, i, here, onJump }: { story: Story; t: PlotThread; i: number; here: string; onJump: Jump }) {
  const since = scenesSince(story, t.setup.scene, here)
  const state = t.payoffs.length ? 'paid' : t.dropped ? 'dropped' : 'open'
  return (
    <div className={`ws-thread ${state}`} style={{ '--i': i } as CSSProperties} data-ws-thread={t.id}>
      <button className="ws-thread-main" onClick={() => jumpToQuote(story, t.setup.scene, t.setup.quote, onJump)} title="Show the setup">
        <b>{t.label}</b>
        <q>{short(t.setup.quote)}</q>
        <span className="ws-thread-when">
          {findScene(story, t.setup.scene)?.scene.title ?? 'Deleted scene'}
          {state === 'open' && since !== null && since > 0 && ` · ${since} scene${since === 1 ? '' : 's'} ago`}
        </span>
      </button>
      {t.payoffs.map((p, n) => (
        <button key={n} className="ws-thread-payoff" onClick={() => jumpToQuote(story, p.scene, p.quote, onJump)} title="Show the payoff">
          <Check size={11} /> {findScene(story, p.scene)?.scene.title ?? 'Deleted scene'}: <q>{short(p.quote, 60)}</q>
        </button>
      ))}
      <div className="ws-thread-actions">
        {state === 'open' && (
          <button className="link-button" onClick={() => change(`Let go of “${t.label}”`, (s) => void (s.threads.find((x) => x.id === t.id)!.dropped = true))} title="It doesn't need paying off">
            Let it go
          </button>
        )}
        {state === 'dropped' && (
          <button className="link-button" onClick={() => change(null, (s) => void (s.threads.find((x) => x.id === t.id)!.dropped = false))}>
            <RotateCcw size={11} /> Keep it open
          </button>
        )}
        {state === 'paid' && (
          <button className="link-button" onClick={() => change('Unmarked a payoff', (s) => void (s.threads.find((x) => x.id === t.id)!.payoffs = []))}>
            <Undo2 size={11} /> Not paid off
          </button>
        )}
        <button className="icon-btn" onClick={() => change(`Removed “${t.label}”`, (s) => void (s.threads = s.threads.filter((x) => x.id !== t.id)))} title="Remove (Ctrl+Z brings it back)">
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

// ---------- reader comments ----------

export function CommentsPanel({ story, chapter, onJump }: { story: Story; chapter: Chapter; onJump: Jump }) {
  const [draft, setDraft] = useState('')
  const comments = story.comments[chapter.id] ?? []
  const heat = useMemo(() => commentHeat(story, chapter, comments), [story, chapter, comments])
  const add = (): void => {
    const text = draft.trim()
    if (!text) return
    change('Added a comment', (s) => {
      s.comments[chapter.id] = [...(s.comments[chapter.id] ?? []), { id: newId(), text: text.slice(0, 20_000), at: Date.now() }]
    })
    setDraft('')
  }
  return (
    <div className="ws-panel" data-ws-comments>
      <h3>Reader comments</h3>
      <p className="ws-panel-tip">Paste comments on “{chapter.title}” from AO3 or Wattpad. The lines readers quote or react to light up in the chapter.</p>
      <textarea className="ws-input ws-textarea" rows={3} placeholder="Paste a comment…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && add()} data-ws-comment-input />
      <button className="btn btn-primary" onClick={add} disabled={!draft.trim()} data-ws-comment-add>
        <Plus size={13} /> Add comment
      </button>
      {heat.lines.length > 0 && (
        <div className="ws-heat">
          <h4>Lines readers picked out</h4>
          {heat.lines.slice(0, 12).map((l, i) => (
            <button key={`${l.scene}${l.start}`} className="ws-heat-row" style={{ '--i': i } as CSSProperties} onClick={() => onJump(l.scene, l.start, l.end)} data-ws-heat-row>
              <span className={`ws-heat-count lvl${Math.min(3, l.comments.length)}`}>{l.comments.length}</span>
              <q>{short(l.text, 120)}</q>
            </button>
          ))}
        </div>
      )}
      {heat.names.length > 0 && (
        <div className="ws-heat">
          <h4>Who they talk about</h4>
          <div className="ws-heat-names">
            {heat.names.map((n) => (
              <span key={n.entity} className="ws-chip">
                {entityById(story, n.entity)?.name} <b>{n.count}</b>
              </span>
            ))}
          </div>
        </div>
      )}
      {comments.length > 0 && (
        <details className="ws-comment-list">
          <summary>
            All comments <span className="ws-count">{comments.length}</span>
          </summary>
          {comments.map((c) => (
            <div key={c.id} className="ws-comment">
              <p>{c.text}</p>
              <button className="icon-btn" onClick={() => change('Removed a comment', (s) => void (s.comments[chapter.id] = (s.comments[chapter.id] ?? []).filter((x) => x.id !== c.id)))} title="Remove">
                <X size={11} />
              </button>
            </div>
          ))}
        </details>
      )}
    </div>
  )
}

/** Lines readers picked out, for lighting up in the scene. */
export function lovedMarks(story: Story, chapter: Chapter, sceneId: string): { from: number; to: number; level: number; title: string }[] {
  const comments = story.comments[chapter.id]
  if (!comments?.length) return []
  return commentHeat(story, chapter, comments)
    .lines.filter((l) => l.scene === sceneId)
    .map((l) => ({ from: l.start, to: l.end, level: l.comments.length, title: `${l.comments.length} reader comment${l.comments.length === 1 ? '' : 's'} picked this out` }))
}

// ---------- the cutting room floor ----------

export function CutsPanel({ story }: { story: Story }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const list = story.cuts.filter((c) => !q.trim() || c.text.toLowerCase().includes(q.trim().toLowerCase()))
  const putBack = (text: string): void => useEditorBridge.setState({ insert: { text, nonce: Date.now() } })
  return (
    <div className="ws-panel" data-ws-cuts>
      <h3>Cutting room floor</h3>
      <p className="ws-panel-tip">Anything longer than a sentence or two that you delete lands here. Drag a piece back into the page, or put it back at the cursor.</p>
      {story.cuts.length > 3 && (
        <label className="ws-search">
          <Search size={13} />
          <input className="ws-input" placeholder="Search your cuts" value={q} onChange={(e) => setQ(e.target.value)} data-ws-cuts-search />
        </label>
      )}
      {!story.cuts.length && (
        <div className="ws-empty small">
          <Scissors size={20} />
          <p>Nothing cut yet.</p>
        </div>
      )}
      <ul className="ws-cut-list">
        {list.slice(0, 80).map((c, i) => (
          <li
            key={c.id}
            className={`ws-cut ${open === c.id ? 'open' : ''}`}
            style={{ '--i': Math.min(i, 12) } as CSSProperties}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', c.text)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            data-ws-cut={c.id}
          >
            <button className="ws-cut-text" onClick={() => setOpen(open === c.id ? null : c.id)} title={open === c.id ? 'Show less' : 'Show all of it'}>
              {c.text}
            </button>
            <div className="ws-cut-foot">
              <span className="ws-cut-from">
                {c.from} · {ago(c.at)}
              </span>
              <button className="icon-btn" onClick={() => putBack(c.text)} title="Put it back at the cursor" data-ws-cut-back>
                <CornerDownLeft size={12} />
              </button>
              <button className="icon-btn" onClick={() => void navigator.clipboard.writeText(c.text).then(() => notify('Copied.', 'info'))} title="Copy">
                <ClipboardCopy size={12} />
              </button>
              <button className="icon-btn" onClick={() => deleteCut(c.id)} title="Throw it away (Ctrl+Z brings it back)">
                <Trash2 size={12} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------- the stuck button ----------

const asked = new Map<string, string[][]>()

export function StuckPanel({ story, scene }: { story: Story; scene: Scene }) {
  const ai = useWriting((s) => s.ai)
  const [busy, setBusy] = useState(false)
  const [rounds, setRounds] = useState<string[][]>(() => asked.get(scene.id) ?? [])
  useEffect(() => setRounds(asked.get(scene.id) ?? []), [scene.id])
  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const qs = await stuckQuestions(useWriting.getState().story ?? story, scene.id)
      const next = [qs, ...(asked.get(scene.id) ?? [])].slice(0, 5)
      asked.set(scene.id, next)
      setRounds(next)
    } catch (err) {
      showAiProblem(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="ws-panel" data-ws-stuck>
      <h3>Stuck?</h3>
      <p className="ws-panel-tip">The AI asks three questions about “{scene.title}”, using what the story brain knows. It never writes any of it for you. {aiWhere(ai)}</p>
      <button className="btn btn-primary ws-stuck-btn" onClick={() => void run()} disabled={busy} data-ws-stuck-run>
        {busy ? <Loader2 size={14} className="spin" /> : <HelpCircle size={14} />} {busy ? 'Thinking…' : rounds.length ? 'Three more' : 'I’m stuck'}
      </button>
      {rounds.map((qs, r) => (
        <ol key={rounds.length - r} className={`ws-questions ${r ? 'old' : ''}`}>
          {qs.map((q, i) => (
            <li key={i} style={{ '--i': i } as CSSProperties}>
              {q}
            </li>
          ))}
        </ol>
      ))}
    </div>
  )
}

// ---------- read it to me ----------

const RATES = [0.8, 1, 1.15, 1.3, 1.6]

export function ReadAloudBar({ scene, onClose }: { scene: Scene; onClose: () => void }) {
  const text = sceneText(scene)
  const chunks = useMemo(() => speechChunks(text), [text])
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => (typeof speechSynthesis === 'undefined' ? [] : speechSynthesis.getVoices()))
  const [voice, setVoice] = useState<string>(() => localStorage.getItem('ws-voice') ?? '')
  const [rate, setRate] = useState<number>(() => Number(localStorage.getItem('ws-rate')) || 1)
  const [at, setAt] = useState<number | null>(null)
  const [paused, setPaused] = useState(false)
  const playing = useRef(false)
  const supported = typeof speechSynthesis !== 'undefined'

  useEffect(() => {
    if (!supported) return
    const load = (): void => setVoices(speechSynthesis.getVoices())
    speechSynthesis.addEventListener('voiceschanged', load)
    return () => speechSynthesis.removeEventListener('voiceschanged', load)
  }, [supported])

  const stop = (): void => {
    playing.current = false
    if (supported) speechSynthesis.cancel()
    setAt(null)
    setPaused(false)
    useEditorBridge.setState({ reading: null })
  }
  // Stop when the scene changes or the bar closes.
  useEffect(() => stop, [scene.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const speak = (i: number): void => {
    if (!supported || i >= chunks.length) return stop()
    const c = chunks[i]
    const u = new SpeechSynthesisUtterance(c.text)
    const v = voices.find((x) => x.voiceURI === voice)
    if (v) u.voice = v
    u.rate = rate
    u.onend = () => {
      if (playing.current) speak(i + 1)
    }
    u.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        notify('This computer couldn’t read that aloud. Try another voice.', 'info')
        stop()
      }
    }
    setAt(i)
    useEditorBridge.setState({ reading: { from: c.start, to: c.end }, follow: { pos: c.start, nonce: Date.now() } })
    speechSynthesis.speak(u)
  }

  const play = (): void => {
    if (!supported) return
    if (paused) {
      speechSynthesis.resume()
      setPaused(false)
      return
    }
    if (at !== null) {
      speechSynthesis.pause()
      setPaused(true)
      return
    }
    // From the cursor (or the start).
    const cursor = useEditorBridge.getState().sel.from
    const from = Math.max(0, chunks.findIndex((c) => c.end > cursor))
    playing.current = true
    speechSynthesis.cancel()
    speak(from)
  }

  const restartWith = (fn: () => void): void => {
    fn()
    if (at !== null && !paused) {
      // A new voice or speed takes effect from the bit being read.
      playing.current = false
      speechSynthesis.cancel()
      const i = at
      setTimeout(() => {
        playing.current = true
        speak(i)
      }, 60)
    }
  }

  return (
    <div className="ws-readaloud" data-ws-readaloud>
      <Volume2 size={15} className="ws-readaloud-icon" />
      {!supported ? (
        <span className="ws-hint">Reading aloud isn’t available on this computer.</span>
      ) : (
        <>
          <button className={`ws-play ${at !== null && !paused ? 'on' : ''}`} onClick={play} disabled={!chunks.length} title={at === null ? 'Read from the cursor' : paused ? 'Carry on' : 'Pause'} data-ws-read-play>
            {at !== null && !paused ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button className="icon-btn" onClick={stop} disabled={at === null} title="Stop">
            <Square size={13} />
          </button>
          <div className="ws-read-progress" aria-hidden>
            <span style={{ width: `${chunks.length && at !== null ? ((at + 1) / chunks.length) * 100 : 0}%` }} />
          </div>
          <select
            className="ws-select"
            value={voice}
            onChange={(e) =>
              restartWith(() => {
                setVoice(e.target.value)
                localStorage.setItem('ws-voice', e.target.value)
              })
            }
            aria-label="Voice"
          >
            <option value="">Default voice</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name}
                {v.localService ? '' : ' (online)'}
              </option>
            ))}
          </select>
          <select
            className="ws-select ws-rate"
            value={rate}
            onChange={(e) =>
              restartWith(() => {
                setRate(Number(e.target.value))
                localStorage.setItem('ws-rate', e.target.value)
              })
            }
            aria-label="Speed"
          >
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </>
      )}
      <button
        className="icon-btn"
        onClick={() => {
          stop()
          onClose()
        }}
        title="Close"
      >
        <X size={14} />
      </button>
    </div>
  )
}

/** The panel buttons' little counts. */
export function toolCounts(story: Story, chapter: Chapter): { open: number; comments: number; cuts: number } {
  return { open: openThreads(story).length, comments: story.comments[chapter.id]?.length ?? 0, cuts: story.cuts.length }
}
