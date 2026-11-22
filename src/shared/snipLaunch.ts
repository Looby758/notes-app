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

/** Which snip this launch asked for, if any. */
export function snipModeFromArgv(argv: readonly string[]): SnipMode | null {
  // The first one is the program itself.
  const args = argv.slice(1).map((a) => a.toLowerCase())
  if (args.includes(SNIP_TEXT_FLAG)) return 'text'
  if (args.includes(SNIP_PICTURE_FLAG)) return 'picture'
  return null
}
