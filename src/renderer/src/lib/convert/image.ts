import { blobToDataUrl } from '../export'
import { extOf } from './formats'

export type ImageFormat = 'jpg' | 'png' | 'webp'

export interface ImageOptions {
  /** The longest side, in pixels; null keeps the size it is. */
  maxSide: number | null
  /** JPG and WebP: 0…1. */
  quality: number
}

const MIME: Record<ImageFormat, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

/** A picture's pixels, ready to draw. */
async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
  const ext = extOf(file.name)
  if (ext === 'heic' || ext === 'heif') {
    const { width, height, data } = await window.api.decodeHeic(new Uint8Array(await file.arrayBuffer()))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0)
    return { source: canvas, width, height }
  }
  if (ext === 'svg') {
    // A drawing has no fixed size; one without width and height comes out 1024 pixels wide.
    const img = new Image()
    img.src = await blobToDataUrl(new Blob([await file.arrayBuffer()], { type: 'image/svg+xml' }))
    await img.decode()
    const width = img.naturalWidth || 1024
    const height = img.naturalHeight || Math.round(width * 0.75)
    return { source: img, width, height }
  }
  try {
    const bitmap = await createImageBitmap(file)
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
  } catch {
    throw new Error('This picture couldn’t be opened. It may be damaged.')
  }
}

/** Converts a picture (iPhone HEIC photos too), optionally making it smaller. */
export async function convertImage(file: File, format: ImageFormat, opts: ImageOptions): Promise<Uint8Array> {
  const pic = await decode(file)
  try {
    const scale = opts.maxSide ? Math.min(1, opts.maxSide / Math.max(pic.width, pic.height)) : 1
    const width = Math.max(1, Math.round(pic.width * scale))
    const height = Math.max(1, Math.round(pic.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    // JPG has no see-through parts: those become white rather than black.
    if (format === 'jpg') {
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, width, height)
    }
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(pic.source, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, MIME[format], format === 'png' ? undefined : opts.quality))
    if (!blob) throw new Error('The picture is too big to convert.')
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    pic.close?.()
  }
}
