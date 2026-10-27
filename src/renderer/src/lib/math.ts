/**
 * Maths in notes, written the usual way:
 *   $x^2 + y^2$          inline, inside a sentence
 *   $$                   a formula of its own, centred
 *   \int_0^1 x\,dx
 *   $$
 * Prices like "$5 and $10" are left alone: the text inside the dollars can't start or end with
 * a space, and the closing $ can't be followed by a digit.
 */

/** Inline maths. The opening $ can't follow a letter, a digit, a backslash or another $. */
export const INLINE_MATH = /(?<![\\$\w])\$(?=[^\s$])((?:\\.|[^$\n\\])*?[^\s\\])\$(?![$\d])/g

export interface MathBlock {
  /** 0-based line numbers of the block's first and last lines. */
  startLine: number
  endLine: number
  tex: string
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/** The $$ … $$ blocks in a note (code blocks are skipped). An unclosed $$ isn't a block yet. */
export function findMathBlocks(lines: string[]): MathBlock[] {
  const out: MathBlock[] = []
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]
    const f = FENCE.exec(text)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !text.slice(f[0].length).trim()) fence = null
      continue
    }
    if (f) {
      fence = f[1]
      continue
    }
    const t = text.trim()
    if (!t.startsWith('$$')) continue
    // On one line: $$ E = mc^2 $$
    if (t.length > 4 && t.endsWith('$$')) {
      out.push({ startLine: i, endLine: i, tex: t.slice(2, -2).trim() })
      continue
    }
    for (let j = i + 1; j < lines.length; j++) {
      const end = lines[j].trim()
      if (!end.endsWith('$$')) continue
      const body = [t.slice(2), ...lines.slice(i + 1, j), end.slice(0, -2)]
      out.push({ startLine: i, endLine: j, tex: body.join('\n').trim() })
      i = j
      break
    }
  }
  return out
}
