import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { LAUNCH_ANIMATION_MS, type Game, type GameSource, type LaunchArt } from '@shared/games'

const STARTING_WITH: Record<GameSource, string> = { steam: 'Starting with Steam', epic: 'Starting with Epic Games', roblox: 'Starting Roblox', app: 'Starting', added: 'Starting' }

/** How long fading out takes (ms); matches .launch-anim.closing in theme.css. */
const FADE_MS = 400

/**
 * The launch animation: the game's art fills the window, slowly drifting closer, and its logo (or
 * name) fades in, for a few seconds while the game starts. Click, or press Esc, Enter or Space, to skip.
 */
export default function LaunchAnimation({ game, onDone }: { game: Game; onDone: () => void }) {
  const [art, setArt] = useState<LaunchArt | null>(null)
  // Backdrops are tried in turn (the hero, then the card's art) until one loads; then the app icon.
  const [heroFailures, setHeroFailures] = useState(0)
  const [heroLoaded, setHeroLoaded] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    let live = true
    window.api.gamesLaunchArt(game.id).then(
      (a) => live && setArt(a),
      () => live && setArt({ hero: game.art, logo: null })
    )
    return () => {
      live = false
    }
  }, [game.id, game.art])

  useEffect(() => {
    if (!closing) return
    const t = setTimeout(onDone, FADE_MS)
    return () => clearTimeout(t)
  }, [closing, onDone])

  useEffect(() => {
    const t = setTimeout(() => setClosing(true), LAUNCH_ANIMATION_MS)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' && e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      e.stopPropagation()
      setClosing(true)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])

  const heroes = art ? [...new Set([art.hero, game.art])].filter((h): h is string => !!h) : []
  const hero = heroes[heroFailures] ?? null
  const logo = art?.logo && !logoFailed ? art.logo : null
  const iconOnly = !hero && !!game.icon

  return createPortal(
    <div
      className={`launch-anim ${closing ? 'closing' : ''}`}
      style={{ ['--launch-ms' as string]: `${LAUNCH_ANIMATION_MS}ms` }}
      onClick={() => setClosing(true)}
      role="dialog"
      aria-label={`Starting ${game.name}`}
      data-launch-animation
    >
      <div className="launch-backdrop">
        {hero ? (
          <img
            key={hero}
            className={heroLoaded ? 'loaded' : ''}
            src={hero}
            alt=""
            draggable={false}
            onLoad={() => setHeroLoaded(true)}
            onError={() => {
              setHeroLoaded(false)
              setHeroFailures((n) => n + 1)
            }}
          />
        ) : iconOnly ? (
          <img className="launch-backdrop-icon loaded" src={game.icon!} alt="" draggable={false} />
        ) : null}
      </div>
      <div className="launch-shade" />
      <div className="launch-bar top" />
      <div className="launch-bar bottom" />

      <div className="launch-title">
        {logo ? (
          <img className="launch-logo" src={logo} alt={game.name} draggable={false} onError={() => setLogoFailed(true)} />
        ) : (
          <>
            {iconOnly && <img className="launch-icon" src={game.icon!} alt="" draggable={false} />}
            <div className="launch-name">{game.name}</div>
          </>
        )}
        <div className="launch-status">{STARTING_WITH[game.source]}…</div>
        <div className="launch-progress">
          <span />
        </div>
      </div>

      <button
        className="launch-skip"
        onClick={(e) => {
          e.stopPropagation()
          setClosing(true)
        }}
        data-launch-skip
      >
        Skip <kbd>Esc</kbd>
      </button>
    </div>,
    document.body
  )
}
