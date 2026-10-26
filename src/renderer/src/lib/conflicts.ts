import { parentOf } from './paths'

/**
 * Sync conflicts: when two computers change a note before syncing, Google Drive (and others) keep
 * both, saving one as a copy like "Plan (1).md". These find such pairs and help put them back together.
 */

export interface ConflictPair {
  /** The note, e.g. "Projects/Plan.md". */
  original: string
  /** Its copy, e.g. "Projects/Plan (1).md". */
  copy: string
}

// "Plan (1)", "Plan (conflicted copy 2026-10-26)", "Plan [Conflict]", "Plan_conflict-20261026"…
const COPY = /^(.*?)(?:\s\((?:\d{1,2}|[^)]*conflict[^)]*)\)|\s\[conflict[^\]]*\]|[_-]conflict[^.]*)$/i

/** Notes that look like sync copies of another note in the same folder. */
export function findConflicts(paths: string[]): ConflictPair[] {
  const byLower = new Map(paths.map((p) => [p.toLowerCase(), p]))
  const pairs: ConflictPair[] = []
  for (const copy of paths) {
    if (!/\.md$/i.test(copy)) continue
    const folder = parentOf(copy)
    const name = copy.slice(folder ? folder.length + 1 : 0).replace(/\.md$/i, '')
    const m = COPY.exec(name)
    if (!m || !m[1].trim()) continue
    const original = byLower.get(`${folder ? `${folder}/` : ''}${m[1].trim()}.md`.toLowerCase())
    if (original && original !== copy) pairs.push({ original, copy })
  }
  return pairs.sort((a, b) => a.original.localeCompare(b.original))
}

export type DiffOp = { kind: 'same' | 'removed' | 'added'; line: string }

/** Line-by-line differences between `a` and `b` (removed: only in a; added: only in b). */
export function lineDiff(a: string, b: string): DiffOp[] {
  const x = a.split('\n')
  const y = b.split('\n')
  // Common start and end first, so big notes with small changes stay quick.
  let start = 0
  while (start < x.length && start < y.length && x[start] === y[start]) start++
  let endX = x.length
  let endY = y.length
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--
    endY--
  }
  const mx = x.slice(start, endX)
  const my = y.slice(start, endY)
  // Longest common subsequence of what's left.
  const n = mx.length
  const m = my.length
  const ops: DiffOp[] = x.slice(0, start).map((line) => ({ kind: 'same', line }))
  if (n * m > 4_000_000) {
    // Too big to compare closely: show it as replaced.
    ops.push(...mx.map((line): DiffOp => ({ kind: 'removed', line })), ...my.map((line): DiffOp => ({ kind: 'added', line })))
  } else {
    const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) lcs[i][j] = mx[i] === my[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && mx[i] === my[j]) {
        ops.push({ kind: 'same', line: mx[i] })
        i++
        j++
      } else if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) {
        ops.push({ kind: 'added', line: my[j++] })
      } else {
        ops.push({ kind: 'removed', line: mx[i++] })
      }
    }
  }
  ops.push(...x.slice(endX).map((line): DiffOp => ({ kind: 'same', line })))
  return ops
}

/** Both versions together: every line from either, in order (good for notes both sides added to). */
export function combine(a: string, b: string): string {
  return lineDiff(a, b)
    .map((op) => op.line)
    .join('\n')
}
