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
/** How long a cheer, a pat, a burst of love and waking up last (pet.css times the animations to fit). */
const CHEER_MS = 1600
const PAT_MS = 900
const LOVE_MS = 1700
const WAKE_MS = 1300
/** Pats this close together count as one fuss; this many in a row and it's smitten. */
const PAT_STREAK_GAP_MS = 1400
const PATS_FOR_LOVE = 4
/** How far the eyes move towards the pointer, in the drawing's units. */
const LOOK = 2.2

type Mood = 'idle' | 'cheer' | 'pat' | 'love' | 'nap' | 'wake'

/**
 * Little things it does by itself now and then while idle, and how long each takes (pet.css).
 * On Subtle it only yawns (a change of face, not a movement); with Motion off it does none.
 */
const FIDGETS = { tilt: 1700, look: 2400, yawn: 1600, bounce: 900, swish: 1300, wiggle: 1100 } as const
type Fidget = keyof typeof FIDGETS
const FIDGET_NAMES = Object.keys(FIDGETS) as Fidget[]

/**
 * The app pet: a chubby little cat in the bottom-right corner with a tiny moon in orbit around it.
 * It breathes, blinks, watches the pointer and swishes its tail, and every so often tilts its head,
 * looks around, yawns or does a little bounce. It perks up when you hover it; hops, spins and gets
 * star-eyed when you finish something (lib/pet.ts); purrs with hearts when patted (keep patting and
 * it gets heart eyes); and naps with a sleep bubble when you've been away a while, waking with a
 * stretch and a yawn. Settings → Appearance → App pet turns it off. Motion → Subtle keeps it from
 * moving about (fades, blinks and faces only, and the moon stays put); Off keeps it still, with
 * just its face changing.
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

/** A four-pointed star centred on (x, y): the cheering eyes and the collar charm. */
const star = (x: number, y: number, r: number): string => {
  const k = r * 0.24
  return `M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`
}
/** A heart centred on (x, y), `w` wide: the smitten eyes. */
const heart = (x: number, y: number, w: number): string => {
  const s = w / 10
  const p = (dx: number, dy: number): string => `${(x + dx * s).toFixed(2)} ${(y + dy * s).toFixed(2)}`
  return `M${p(0, 4.2)}C${p(-3, 2)} ${p(-5, 0.2)} ${p(-5, -1.8)}C${p(-5, -4)} ${p(-2.4, -5.2)} ${p(0, -2.6)}C${p(2.4, -5.2)} ${p(5, -4)} ${p(5, -1.8)}C${p(5, 0.2)} ${p(3, 2)} ${p(0, 4.2)}Z`
}

