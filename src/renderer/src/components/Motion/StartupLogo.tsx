import { useEffect, useState } from 'react'
import { useMotion } from '../../lib/motion'

/** How long the logo stays before fading away (styles/motion.css times its parts to fit). */
const SHOW_MS = { full: 1100, subtle: 500, off: 0 }

/**
 * The app's logo drawing itself for a moment at start-up, over the app as it loads. It never
 * blocks clicks, and Motion → Off skips it.
 */
export default function StartupLogo() {
  const motion = useMotion()
  const [phase, setPhase] = useState<'show' | 'leave' | 'gone'>(motion === 'off' ? 'gone' : 'show')

  useEffect(() => {
    if (phase !== 'show') return
    const t = setTimeout(() => setPhase('leave'), SHOW_MS[motion])
    return () => clearTimeout(t)
  }, [phase, motion])

  if (phase === 'gone') return null
  return (
    <div className={`startup-logo ${phase === 'leave' ? 'leaving' : ''}`} onAnimationEnd={(e) => e.target === e.currentTarget && phase === 'leave' && setPhase('gone')} aria-hidden>
      <div className="startup-tile">
        <div className="startup-page">
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  )
}
