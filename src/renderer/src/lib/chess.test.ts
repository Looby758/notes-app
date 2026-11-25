import { describe, expect, it } from 'vitest'
import { computerMove, fromFen, legalMoves, makeMove, perft, positionKey, START_FEN, statusOf, squareOf, toFen, toSan, type Position } from './chess'

const play = (p: Position, ...sans: string[]): Position =>
  sans.reduce((pos, san) => {
    const m = legalMoves(pos).find((x) => toSan(pos, x).replace(/[+#]/, '') === san.replace(/[+#]/, ''))
    if (!m) throw new Error(`No move ${san} in ${toFen(pos)}`)
    return makeMove(pos, m)
  }, p)

describe('chess rules', () => {
  it('reads and writes positions', () => {
    expect(toFen(fromFen(START_FEN))).toBe(START_FEN)
  })

  // Known move counts (perft) catch mistakes in castling, en passant, promotion and pins.
  it('counts every move from the start', () => {
    const p = fromFen(START_FEN)
    expect(perft(p, 1)).toBe(20)
    expect(perft(p, 2)).toBe(400)
    expect(perft(p, 3)).toBe(8902)
  })

  it('counts the tricky “Kiwipete” position', () => {
    const p = fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1')
    expect(perft(p, 1)).toBe(48)
    expect(perft(p, 2)).toBe(2039)
    expect(perft(p, 3)).toBe(97862)
  })

  it('counts en passant and promotion positions', () => {
    expect(perft(fromFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'), 4)).toBe(43238)
    expect(perft(fromFen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1'), 3)).toBe(9467)
  })

  it('spots checkmate and stalemate', () => {
    const mate = play(fromFen(START_FEN), 'f3', 'e5', 'g4', 'Qh4')
    expect(statusOf(mate)).toBe('checkmate')
    expect(statusOf(fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'))).toBe('stalemate')
  })

  it('calls a draw for bare kings, 50 moves and three repeats', () => {
    expect(statusOf(fromFen('8/8/4k3/8/8/3NK3/8/8 w - - 0 1'))).toBe('material')
    expect(statusOf(fromFen('8/8/4k3/8/8/3RK3/8/8 w - - 100 80'))).toBe('fifty')
    let p = fromFen(START_FEN)
    const keys = [positionKey(p)]
    for (const san of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) {
      p = play(p, san)
      keys.push(positionKey(p))
    }
    expect(statusOf(p, keys)).toBe('repetition')
  })

  it('writes moves the usual way', () => {
    const p = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')
    const sans = legalMoves(p).map((m) => toSan(p, m))
    expect(sans).toContain('O-O')
    expect(sans).toContain('O-O-O')
    expect(sans).toContain('Rxa8+')
    // Two rooks can reach d1: say which one.
    const twoRooks = fromFen('4k3/8/8/8/8/8/4K3/R6R w - - 0 1')
    expect(legalMoves(twoRooks).map((m) => toSan(twoRooks, m))).toContain('Rad1')
    const promo = fromFen('8/4P3/8/8/8/8/k7/4K3 w - - 0 1')
    expect(legalMoves(promo).map((m) => toSan(promo, m))).toContain('e8=Q')
  })
})

describe('computer player', () => {
  it('takes a free queen', () => {
    const p = fromFen('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1')
    const m = computerMove(p, 'medium', () => 0)
    expect(m?.to).toBe(squareOf('d5'))
  })

  it('plays mate in one on every level', () => {
    const p = fromFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1')
    for (const level of ['easy', 'medium', 'hard'] as const) {
      const m = computerMove(p, level, () => 0.99)!
      expect(statusOf(makeMove(p, m))).toBe('checkmate')
    }
  })

  it('thinks fast enough on hard from the start', () => {
    const t = Date.now()
    computerMove(fromFen(START_FEN), 'hard')
    expect(Date.now() - t).toBeLessThan(5000)
  })
})
