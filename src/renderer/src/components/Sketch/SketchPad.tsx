import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Copy, Eraser, Grid3x3, Highlighter, Pen, Redo2, Rows3, ScanText, Trash2, Undo2, X } from 'lucide-react'
import { useUI } from '../../store/ui'
import { usePrefs } from '../../store/prefs'
import { useVault } from '../../store/vault'
import { notify } from '../../store/notify'
import { refreshAiStatus } from '../../store/ai'
import { insertBlockIntoActiveNote, insertIntoActiveNote, refreshLinkDecorations } from '../../lib/editorController'
import { inkPng, pickReader, READER_NAMES, type Reader } from '../../lib/handwriting'
import { errorMessage } from '../../lib/paths'
import {
  bumpSketch,
  emptySketch,
  loadSketch,
  PAPER_COLOUR,
  paperLines,
  sketchFileName,
  sketchToSvg,
  strokeHits,
  strokeOpacity,
  strokePath,
  type Sketch,
  type SketchPaper,
  type Stroke
} from '../../lib/sketch'
import { showKeys } from '@shared/platform'

type Tool = 'pen' | 'highlighter' | 'eraser'

const PEN_COLOURS = ['#1f2328', '#2f6fdf', '#e5484d', '#2f9e5b', '#f08c00', '#7c5cff']
const HIGHLIGHTER_COLOURS = ['#ffd43b', '#8ce99a', '#faa2c1', '#74c0fc']
const SIZES = [2, 4, 8]
const HIGHLIGHTER_SCALE = 6
const ERASER_RADIUS = 10

/** "Turn into text": the writing being read, or what was read (editable before it goes in the note). */
interface Reading {
  reader: Reader
  state: 'working' | 'done' | 'error'
  text: string
  error?: string
}

/**
 * The sketch pad: draw with a mouse, trackpad or pen (pressure makes lines thicker). Save puts
 * the drawing in the attachments folder and in the note at the cursor; an existing sketch is
 * saved over in place, so every note showing it updates. "Turn into text" reads the handwriting
 * (with the AI helper or offline, see Settings → Editor → Sketches) so it can go in the note as text.
 */
export default function SketchPad() {
  const sketch = useUI((s) => s.sketch)
  const close = useCallback(() => useUI.setState({ sketch: null }), [])
  // Keyed so opening another sketch starts afresh.
  return sketch ? <Pad key={sketch.path ?? 'new'} path={sketch.path} onSaved={sketch.onSaved} close={close} /> : null
}

