/**
 * Chess: the rules (every legal move, check, checkmate and draws) and a small computer player.
 *
 * A board is 64 squares, a8 first and h1 last (index = row * 8 + column, row 0 is the 8th rank).
 * Pieces are letters, upper case for White: P N B R Q K.
 */

export type Color = 'w' | 'b'
export type Piece = string
export type Square = number

export interface Position {
  board: (Piece | null)[]
  turn: Color
  /** Castling still allowed: K Q for White, k q for Black. */
  castling: string
  /** The square a pawn can capture en passant onto, if the last move was a two-square pawn push. */
  ep: Square | null
  /** Moves since the last capture or pawn move, for the 50-move rule. */
  halfmove: number
  fullmove: number
}

export interface Move {
  from: Square
  to: Square
  piece: Piece
  captured?: Piece
  promo?: Piece
  castle?: 'K' | 'Q'
  ep?: boolean
}

export type Status = 'playing' | 'checkmate' | 'stalemate' | 'fifty' | 'material' | 'repetition'

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export const colorOf = (p: Piece): Color => (p === p.toUpperCase() ? 'w' : 'b')
export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w')
const rowOf = (sq: Square): number => sq >> 3
const colOf = (sq: Square): number => sq & 7
export const squareName = (sq: Square): string => 'abcdefgh'[colOf(sq)] + (8 - rowOf(sq))
export const squareOf = (name: string): Square => (8 - Number(name[1])) * 8 + 'abcdefgh'.indexOf(name[0])

export function fromFen(fen: string): Position {
  const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/)
  const board: (Piece | null)[] = []
  for (const ch of placement.replace(/\//g, '')) {
    if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) board.push(null)
    else board.push(ch)
  }
  return {
    board,
    turn: turn === 'b' ? 'b' : 'w',
    castling: castling && castling !== '-' ? castling : '',
    ep: ep && ep !== '-' ? squareOf(ep) : null,
    halfmove: Number(half) || 0,
    fullmove: Number(full) || 1
  }
}

export function toFen(p: Position): string {
  let s = ''
  for (let r = 0; r < 8; r++) {
    let empty = 0
    for (let c = 0; c < 8; c++) {
      const piece = p.board[r * 8 + c]
      if (!piece) empty++
      else {
        if (empty) s += empty
        empty = 0
        s += piece
      }
    }
    if (empty) s += empty
    if (r < 7) s += '/'
  }
  return `${s} ${p.turn} ${p.castling || '-'} ${p.ep === null ? '-' : squareName(p.ep)} ${p.halfmove} ${p.fullmove}`
}

/** The position without the move counters: the same key means the same position, for repetition. */
export const positionKey = (p: Position): string => toFen(p).split(' ').slice(0, 4).join(' ')

const KNIGHT = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1]
]
const KING = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1]
]
const ROOK_DIRS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1]
]
const BISHOP_DIRS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1]
]

const at = (r: number, c: number): Square | null => (r >= 0 && r < 8 && c >= 0 && c < 8 ? r * 8 + c : null)

/** Is `sq` attacked by any piece of colour `by`? */
export function isAttacked(board: (Piece | null)[], sq: Square, by: Color): boolean {
  const r = rowOf(sq)
  const c = colOf(sq)
  const own = (p: Piece | null, type: string): boolean => !!p && colorOf(p) === by && p.toUpperCase() === type
  // Pawns attack diagonally forwards, so look one row back from their side.
  const pr = by === 'w' ? r + 1 : r - 1
  for (const dc of [-1, 1]) {
    const s = at(pr, c + dc)
    if (s !== null && own(board[s], 'P')) return true
  }
  for (const [dr, dc] of KNIGHT) {
    const s = at(r + dr, c + dc)
    if (s !== null && own(board[s], 'N')) return true
  }
  for (const [dr, dc] of KING) {
    const s = at(r + dr, c + dc)
    if (s !== null && own(board[s], 'K')) return true
  }
  for (const [dirs, types] of [
    [ROOK_DIRS, 'RQ'],
    [BISHOP_DIRS, 'BQ']
  ] as const) {
    for (const [dr, dc] of dirs) {
      let rr = r + dr
      let cc = c + dc
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
        const p = board[rr * 8 + cc]
        if (p) {
          if (colorOf(p) === by && types.includes(p.toUpperCase())) return true
          break
        }
        rr += dr
        cc += dc
      }
    }
  }
  return false
}

