import { toVaultUrl } from './paths'

/**
 * Note banners: a wide strip at the top of a note, stored as a property:
 *   banner: attachments/beach.jpg     an image in the notes folder (or a web address)
 *   banner: "#5ea8ff"                 a colour
 *   banner: aurora                    one of the gradients below
 *   banner_y: 30                      which part of a tall image shows (0 top … 100 bottom)
 */

export const BANNER_COLOURS = ['#4ade80', '#5ea8ff', '#8b7cf6', '#f472b6', '#f97066', '#e0a458', '#3ccfcf', '#64748b']

export const BANNER_GRADIENTS: Record<string, string> = {
  aurora: 'linear-gradient(120deg, #4ade80 0%, #3ccfcf 45%, #5ea8ff 100%)',
  sunset: 'linear-gradient(120deg, #f97066 0%, #fb923c 50%, #fbbf24 100%)',
  dusk: 'linear-gradient(120deg, #8b7cf6 0%, #f472b6 100%)',
  ocean: 'linear-gradient(160deg, #0ea5e9 0%, #1e3a8a 100%)',
  forest: 'linear-gradient(140deg, #166534 0%, #4ade80 100%)',
  night: 'linear-gradient(160deg, #1e1b4b 0%, #4c1d95 60%, #8b7cf6 100%)',
  peach: 'linear-gradient(120deg, #fecaca 0%, #fde68a 100%)',
  slate: 'linear-gradient(140deg, #334155 0%, #64748b 100%)'
}

export type Banner = { kind: 'image'; src: string; path: string } | { kind: 'fill'; css: string }

export function parseBanner(value: string | undefined): Banner | null {
  const v = (value ?? '').trim()
  if (!v) return null
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return { kind: 'fill', css: v }
  if (BANNER_GRADIENTS[v.toLowerCase()]) return { kind: 'fill', css: BANNER_GRADIENTS[v.toLowerCase()] }
  if (/^https?:\/\//i.test(v)) return { kind: 'image', src: v, path: v }
  // [[image.png]] or a plain path, from the top of the notes folder.
  const path = v.replace(/^\[\[|\]\]$/g, '').replace(/^\/+/, '')
  return { kind: 'image', src: toVaultUrl(path), path }
}

/** banner_y as a CSS background position (default: the middle). */
export const bannerY = (value: string | undefined): number => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50
}