function Pad({ path, onSaved, close }: { path: string | null; onSaved?: (path: string) => void; close: () => void }) {
  const folder = usePrefs((s) => s.prefs.attachmentFolder)
  const [board, setBoard] = useState<Sketch | null>(path ? null : emptySketch())
  const [history, setHistory] = useState<{ undo: Stroke[][]; redo: Stroke[][] }>({ undo: [], redo: [] })
  const [tool, setTool] = useState<Tool>('pen')
  const [penColour, setPenColour] = useState(PEN_COLOURS[0])
  const [highlighterColour, setHighlighterColour] = useState(HIGHLIGHTER_COLOURS[0])
  const [size, setSize] = useState(SIZES[1])
  const [saving, setSaving] = useState(false)
  const [reading, setReading] = useState<Reading | null>(null)
  const readerPref = usePrefs((s) => s.prefs.handwritingReader)
  /** Only the latest reading counts, if you ask again before one finishes. */
  const readingId = useRef(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /** The finished strokes, drawn once, so only the line being drawn is redrawn as you move. */
  const layerRef = useRef<HTMLCanvasElement | null>(null)
  const liveRef = useRef<Stroke | null>(null)
  const erasingRef = useRef<Stroke[] | null>(null)

  // Open a saved sketch.
  useEffect(() => {
    if (!path) return
    let cancelled = false
    loadSketch(path)
      .then((s) => {
        if (cancelled) return
        if (!s) throw new Error('This picture wasn’t drawn in Orbit, so it can’t be edited here.')
        setBoard(s)
      })
      .catch((err) => {
        if (cancelled) return
        notify(err)
        close()
      })
    return () => {
      cancelled = true
    }
  }, [path, close])

  const scale = (): number => Math.min(2, window.devicePixelRatio || 1)

  /** Redraws the finished strokes into the layer, then shows it. */
  const redrawLayer = useCallback((b: Sketch) => {
    const k = scale()
    const layer = layerRef.current ?? document.createElement('canvas')
    layerRef.current = layer
    layer.width = b.width * k
    layer.height = b.height * k
    const ctx = layer.getContext('2d')
    if (!ctx) return
    ctx.setTransform(k, 0, 0, k, 0, 0)
    ctx.fillStyle = PAPER_COLOUR
    ctx.fillRect(0, 0, b.width, b.height)
    ctx.lineWidth = 1
    for (const [x1, y1, x2, y2, c] of paperLines(b)) {
      ctx.strokeStyle = c
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }
    for (const s of b.strokes) drawStroke(ctx, s)
  }, [])

  const show = useCallback(() => {
    const canvas = canvasRef.current
    const layer = layerRef.current
    if (!canvas || !layer || !board) return
    const k = scale()
    if (canvas.width !== layer.width) canvas.width = layer.width
    if (canvas.height !== layer.height) canvas.height = layer.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(layer, 0, 0)
    if (liveRef.current) {
      ctx.setTransform(k, 0, 0, k, 0, 0)
      drawStroke(ctx, liveRef.current)
    }
  }, [board])

  useLayoutEffect(() => {
    if (!board) return
    redrawLayer(board)
    show()
  }, [board, redrawLayer, show])

  const commit = (strokes: Stroke[]): void => {
    if (!board) return
    setHistory((h) => ({ undo: [...h.undo, board.strokes], redo: [] }))
    setBoard({ ...board, strokes })
  }
  const undo = (): void => {
    if (!board || history.undo.length === 0) return
    setHistory((h) => ({ undo: h.undo.slice(0, -1), redo: [...h.redo, board.strokes] }))
    setBoard({ ...board, strokes: history.undo[history.undo.length - 1] })
  }
  const redo = (): void => {
    if (!board || history.redo.length === 0) return
    setHistory((h) => ({ undo: [...h.undo, board.strokes], redo: h.redo.slice(0, -1) }))
    setBoard({ ...board, strokes: history.redo[history.redo.length - 1] })
  }
  const setPaper = (paper: SketchPaper): void => {
    if (board) setBoard({ ...board, paper: board.paper === paper ? 'plain' : paper })
  }

  // ---------- drawing ----------

  const toBoard = (e: PointerEvent | React.PointerEvent): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return [((e.clientX - rect.left) * board!.width) / rect.width, ((e.clientY - rect.top) * board!.height) / rect.height]
  }
  // A mouse has no pressure; pens and some trackpads do.
  const pressureOf = (e: PointerEvent): number => (e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.75)

  const erase = (x: number, y: number): void => {
    const left = erasingRef.current
    if (!left) return
    const kept = left.filter((s) => !strokeHits(s, x, y, ERASER_RADIUS))
    if (kept.length !== left.length) {
      erasingRef.current = kept
      redrawLayer({ ...board!, strokes: kept })
      show()
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!board || saving || e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const [x, y] = toBoard(e)
    if (tool === 'eraser') {
      erasingRef.current = board.strokes
      erase(x, y)
      return
    }
    liveRef.current =
      tool === 'highlighter'
        ? { tool, color: highlighterColour, size: size * HIGHLIGHTER_SCALE, points: [x, y, 1] }
        : { tool, color: penColour, size, points: [x, y, pressureOf(e.nativeEvent)] }
    show()
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!board) return
    const events = e.nativeEvent.getCoalescedEvents?.() ?? []
    const all = events.length ? events : [e.nativeEvent]
    if (erasingRef.current) {
      for (const ev of all) erase(...toBoard(ev))
      return
    }
    const live = liveRef.current
    if (!live) return
    for (const ev of all) {
      const [x, y] = toBoard(ev)
      const p = live.points
      // Skip points too close to the last one; they only make the outline wobble.
      if (Math.hypot(x - p[p.length - 3], y - p[p.length - 2]) < 1.5) continue
      p.push(x, y, live.tool === 'highlighter' ? 1 : pressureOf(ev))
    }
    show()
  }

  const onPointerUp = (): void => {
    if (erasingRef.current) {
      const kept = erasingRef.current
      erasingRef.current = null
      if (board && kept.length !== board.strokes.length) commit(kept)
      return
    }
    const live = liveRef.current
    liveRef.current = null
    if (live && board) commit([...board.strokes, live])
  }

  // ---------- saving and closing ----------

  const changed = history.undo.length > 0

  const cancel = async (): Promise<void> => {
    if (
      changed &&
      !(await window.api.confirm({
        message: path ? 'Close without saving your changes?' : 'Throw away this sketch?',
        ok: path ? 'Close without saving' : 'Throw away',
        cancel: 'Keep drawing',
        type: 'warning'
      }))
    )
      return
    close()
  }

  /** Saves the sketch, and puts `text` (read from it) in the note after it. */
  const save = async (text?: string): Promise<void> => {
    if (!board || saving) return
    if (!changed) {
      if (text) putText(text)
      return close()
    }
    setSaving(true)
    try {
      const svg = sketchToSvg(board)
      if (path) {
        await window.api.writeSketch(path, svg)
        bumpSketch(path)
        refreshLinkDecorations()
        if (text) putText(text)
      } else {
        const saved = await window.api.saveAttachment(folder, sketchFileName(), new TextEncoder().encode(svg))
        if (onSaved) {
          onSaved(saved)
          if (text) putText(text)
        } else if (!insertIntoActiveNote(saved)) notify(`Your sketch was saved in the “${folder}” folder.`)
        else if (text) putText(text)
        useVault.getState().refresh()
      }
      close()
    } catch (err) {
      notify(err)
      setSaving(false)
    }
  }

  // ---------- turning the writing into text ----------

  /** At the cursor of the open note, or copied if no note is open. */
  const putText = (text: string): void => {
    if (insertBlockIntoActiveNote(text)) return
    void navigator.clipboard.writeText(text)
    notify('No note is open, so the text was copied. Paste it wherever you like.', 'info')
  }

  const readWriting = async (choice?: Reader): Promise<void> => {
    if (!board) return
    const id = ++readingId.current
    const done = (r: Reading): void => {
      if (readingId.current === id) setReading(r)
    }
    const hasKey = (await refreshAiStatus().catch(() => null))?.hasKey ?? false
    const reader = choice ?? pickReader(readerPref, hasKey)
    if (reader === 'ai' && !hasKey) {
      return done({ reader, state: 'error', text: '', error: 'The AI helper needs your Anthropic API key first (Settings → AI helper).' })
    }
    done({ reader, state: 'working', text: '' })
    try {
      const png = await inkPng(board)
      if (!png) throw new Error('Write something with the pen first. Highlighter marks aren’t read.')
      done({ reader, state: 'done', text: await window.api.readHandwriting(png, reader) })
    } catch (err) {
      done({ reader, state: 'error', text: '', error: errorMessage(err) })
    }
  }

  const closeReading = (): void => {
    readingId.current++
    setReading(null)
  }

  /** A new sketch can go in as text alone, without saving the drawing. */
  const useTextOnly = (text: string): void => {
    putText(text)
    close()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Typing in the text box is just typing (Esc closes the box).
      if (e.target instanceof HTMLTextAreaElement) {
        if (e.key !== 'Escape') return
        e.preventDefault()
        e.stopPropagation()
        return closeReading()
      }
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      let handled = true
      if (e.key === 'Escape') void (reading ? closeReading() : cancel())
      else if (mod && key === 'z' && e.shiftKey) redo()
      else if (mod && key === 'z') undo()
      else if (mod && key === 'y') redo()
      else if (mod && (key === 's' || e.key === 'Enter')) void save()
      else if (!mod && !e.altKey && key === 'p') setTool('pen')
      else if (!mod && !e.altKey && key === 'h') setTool('highlighter')
      else if (!mod && !e.altKey && key === 'e') setTool('eraser')
      else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const colours = tool === 'highlighter' ? HIGHLIGHTER_COLOURS : PEN_COLOURS
  const colour = tool === 'highlighter' ? highlighterColour : penColour
  const pickColour = (c: string): void => {
    if (tool === 'highlighter') setHighlighterColour(c)
    else {
      setPenColour(c)
      if (tool === 'eraser') setTool('pen')
    }
  }

  return (
    <div className="modal-backdrop sketch-backdrop" onMouseDown={(e) => e.target === e.currentTarget && void cancel()}>
      <div className="modal sketch-pad" role="dialog" aria-label={path ? 'Editing a sketch' : 'Drawing a sketch'} data-sketch-pad>
        <div className="sketch-toolbar">
          <div className="sketch-group">
            <ToolButton active={tool === 'pen'} onClick={() => setTool('pen')} title="Pen (P)" data="pen">
              <Pen size={15} />
            </ToolButton>
            <ToolButton active={tool === 'highlighter'} onClick={() => setTool('highlighter')} title="Highlighter (H)" data="highlighter">
              <Highlighter size={15} />
            </ToolButton>
            <ToolButton active={tool === 'eraser'} onClick={() => setTool('eraser')} title="Eraser: rub out whole lines (E)" data="eraser">
              <Eraser size={15} />
            </ToolButton>
          </div>
          <div className="sketch-group">
            {colours.map((c) => (
              <button
                key={c}
                className={`sketch-colour ${tool !== 'eraser' && c === colour ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => pickColour(c)}
                title="Colour"
                aria-label={`Colour ${c}`}
                data-sketch-colour={c}
              />
            ))}
          </div>
          <div className="sketch-group">
            {SIZES.map((s) => (
              <button key={s} className={`icon-btn sketch-size ${s === size ? 'active' : ''}`} onClick={() => setSize(s)} title={['Thin', 'Medium', 'Thick'][SIZES.indexOf(s)]}>
                <i style={{ width: s + 3, height: s + 3 }} />
              </button>
            ))}
          </div>
          <div className="sketch-group">
            <ToolButton active={board?.paper === 'grid'} onClick={() => setPaper('grid')} title="Squared paper" data="grid">
              <Grid3x3 size={15} />
            </ToolButton>
            <ToolButton active={board?.paper === 'lined'} onClick={() => setPaper('lined')} title="Lined paper" data="lined">
              <Rows3 size={15} />
            </ToolButton>
          </div>
          <div className="sketch-group">
            <button className="icon-btn" onClick={undo} disabled={history.undo.length === 0} title={`Undo (${showKeys('Ctrl+Z')})`} data-sketch-undo>
              <Undo2 size={15} />
            </button>
            <button className="icon-btn" onClick={redo} disabled={history.redo.length === 0} title={`Redo (${showKeys('Ctrl+Y')})`}>
              <Redo2 size={15} />
            </button>
            <button className="icon-btn" onClick={() => board && commit([])} disabled={!board?.strokes.length} title="Clear everything" data-sketch-clear>
              <Trash2 size={15} />
            </button>
          </div>
          <span className="sketch-spacer" />
          <button
            className={`btn ${reading ? 'active' : ''}`}
            onClick={() => void readWriting()}
            disabled={!board?.strokes.length || saving || reading?.state === 'working'}
            title="Read your handwriting and turn it into typed text"
            data-sketch-read
          >
            <ScanText size={14} /> Turn into text
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={!board || saving} title={`Save (${showKeys('Ctrl+S')})`} data-sketch-save>
            {saving ? 'Saving…' : path ? 'Save changes' : 'Save sketch'}
          </button>
          <button className="icon-btn" onClick={cancel} title="Close (Esc)" data-sketch-close>
            <X size={15} />
          </button>
        </div>
        <div className="sketch-body">
          <div className="sketch-board">
            {board ? (
              <canvas
                ref={canvasRef}
                className={`sketch-canvas tool-${tool}`}
                style={{ aspectRatio: `${board.width} / ${board.height}` }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                data-sketch-canvas
              />
            ) : (
              <p className="sketch-loading">Opening the sketch…</p>
            )}
          </div>
          {reading && (
            <ReadingPanel
              reading={reading}
              newSketch={!path}
              onEdit={(text) => setReading({ ...reading, text })}
              onRetry={(reader) => void readWriting(reader)}
              onTextOnly={useTextOnly}
              onWithSketch={(text) => void save(text)}
              onClose={closeReading}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function ReadingPanel(props: {
  reading: Reading
  newSketch: boolean
  onEdit: (text: string) => void
  onRetry: (reader: Reader) => void
  onTextOnly: (text: string) => void
  onWithSketch: (text: string) => void
  onClose: () => void
}) {
  const { reading } = props
  const other: Reader = reading.reader === 'ai' ? 'offline' : 'ai'
  const text = reading.text.trim()
  return (
    <aside className="sketch-reading" aria-label="Text from your writing" data-sketch-reading={reading.state}>
      <div className="sketch-reading-head">
        <strong>Text from your writing</strong>
        <button className="icon-btn" onClick={props.onClose} title="Close (Esc)">
          <X size={14} />
        </button>
      </div>
      {reading.state === 'working' ? (
        <p className="sketch-reading-note">Reading your writing with {READER_NAMES[reading.reader]}…</p>
      ) : reading.state === 'error' ? (
        <p className="sketch-reading-note error">{reading.error}</p>
      ) : (
        <>
          <p className="sketch-reading-note">Read by {READER_NAMES[reading.reader]}. Fix anything it got wrong, then add it to your note.</p>
          <textarea className="sketch-reading-text" value={reading.text} onChange={(e) => props.onEdit(e.target.value)} spellCheck autoFocus data-sketch-reading-text />
          <div className="sketch-reading-actions">
            {/* An edited sketch is already in the note, so its changes are saved and the text goes in too. */}
            <button className="btn btn-primary" disabled={!text} onClick={() => (props.newSketch ? props.onTextOnly : props.onWithSketch)(text)} data-sketch-text-only>
              {props.newSketch ? 'Add text only' : 'Add text to note'}
            </button>
            {props.newSketch && (
              <button className="btn" disabled={!text} onClick={() => props.onWithSketch(text)} data-sketch-text-and-sketch>
                Add text and sketch
              </button>
            )}
            <button className="icon-btn" disabled={!text} onClick={() => void navigator.clipboard.writeText(text)} title="Copy the text">
              <Copy size={14} />
            </button>
          </div>
        </>
      )}
      {reading.state !== 'working' && (
        <button className="link-btn sketch-reading-other" onClick={() => props.onRetry(other)} data-sketch-read-other>
          Read it with {READER_NAMES[other]} instead
        </button>
      )}
    </aside>
  )
}

function ToolButton(props: { active: boolean; onClick: () => void; title: string; data: string; children: React.ReactNode }) {
  return (
    <button className={`icon-btn ${props.active ? 'active' : ''}`} onClick={props.onClick} title={props.title} aria-pressed={props.active} data-sketch-tool={props.data}>
      {props.children}
    </button>
  )
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const d = strokePath(stroke)
  if (!d) return
  ctx.globalAlpha = strokeOpacity(stroke)
  ctx.fillStyle = stroke.color
  ctx.fill(new Path2D(d))
  ctx.globalAlpha = 1
}