export const kingSquare = (board: (Piece | null)[], color: Color): Square => board.indexOf(color === 'w' ? 'K' : 'k')

export const inCheck = (p: Position, color: Color = p.turn): boolean => isAttacked(p.board, kingSquare(p.board, color), other(color))

/** Every move the pieces can make, before checking whether it leaves your own king in check. */
function pseudoMoves(p: Position): Move[] {
  const moves: Move[] = []
  const { board, turn } = p
  const add = (from: Square, to: Square, extra: Partial<Move> = {}): void => {
    const captured = board[to] ?? undefined
    moves.push({ from, to, piece: board[from]!, ...(captured ? { captured } : {}), ...extra })
  }
  for (let sq = 0; sq < 64; sq++) {
    const piece = board[sq]
    if (!piece || colorOf(piece) !== turn) continue
    const type = piece.toUpperCase()
    const r = rowOf(sq)
    const c = colOf(sq)
    if (type === 'P') {
      const dir = turn === 'w' ? -1 : 1
      const startRow = turn === 'w' ? 6 : 1
      const lastRow = turn === 'w' ? 0 : 7
      const pushTo = (to: Square, extra: Partial<Move> = {}): void => {
        if (rowOf(to) === lastRow) for (const promo of 'QRBN') add(sq, to, { ...extra, promo: turn === 'w' ? promo : promo.toLowerCase() })
        else add(sq, to, extra)
      }
      const one = at(r + dir, c)
      if (one !== null && !board[one]) {
        pushTo(one)
        const two = at(r + 2 * dir, c)
        if (r === startRow && two !== null && !board[two]) add(sq, two)
      }
      for (const dc of [-1, 1]) {
        const to = at(r + dir, c + dc)
        if (to === null) continue
        if (board[to] && colorOf(board[to]!) !== turn) pushTo(to)
        else if (to === p.ep) add(sq, to, { ep: true, captured: turn === 'w' ? 'p' : 'P' })
      }
    } else if (type === 'N' || type === 'K') {
      for (const [dr, dc] of type === 'N' ? KNIGHT : KING) {
        const to = at(r + dr, c + dc)
        if (to !== null && (!board[to] || colorOf(board[to]!) !== turn)) add(sq, to)
      }
      if (type === 'K') {
        const enemy = other(turn)
        const home = turn === 'w' ? 60 : 4
        const [k, q] = turn === 'w' ? ['K', 'Q'] : ['k', 'q']
        if (sq === home && !isAttacked(board, home, enemy)) {
          if (p.castling.includes(k) && !board[home + 1] && !board[home + 2] && !isAttacked(board, home + 1, enemy) && !isAttacked(board, home + 2, enemy))
            add(sq, home + 2, { castle: 'K' })
          if (p.castling.includes(q) && !board[home - 1] && !board[home - 2] && !board[home - 3] && !isAttacked(board, home - 1, enemy) && !isAttacked(board, home - 2, enemy))
            add(sq, home - 2, { castle: 'Q' })
        }
      }
    } else {
      const dirs = type === 'R' ? ROOK_DIRS : type === 'B' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS]
      for (const [dr, dc] of dirs) {
        let rr = r + dr
        let cc = c + dc
        while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
          const to = rr * 8 + cc
          if (board[to]) {
            if (colorOf(board[to]!) !== turn) add(sq, to)
            break
          }
          add(sq, to)
          rr += dr
          cc += dc
        }
      }
    }
  }
  return moves
}

