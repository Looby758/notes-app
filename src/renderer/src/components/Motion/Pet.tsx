import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { usePrefs } from '../../store/prefs'
import { useUI } from '../../store/ui'
import { useMotion } from '../../lib/motion'
import { PET_CHEER } from '../../lib/pet'
import { useEditor } from '../../store/editor'
import { useVideoPlayer } from '../../store/videoPlayer'
import { VIDEO_TAB } from '../../lib/editorController'
import './pet.css'

/** How long without a key press or pointer move before the pet curls up for a nap. */
const NAP_AFTER_MS = 2 * 60_000
/** How long a cheer, a pat and waking up last (pet.css times the animations to fit). */
const CHEER_MS = 1500
const PAT_MS = 900
const WAKE_MS = 700
/** How far the eyes move towards the pointer, in the drawing's units. */
const LOOK = 2.2

type Mood = 'idle' | 'cheer' | 'pat' | 'nap' | 'wake'

/**
 * The app pet: a small round creature in the bottom-right corner. It breathes, blinks, watches the
 * pointer and wags its tail; hops and sparkles when you finish something (lib/pet.ts); purrs with
 * hearts when clicked; and naps when you've been away a while. Settings → Appearance → App pet
 * turns it off. Motion → Subtle keeps it from moving about (fades and blinks only); Off keeps it
 * still, with just its face changing.
 */
export default function Pet() {
  const on = usePrefs((s) => s.prefs.pet)
  const zen = useUI((s) => s.zen)
  // It keeps out of the way of a film (and the player's buttons in that corner).
  const playerShown = useEditor((s) => Object.values(s.panes).some((p) => p.active === VIDEO_TAB))
  const video = useVideoPlayer((s) => s.current)
  const watching = playerShown && !!video
  if (!on || zen || watching) return null
  return <PetBody />
}

