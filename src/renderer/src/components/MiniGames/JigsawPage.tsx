import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Eye, EyeOff, ImagePlus, Puzzle, Shuffle, Trophy } from 'lucide-react'
import {
  BOARD_WIDTH,
  gridFor,
  makeJoins,
  marginFor,
  PIECE_COUNTS,
  piecePath,
  scatter,
  sidesOf,
  snapsHome,
  type Joins,
  type PieceCount,
  type Spot
} from '../../lib/jigsaw'
import { formatTime } from '../../lib/sudoku'
import { petCheer } from '../../lib/pet'

/** A puzzle in progress. Positions are in the puzzle's units (the picture is BOARD_WIDTH wide). */
interface Game {
  count: PieceCount
  rows: number
  cols: number
  /** The picture's width / height. */
  aspect: number
  joins: Joins
  spots: Spot[]
  placed: boolean[]
  /** Loose pieces, bottom to top. */
  order: number[]
  seconds: number
  won: boolean
}

// The puzzle and its picture live on this computer only (not in the notes folder).
const GAME_KEY = 'notesapp.jigsaw.game'
const PICTURE_KEY = 'notesapp.jigsaw.picture'
const COUNT_KEY = 'notesapp.jigsaw.count'
/** Pictures are shrunk to this many pixels on their longer side, plenty for a puzzle that fits a window. */
const MAX_SIDE = 1600

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
    return true
  } catch {
    // Storage full or blocked: the puzzle still works, it just won't be remembered.
    return false
  }
}

function loadPicture(): string | null {
  try {
    return localStorage.getItem(PICTURE_KEY)
  } catch {
    return null
  }
}

function measure(aspect: number, rows: number, cols: number): { w: number; h: number; pw: number; ph: number; margin: number } {
  const w = BOARD_WIDTH
  const h = BOARD_WIDTH / aspect
  const pw = w / cols
  const ph = h / rows
  return { w, h, pw, ph, margin: marginFor(w, h, pw, ph) }
}

function newGame(count: PieceCount, aspect: number): Game {
  const { rows, cols } = gridFor(count, aspect)
  const { w, h, pw, ph, margin } = measure(aspect, rows, cols)
  const total = rows * cols
  const order = Array.from({ length: total }, (_, i) => i).sort(() => Math.random() - 0.5)
  return {
    count,
    rows,
    cols,
    aspect,
    joins: makeJoins(rows, cols),
    spots: scatter(total, w, h, pw, ph, margin),
    placed: new Array(total).fill(false),
    order,
    seconds: 0,
    won: false
  }
}

function loadGame(): Game | null {
  const g = load<Game>(GAME_KEY)
  return g && Array.isArray(g.spots) && g.spots.length === g.rows * g.cols && g.joins ? g : null
}

/** Reads a picture file and shrinks it, as a JPEG data: URL, with its shape. */
async function readPicture(file: File): Promise<{ url: string; aspect: number }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return { url: canvas.toDataURL('image/jpeg', 0.88), aspect: canvas.width / canvas.height }
}

interface PieceProps {
  index: number
  path: string
  home: Spot
  spot: Spot
  placed: boolean
  onGrab: (index: number, e: ReactPointerEvent<SVGGElement>) => void
}

/** One piece: the picture, clipped to the piece's outline (drawn where the piece belongs), moved to where it is. */
const Piece = memo(function Piece({ index, path, home, spot, placed, onGrab }: PieceProps) {
  return (
    <g
      className={`jig-piece ${placed ? 'placed' : ''}`}
      transform={`translate(${spot.x - home.x} ${spot.y - home.y})`}
      onPointerDown={placed ? undefined : (e) => onGrab(index, e)}
      data-piece={index}
    >
      <g clipPath={`url(#jig-clip-${index})`}>
        <use href="#jig-picture" />
      </g>
      <path d={path} className="jig-outline" />
    </g>
  )
})