/** The position after a move (the move is assumed to be one of `legalMoves`). */
export function makeMove(p: Position, m: Move): Position {
  const board = [...p.board]
  board[m.to] = m.promo ?? m.piece
  board[m.from] = null
  if (m.ep) board[m.to + (p.turn === 'w' ? 8 : -8)] = null
  if (m.castle === 'K') {
    board[m.from + 1] = board[m.from + 3]
    board[m.from + 3] = null
  } else if (m.castle === 'Q') {
    board[m.from - 1] = board[m.from - 4]
    board[m.from - 4] = null
  }
  // Moving the king or a rook, or capturing a rook at home, ends that castling for good.
  let castling = p.castling
  const drop = (sq: Square, letters: string): void => {
    if (m.from === sq || m.to === sq) castling = castling.replace(new RegExp(`[${letters}]`, 'g'), '')
  }
  drop(60, 'KQ')
  drop(4, 'kq')
  drop(63, 'K')
  drop(56, 'Q')
  drop(7, 'k')
  drop(0, 'q')
  const pawn = m.piece.toUpperCase() === 'P'
  return {
    board,
    turn: other(p.turn),
    castling,
    ep: pawn && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) / 2 : null,
    halfmove: pawn || m.captured ? 0 : p.halfmove + 1,
    fullmove: p.turn === 'b' ? p.fullmove + 1 : p.fullmove
  }
}

export function legalMoves(p: Position): Move[] {
  return pseudoMoves(p).filter((m) => !inCheck(makeMove(p, m), p.turn))
}

/** Only kings, or a king and one knight or bishop, against a lone king: nobody can win. */
export function insufficientMaterial(board: (Piece | null)[]): boolean {
  const rest = board.filter((x): x is Piece => !!x && x.toUpperCase() !== 'K')
  if (!rest.length) return true
  if (rest.length === 1 && 'NB'.includes(rest[0].toUpperCase())) return true
  // Bishops only, all on the same colour of square.
  const bishops = board.flatMap((x, sq) => (x && x.toUpperCase() === 'B' ? [(rowOf(sq) + colOf(sq)) % 2] : []))
  return rest.every((x) => x.toUpperCase() === 'B') && bishops.every((b) => b === bishops[0])
}

/** How the game stands. `keys` are the position keys so far (including this one), for repetition. */
export function statusOf(p: Position, keys: string[] = []): Status {
  if (!legalMoves(p).length) return inCheck(p) ? 'checkmate' : 'stalemate'
  if (p.halfmove >= 100) return 'fifty'
  if (insufficientMaterial(p.board)) return 'material'
  const key = positionKey(p)
  if (keys.filter((k) => k === key).length >= 3) return 'repetition'
  return 'playing'
}

/** The move written the usual way, like Nf3, exd5, O-O or e8=Q+. */
export function toSan(p: Position, m: Move): string {
  let san: string
  if (m.castle) san = m.castle === 'K' ? 'O-O' : 'O-O-O'
  else {
    const type = m.piece.toUpperCase()
    const to = squareName(m.to)
    if (type === 'P') {
      san = (m.captured ? `${squareName(m.from)[0]}x` : '') + to + (m.promo ? `=${m.promo.toUpperCase()}` : '')
    } else {
      // Say which piece when two of the same kind could go there.
      const twins = legalMoves(p).filter((o) => o.to === m.to && o.piece === m.piece && o.from !== m.from)
      let which = ''
      if (twins.length) {
        if (twins.every((o) => colOf(o.from) !== colOf(m.from))) which = squareName(m.from)[0]
        else if (twins.every((o) => rowOf(o.from) !== rowOf(m.from))) which = squareName(m.from)[1]
        else which = squareName(m.from)
      }
      san = type + which + (m.captured ? 'x' : '') + to
    }
  }
  const after = makeMove(p, m)
  if (inCheck(after)) san += legalMoves(after).length ? '+' : '#'
  return san
}

/** Counts the positions a few moves deep; used to check the move rules against known numbers. */
export function perft(p: Position, depth: number): number {
  if (depth === 0) return 1
  const moves = legalMoves(p)
  if (depth === 1) return moves.length
  let n = 0
  for (const m of moves) n += perft(makeMove(p, m), depth - 1)
  return n
}

// ---------- the computer player ----------

const VALUE: Record<string, number> = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 }