function PetBody() {
  const motion = useMotion()
  const root = useRef<HTMLDivElement>(null)
  const [mood, setMood] = useState<Mood>('idle')
  const [blink, setBlink] = useState(false)
  // Bumped on each cheer or pat, so a second one in a row restarts the animation.
  const [beat, setBeat] = useState(0)
  const moodRef = useRef(mood)
  moodRef.current = mood
  const moodTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const play = (next: Mood, ms: number): void => {
    clearTimeout(moodTimer.current)
    setMood(next)
    setBeat((b) => b + 1)
    moodTimer.current = setTimeout(() => setMood('idle'), ms)
  }
  useEffect(() => () => clearTimeout(moodTimer.current), [])

  // Cheering when something's done (a napping pet wakes up for it).
  useEffect(() => {
    const onCheer = (): void => play('cheer', CHEER_MS)
    window.addEventListener(PET_CHEER, onCheer)
    return () => window.removeEventListener(PET_CHEER, onCheer)
  }, [])

  // Napping when you're away, waking with a stretch when you're back.
  useEffect(() => {
    let napTimer: ReturnType<typeof setTimeout>
    const restart = (): void => {
      clearTimeout(napTimer)
      napTimer = setTimeout(() => {
        clearTimeout(moodTimer.current)
        setMood('nap')
      }, NAP_AFTER_MS)
    }
    const onActive = (): void => {
      if (moodRef.current === 'nap') play('wake', WAKE_MS)
      restart()
    }
    restart()
    window.addEventListener('keydown', onActive)
    window.addEventListener('pointerdown', onActive)
    window.addEventListener('pointermove', onActive, { passive: true })
    return () => {
      clearTimeout(napTimer)
      window.removeEventListener('keydown', onActive)
      window.removeEventListener('pointerdown', onActive)
      window.removeEventListener('pointermove', onActive)
    }
  }, [])

  // Blinking every few seconds, at uneven times so it feels alive.
  useEffect(() => {
    if (motion === 'off') return
    let t: ReturnType<typeof setTimeout>
    const next = (): void => {
      t = setTimeout(
        () => {
          setBlink(true)
          t = setTimeout(() => {
            setBlink(false)
            next()
          }, 150)
        },
        2200 + Math.random() * 4200
      )
    }
    next()
    return () => clearTimeout(t)
  }, [motion])

  // Eyes follow the pointer (written straight onto the element, so it doesn't re-render).
  useEffect(() => {
    const el = root.current
    if (!el || motion === 'off') return
    let frame = 0
    let x = 0
    let y = 0
    const onMove = (e: PointerEvent): void => {
      x = e.clientX
      y = e.clientY
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const r = el.getBoundingClientRect()
        const dx = x - (r.left + r.width / 2)
        const dy = y - (r.top + r.height * 0.45)
        const dist = Math.hypot(dx, dy) || 1
        const reach = Math.min(1, dist / 240)
        el.style.setProperty('--look-x', ((dx / dist) * LOOK * reach).toFixed(2))
        el.style.setProperty('--look-y', ((dy / dist) * LOOK * reach).toFixed(2))
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      el.style.removeProperty('--look-x')
      el.style.removeProperty('--look-y')
    }
  }, [motion])

  const pat = (): void => {
    if (mood !== 'cheer') play('pat', PAT_MS)
  }

  const happy = mood === 'cheer' || mood === 'pat'
  const asleep = mood === 'nap'
  const effects = motion !== 'off'

  return (
    <div
      ref={root}
      className={`pet pet-${mood} ${blink && !happy && !asleep ? 'pet-blinking' : ''}`}
      title="Click to pat · Settings → Appearance → App pet turns it off"
      onClick={pat}
      aria-hidden
    >
      {effects && mood === 'cheer' && (
        <div className="pet-sparkles" key={`s${beat}`}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <i key={i} style={{ '--i': i } as CSSProperties} />
          ))}
        </div>
      )}
      {effects && mood === 'pat' && (
        <div className="pet-hearts" key={`h${beat}`}>
          <i />
          <i />
          <i />
        </div>
      )}
      {asleep && (
        <div className="pet-zzz">
          <i>z</i>
          {effects && <i>z</i>}
          {effects && <i>Z</i>}
        </div>
      )}

      <div className="pet-shadow" key={`sh${beat}`} />
      <div className="pet-hop" key={`b${beat}`}>
        <svg className="pet-svg" viewBox="0 0 64 64" width="60" height="60">
          <defs>
            <radialGradient id="pet-fur" cx="40%" cy="30%" r="75%">
              <stop offset="0%" className="pet-fur-light" />
              <stop offset="100%" className="pet-fur-dark" />
            </radialGradient>
            <radialGradient id="pet-belly" cx="50%" cy="35%" r="65%">
              <stop offset="0%" className="pet-belly-light" />
              <stop offset="100%" className="pet-belly-dark" />
            </radialGradient>
          </defs>

          <g className="pet-breathe">
            <path className="pet-tail" d="M47 50c7 1 11-4 10-10-.4-2.6-3.4-2.8-3.6-.2-.3 3.6-2.6 6-6.6 5.6z" fill="url(#pet-fur)" />

            <path className="pet-ear pet-ear-l" d="M17 25 15.5 9.5c-.2-2 1.9-3 3.3-1.6L30 19z" fill="url(#pet-fur)" />
            <path className="pet-ear pet-ear-r" d="M47 25l1.5-15.5c.2-2-1.9-3-3.3-1.6L34 19z" fill="url(#pet-fur)" />
            <path className="pet-ear-inner" d="M19.5 21 18.6 12.3 25.5 18.5z M44.5 21l.9-8.7-6.9 6.2z" />

            <path className="pet-body" d="M32 15c13 0 21 9.5 21 22 0 12-8 19-21 19S11 49 11 37c0-12.5 8-22 21-22z" fill="url(#pet-fur)" />
            <ellipse className="pet-tummy" cx="32" cy="45" rx="11.5" ry="9" fill="url(#pet-belly)" />
            <ellipse className="pet-paw" cx="24.5" cy="55" rx="4.6" ry="2.8" />
            <ellipse className="pet-paw" cx="39.5" cy="55" rx="4.6" ry="2.8" />

            <g className="pet-face">
              <ellipse className="pet-cheek" cx="19.5" cy="38" rx="3.6" ry="2.2" />
              <ellipse className="pet-cheek" cx="44.5" cy="38" rx="3.6" ry="2.2" />

              <g className="pet-eyes pet-eyes-open">
                <g className="pet-eye">
                  <ellipse cx="24" cy="32" rx="3.3" ry="4" />
                  <circle className="pet-glint" cx="25.2" cy="30.4" r="1.25" />
                  <circle className="pet-glint" cx="23" cy="33.6" r="0.55" />
                </g>
                <g className="pet-eye">
                  <ellipse cx="40" cy="32" rx="3.3" ry="4" />
                  <circle className="pet-glint" cx="41.2" cy="30.4" r="1.25" />
                  <circle className="pet-glint" cx="39" cy="33.6" r="0.55" />
                </g>
              </g>
              <path className="pet-eyes pet-eyes-happy" d="M20.5 33.5q3.5-5 7 0 M36.5 33.5q3.5-5 7 0" />
              <path className="pet-eyes pet-eyes-shut" d="M20.5 32q3.5 3.2 7 0 M36.5 32q3.5 3.2 7 0" />

              <path className="pet-mouth pet-mouth-calm" d="M29 38.2q1.5 1.6 3 0 q1.5 1.6 3 0" />
              <path className="pet-mouth pet-mouth-open" d="M28.6 37.6h6.8q-.4 4.6-3.4 4.6t-3.4-4.6z" />
            </g>
          </g>
        </svg>
      </div>
    </div>
  )
}
