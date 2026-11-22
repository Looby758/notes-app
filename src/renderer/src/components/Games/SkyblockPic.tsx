import { useEffect, useState, type CSSProperties } from 'react'
import type { ItemIcon, SkyblockAddonState } from '@shared/skyblockTextures'

/**
 * Item pictures for the SkyBlock pages: a texture from the SkyBlock add-on's packs, a 3D player head
 * drawn from its skin, or two letters when there's neither.
 */

// ---------- the add-on's state, shared by every page that asks ----------

let addonState: SkyblockAddonState | null = null
const addonListeners = new Set<(s: SkyblockAddonState) => void>()
let addonWatching = false

function loadAddon(): void {
  void window.api.skyblockAddonState().then((s) => {
    const changed = !addonState || addonState.state !== s.state || addonState.packs.join() !== s.packs.join() || addonState.iconsVersion !== s.iconsVersion
    addonState = s
    if (changed) loadIcons()
    for (const fn of addonListeners) fn(s)
  })
}

/** The SkyBlock add-on's state (null for the first moment), kept up to date. */
export function useSkyblockAddon(): SkyblockAddonState | null {
  const [s, setS] = useState(addonState)
  useEffect(() => {
    addonListeners.add(setS)
    if (!addonWatching) {
      addonWatching = true
      window.api.onSkyblockAddonChanged(loadAddon)
    }
    loadAddon()
    return () => void addonListeners.delete(setS)
  }, [])
  return s
}

// ---------- NEU item id → picture ----------

let icons: Record<string, ItemIcon> = {}
const iconListeners = new Set<() => void>()
let iconsLoaded = false

function loadIcons(): void {
  void window.api.skyblockAddonIcons().then((m) => {
    icons = m
    iconsLoaded = true
    for (const fn of iconListeners) fn()
  })
}

/** Rerenders when the pictures change (installed, or new packs). */
export function useNeuIcons(): Record<string, ItemIcon> {
  const [, bump] = useState(0)
  useEffect(() => {
    const fn = (): void => bump((n) => n + 1)
    iconListeners.add(fn)
    if (!iconsLoaded) loadIcons()
    return () => void iconListeners.delete(fn)
  }, [])
  return icons
}

/** The picture for a NEU id, trying the forms Hypixel and NEU spell ids in ("INK_SACK:3" → "INK_SACK-3"). */
export function neuIcon(map: Record<string, ItemIcon>, id: string | undefined): ItemIcon | undefined {
  if (!id) return undefined
  return map[id] ?? map[id.replace(/:/g, '-')] ?? map[id.replace(/:\d+$/, '')] ?? map[id.toUpperCase()]
}

// ---------- drawing ----------

const plain = (s: string): string => s.replace(/§./g, '')

/** Two letters for an item without a picture ("Hyperion" → "Hy", "Necron's Chestplate" → "NC"). */
export function initials(name: string): string {
  const words = plain(name)
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2)
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/** A player head in 3D (front, side and top, with the hat layer), from a skin id. */
export function Head({ skin, size = 32 }: { skin: string; size?: number }) {
  const s = Math.round(size * 0.58)
  return (
    <span className="sb-head" style={{ width: size, height: size, '--s': `${s}px`, '--skin': `url("sbtex://skin/${skin}")` } as CSSProperties} aria-hidden>
      <span className="sb-head-cube">
        <i className="sb-face top" />
        <i className="sb-face front" />
        <i className="sb-face side" />
        <span className="sb-head-hat">
          <i className="sb-face top" />
          <i className="sb-face front" />
          <i className="sb-face side" />
        </span>
      </span>
    </span>
  )
}

/**
 * An item's picture. `icon` is the item's own (from its NBT); `id` looks one up by NEU id instead.
 * Falls back to two letters from `name`.
 */
export function ItemPic({
  icon,
  id,
  name = '',
  size = 32,
  glint = false,
  className = ''
}: {
  icon?: ItemIcon
  id?: string
  name?: string
  size?: number
  glint?: boolean
  className?: string
}) {
  const map = useNeuIcons()
  const pic = icon ?? neuIcon(map, id)
  const [broken, setBroken] = useState<string | null>(null)
  const style = { width: size, height: size }
  if (pic?.tex && broken !== pic.tex) {
    // The version makes the page fetch again after the pictures change (a new pack keeps the same file names).
    const src = `sbtex://tex/${pic.tex.split('/').map(encodeURIComponent).join('/')}?v=${addonState?.iconsVersion ?? 0}`
    return (
      <span className={`sb-pic ${className}`} style={style}>
        <img src={src} alt="" draggable={false} onError={() => setBroken(pic.tex!)} />
        {glint && <span className="sb-glint" style={{ WebkitMaskImage: `url("${src}")` }} />}
      </span>
    )
  }
  if (pic?.skin) return <Head skin={pic.skin} size={size} />
  return (
    <span className={`sb-pic sb-pic-letters ${className}`} style={{ ...style, fontSize: Math.max(9, Math.round(size * 0.36)) }}>
      {initials(name || id || '?')}
    </span>
  )
}
