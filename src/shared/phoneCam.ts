/**
 * Pure helpers for the phone webcam (src/main/phoneCam.ts): the shape of the shared memory the
 * webcam driver reads, and the little messages Orbit sends its Windows helper.
 *
 * The driver is OBS Studio's "OBS Virtual Camera", which apps like Discord, Zoom and Teams list
 * as a normal webcam. It reads frames from a block of shared memory called "OBSVirtualCamVideo":
 * an 80-byte header (padded to 96), then three NV12 frames, each after a 32-byte timestamp. This
 * mirrors plugins/win-dshow/shared-memory-queue.c in OBS, so any app that writes it the same way
 * becomes the camera.
 */

export const QUEUE_NAME = 'OBSVirtualCamVideo'
/** The header's fields, by byte offset (uint32 unless noted). */
export const HEADER = {
  writeIdx: 0,
  readIdx: 4,
  state: 8,
  offsets: 12,
  type: 24,
  cx: 28,
  cy: 32,
  /** uint64, 100 ns units */ interval: 40
} as const
export const HEADER_SIZE = 80
export const FRAME_HEADER_SIZE = 32
export const QUEUE_STATE = {
  invalid: 0,
  starting: 1,
  ready: 2,
  stopping: 3
} as const

const align32 = (n: number): number => (n + 31) & ~31

export interface QueueLayout {
  /** NV12: a full-size brightness plane, then a half-size colour plane. */
  frameSize: number
  /** Where each of the three frames' timestamps start; the picture is FRAME_HEADER_SIZE after. */
  offsets: [number, number, number]
  /** The whole block. */
  size: number
  /** Time between frames in 100 ns units (what DirectShow counts in). */
  interval: number
}

export function queueLayout(width: number, height: number, fps: number): QueueLayout {
  const frameSize = (width * height * 3) / 2
  let size = align32(HEADER_SIZE)
  const offsets: number[] = []
  for (let i = 0; i < 3; i++) {
    offsets.push(size)
    size = align32(size + frameSize + FRAME_HEADER_SIZE)
  }
  return {
    frameSize,
    offsets: offsets as [number, number, number],
    size,
    interval: Math.round(10_000_000 / fps)
  }
}

export type CamQuality = 'sd' | 'hd'

/** What the PC camera puts out. 720p is what most video calls send anyway. */
export const CAM_SIZES: Record<CamQuality, { width: number; height: number }> = {
  sd: { width: 1280, height: 720 },
  hd: { width: 1920, height: 1080 }
}
export const CAM_FPS = 30

/** Messages to the Windows helper on its stdin: a type byte, a little-endian length, then the bytes. */
export const HELPER_MSG = { frame: 1, fill: 2 } as const

export function helperMessage(type: number, data: Uint8Array): Buffer {
  const head = Buffer.alloc(5)
  head[0] = type
  head.writeUInt32LE(data.length, 1)
  return Buffer.concat([head, data])
}

/** A JPEG starts FF D8 FF. */
export const isJpeg = (data: Uint8Array): boolean => data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
