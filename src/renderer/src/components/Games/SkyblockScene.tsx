import { useEffect, useRef, useState, type CSSProperties } from 'react'

/**
 * The SkyBlock pages' backdrop: a sky over floating islands, coloured for the page or profile
 * section you're on (green over the Garden, red over Slayer, a deep cave blue for Mining…). Only
 * the clouds move, and only by a transform, so it stays cheap.
 */

export interface SkyTheme {
  /** Top of the sky, the middle, and the glow at the horizon. */
  sky: [string, string, string]
  /** The big soft light (sun, moon, lava…). */
  glow: string
  /** Island rock and the grass on top. */
  rock: string
  grass: string
  /** The page's accent for panels, rings and buttons. */
  accent: string
  stars: number
}

const T = (sky: [string, string, string], glow: string, rock: string, grass: string, accent: string, stars = 0.5): SkyTheme => ({ sky, glow, rock, grass, accent, stars })

export const SKY_THEMES: Record<string, SkyTheme> = {
  setup: T(['#0b1030', '#1d1a4d', '#5b3a8c'], '#ffb36b', '#151433', '#5fd18b', '#8fa8ff', 0.8),
  overview: T(['#0b1030', '#1d1a4d', '#5b3a8c'], '#ffb36b', '#151433', '#5fd18b', '#8fa8ff', 0.8),
  networth: T(['#06231d', '#0f3b2f', '#3f7a4a'], '#ffd76b', '#0c2420', '#69db7c', '#5ee0a0', 0.4),
  gear: T(['#0a1426', '#17284a', '#3b5d8f'], '#a8d8ff', '#101a2e', '#7fb2e5', '#7fc4ff', 0.6),
  inventories: T(['#120f22', '#2a1f3f', '#6a4a6e'], '#ffcf8a', '#191427', '#c9a56b', '#e0b97a', 0.6),
  accessories: T(['#1a0b26', '#3a1450', '#8a3a86'], '#ff9be0', '#1d0f2a', '#e599f7', '#f08cff', 0.7),
  pets: T(['#1f1208', '#3f2410', '#a0582a'], '#ffd27a', '#21150c', '#ffb347', '#ffb35c', 0.3),
  collections: T(['#1d1707', '#3b2d0c', '#8a6a1e'], '#ffe27a', '#1f190b', '#e6c547', '#ffd34d', 0.3),
  dungeons: T(['#050f0e', '#0d2321', '#21514a'], '#7dffc8', '#0b1716', '#3fbf91', '#48e3a8', 0.5),
  slayer: T(['#1a0508', '#3a0a12', '#8a1c25'], '#ff6b5c', '#1c0709', '#c9343f', '#ff6b7a', 0.4),
  mining: T(['#040b16', '#0b1d33', '#1c4a6e'], '#5ce1ff', '#08121f', '#4fb5d9', '#56d6ff', 0.9),
  forest: T(['#071509', '#123018', '#2f6e3a'], '#d8ff8a', '#0c1a0e', '#62c46b', '#7ee08a', 0.5),
  bestiary: T(['#170c08', '#33190f', '#7a3d22'], '#ff9f6b', '#1a0f0a', '#c97a4a', '#ff9c6b', 0.4),
  garden: T(['#0d2a3f', '#1f5a7a', '#8ccfe6'], '#fff3a8', '#173226', '#7ed957', '#8be36a', 0),
  fishing: T(['#041627', '#0a3150', '#1d6e94'], '#a8f0ff', '#081a2a', '#3ba7c9', '#4fd1ff', 0.6),
  crimson: T(['#1c0603', '#45110a', '#b8361a'], '#ffb347', '#220806', '#ff5f2e', '#ff7a45', 0.2),
  rift: T(['#16071f', '#331046', '#7d2d86'], '#ff7be5', '#1a0a24', '#d65cf2', '#e57cff', 0.9),
  museum: T(['#18130a', '#352a14', '#7a6334'], '#ffe6a8', '#1d180e', '#d9b45a', '#f2cf72', 0.3),
  coop: T(['#0f0f24', '#24245a', '#55528f'], '#ffc1d6', '#14142c', '#a29bfe', '#b4a8ff', 0.6),
  stats: T(['#0c0f1e', '#1e2443', '#46507d'], '#c5d0ff', '#11152a', '#8a9cff', '#9aa9ff', 0.7),
  progress: T(['#071325', '#0f2a4a', '#2c6aa0'], '#9be7ff', '#0c1a2e', '#4fd1c5', '#5ed1ff', 0.6),
  goals: T(['#170e24', '#2c1b47', '#6a3fa0'], '#ffd479', '#1a1129', '#b48cff', '#c49bff', 0.7),
  helpers: T(['#0b1a14', '#163628', '#3e7a5a'], '#ffe9a8', '#0f2019', '#6fd39a', '#6fe0a5', 0.5),
  compare: T(['#1a0f14', '#3b1d2c', '#8a4560'], '#ffc58a', '#1d1117', '#ff8fb1', '#ff94b8', 0.6)
}

