/**
 * Quiet time: while something wants your full attention (reading a comic in zen mode), Orbit's own
 * pop-ups and reminders wait. Reminders that came due show up as "missed" once it's over.
 */

const reasons = new Set<string>()

export function setQuiet(reason: string, on: boolean): void {
  if (on) reasons.add(reason)
  else reasons.delete(reason)
}

export const isQuiet = (): boolean => reasons.size > 0
