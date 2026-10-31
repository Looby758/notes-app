/**
 * The Studio (components/Studio): build scenes out of your screen, webcam, pictures and text, mix
 * your mic and desktop sound, and record it all to a video. This file is the plain data and maths
 * (no DOM), so it can be tested.
 *
 * Positions and sizes are fractions of the output picture (0–1), so a scene looks the same at
 * 720p and 1080p.
 */

export type StudioSourceKind = 'screen' | 'camera' | 'image' | 'text' | 'nowPlaying'

export interface StudioItem {
  id: string
  kind: StudioSourceKind
  name: string
  x: number
  y: number
  w: number
  h: number
  visible: boolean
  /** Corner rounding, as a fraction of the shorter side (0 = square, 0.5 = circle/pill). */
  radius: number
  /** 'contain' shows all of it (letterboxed), 'cover' fills the box and crops. */
  fit: 'contain' | 'cover'
  /** Screen/window: the desktopCapturer id. Camera: the device id ('' = the default camera). */
  deviceId?: string
  /** Mirror the webcam, like looking in a mirror. */
  mirror?: boolean
  /** Picture: a data: URL. */
  image?: string
  /** Text. */
  text?: string
  color?: string
  /** Text: draw a dark pill behind it so it's readable over anything. */
  background?: boolean
}

export interface StudioScene {
  id: string
  name: string
  items: StudioItem[]
}

export interface StudioQuality {
  id: '720p30' | '1080p30' | '1080p60'
  label: string
  width: number
  height: number
  fps: number
  /** Video bits per second. */
  bitrate: number
}

export const QUALITIES: StudioQuality[] = [
  { id: '720p30', label: '720p · 30 fps (smaller files)', width: 1280, height: 720, fps: 30, bitrate: 5_000_000 },
  { id: '1080p30', label: '1080p · 30 fps', width: 1920, height: 1080, fps: 30, bitrate: 8_000_000 },
  { id: '1080p60', label: '1080p · 60 fps (smooth, for games)', width: 1920, height: 1080, fps: 60, bitrate: 12_000_000 }
]

export const qualityById = (id: string | undefined): StudioQuality => QUALITIES.find((q) => q.id === id) ?? QUALITIES[1]

export const SOURCE_LABELS: Record<StudioSourceKind, string> = {
  screen: 'Screen or window',
  camera: 'Webcam',
  image: 'Picture',
  text: 'Text',
  nowPlaying: 'Now playing'
}

let counter = 0
export const studioId = (): string => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** A new source, placed where that kind usually goes (the webcam bottom-right, text top-left…). */
export function newItem(kind: StudioSourceKind, extra: Partial<StudioItem> = {}): StudioItem {
  const base: StudioItem = { id: studioId(), kind, name: SOURCE_LABELS[kind], x: 0, y: 0, w: 1, h: 1, visible: true, radius: 0, fit: 'contain' }
  const placed: Partial<StudioItem> =
    kind === 'camera'
      ? { x: 0.74, y: 0.7, w: 0.24, h: 0.27, radius: 0.08, fit: 'cover', mirror: true }
      : kind === 'text'
        ? { x: 0.03, y: 0.04, w: 0.4, h: 0.07, text: 'Hello!', color: '#ffffff', background: true }
        : kind === 'nowPlaying'
          ? { x: 0.02, y: 0.86, w: 0.3, h: 0.11, radius: 0.15 }
          : kind === 'image'
            ? { x: 0.35, y: 0.3, w: 0.3, h: 0.4 }
            : {}
  return { ...base, ...placed, ...extra }
}

export function defaultScenes(): StudioScene[] {
  return [
    { id: studioId(), name: 'Main', items: [] },
    { id: studioId(), name: 'Starting soon', items: [newItem('text', { text: 'Starting soon…', x: 0.2, y: 0.42, w: 0.6, h: 0.14 })] }
  ]
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** The smallest a source can be resized to (as a fraction of the picture). */
export const MIN_SIZE = 0.03

/** Keeps a box mostly on screen: at least a sliver of it stays grabbable. */
export function keepOnScreen<T extends { x: number; y: number; w: number; h: number }>(r: T): T {
  const w = clamp(r.w, MIN_SIZE, 4)
  const h = clamp(r.h, MIN_SIZE, 4)
  const edge = 0.02
  return { ...r, w, h, x: clamp(r.x, edge - w, 1 - edge), y: clamp(r.y, edge - h, 1 - edge) }
}

/** Where a picture of `srcW`×`srcH` is drawn inside a box, for 'contain' (letterboxed) or 'cover' (cropped). */
export function fitRect(
  srcW: number,
  srcH: number,
  box: { x: number; y: number; w: number; h: number },
  fit: 'contain' | 'cover'
): { x: number; y: number; w: number; h: number } {
  if (srcW <= 0 || srcH <= 0 || box.w <= 0 || box.h <= 0) return { ...box }
  const scale = fit === 'contain' ? Math.min(box.w / srcW, box.h / srcH) : Math.max(box.w / srcW, box.h / srcH)
  const w = srcW * scale
  const h = srcH * scale
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }
}