// ---------- which theme is showing ----------

let page = 'profile'
let section = 'overview'
const listeners = new Set<() => void>()
const tell = (): void => listeners.forEach((f) => f())
/** The page (profile, progress, goals…) and the profile section, which picks the colours. */
export const setSkyPage = (p: string): void => {
  if (p !== page) ((page = p), tell())
}
export const setSkySection = (s: string): void => {
  if (s !== section) ((section = s), tell())
}
export const currentSkyTheme = (): string => (page === 'profile' ? section : page)

function useSkyTheme(): SkyTheme {
  const [id, setId] = useState(currentSkyTheme())
  useEffect(() => {
    const f = (): void => setId(currentSkyTheme())
    listeners.add(f)
    return () => void listeners.delete(f)
  }, [])
  return SKY_THEMES[id] ?? SKY_THEMES.overview
}

// ---------- the drawing ----------

/** A small seeded random, so the islands and stars stay put between visits. */
function rand(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

/** A floating island: a grassy top and a craggy rock underneath that hangs down to a rough point. */
function islandPath(w: number, seed: number): { rock: string; grass: string; trees: [number, number, number][] } {
  const r = rand(seed)
  const top: [number, number][] = []
  const steps = 10
  for (let i = 0; i <= steps; i++) top.push([(i / steps) * w, (r() - 0.5) * w * 0.025])
  const under: [number, number][] = []
  const depth = w * (0.42 + r() * 0.22)
  const tip = 0.4 + r() * 0.2
  const n = 16
  for (let i = n; i >= 0; i--) {
    const f = i / n
    // Rounded near the edges, dropping to a point under the middle, with ledges along the way.
    const d = Math.abs(f - tip) / (f < tip ? tip : 1 - tip)
    const shape = Math.pow(Math.max(0, 1 - d), 0.9) * 0.75 + Math.sin(Math.PI * f) * 0.25
    const step = (i % 3 === 0 ? 0.05 : 0) + (r() - 0.5) * 0.08
    under.push([f * w + (r() - 0.5) * w * 0.02, w * 0.07 + Math.max(0, shape + step * shape) * depth])
  }
  const pts = (p: [number, number][]): string => p.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')
  const rock = `M ${pts(top)} L ${pts(under)} Z`
  const g = w * 0.06
  const grass = `M ${pts(top)} L ${w.toFixed(1)} ${g.toFixed(1)} ${[...top]
    .reverse()
    .map(([x, y], i) => `L ${x.toFixed(1)} ${(y + g + (i % 2 ? w * 0.025 : 0)).toFixed(1)}`)
    .join(' ')} Z`
  const trees: [number, number, number][] = []
  const count = Math.floor(r() * 3) + (w > 200 ? 1 : 0)
  for (let i = 0; i < count; i++) trees.push([w * (0.15 + r() * 0.7), w * (0.05 + r() * 0.04), 0.7 + r() * 0.6])
  return { rock, grass, trees }
}

// x, y in a 1600 × 900 box, width, and depth (0 far, 1 near).
const ISLANDS: [number, number, number, number][] = [
  [120, 610, 260, 1],
  [1260, 560, 300, 1],
  [520, 700, 170, 0.6],
  [930, 640, 140, 0.45],
  [330, 470, 90, 0.25],
  [1080, 430, 80, 0.2],
  [760, 520, 60, 0.15],
  [1450, 330, 70, 0.2]
]
const SHAPES = ISLANDS.map(([, , w], i) => islandPath(w, 7 + i * 31))
const STARS = (() => {
  const r = rand(99)
  return Array.from({ length: 90 }, () => [r() * 1600, r() * 520, r() * 1.4 + 0.3, r()] as const)
})()

export function SkyScene({ page: shownPage }: { page: string }) {
  useEffect(() => setSkyPage(shownPage), [shownPage])
  const t = useSkyTheme()
  const box = useRef<HTMLDivElement>(null)
  // Hand the page's colours to everything inside, so panels match the sky.
  useEffect(() => {
    const root = box.current?.parentElement
    if (!root) return
    root.style.setProperty('--sec', t.accent)
    root.style.setProperty('--sec-glow', t.glow)
    root.style.setProperty('--sec-deep', t.sky[1])
  }, [t])
  return (
    <div
      ref={box}
      className="sky"
      aria-hidden
      style={
        {
          '--sky-a': t.sky[0],
          '--sky-b': t.sky[1],
          '--sky-c': t.sky[2],
          '--sky-glow': t.glow,
          '--sky-rock': t.rock,
          '--sky-grass': t.grass,
          '--sky-stars': t.stars
        } as CSSProperties
      }
    >
      <div className="sky-grad" />
      <div className="sky-sun" />
      <svg className="sky-stars" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        {STARS.map(([x, y, s, o], i) => (
          <circle key={i} cx={x} cy={y} r={s} opacity={0.3 + o * 0.7} />
        ))}
      </svg>
      <div className="sky-clouds far" />
      <svg className="sky-islands" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="sky-rock" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--sky-grass)', stopOpacity: 0.25 }} />
            <stop offset="0.25" style={{ stopColor: 'var(--sky-rock)' }} />
            <stop offset="1" style={{ stopColor: 'var(--sky-rock)', stopOpacity: 0.6 }} />
          </linearGradient>
        </defs>
        {[...ISLANDS.keys()]
          .sort((a, b) => ISLANDS[a][3] - ISLANDS[b][3])
          .map((i) => {
            const [x, y, , d] = ISLANDS[i]
            const s = SHAPES[i]
            return (
              <g key={i} transform={`translate(${x} ${y})`} style={{ opacity: 0.35 + d * 0.65 }} className="sky-island">
                <path d={s.rock} fill="url(#sky-rock)" />
                <path d={s.grass} className="sky-grass" />
                {s.trees.map(([tx, ty, k2], k) => (
                  <g key={k} className="sky-tree" transform={`translate(${tx} 0) scale(${k2})`}>
                    <rect x={-ty * 0.12} y={-ty * 1.6} width={ty * 0.24} height={ty * 1.7} className="sky-trunk" />
                    <circle cx={0} cy={-ty * 2} r={ty * 0.85} />
                    <circle cx={-ty * 0.55} cy={-ty * 1.55} r={ty * 0.6} />
                    <circle cx={ty * 0.55} cy={-ty * 1.6} r={ty * 0.62} />
                  </g>
                ))}
              </g>
            )
          })}
      </svg>
      <div className="sky-clouds near" />
      <div className="sky-fog" />
    </div>
  )
}
