import { useEffect, useRef } from 'react'

/**
 * Which squares changed since the last render, for one-off "that just happened" animations (a
 * number popping in, a square opening). Nothing counts as changed on the first render, so opening
 * a saved game doesn't replay everything.
 */
export function useChanged<T>(values: readonly T[], changed: (now: T, before: T) => boolean = (a, b) => a !== b): Set<number> {
  const before = useRef(values)
  const out = new Set<number>()
  if (before.current !== values) values.forEach((v, i) => i < before.current.length && changed(v, before.current[i]) && out.add(i))
  useEffect(() => {
    before.current = values
  })
  return out
}
