/**
 * Snipping from the taskbar (main/snipTaskbar.ts): the "Orbit Snip" shortcut and the jump list
 * start Orbit with one of these flags. A running Orbit gets them from the second copy, which
 * closes straight away; otherwise Orbit starts quietly in the tray and snips.
 */
export type SnipMode = 'picture' | 'text'

/** Snip a picture: drag a box and it's copied, ready to paste anywhere. */
export const SNIP_PICTURE_FLAG = '--snip'
/** Snip text: the usual screen snip, which reads the text in the box. */
export const SNIP_TEXT_FLAG = '--snip-text'
/** Snip a picture after a few seconds ("--snip-delay=5"), so you can hover over something first. */
export const SNIP_DELAY_FLAG = '--snip-delay'

/** The ready-made delays offered in the taskbar and tray menus, in seconds. */
export const SNIP_DELAYS = [3, 5, 10] as const
/** The longest delay you can set (Settings), in seconds. */
export const MAX_SNIP_DELAY = 30

/** A delay in whole seconds, from 0 (none) to MAX_SNIP_DELAY. */
export function cleanSnipDelay(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(MAX_SNIP_DELAY, Math.max(0, Math.round(n))) : 0
}

/** The delay this launch asked for ("--snip-delay=5"), if any. */
export function snipDelayFromArgv(argv: readonly string[]): number | undefined {
  for (const a of argv.slice(1)) {
    const m = /^--snip-delay=(\d{1,3})$/i.exec(a)
    if (m) return cleanSnipDelay(m[1])
  }
  return undefined
}

/** Which snip this launch asked for, if any. */
export function snipModeFromArgv(argv: readonly string[]): SnipMode | null {
  // The first one is the program itself.
  const args = argv.slice(1).map((a) => a.toLowerCase())
  if (args.includes(SNIP_TEXT_FLAG)) return 'text'
  if (args.includes(SNIP_PICTURE_FLAG) || args.some((a) => a.startsWith(`${SNIP_DELAY_FLAG}=`))) return 'picture'
  return null
}

/** A saved picture snip's file name: when it was taken ("Snip 2026-11-22 09-05-07.png"), with (2), (3)… if that's taken. */
export function snipFileName(at: Date, n = 1): string {
  const two = (x: number): string => String(x).padStart(2, '0')
  const stamp = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}-${two(at.getMinutes())}-${two(at.getSeconds())}`
  return `Snip ${stamp}${n > 1 ? ` (${n})` : ''}.png`
}