export function PetBody() {
  const motion = useMotion()
  const root = useRef<HTMLDivElement>(null)
  const [mood, setMood] = useState<Mood>('idle')
  const [blink, setBlink] = useState(false)
  const [fidget, setFidget] = useState<Fidget | null>(null)
  // Bumped on each cheer, pat or fidget, so a second one in a row restarts the animation.
  const [beat, setBeat] = useState(0)
  const moodRef = useRef(mood)
  moodRef.current = mood
  const moodTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pats = useRef({ count: 0, last: 0 })

  const play = (next: Mood, ms: number): void => {
    clearTimeout(moodTimer.current)
    setFidget(null)
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

  // Napping when you're away, waking with a stretch and a yawn when you're back.
  useEffect(() => {
    let napTimer: ReturnType<typeof setTimeout>
    const restart = (): void => {
      clearTimeout(napTimer)
      napTimer = setTimeout(() => {
        clearTimeout(moodTimer.current)
        setFidget(null)
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

  // Blinking every few seconds, at uneven times (and now and then twice) so it feels alive.
  useEffect(() => {
    if (motion === 'off') return
    let t: ReturnType<typeof setTimeout>
    const shut = (then: () => void): void => {
      setBlink(true)
      t = setTimeout(() => {
        setBlink(false)
        then()
      }, 140)
    }
    const next = (): void => {
      t = setTimeout(
        () => shut(() => (Math.random() < 0.25 ? (t = setTimeout(() => shut(next), 180)) : next())),
        2200 + Math.random() * 4200
      )
    }
    next()
    return () => clearTimeout(t)
  }, [motion])

  // Fidgeting by itself every so often while idle.
  useEffect(() => {
    if (motion === 'off' || mood !== 'idle') return
    let t: ReturnType<typeof setTimeout>
    const next = (): void => {
      t = setTimeout(
        () => {
          // Late at night it yawns a lot more.
          const hour = new Date().getHours()
          const sleepy = hour >= 23 || hour < 5
          const pick: Fidget =
            motion === 'subtle' || (sleepy && Math.random() < 0.4)
              ? 'yawn'
              : FIDGET_NAMES[Math.floor(Math.random() * FIDGET_NAMES.length)]
          setFidget(pick)
          setBeat((b) => b + 1)
          t = setTimeout(() => {
            setFidget(null)
            next()
          }, FIDGETS[pick])
        },
        (motion === 'subtle' ? 30_000 : 7000) + Math.random() * 9000
      )
    }
    next()
    return () => {
      clearTimeout(t)
      setFidget(null)
    }
  }, [motion, mood])

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
    if (mood === 'cheer') return
    const now = Date.now()
    const p = pats.current
    p.count = now - p.last < PAT_STREAK_GAP_MS ? p.count + 1 : 1
    p.last = now
    if (p.count >= PATS_FOR_LOVE) {
      p.count = 0
      play('love', LOVE_MS)
    } else if (mood !== 'love') play('pat', PAT_MS)
  }

  const effects = motion !== 'off'
  const faceBusy = mood !== 'idle' || fidget === 'yawn'
  const classes = ['pet', `pet-${mood}`]
  if (mood === 'idle' && fidget) classes.push(`pet-fidget-${fidget}`)
  if (blink && !faceBusy) classes.push('pet-blinking')

  return (
    <div
      ref={root}
      className={classes.join(' ')}
      title="Click to pat · Settings → Appearance → App pet turns it off"
      onClick={pat}
      aria-hidden
    >
      {/* The little moon goes round it: one copy behind the cat and one in front, each shown for its half of the orbit. */}
      <div className="pet-orbit pet-orbit-back">
        <span className="pet-moon-x">
          <span className="pet-moon-y">
            <i className="pet-moon" />
          </span>
        </span>
      </div>

      {effects && mood === 'cheer' && (
        <div className="pet-sparkles" key={`s${beat}`}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <i key={i} style={{ '--i': i } as CSSProperties} />
          ))}
        </div>
      )}
      {effects && (mood === 'pat' || mood === 'love') && (
        <div className={`pet-hearts ${mood === 'love' ? 'pet-hearts-burst' : ''}`} key={`h${beat}`}>
          {(mood === 'love' ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2]).map((i) => (
            <i key={i} style={{ '--i': i } as CSSProperties} />
          ))}
        </div>
      )}
      {mood === 'nap' && (
        <div className="pet-zzz">
          <i>z</i>
          {effects && <i>z</i>}
          {effects && <i>Z</i>}
        </div>
      )}

      <div className="pet-shadow" key={`sh${beat}`} />
      <div className="pet-hop" key={`b${beat}`}>
        <svg className="pet-svg" viewBox="0 0 64 64" width="64" height="64">
          <defs>
            <radialGradient id="pet-fur" cx="38%" cy="28%" r="80%">
              <stop offset="0%" className="pet-fur-light" />
              <stop offset="100%" className="pet-fur-dark" />
            </radialGradient>
            <radialGradient id="pet-belly" cx="50%" cy="30%" r="70%">
              <stop offset="0%" className="pet-belly-light" />
              <stop offset="100%" className="pet-belly-dark" />
            </radialGradient>
            <linearGradient id="pet-iris" x1="0" y1="0" x2="0" y2="1">
              <stop offset="35%" className="pet-iris-top" />
              <stop offset="100%" className="pet-iris-bottom" />
            </linearGradient>
            <radialGradient id="pet-blush">
              <stop offset="0%" className="pet-blush-mid" />
              <stop offset="100%" className="pet-blush-edge" />
            </radialGradient>
            <radialGradient id="pet-bubble" cx="35%" cy="35%" r="70%">
              <stop offset="0%" className="pet-bubble-mid" />
              <stop offset="100%" className="pet-bubble-edge" />
            </radialGradient>
          </defs>

          <g className="pet-breathe">
            <g className="pet-purr">
              <g className="pet-tail">
                <path className="pet-tail-line" d="M43 55c8 2.2 14-1.6 14.2-8.6.1-3.2-1.4-5.8-3.6-7.2" />
                <path className="pet-tail-fur" d="M43 55c8 2.2 14-1.6 14.2-8.6.1-3.2-1.4-5.8-3.6-7.2" />
                <path className="pet-tail-tip" pathLength={100} d="M43 55c8 2.2 14-1.6 14.2-8.6.1-3.2-1.4-5.8-3.6-7.2" />
              </g>

              <ellipse className="pet-body" cx="32" cy="50.5" rx="14.5" ry="10" fill="url(#pet-fur)" />
              <ellipse className="pet-tummy" cx="32" cy="52.6" rx="8.6" ry="6.4" fill="url(#pet-belly)" />
              <g className="pet-feet">
                <ellipse className="pet-paw" cx="25" cy="58.6" rx="5" ry="3.2" />
                <ellipse className="pet-paw" cx="39" cy="58.6" rx="5" ry="3.2" />
                <path className="pet-toes" d="M23.6 57.4v1.5M26.4 57.4v1.5M37.6 57.4v1.5M40.4 57.4v1.5" />
              </g>

              <g className="pet-head">
                <g className="pet-ear pet-ear-l">
                  <path className="pet-line" d="M11.5 24C10.5 16 11 9 13.5 5.5c1.1-1.5 2.9-1.3 4.1-.1 3.4 3.2 6.9 6.6 9.4 10.6z" fill="url(#pet-fur)" />
                  <path className="pet-ear-inner" d="M14.6 19.5c-.5-5.5-.1-9 1-10.9 2.8 2.4 5.4 5 7.4 7.8z" />
                </g>
                <g className="pet-ear pet-ear-r">
                  <path className="pet-line" d="M52.5 24c1-8 .5-15-2-18.5-1.1-1.5-2.9-1.3-4.1-.1-3.4 3.2-6.9 6.6-9.4 10.6z" fill="url(#pet-fur)" />
                  <path className="pet-ear-inner" d="M49.4 19.5c.5-5.5.1-9-1-10.9-2.8 2.4-5.4 5-7.4 7.8z" />
                </g>

                <path
                  className="pet-line pet-skull"
                  d="M32 12.5C47.5 12.5 56 20.5 56 31c0 2-.2 4-.6 5.8l3 1.8-3.8 1.6 2.4 2.4-4-.1C50 45.5 43 47.5 32 47.5S14 45.5 11 42.5l-4 .1 2.4-2.4-3.8-1.6 3-1.8C8.2 35 8 33 8 31 8 20.5 16.5 12.5 32 12.5z"
                  fill="url(#pet-fur)"
                />
                <path className="pet-stripes" d="M32 14.4v4.2M27.4 15.2v2.8M36.6 15.2v2.8" />
                <path className="pet-shine" d="M14.5 25c2-5.6 6.4-8.6 12.4-9.6" />

                <g className="pet-face">
                  <ellipse className="pet-cheek" cx="16" cy="38.6" rx="4.6" ry="3" fill="url(#pet-blush)" />
                  <ellipse className="pet-cheek" cx="48" cy="38.6" rx="4.6" ry="3" fill="url(#pet-blush)" />
                  <path className="pet-whiskers" d="M12.8 35.6 6.4 34.4M12.8 37.8l-6.2.8M51.2 35.6l6.4-1.2M51.2 37.8l6.2.8" />

                  <g className="pet-eyes pet-eyes-open">
                    <g className="pet-glance">
                      <g className="pet-eye">
                        <ellipse cx="22" cy="31" rx="4.6" ry="5.4" fill="url(#pet-iris)" />
                        <circle className="pet-glint" cx="23.8" cy="28.6" r="1.8" />
                        <circle className="pet-glint" cx="20.4" cy="33.4" r="0.85" />
                      </g>
                      <g className="pet-eye">
                        <ellipse cx="42" cy="31" rx="4.6" ry="5.4" fill="url(#pet-iris)" />
                        <circle className="pet-glint" cx="43.8" cy="28.6" r="1.8" />
                        <circle className="pet-glint" cx="40.4" cy="33.4" r="0.85" />
                      </g>
                    </g>
                  </g>
                  <path className="pet-eyes pet-eyes-line pet-eyes-happy" d="M17.5 32.6q4.5-6 9 0M37.5 32.6q4.5-6 9 0" />
                  <path className="pet-eyes pet-eyes-line pet-eyes-shut" d="M17.5 31q4.5 4 9 0M37.5 31q4.5 4 9 0" />
                  <path className="pet-eyes pet-eyes-line pet-eyes-squeeze" d="M18.4 28l6.4 3-6.4 3M45.6 28l-6.4 3 6.4 3" />
                  <path className="pet-eyes pet-eyes-star" d={star(22, 31, 5.6) + star(42, 31, 5.6)} />
                  <path className="pet-eyes pet-eyes-heart" d={heart(22, 31.4, 10.5) + heart(42, 31.4, 10.5)} />

                  <path className="pet-nose" d="M30.3 35.2h3.4c.5 0 .7.5.4.9l-1.4 1.4c-.4.4-1 .4-1.4 0l-1.4-1.4c-.3-.4-.1-.9.4-.9z" />
                  <path className="pet-mouth pet-mouth-calm" d="M29 38q1.5 1.9 3 0 1.5 1.9 3 0" />
                  <g className="pet-mouth pet-mouth-open">
                    <path d="M28.4 37.8q3.6 1.3 7.2 0-.3 5-3.6 5t-3.6-5z" />
                    <ellipse className="pet-tongue" cx="32" cy="41.4" rx="1.9" ry="1.1" />
                  </g>
                  <g className="pet-mouth pet-mouth-yawn">
                    <ellipse cx="32" cy="40.6" rx="2.8" ry="3.4" />
                    <ellipse className="pet-tongue" cx="32" cy="42.6" rx="1.8" ry="1" />
                  </g>
                  <g className="pet-bubble">
                    <circle cx="37.4" cy="38.6" r="3.4" fill="url(#pet-bubble)" />
                    <circle className="pet-glint" cx="36.4" cy="37.4" r="0.8" />
                  </g>
                </g>
              </g>

              <path className="pet-collar" d="M21.4 46q10.6 4.6 21.2 0" />
              <g className="pet-charm">
                <path d={star(32, 51.2, 3.4)} />
              </g>
            </g>
          </g>
        </svg>
      </div>

      <div className="pet-orbit pet-orbit-front">
        <span className="pet-moon-x">
          <span className="pet-moon-y">
            <i className="pet-moon" />
          </span>
        </span>
      </div>
    </div>
  )
}