/** Jigsaw: a picture of your own, cut into pieces. Drag each piece to its place on the board. */
export default function JigsawPage() {
  const [picture, setPicture] = useState<string | null>(loadPicture)
  const [game, setGame] = useState<Game | null>(() => (loadPicture() ? loadGame() : null))
  const [count, setCount] = useState<PieceCount>(() => {
    const saved = load<number>(COUNT_KEY)
    return (PIECE_COUNTS as readonly number[]).includes(saved ?? 0) ? (saved as PieceCount) : 24
  })
  const [peek, setPeek] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unsaved, setUnsaved] = useState(false)
  const [dropping, setDropping] = useState(false)
  const svg = useRef<SVGSVGElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const drag = useRef<{ index: number; dx: number; dy: number; pointer: number } | null>(null)

  useEffect(() => {
    if (game) save(GAME_KEY, game)
  }, [game])

  const wasWon = useRef(game?.won ?? false)
  useEffect(() => {
    if (game?.won && !wasWon.current) petCheer()
    wasWon.current = game?.won ?? false
  }, [game?.won])

  const playing = !!game && !game.won
  useEffect(() => {
    if (!playing) return
    const tick = setInterval(() => {
      if (document.hasFocus()) setGame((g) => (g && !g.won ? { ...g, seconds: g.seconds + 1 } : g))
    }, 1000)
    return () => clearInterval(tick)
  }, [playing])

  const choose = async (file: File | undefined): Promise<void> => {
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('That isn’t a picture. Choose a photo (JPG, PNG, WebP…).')
    try {
      const { url, aspect } = await readPicture(file)
      setError(null)
      setUnsaved(!save(PICTURE_KEY, url))
      setPicture(url)
      setGame(newGame(count, aspect))
      setPeek(false)
    } catch {
      setError('Orbit couldn’t open that picture. Try a JPG or PNG.')
    }
  }

  const restart = (n: PieceCount): void => {
    setCount(n)
    save(COUNT_KEY, n)
    if (game) setGame(newGame(n, game.aspect))
  }

  const dims = game ? measure(game.aspect, game.rows, game.cols) : null

  // Each piece's outline, drawn where it belongs (only changes with a new puzzle).
  const shapes = useMemo(() => {
    if (!game || !dims) return []
    return Array.from({ length: game.rows * game.cols }, (_, i) => {
      const r = Math.floor(i / game.cols)
      const c = i % game.cols
      const home = { x: c * dims.pw, y: r * dims.ph }
      return { home, path: piecePath(sidesOf(game.joins, game.rows, game.cols, r, c), home.x, home.y, dims.pw, dims.ph) }
    })
  }, [game?.joins, game?.rows, game?.cols, game?.aspect])

  function toWorld(clientX: number, clientY: number): Spot {
    const el = svg.current
    const m = el?.getScreenCTM()
    if (!el || !m) return { x: 0, y: 0 }
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }

  const current = useRef(game)
  current.current = game
  const onGrab = useCallback((index: number, e: ReactPointerEvent<SVGGElement>) => {
    const g = current.current
    if (e.button !== 0 || !g || g.won) return
    e.preventDefault()
    svg.current?.setPointerCapture(e.pointerId)
    const at = toWorld(e.clientX, e.clientY)
    drag.current = { index, dx: at.x - g.spots[index].x, dy: at.y - g.spots[index].y, pointer: e.pointerId }
    // The piece you pick up comes to the top.
    setGame((g) => (g ? { ...g, order: [...g.order.filter((j) => j !== index), index] } : g))
  }, [])

  const onMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const d = drag.current
    if (!d || d.pointer !== e.pointerId || !dims) return
    const at = toWorld(e.clientX, e.clientY)
    const { w, h, pw, ph, margin } = dims
    // Pieces stay on the table.
    const x = Math.min(w + margin - pw, Math.max(-margin, at.x - d.dx))
    const y = Math.min(h + margin - ph, Math.max(-margin, at.y - d.dy))
    setGame((g) => (g ? { ...g, spots: g.spots.map((s, i) => (i === d.index ? { x, y } : s)) } : g))
  }

  const onDrop = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const d = drag.current
    if (!d || d.pointer !== e.pointerId) return
    drag.current = null
    setGame((g) => {
      if (!g || !dims) return g
      const home = shapes[d.index]?.home
      if (!home || !snapsHome(g.spots[d.index], home, dims.pw, dims.ph)) return g
      const spots = g.spots.map((s, i) => (i === d.index ? home : s))
      const placed = g.placed.map((p, i) => p || i === d.index)
      return { ...g, spots, placed, won: placed.every(Boolean) }
    })
  }

  /** Spreads the loose pieces out again around the board. */
  const tidy = (): void => {
    setGame((g) => {
      if (!g || !dims) return g
      const fresh = scatter(g.spots.length, dims.w, dims.h, dims.pw, dims.ph, dims.margin)
      return { ...g, spots: g.spots.map((s, i) => (g.placed[i] ? s : fresh[i])) }
    })
  }

  const onDragOver = (e: DragEvent): void => {
    if (![...e.dataTransfer.items].some((i) => i.kind === 'file')) return
    e.preventDefault()
    setDropping(true)
  }

  const onFileDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDropping(false)
    void choose(e.dataTransfer.files[0])
  }

  const placedCount = game ? game.placed.filter(Boolean).length : 0
  const total = game ? game.rows * game.cols : 0

  return (
    <div
      className={`sudoku-page jig-page ${dropping ? 'dropping' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={() => setDropping(false)}
      onDrop={onFileDrop}
      data-jigsaw-page
    >
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void choose(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <div className="sudoku-inner jig-inner">
        <header className="sudoku-head">
          <h2>
            <Puzzle size={20} /> Jigsaw
          </h2>
          <div className="sudoku-levels" role="group" aria-label="How many pieces">
            {PIECE_COUNTS.map((n) => (
              <button
                key={n}
                className={`sudoku-level ${count === n ? 'active' : ''}`}
                onClick={() => restart(n)}
                title={game ? `Start again with about ${n} pieces` : `About ${n} pieces`}
              >
                {n}
              </button>
            ))}
          </div>
        </header>

        {!picture || !game || !dims ? (
          <div className="jig-empty" data-jigsaw-empty>
            <ImagePlus size={36} />
            <strong>Make a jigsaw from a photo</strong>
            <span>Choose a picture from your computer, or drop one here. It’s cut into {count} pieces.</span>
            <button className="btn btn-primary" onClick={() => fileInput.current?.click()} data-jigsaw-choose>
              Choose a picture
            </button>
            {error && <span className="jig-error">{error}</span>}
          </div>
        ) : (
          <>
            <div className="sudoku-status">
              <span className="sudoku-time" title="How long you've been doing this puzzle">
                {formatTime(game.seconds)}
              </span>
              <span title="Pieces in place">
                {placedCount} / {total}
              </span>
              <span className="mines-tools">
                <button className={`sudoku-tool ${peek ? 'active' : ''}`} onClick={() => setPeek((p) => !p)} aria-pressed={peek} title="Show the picture faintly on the board">
                  {peek ? <EyeOff size={15} /> : <Eye size={15} />} Peek
                </button>
                <button className="sudoku-tool" onClick={tidy} disabled={game.won} title="Spread the loose pieces out again">
                  <Shuffle size={15} /> Spread out
                </button>
                <button className="sudoku-tool" onClick={() => fileInput.current?.click()} title="Make a puzzle from another picture">
                  <ImagePlus size={15} /> New picture
                </button>
              </span>
            </div>
            {error && <p className="jig-error">{error}</p>}
            {unsaved && <p className="sudoku-help">That picture is too big to remember, so this puzzle won’t be here after Orbit closes.</p>}

            <div className="jig-table">
              <svg
                ref={svg}
                className="jig-svg"
                viewBox={`${-dims.margin} ${-dims.margin} ${dims.w + 2 * dims.margin} ${dims.h + 2 * dims.margin}`}
                onPointerMove={onMove}
                onPointerUp={onDrop}
                onPointerCancel={onDrop}
                data-jigsaw-board
              >
                <defs>
                  <image id="jig-picture" href={picture} x={0} y={0} width={dims.w} height={dims.h} preserveAspectRatio="none" />
                  {shapes.map((s, i) => (
                    <clipPath key={i} id={`jig-clip-${i}`}>
                      <path d={s.path} />
                    </clipPath>
                  ))}
                </defs>
                <rect className="jig-frame" x={0} y={0} width={dims.w} height={dims.h} />
                {peek && <use href="#jig-picture" className="jig-peek" />}
                {/* Pieces in place lie underneath; the loose ones on top, the last one picked up highest. */}
                {[...game.placed.map((p, i) => (p ? i : -1)).filter((i) => i >= 0), ...game.order.filter((i) => !game.placed[i])].map((i) => (
                  <Piece key={i} index={i} path={shapes[i].path} home={shapes[i].home} spot={game.spots[i]} placed={game.placed[i]} onGrab={onGrab} />
                ))}
              </svg>
              {game.won && (
                <div className="nono-result jig-result" data-jigsaw-result>
                  <Trophy size={26} />
                  <strong>Finished!</strong>
                  <span>
                    {total} pieces in {formatTime(game.seconds)}
                  </span>
                  <button className="btn btn-primary" onClick={() => setGame(newGame(count, game.aspect))}>
                    Play again
                  </button>
                </div>
              )}
            </div>
            <p className="sudoku-help">
              Drag each piece onto the board. It clicks into place when it’s close to the right spot. Peek shows the picture faintly to help, and you can
              drop a different picture anywhere on this page to start a new puzzle.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
