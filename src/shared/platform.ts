/**
 * Which system the app runs on, usable from both the main process (process.platform) and the
 * sandboxed UI (navigator.platform, e.g. "MacIntel"; there's no `process` there).
 */
export const IS_MAC =
  typeof process !== 'undefined' && typeof process.platform === 'string'
    ? process.platform === 'darwin'
    : typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

/** What the system calls the bin deleted files go to. */
export const TRASH_NAME = IS_MAC ? 'Bin' : 'Recycle Bin'
export const SYSTEM_NAME = IS_MAC ? 'macOS' : 'Windows'
/** The system's file manager. */
export const FILE_MANAGER = IS_MAC ? 'Finder' : 'File Explorer'
/** Where the app's icon lives while it runs in the background. */
export const TRAY_NAME = IS_MAC ? 'menu bar' : 'tray'

/**
 * Shortcuts are stored the Windows way ("Ctrl+Shift+K"); on a Mac, Ctrl means ⌘ and they're shown
 * with the Mac symbols ("⇧⌘K").
 */
export function showKeys(shortcut: string): string {
  if (!IS_MAC) return shortcut
  const parts = shortcut.split(/\+(?!$)/)
  const key = parts.pop() ?? ''
  const symbols: Record<string, string> = { Ctrl: '⌘', Control: '⌘', Alt: '⌥', Shift: '⇧', Super: '⌘', Meta: '⌘' }
  // Mac order: ⌃ ⌥ ⇧ ⌘
  const order = ['⌃', '⌥', '⇧', '⌘']
  // ⌘Tab belongs to macOS, so Ctrl+Tab stays the real Control key (which also works).
  if (key === 'Tab') symbols.Ctrl = '⌃'
  const mods = parts.map((p) => symbols[p] ?? p).sort((a, b) => order.indexOf(a) - order.indexOf(b))
  const keyNames: Record<string, string> = { Up: '↑', Down: '↓', Left: '←', Right: '→', Enter: '↩', Escape: 'Esc', Backspace: '⌫', Delete: '⌦', Tab: '⇥', Plus: '+' }
  return mods.join('') + (keyNames[key] ?? key)
}

/**
 * Readable name for an Electron accelerator (the system-wide quick capture shortcut), where
 * Control is the real Control key and Super is Win / ⌘: "Super+Shift+N" → "Win+Shift+N".
 */
export function acceleratorLabel(accel: string): string {
  if (!accel) return ''
  if (!IS_MAC) return accel.replace('Super', 'Win').replace('Control', 'Ctrl')
  const symbols: Record<string, string> = { Control: '⌃', Alt: '⌥', Shift: '⇧', Super: '⌘' }
  const parts = accel.split('+')
  const key = parts.pop() ?? ''
  const order = ['⌃', '⌥', '⇧', '⌘']
  return parts.map((p) => symbols[p] ?? p).sort((a, b) => order.indexOf(a) - order.indexOf(b)).join('') + key
}

/** "Ctrl+click" / "⌘-click". */
export const CLICK_MOD = IS_MAC ? '⌘-click' : 'Ctrl+click'
