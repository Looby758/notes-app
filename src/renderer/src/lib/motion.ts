import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Prefs } from '@shared/prefs'
import { usePrefs } from '../store/prefs'

/**
 * How much the app animates: Settings → Appearance → Motion, turned down from Full to Subtle when
 * the system asks for less motion. The level is written on <html data-motion> (lib/appearance.ts)
 * so CSS (styles/motion.css) and code outside React read the same answer.
 */
export type Motion = Prefs['motion']

const reduceQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null

export const systemReducesMotion = (): boolean => reduceQuery?.matches ?? false

export function effectiveMotion(setting: Motion): Motion {
  return setting === 'full' && systemReducesMotion() ? 'subtle' : setting
}

/** The level in use right now (for code that isn't a component). */
export function motionLevel(): Motion {
  return (document.documentElement.dataset.motion as Motion | undefined) ?? 'full'
}

/** Calls `onChange` when the system's reduce-motion setting changes. */
export function watchSystemMotion(onChange: () => void): () => void {
  reduceQuery?.addEventListener('change', onChange)
  return () => reduceQuery?.removeEventListener('change', onChange)
}

const subscribeSystem = (cb: () => void): (() => void) => watchSystemMotion(cb)

/** The level in use, for components. */
export function useMotion(): Motion {
  const setting = usePrefs((s) => s.prefs.motion)
  const reduced = useSyncExternalStore(subscribeSystem, systemReducesMotion)
  return setting === 'full' && reduced ? 'subtle' : setting
}

/**
 * Plays a one-off CSS animation class on an element again (adding a class that's already there
 * does nothing, so it's taken off and the element re-laid out first).
 */
export function replay(el: Element | null | undefined, className: string): void {
  if (!el || motionLevel() === 'off') return
  el.classList.remove(className)
  void (el as HTMLElement).offsetWidth
  el.classList.add(className)
}

/**
 * Adds `className` (an animation that ends with the element gone, like a tab shrinking away), then
 * calls `done` when it finishes. With motion off, or if the animation never starts, `done` runs
 * straight away / after `maxMs`.
 */
export function animateOut(el: Element | null | undefined, className: string, done: () => void, maxMs = 400): void {
  if (!el || motionLevel() === 'off') return done()
  let finished = false
  const finish = (): void => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    done()
  }
  const timer = setTimeout(finish, maxMs)
  el.addEventListener('animationend', (e) => e.target === el && finish())
  el.classList.add(className)
}

/**
 * Keeps something on screen for a moment after it's hidden, so it can animate away.
 * `mounted` says whether to draw it; `leaving` is true while it's on its way out.
 */
export function usePresence(open: boolean, ms: number): { mounted: boolean; leaving: boolean } {
  const motion = useMotion()
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    if (motion === 'off') {
      setMounted(false)
      return
    }
    const t = setTimeout(() => setMounted(false), ms)
    return () => clearTimeout(t)
  }, [open, ms, motion])
  return { mounted: open || mounted, leaving: !open && mounted }
}

// Things restored at start-up (tabs, panes) appear without their "new" animation.
const started = typeof performance !== 'undefined' ? performance.now() : 0
let firstPane: number | null = null

/** True while the window is still putting back what was open last time. */
export function isRestoring(): boolean {
  const now = performance.now()
  firstPane ??= now
  return now - firstPane < 800 || now - started < 1500
}

const inView = (r: DOMRect): boolean => r.bottom > 0 && r.top < window.innerHeight && r.height > 0

/** Where each item in a list is on screen, by its `data-key` attribute (only items in view, so long lists stay cheap). */
export function snapshot(root: Element, selector: string, attr: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const el of root.querySelectorAll<HTMLElement>(selector)) {
    const key = el.getAttribute(attr)
    const r = el.getBoundingClientRect()
    if (key !== null && inView(r)) out.set(key, r.top)
  }
  return out
}

/**
 * Slides list items from where they were (`before`, from `snapshot`) to where they are now.
 * An item whose key changed (a note moved to another folder) is found by `alias` (its name) when
 * that's unambiguous. Items that weren't there before fade in.
 */
export function slideFrom(root: Element, selector: string, attr: string, before: Map<string, number>, alias?: (key: string) => string): void {
  if (motionLevel() !== 'full' || before.size === 0) return
  const els = [...root.querySelectorAll<HTMLElement>(selector)]
  const now = new Set(els.map((el) => el.getAttribute(attr)))
  // Old positions of items that are gone, by alias (null when two share one).
  const gone = new Map<string, number | null>()
  if (alias) {
    for (const [key, top] of before) {
      if (now.has(key)) continue
      const a = alias(key)
      gone.set(a, gone.has(a) ? null : top)
    }
  }
  let moved = 0
  for (const el of els) {
    const key = el.getAttribute(attr)
    if (key === null) continue
    const r = el.getBoundingClientRect()
    if (!inView(r)) continue
    const from = before.get(key) ?? (alias ? gone.get(alias(key)) : undefined)
    if (moved++ > 200) break
    if (from === undefined || from === null) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' })
    } else if (Math.abs(from - r.top) > 1) {
      el.animate([{ transform: `translateY(${from - r.top}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.2, 0, 0, 1)' })
    }
  }
}
