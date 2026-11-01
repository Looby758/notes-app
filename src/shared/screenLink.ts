/**
 * Screens between the two paired computers (built on the mouse-sharing link): the MacBook as a
 * second screen for the PC, and seeing and using the Mac's screen from the PC in a window. These are
 * the parts that are plain logic, so they can be tested.
 */

import type { Rect } from './mouseShare'

/**
 * - extend: this computer shows one of its screens on the other one, full screen there (the MacBook
 *   as a second screen for the PC). The computer that asks is the one whose screen is shown.
 * - control: this computer opens a window showing the other one's screen, and the mouse and
 *   keyboard in that window work it. The computer that asks is the one watching.
 */
export type ScreenMode = 'extend' | 'control'

/** What a screen session looks like to the Settings page and the features menu. */
export interface ScreenStatus {
  /** The paired computer is connected, so a screen can be shared. */
  available: boolean
  peerName: string
  /** What's going on right now, if anything. `role` is this computer's part in it. */
  session: { mode: ScreenMode; role: 'send' | 'view'; state: 'starting' | 'live' } | null
  /** This computer's screens (for picking which one goes on the other computer). */
  displays: { id: string; label: string; width: number; height: number; primary: boolean }[]
  /** The screen picked to show on the other computer ('' = worked out each time). */
  extendDisplay: string
  /** Windows: an extra (e.g. virtual) screen exists, so the other computer extends rather than copies. */
  canExtend: boolean
  /** Mac: macOS lets Orbit record the screen (needed to be seen and used from the PC). */
  screenAllowed: boolean
  /** The virtual screen download/installer, while it's going. */
  installing: string
  error: string
}

/** Something done in the window showing the other computer's screen: where (0 to 1 across and down the picture), or a button, scroll or key. */
export type ScreenInput =
  | { t: 'pos'; x: number; y: number }
  | { t: 'btn'; b: 0 | 1 | 2; down: boolean }
  | { t: 'wheel'; dx: number; dy: number }
  | { t: 'key'; code: string; down: boolean }

const clamp01 = (n: number): number => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0))

/** Where on the shared screen a point in the picture is (0 to 1 across and down), in that screen's own coordinates. */
export function pointOnDisplay(display: Rect, fx: number, fy: number): { x: number; y: number } {
  const x = display.x + clamp01(fx) * (display.width - 1)
  const y = display.y + clamp01(fy) * (display.height - 1)
  return { x: Math.round(x), y: Math.round(y) }
}

/**
 * Where a point in the window falls on the picture, which is fitted in without stretching (so there
 * may be bars at the sides or top and bottom). Null over the bars.
 */
export function pictureFraction(
  box: { width: number; height: number },
  picture: { width: number; height: number },
  at: { x: number; y: number }
): { x: number; y: number } | null {
  if (box.width <= 0 || box.height <= 0 || picture.width <= 0 || picture.height <= 0) return null
  const scale = Math.min(box.width / picture.width, box.height / picture.height)
  const w = picture.width * scale
  const h = picture.height * scale
  const left = (box.width - w) / 2
  const top = (box.height - h) / 2
  const fx = (at.x - left) / w
  const fy = (at.y - top) / h
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null
  return { x: fx, y: fy }
}

/**
 * Which of this computer's screens goes on the other one: the one picked, if it's still there;
 * otherwise an extra screen (a virtual one, or a second monitor) rather than the main one, so the
 * other computer adds space instead of copying what's in front of you.
 */
export function pickDisplay<T extends { id: string; primary: boolean }>(displays: T[], wanted: string): T | undefined {
  return displays.find((d) => d.id === wanted) ?? displays.find((d) => !d.primary) ?? displays[0]
}

/**
 * The installer to download for the virtual screen, from a GitHub release's files: a Windows
 * installer (an .exe or .msi with "setup" or "installer" in the name, else any .exe) for this
 * computer's kind of processor.
 */
export function pickInstaller(assets: { name: string; url: string }[], arch: string): { name: string; url: string } | undefined {
  const windows = assets.filter((a) => /\.(exe|msi)$/i.test(a.name))
  const armWanted = arch === 'arm64'
  const forArch = windows.filter((a) => (/arm64|aarch64/i.test(a.name) ? armWanted : !armWanted || !/x64|amd64|x86/i.test(a.name)))
  const pool = forArch.length ? forArch : windows
  return pool.find((a) => /setup|install/i.test(a.name)) ?? pool[0]
}