// Where each piece likes to stand, from White's side (a8 first). Black reads them upside down.
// prettier-ignore
const PLACE: Record<string, number[]> = {
  P: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  N: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  B: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  R: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  Q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  K: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20]
}

/** How good the position looks for the side to move, in hundredths of a pawn. */
export function evaluate(p: Position): number {
  let score = 0
  for (let sq = 0; sq < 64; sq++) {
    const piece = p.board[sq]
    if (!piece) continue
    const type = piece.toUpperCase()
    const white = piece === type
    const v = VALUE[type] + PLACE[type][white ? sq : (7 - rowOf(sq)) * 8 + colOf(sq)]
    score += white ? v : -v
  }
  return p.turn === 'w' ? score : -score
}

const MATE = 100000

/** Captures first (most valuable victim, cheapest attacker), so the search cuts off sooner. */
function ordered(moves: Move[]): Move[] {
  const worth = (m: Move): number => (m.captured ? 10 * VALUE[m.captured.toUpperCase()] - VALUE[m.piece.toUpperCase()] + 1000 : 0) + (m.promo ? 800 : 0)
  return moves.sort((a, b) => worth(b) - worth(a))
}

/** Keeps looking at captures past the depth, so it doesn't stop just before losing a piece. */
function quiet(p: Position, alpha: number, beta: number, depth: number, budget: { nodes: number }): number {
  budget.nodes++
  const stand = evaluate(p)
  if (stand >= beta) return beta
  if (stand > alpha) alpha = stand
  if (depth <= 0) return alpha
  for (const m of ordered(legalMoves(p).filter((m) => m.captured || m.promo))) {
    const score = -quiet(makeMove(p, m), -beta, -alpha, depth - 1, budget)
    if (score >= beta) return beta
    if (score > alpha) alpha = score
  }
  return alpha
}

function search(p: Position, depth: number, alpha: number, beta: number, ply: number, budget: { nodes: number }): number {
  const moves = legalMoves(p)
  if (!moves.length) return inCheck(p) ? -MATE + ply : 0
  if (p.halfmove >= 100 || insufficientMaterial(p.board)) return 0
  if (depth === 0) return quiet(p, alpha, beta, 4, budget)
  budget.nodes++
  for (const m of ordered(moves)) {
    const score = -search(makeMove(p, m), depth - 1, -beta, -alpha, ply + 1, budget)
    if (score >= beta) return beta
    if (score > alpha) alpha = score
  }
  return alpha
}

export type Level = 'easy' | 'medium' | 'hard'

export const LEVELS: { id: Level; label: string; depth: number; slack: number }[] = [
  // Easy looks one move ahead and often settles for a move that's nearly as good.
  { id: 'easy', label: 'Easy', depth: 1, slack: 120 },
  { id: 'medium', label: 'Medium', depth: 2, slack: 15 },
  { id: 'hard', label: 'Hard', depth: 3, slack: 0 }
]

/** The computer's move. `keys` (positions so far) steer it away from repeating when it's ahead. */
export function computerMove(p: Position, level: Level, random: () => number = Math.random, keys: string[] = []): Move | null {
  const { depth, slack } = LEVELS.find((l) => l.id === level) ?? LEVELS[1]
  const moves = ordered(legalMoves(p))
  if (!moves.length) return null
  const budget = { nodes: 0 }
  // With no slack only the best move matters, so moves that can't beat it are cut short.
  let alpha = -MATE - 1
  const scored = moves.map((m) => {
    const next = makeMove(p, m)
    let score = -search(next, depth - 1, -MATE - 1, slack ? MATE + 1 : -alpha + 1, 1, budget)
    if (!slack) alpha = Math.max(alpha, score)
    // Repeating a position is a draw, which is only worth it when losing.
    if (keys.includes(positionKey(next)) && score > -50) score -= 60
    return { m, score }
  })
  const top = Math.max(...scored.map((s) => s.score))
  // A mate in hand is always played; otherwise pick among the moves close to the best.
  const pool = scored.filter((s) => s.score >= top - (top > MATE / 2 ? 0 : slack))
  return pool[Math.floor(random() * pool.length)].m
}