/** The topmost visible source under a point (sources later in the list are drawn on top). */
export function itemAt(items: StudioItem[], px: number, py: number): StudioItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.visible && px >= it.x && px <= it.x + it.w && py >= it.y && py <= it.y + it.h) return it
  }
  return null
}

export type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se'

/**
 * A box after dragging by (dx, dy) from `handle`. Corners resize from the opposite corner; with
 * `keepRatio` (the default for screens, webcams and pictures) the shape stays the same.
 */
export function dragRect(
  start: { x: number; y: number; w: number; h: number },
  handle: Handle,
  dx: number,
  dy: number,
  keepRatio: boolean
): { x: number; y: number; w: number; h: number } {
  if (handle === 'move') return keepOnScreen({ ...start, x: start.x + dx, y: start.y + dy })
  const left = handle === 'nw' || handle === 'sw'
  const top = handle === 'nw' || handle === 'ne'
  let w = start.w + (left ? -dx : dx)
  let h = start.h + (top ? -dy : dy)
  if (keepRatio && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h
    // Follow whichever way the mouse moved further.
    if (Math.abs(w / start.w) > Math.abs(h / start.h)) h = w / ratio
    else w = h * ratio
  }
  w = Math.max(MIN_SIZE, w)
  h = Math.max(MIN_SIZE, h)
  const x = left ? start.x + start.w - w : start.x
  const y = top ? start.y + start.h - h : start.y
  return keepOnScreen({ x, y, w, h })
}

/** Snaps an edge to the picture's edges and centre lines when it's within `within`. */
export function snap(r: { x: number; y: number; w: number; h: number }, within = 0.012): { x: number; y: number; w: number; h: number } {
  const pick = (pos: number, size: number): number => {
    for (const target of [0, 0.5 - size / 2, 1 - size]) if (Math.abs(pos - target) < within) return target
    return pos
  }
  return { ...r, x: pick(r.x, r.w), y: pick(r.y, r.h) }
}

/** The video formats to try, best first. Chromium records MP4 (H.264 + AAC) since version 126. */
export const RECORDING_TYPES: { mime: string; ext: 'mp4' | 'webm' }[] = [
  { mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' }
]

export function pickRecordingType(isSupported: (mime: string) => boolean): { mime: string; ext: 'mp4' | 'webm' } | null {
  return RECORDING_TYPES.find((t) => isSupported(t.mime)) ?? null
}

/** "Recording 2026-10-31 14-05-09.mp4" (no colons: Windows doesn't allow them). */
export function recordingFileName(date: Date, ext: string): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `Recording ${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}.${ext}`
}

/** 0:07, 12:45, 1:02:03 */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** Makes saved scenes safe to use: drops anything malformed, fills in what's missing. */
export function cleanScenes(raw: unknown): StudioScene[] | null {
  if (!Array.isArray(raw)) return null
  const kinds = new Set<string>(Object.keys(SOURCE_LABELS))
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const scenes: StudioScene[] = []
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue
    const sc = s as Partial<StudioScene>
    const items: StudioItem[] = []
    for (const i of Array.isArray(sc.items) ? sc.items : []) {
      if (!i || typeof i !== 'object' || !kinds.has((i as StudioItem).kind)) continue
      const it = i as StudioItem
      const fresh = newItem(it.kind)
      items.push(
        keepOnScreen({
          ...fresh,
          ...it,
          id: typeof it.id === 'string' ? it.id : fresh.id,
          name: typeof it.name === 'string' ? it.name : fresh.name,
          x: num(it.x, fresh.x),
          y: num(it.y, fresh.y),
          w: num(it.w, fresh.w),
          h: num(it.h, fresh.h),
          radius: clamp(num(it.radius, 0), 0, 0.5),
          visible: it.visible !== false,
          fit: it.fit === 'cover' ? 'cover' : 'contain'
        })
      )
    }
    scenes.push({ id: typeof sc.id === 'string' ? sc.id : studioId(), name: typeof sc.name === 'string' && sc.name ? sc.name : 'Scene', items })
  }
  return scenes.length ? scenes : null
}
